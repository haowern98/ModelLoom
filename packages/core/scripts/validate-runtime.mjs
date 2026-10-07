import path from 'node:path';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { setTimeout as delay } from 'node:timers/promises';
import {
  createDevelopmentRuntimeVerifier,
  requireLivePackage,
} from '../out/runtime-package/verifier.js';
import { installExpanded, revalidateInstalled } from '../out/runtime-package/install.js';
import { ownershipBinding, confirmExit } from '../out/hosts/windows-ownership.js';
import { inspectGGUF } from '../out/runtime/gguf.js';
import { discoverResources } from '../out/hosts/resource-probe.js';
import { fixedArguments } from '../out/hosts/runtime-arguments.js';
import { checkOwnedReadiness } from '../out/hosts/readiness.js';
// Explicit development calibration, not live-loader admission. The estimator stays uncertain
// until its allocations are compared with these actual, bounded, owned runtime observations.
if (process.argv.length !== 3) throw new Error('Use validate-runtime.mjs <Bonsai-Q1_0.gguf>');
const base = path.resolve('out/activation/b11306'),
  model = path.resolve(process.argv[2]);
const cfg = Object.freeze({
  modelSha256: '71d6871836886267f39f1ac69b1b1dd8a783970708d7a189960112ed02978901',
  contextPerSlot: 7680,
  slots: 1,
  gpuLayers: 999999,
  gpuDevice: 'GPU-22c23971-dacf-2123-2169-ad70d8f6729a',
  cacheK: 'q8_0',
  cacheV: 'q8_0',
  seed: 7,
  temperature: 0.8,
});
const planner = await readFile(path.join(base, 'evidence/planner.log'), 'utf8');
const gpu = /^CUDA0 (\d+) (\d+) (\d+)\s*$/mu.exec(planner),
  host = /^Host (\d+) (\d+) (\d+)\s*$/mu.exec(planner);
if (!gpu || !host) throw new Error('NEEDS_RESOURCE_EVIDENCE');
// Printed MiB are truncated; round each category upward. This is a diagnostic budget only.
const budget = (values) =>
  values.slice(1).reduce((sum, value) => sum + (Number(value) + 1) * 1048576, 0);
const capability = await createDevelopmentRuntimeVerifier().verify(
  path.join(base, 'repository'),
  path.join(base, 'verification'),
);
const inventory = requireLivePackage(capability).inventory;
if (
  inventory.upstreamCommit !== '4f31296a907d73f3409f720429bcf31111615d77' ||
  inventory.backend !== 'cuda'
)
  throw new Error('UNSUPPORTED_RUNTIME');
const installed = await installExpanded(
  capability,
  path.join(base, 'candidate'),
  path.join(base, 'installed'),
);
const native = ownershipBinding(),
  root = native.createDeployment(),
  lock = await revalidateInstalled(installed);
const temp = path.join(base, 'calibration-temporary');
native.privateDirectory(temp);
const key = randomBytes(32).toString('base64url'),
  keyFile = path.join(temp, 'key');
await writeFile(keyFile, key + '\n', { flag: 'wx', mode: 0o600 });
let modelLock,
  child,
  timer,
  output = '',
  ended = false,
  captured = false,
  serverPid,
  exitCode;
const evidence = {
  configuration: cfg,
  artifact: inventory.artifact,
  tests: [],
  uncertainty: 'Actual memory comparison pending',
};
const port = 18476,
  alias = 'bonsai-development-calibration';
