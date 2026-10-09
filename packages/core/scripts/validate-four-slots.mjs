import path from 'node:path';
import { Buffer } from 'node:buffer';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';
import {
  createDevelopmentRuntimeVerifier,
  requireLivePackage,
} from '../out/runtime-package/verifier.js';
import { installExpanded, revalidateInstalled } from '../out/runtime-package/install.js';
import { ownershipBinding, confirmExit } from '../out/hosts/windows-ownership.js';
import { discoverResources } from '../out/hosts/resource-probe.js';
import { inspectGGUF } from '../out/runtime/gguf.js';
import { fixedArguments } from '../out/hosts/runtime-arguments.js';
import { checkOwnedReadiness } from '../out/hosts/readiness.js';
import { SERVER_CACHE_POLICY } from '../out/runtime/preflight.js';
import { diagnosticBudget, admitsDiagnostic } from './four-slot-budget.mjs';

// Explicit bounded calibration only. This does not add a normal-loader memory report.
if (process.argv.length !== 3) throw new Error('Use validate-four-slots.mjs <Bonsai.gguf>');
const base = path.resolve('out/activation/b11306'),
  model = path.resolve(process.argv[2]);
const configuration = Object.freeze({
  modelSha256: '71d6871836886267f39f1ac69b1b1dd8a783970708d7a189960112ed02978901',
  contextPerSlot: 7680,
  slots: 4,
  gpuLayers: 999999,
  gpuDevice: 'GPU-22c23971-dacf-2123-2169-ad70d8f6729a',
  cacheK: 'q8_0',
  cacheV: 'q8_0',
  seed: 7,
  temperature: 0.8,
});
const planner = JSON.parse(
  await readFile(path.join(base, 'evidence/planner-four-slots-input.json'), 'utf8'),
);
const plannerLog = await readFile(path.join(base, 'evidence/planner-four-slots.log'), 'utf8');
if (
  !isDeepStrictEqual(planner.configuration, configuration) ||
  planner.status !== 0 ||
  !/^CUDA0 3446 1618 512\s*$/mu.test(plannerLog) ||
  !/^Host 170 0 27\s*$/mu.test(plannerLog)
)
  throw new Error('NEEDS_RESOURCE_EVIDENCE');
const capability = await createDevelopmentRuntimeVerifier().verify(
  path.join(base, 'repository'),
  path.join(base, 'four-slot-verification'),
);
const inventory = requireLivePackage(capability).inventory;
if (
  inventory.upstreamCommit !== '4f31296a907d73f3409f720429bcf31111615d77' ||
  inventory.artifact !== planner.inventory.artifact
)
  throw new Error('UNSUPPORTED_RUNTIME');
const installed = await installExpanded(
  capability,
  path.join(base, 'candidate'),
  path.join(base, 'installed'),
);
const native = ownershipBinding(),
  root = native.createDeployment();
const temporary = path.join(base, 'four-slot-temporary');
native.privateDirectory(temporary);
const keyFile = path.join(temporary, 'key'),
  secret = randomBytes(32).toString('base64url');
const port = 18479,
  alias = 'bonsai-four-slot-validation',
  server = path.join(installed.directory, inventory.entrypoint);
let child,
  lock,
  modelLock,
  timer,
  failure,
  captured = false,
  output = '',
  receipt;