const drain = () => {
  const state = native.observe(child);
  if (state.peakWorkingSet < 0) throw new Error('MEMORY_OBSERVATION_FAILED');
  evidence.peakWorkingSet = Math.max(evidence.peakWorkingSet ?? 0, state.peakWorkingSet);
  evidence.peakJobCommit = Math.max(evidence.peakJobCommit ?? 0, state.peakJobCommit);
  output += state.output;
  if (Buffer.byteLength(output) > 1024 * 1024) throw new Error('OUTPUT_LIMIT');
  if (!captured && output.includes('\n')) {
    const receipt = /^ENGINE ([1-9][0-9]*)\r?$/u.exec(output.slice(0, output.indexOf('\n')));
    if (!receipt) throw new Error('INVALID_CONTROL');
    serverPid = Number(receipt[1]);
    native.captureServer(child, serverPid, path.join(installed.directory, inventory.entrypoint));
    captured = true;
  }
  ended = state.exitCode !== -1 && state.activeProcesses === 0;
  exitCode = state.exitCode;
};
const call = async (endpoint, body, signal = globalThis.AbortSignal.timeout(60000)) => {
  if (!native.ownedListener(child, port)) throw new Error('NOT_READY');
  const response = await globalThis.fetch(`http://127.0.0.1:${port}${endpoint}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'error',
    signal,
  });
  let bytes = Buffer.alloc(0);
  for await (const chunk of response.body) {
    if (bytes.length + chunk.length > 1024 * 1024) throw new Error('RESPONSE_LIMIT');
    bytes = Buffer.concat([bytes, chunk]);
  }
  if (!response.ok) throw new Error('REQUEST_FAILED');
  return JSON.parse(bytes.toString('utf8'));
};
try {
  modelLock = native.sealFiles([model]);
  const info = await inspectGGUF(model);
  if (info.sha256 !== cfg.modelSha256 || info.contextLimit < cfg.contextPerSlot)
    throw new Error('INVALID_CONFIGURATION');
  evidence.before = await discoverResources();
  const selected = evidence.before.gpus?.find((g) => g.uuid === cfg.gpuDevice);
  if (
    !selected ||
    selected.free === null ||
    selected.free < budget(gpu) ||
    evidence.before.ram === null ||
    evidence.before.ram < budget(host)
  )
    throw new Error('INSUFFICIENT_RESOURCES');
  requireLivePackage(capability);
  child = native.launchCudaConsole(
    root,
    path.join(installed.directory, inventory.helper),
    [
      path.join(installed.directory, inventory.entrypoint),
      ...fixedArguments(model, cfg, port, keyFile, alias),
      '--log-verbosity',
      '5',
    ],
    temp,
    cfg.gpuDevice,
  );
  timer = globalThis.setInterval(() => {
    try {
      drain();
    } catch {
      native.forceStop(child);
    }
  }, 20);
  const deadline = Date.now() + 180000;
  let ready = false;
  while (!ready && Date.now() < deadline) {
    drain();
    if (ended) throw new Error('START_FAILED');
    if (captured)
      try {
        await checkOwnedReadiness(
          port,
          key,
          alias,
          7680,
          1,
          () => native.ownedListener(child, port),
          globalThis.AbortSignal.timeout(2000),
        );
        ready = true;
      } catch {
        /* Loading is retried within the fixed startup deadline. */
      }
    if (!ready) await delay(100);
  }
  if (!ready) throw new Error('START_TIMEOUT');
  evidence.tests.push('owned authenticated readiness/context=7680/slots=1');
  evidence.loaded = await discoverResources();
  console.log('Bonsai loaded with the exact configuration; testing bounded generation.');
  const response = await call('/completion', {
    prompt: 'Say hello in one sentence.',
    n_predict: 16,
    temperature: cfg.temperature,
    seed: cfg.seed,
    stream: false,
  });
  if (
    typeof response.content !== 'string' ||
    !response.content.length ||
    response.tokens_predicted < 1 ||
    response.tokens_predicted > 16
  )
    throw new Error('GENERATION_FAILED');
  evidence.tests.push('bounded response');
  const tokenized = await call('/tokenize', { content: ' calibration' });
  if (
    !Array.isArray(tokenized.tokens) ||
    !tokenized.tokens.length ||
    tokenized.tokens.some((t) => !Number.isInteger(t))
  )
    throw new Error('TOKENIZATION_FAILED');
  const prompt = Array.from(
    { length: 7500 },
    (_, i) => tokenized.tokens[i % tokenized.tokens.length],
  );
  const full = await call(
    '/completion',
    { prompt, n_predict: 16, temperature: cfg.temperature, seed: cfg.seed, stream: false },
    globalThis.AbortSignal.timeout(180000),
  );
  if (full.tokens_evaluated !== 7500 || full.tokens_predicted < 1 || full.tokens_predicted > 16)
    throw new Error('CONTEXT_VALIDATION_FAILED');
  evidence.tests.push('7500-token prefill and bounded decode');
  evidence.afterGeneration = await discoverResources();
  console.log('High-context generation passed; testing caller cancellation and graceful shutdown.');
  const controller = new globalThis.AbortController();
  const pending = call(
    '/completion',
    {
      prompt: 'Write a long essay about computing.',
      n_predict: 2048,
      stream: true,
      temperature: cfg.temperature,
      seed: cfg.seed,
    },
    controller.signal,
  ).catch((error) => error);
  await delay(1500);
  controller.abort();
  const cancelled = await pending;
  if (!(cancelled instanceof Error)) throw new Error('CANCELLATION_FAILED');
  await delay(500);
  const after = await call('/completion', {
    prompt: 'Say hello.',
    n_predict: 8,
    temperature: cfg.temperature,
    seed: cfg.seed,
    stream: false,
  });
  if (after.tokens_predicted < 1) throw new Error('CANCELLATION_RECOVERY_FAILED');
  evidence.tests.push('cancelled streaming request and subsequent response');
  native.requestStop(child);
  await confirmExit(() => {
    drain();
    return ended;
  }, 5000);
  evidence.tests.push('graceful owned shutdown within 5 seconds');
  evidence.exitCode = exitCode;
  evidence.afterExit = await discoverResources();
  console.log(JSON.stringify({ tests: evidence.tests, exitCode, serverPid }));
} finally {
  if (timer) globalThis.clearInterval(timer);
  native.closeDeployment(root);
  if (child) {
    await confirmExit(() => {
      drain();
      return ended;
    });
    native.release(child);
  }
  lock.release();
  if (modelLock) native.releaseFiles(modelLock);
  await mkdir(path.join(base, 'evidence'), { recursive: true });
  await writeFile(
    path.join(base, 'evidence/calibration.log'),
    output.replaceAll(key, '[redacted]'),
  );
  await writeFile(path.join(base, 'evidence/calibration.json'), JSON.stringify(evidence, null, 2));
  await rm(keyFile);
}