const evidence = {
  configuration,
  cachePolicy: SERVER_CACHE_POLICY,
  artifact: inventory.artifact,
  diagnosticBudget,
  phases: [],
};
const drain = () => {
  const value = native.observe(child);
  output += value.output;
  if (Buffer.byteLength(output) > 4 * 1024 ** 2) throw new Error('OUTPUT_LIMIT');
  if (!captured && output.includes('\n')) {
    const match = /^ENGINE ([1-9][0-9]*)\r?$/u.exec(output.slice(0, output.indexOf('\n')));
    if (!match) throw new Error('INVALID_CONTROL');
    native.captureServer(child, Number(match[1]), server);
    evidence.pid = Number(match[1]);
    captured = true;
  }
  if (value.peakWorkingSet < 0 || value.peakJobCommit < 0)
    throw new Error('MEMORY_OBSERVATION_FAILED');
  if (
    value.activeProcesses > 0 &&
    (native.availableMemory() < 1024 ** 3 || value.peakJobCommit > 12 * 1024 ** 3)
  )
    throw new Error('DIAGNOSTIC_MEMORY_LIMIT');
  return value;
};
const post = async (endpoint, body) => {
  if (failure) throw failure;
  if (!native.ownedListener(child, port)) throw new Error('NOT_READY');
  const response = await globalThis.fetch(`http://127.0.0.1:${port}${endpoint}`, {
    method: 'POST',
    redirect: 'error',
    signal: globalThis.AbortSignal.timeout(180000),
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  let bytes = Buffer.alloc(0);
  for await (const chunk of response.body) {
    if (bytes.length + chunk.length > 256 * 1024) throw new Error('RESPONSE_LIMIT');
    bytes = Buffer.concat([bytes, chunk]);
  }
  if (!response.ok || failure) throw failure ?? new Error('REQUEST_FAILED');
  return JSON.parse(bytes.toString('utf8'));
};
const cycle = async (prompt, phase, slots = [0, 1, 2, 3]) => {
  console.log(JSON.stringify({ phase }));
  const results = await Promise.all(
    slots.map(async (id_slot) => {
      const result = await post('/completion', {
        prompt,
        id_slot,
        n_predict: 16,
        cache_prompt: true,
        temperature: configuration.temperature,
        seed: configuration.seed,
        stream: false,
      });
      if (
        typeof result.content !== 'string' ||
        !result.content.length ||
        result.tokens_predicted < 1 ||
        result.tokens_predicted > 16
      )
        throw new Error('GENERATION_FAILED');
      return { slot: id_slot, timings: result.timings, tokensPredicted: result.tokens_predicted };
    }),
  );
  evidence.phases.push({ phase, results, memory: drain() });
};
try {
  lock = await revalidateInstalled(installed);
  modelLock = native.sealFiles([model]);
  if ((await inspectGGUF(model)).sha256 !== configuration.modelSha256)
    throw new Error('UNSUPPORTED_MODEL');
  const before = await discoverResources();
  evidence.before = before;
  if (!admitsDiagnostic(before)) throw new Error('INSUFFICIENT_DIAGNOSTIC_RESOURCES');
  await writeFile(keyFile, `${secret}\n`, { flag: 'wx', mode: 0o600 });
  requireLivePackage(capability);
  child = native.launchCudaConsole(
    root,
    path.join(installed.directory, inventory.helper),
    [server, ...fixedArguments(model, configuration, port, keyFile, alias), '--log-verbosity', '5'],
    temporary,
    configuration.gpuDevice,
  );
  timer = globalThis.setInterval(() => {
    try {
      drain();
    } catch (error) {
      failure = error;
      native.forceStop(child);
    }
  }, 20);
  const deadline = Date.now() + 180000;
  let ready = false;
  while (Date.now() < deadline) {
    if (failure) throw failure;
    if (drain().exitCode !== -1) throw new Error('START_FAILED');
    if (captured) {
      try {
        await checkOwnedReadiness(
          port,
          secret,
          alias,
          7680,
          4,
          () => native.ownedListener(child, port),
          globalThis.AbortSignal.timeout(2000),
        );
        ready = true;
        break;
      } catch {
        /* Bound all readiness retries to this one owned launch. */
      }
    }
    await delay(100);
  }
  if (!ready) throw new Error('START_TIMEOUT');
  evidence.readyMemory = drain();
  const tokenized = await post('/tokenize', {
    content: 'Summarize these notes: ' + 'Information is stored in memory. '.repeat(3000),
    add_special: true,
  });
  if (!Array.isArray(tokenized.tokens) || tokenized.tokens.length < 7500)
    throw new Error('TOKENIZATION_FAILED');
  const prompt = tokenized.tokens.slice(0, 7500);
  await cycle(prompt, 'four-concurrent-7500-token-prefills');
  await cycle(prompt, 'four-slot-cache-reuse');
  if (evidence.phases.at(-1).results.some((r) => !(r.timings?.cache_n > 0)))
    throw new Error('SLOT_CACHE_REUSE_FAILED');
  // The shared 768 MiB cache does not promise four near-limit prompt snapshots.
  // Replace all near-limit resident prompts before testing the short restoration
  // workload, so idle slots cannot repeatedly evict it from the shared cache.
  const cachePrompt = `Explain briefly: ${'Information is stored in memory. '.repeat(16)}`;
  await cycle(cachePrompt, 'bounded-RAM-cache-prompts');
  await cycle('Count from one to three.', 'replace-slot-zero-prompt', [0]);
  await cycle(cachePrompt, 'restore-slot-zero-prompt', [0]);
  if (
    !output.includes('found better prompt') ||
    evidence.phases.at(-1).results.some((r) => !(r.timings?.cache_n > 0))
  )
    throw new Error('RAM_CACHE_RESTORE_FAILED');
  native.requestStop(child);
  await confirmExit(() => {
    receipt = drain();
    return receipt.activeProcesses === 0 && receipt.exitCode !== -1;
  }, 5000);
  if (receipt.exitCode !== 0 || failure) throw failure ?? new Error('EXIT_FAILED');
  evidence.exit = { ...receipt, output: undefined };
  evidence.passed = true;
} catch (error) {
  evidence.error = error instanceof Error ? error.message : 'VALIDATION_FAILED';
  throw error;
} finally {
  globalThis.clearInterval(timer);
  native.closeDeployment(root);
  if (child) {
    await confirmExit(() => {
      const observation = native.observe(child);
      return observation.activeProcesses === 0 && observation.exitCode !== -1;
    });
    evidence.finalObservation = { ...native.observe(child), output: undefined };
    native.release(child);
  }
  lock?.release();
  if (modelLock) native.releaseFiles(modelLock);
  await rm(keyFile, { force: true });
  // Native logs may echo startup arguments, so redact the captured credential before retention.
  await writeFile(
    path.join(base, 'evidence/four-slots.log'),
    output.replaceAll(secret, '[redacted]'),
  );
  for (const phase of evidence.phases) delete phase.memory.output;
  if (evidence.readyMemory) delete evidence.readyMemory.output;
  await writeFile(path.join(base, 'evidence/four-slots.json'), JSON.stringify(evidence, null, 2));
  console.log(
    JSON.stringify({
      passed: evidence.passed === true,
      error: evidence.error,
      exit: evidence.finalObservation,
    }),
  );
}
