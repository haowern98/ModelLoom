import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import process from 'node:process';
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
import {
  DEVELOPMENT_BUILD,
  DEVELOPMENT_MEMORY_REPORTS,
} from '../out/runtime-package/development-policy.js';
import { SERVER_CACHE_POLICY } from '../out/runtime/preflight.js';
import { checkCudaResources } from '../out/runtime/gpu-resources.js';

// Bounded development diagnostic, never normal-loader admission or a memory-report override.
// One real model is loaded at a time. The other deployment contains a harmless native probe.
const worker = process.argv[3] === '--worker';
if (!DEVELOPMENT_BUILD || process.argv.length !== (worker ? 4 : 3))
  throw new Error('Use the explicit development build and validate-lifecycle.mjs <Bonsai.gguf>');
const base = path.resolve('out/activation/b11306');
const temporary = path.join(base, 'lifecycle-temporary');
const model = path.resolve(process.argv[2]);
const native = ownershipBinding();
const configuration = Object.freeze({
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
const port = 18477;
const emit = (event) => console.log(`DIAGNOSTIC ${JSON.stringify(event)}`);

async function runWorker() {
  // Only the captured parent pipe can request the two fixed diagnostic phases.
  let continueRun;
  const continuation = new Promise((resolve) => {
    continueRun = resolve;
  });
  process.stdin.on('data', (data) => {
    for (const command of data) {
      if (command === 83) continueRun();
      // Intentional owner death: no finally, stop command or credential cleanup here.
      else if (command === 65) process.exit(91);
      else process.exit(92);
    }
  });
  const capability = await createDevelopmentRuntimeVerifier().verify(
    path.join(base, 'repository'),
    path.join(base, 'lifecycle-verification'),
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
  const server = path.join(installed.directory, inventory.entrypoint);
  const root = native.createDeployment();
  native.privateDirectory(temporary);
  const keyFile = path.join(temporary, 'key');
  const modelLock = native.sealFiles([model]);
  const info = await inspectGGUF(model);
  if (info.sha256 !== configuration.modelSha256 || info.contextLimit < 7680)
    throw new Error('INVALID_CONFIGURATION');
  const planner = await readFile(path.join(base, 'evidence/planner.log'), 'utf8');
  const gpu = /^CUDA0 (\d+) (\d+) (\d+)\s*$/mu.exec(planner);
  if (!gpu) throw new Error('NEEDS_RESOURCE_EVIDENCE');
  const gpuFloor = gpu.slice(1).reduce((sum, value) => sum + (Number(value) + 1) * 1048576, 0);
  let child, lock, secret, alias, pid, timer, failure;
  let output = '',
    captured = false;
  const evidence = {
    configuration,
    cachePolicy: SERVER_CACHE_POLICY,
    artifact: inventory.artifact,
    tests: [],
    launches: [],
  };
  const drain = () => {
    const observation = native.observe(child);
    output += observation.output;
    if (Buffer.byteLength(output) > 1024 * 1024) throw new Error('OUTPUT_LIMIT');
    if (!captured && output.includes('\n')) {
      const receipt = /^ENGINE ([1-9][0-9]*)\r?$/u.exec(output.slice(0, output.indexOf('\n')));
      if (!receipt) throw new Error('INVALID_CONTROL');
      pid = Number(receipt[1]);
      native.captureServer(child, pid, server);
      captured = true;
      emit({ phase: 'loading', pid, server });
    }
    if (observation.peakWorkingSet < 0 || observation.peakJobCommit < 0)
      throw new Error('MEMORY_OBSERVATION_FAILED');
    if (
      observation.activeProcesses > 0 &&
      (native.availableMemory() < 1048576 * 1024 || observation.peakJobCommit > 8 * 1024 ** 3)
    )
      throw new Error('DIAGNOSTIC_MEMORY_LIMIT');
    return observation;
  };
  const start = async () => {
    lock = await revalidateInstalled(installed);
    secret = randomBytes(32).toString('base64url');
    alias = `bonsai-lifecycle-${evidence.launches.length + 1}`;
    await writeFile(keyFile, `${secret}\n`, { flag: 'wx', mode: 0o600 });
    const before = await discoverResources();
    // Use the same exact reviewed physical-RAM admission estimate as the development
    // adapter. The retained-job/free-RAM abort limits below remain additional guards.
    const admission = checkCudaResources(
      configuration,
      inventory.artifact,
      DEVELOPMENT_MEMORY_REPORTS[0],
      before,
      inventory.minimumDriver,
    );
    if (admission.code !== 'ADMITTED' || admission.vram < gpuFloor)
      throw new Error('INSUFFICIENT_DIAGNOSTIC_RESOURCES');
    requireLivePackage(capability);
    output = '';
    captured = false;
    failure = undefined;
    child = native.launchCudaConsole(
      root,
      path.join(installed.directory, inventory.helper),
      [
        server,
        ...fixedArguments(model, configuration, port, keyFile, alias),
        '--log-verbosity',
        '5',
      ],
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
            1,
            () => native.ownedListener(child, port),
            globalThis.AbortSignal.timeout(2000),
          );
          evidence.launches.push({ pid, before });
          return;
        } catch {
          /* Loading is retried only within the fixed startup deadline. */
        }
      }
      await delay(100);
    }
    throw new Error('START_TIMEOUT');
  };
  // A three-token prompt has no reusable recurrent checkpoint. Use a small but
  // sufficiently long prompt so this test exercises actual reuse rather than that fallback.
  const greet = async (
    prompt = `Explain briefly: ${'Information is stored in memory. '.repeat(16)}`,
  ) => {
    if (failure) throw failure;
    if (!native.ownedListener(child, port)) throw new Error('NOT_READY');
    const response = await globalThis.fetch(`http://127.0.0.1:${port}/completion`, {
      method: 'POST',
      redirect: 'error',
      signal: globalThis.AbortSignal.timeout(60000),
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt,
        n_predict: 8,
        temperature: configuration.temperature,
        seed: configuration.seed,
        stream: false,
      }),
    });
    let bytes = Buffer.alloc(0);
    for await (const chunk of response.body) {
      if (bytes.length + chunk.length > 65536) throw new Error('RESPONSE_LIMIT');
      bytes = Buffer.concat([bytes, chunk]);
    }
    const value = JSON.parse(bytes.toString('utf8'));
    evidence.lastTimings = value.timings;
    if (
      !response.ok ||
      typeof value.content !== 'string' ||
      !value.content.length ||
      value.tokens_predicted < 1 ||
      value.tokens_predicted > 8 ||
      failure
    )
      throw new Error('GENERATION_FAILED');
    return value.timings;
  };
  const stop = async (force) => {
    if (force) native.forceStop(child);
    else native.requestStop(child);
    let receipt;
    await confirmExit(
      () => {
        receipt = drain();
        return receipt.exitCode !== -1 && receipt.activeProcesses === 0;
      },
      force ? 2000 : 5000,
    );
    if (failure) throw failure;
    if (force ? receipt.exitCode === 0 : receipt.exitCode !== 0) throw new Error('EXIT_FAILED');
    evidence.launches.at(-1).exit = receipt;
    globalThis.clearInterval(timer);
    timer = undefined;
    native.release(child);
    child = undefined;
    lock.release();
    lock = undefined;
    await rm(keyFile);
  };
  try {
    await start();
    await greet();
    emit({ phase: 'ready', pid });
    await continuation;
    const repeated = await greet();
    if (!Number.isSafeInteger(repeated?.cache_n) || repeated.cache_n < 1)
      throw new Error('SLOT_CACHE_REUSE_FAILED');
    evidence.tests.push('real response after other deployment closes');
    await greet('Count from one to three.');
    const restored = await greet();
    drain();
    if (
      !Number.isSafeInteger(restored?.cache_n) ||
      restored.cache_n < 1 ||
      !output.includes('found better prompt')
    )
      throw new Error('RAM_CACHE_RESTORE_FAILED');
    evidence.cache = { repeated, restored, ramRestoreObserved: true };
    evidence.tests.push('bounded slot reuse and RAM prompt-cache restoration');
    await stop(false);
    evidence.tests.push('graceful stop with empty owned job');
    await start();
    await greet();
    evidence.tests.push('explicit reload and response');
    await stop(true);
    evidence.tests.push('forced owned stop within two seconds');
    await start();
    await greet();
    evidence.tests.push('same owner survives forced stop and explicitly reloads');
    await writeFile(
      path.join(base, 'evidence/lifecycle-worker.json'),
      JSON.stringify(evidence, null, 2),
    );
    emit({ phase: 'owner-death-ready', pid, server });
    await new Promise(() => {});
  } finally {
    if (timer) globalThis.clearInterval(timer);
    native.closeDeployment(root);
    if (child) {
      await confirmExit(() => {
        const observation = native.observe(child);
        return observation.exitCode !== -1 && observation.activeProcesses === 0;
      });
      native.release(child);
    }
    lock?.release();
    native.releaseFiles(modelLock);
    await writeFile(
      path.join(base, 'evidence/lifecycle-worker-current.log'),
      secret ? output.replaceAll(secret, '[redacted]') : output,
    );
    await writeFile(
      path.join(base, 'evidence/lifecycle-worker-current.json'),
      JSON.stringify(evidence, null, 2),
    );
    await rm(keyFile, { force: true });
  }
}

async function runParent() {
  native.privateDirectory(temporary);
  await mkdir(path.join(base, 'evidence'), { recursive: true });
  const root = native.createDeployment();
  const otherRoot = native.createDeployment();
  const survivorRoot = native.createDeployment();
  const probes = [];
  const child = native.launch(root, process.execPath, [
    fileURLToPath(import.meta.url),
    model,
    '--worker',
  ]);
  let output = '',
    tail = '',
    latest,
    receipt;
  const events = [];
  const evidence = {
    configuration,
    cachePolicy: SERVER_CACHE_POLICY,
    sampleOnly: true,
    normalAdapter: false,
    completed: false,
    tests: [],
  };
  const read = () => {
    receipt = native.observe(child);
    output += receipt.output;
    tail += receipt.output;
    if (Buffer.byteLength(output) > 65536) throw new Error('OUTPUT_LIMIT');
    let newline;
    while ((newline = tail.indexOf('\n')) !== -1) {
      const line = tail.slice(0, newline).replace(/\r$/u, '');
      tail = tail.slice(newline + 1);
      if (line.startsWith('DIAGNOSTIC ')) {
        latest = JSON.parse(line.slice(11));
        events.push(latest);
      }
    }
    return receipt;
  };
  const wait = async (phase) => {
    const deadline = Date.now() + 600000;
    while (Date.now() < deadline) {
      if (read().exitCode !== -1) throw new Error(`WORKER_FAILED: ${output}`);
      if (latest?.phase === phase) return;
      await delay(20);
    }
    throw new Error('WORKER_TIMEOUT');
  };
  const probe = async (deployment) => {
    const handle = native.launch(deployment, path.resolve('out/native/engine-fixture.exe'), [
      'ready',
    ]);
    probes.push(handle);
    let text = '';
    await confirmExit(() => {
      text += native.observe(handle).output;
      return text.includes('READY');
    }, 2000);
    return handle;
  };
  try {
    await wait('ready');
    console.log(
      'Bonsai is ready; checking independent deployment closure, reload and forced stop.',
    );
    const other = await probe(otherRoot);
    native.closeDeployment(otherRoot);
    await confirmExit(() => native.observe(other).activeProcesses === 0, 2000);
    if (read().exitCode !== -1) throw new Error('INDEPENDENCE_FAILED');
    native.requestStop(child);
    await wait('owner-death-ready');
    // Capture the exact final server while alive, including image, creation time and job membership.
    native.captureServer(child, latest.pid, latest.server);
    if (!native.ownedListener(child, port)) throw new Error('NOT_READY');
    const survivor = await probe(survivorRoot);
    console.log(
      'Reload and force recovery passed; checking abnormal owner exit and unrelated survival.',
    );
    native.abortFixture(child);
    await confirmExit(() => {
      const o = read();
      return o.exitCode !== -1 && o.activeProcesses === 0;
    }, 2000);
    if (receipt.exitCode !== 91) throw new Error('OWNER_EXIT_FAILED');
    if (native.observe(survivor).exitCode !== -1) throw new Error('INDEPENDENCE_FAILED');
    evidence.tests.push(
      'other deployment closes while real Bonsai stays usable',
      'abnormal owner exit leaves its complete job empty within two seconds',
      'independent native deployment survives abnormal real-engine owner exit',
    );
    evidence.worker = JSON.parse(
      await readFile(path.join(base, 'evidence/lifecycle-worker.json'), 'utf8'),
    );
    evidence.events = events;
    evidence.ownerExit = receipt;
    evidence.lifecycleCompleted = true;
    console.log(
      JSON.stringify({
        tests: [...evidence.worker.tests, ...evidence.tests],
        ownerExit: receipt.exitCode,
      }),
    );
  } finally {
    native.closeDeployment(root);
    native.closeDeployment(otherRoot);
    native.closeDeployment(survivorRoot);
    await confirmExit(() => {
      const o = read();
      return o.exitCode !== -1 && o.activeProcesses === 0;
    });
    native.release(child);
    for (const handle of probes) {
      await confirmExit(() => {
        const o = native.observe(handle);
        return o.exitCode !== -1 && o.activeProcesses === 0;
      });
      native.release(handle);
    }
    await writeFile(path.join(base, 'evidence/lifecycle.json'), JSON.stringify(evidence, null, 2));
    // Fixed ignored diagnostic directory, created with the native private-directory checks above.
    await rm(temporary, { recursive: true, force: true });
  }
}

async function cancelBeforeReadiness() {
  const root = native.createDeployment();
  const child = native.launch(root, process.execPath, [
    fileURLToPath(import.meta.url),
    model,
    '--worker',
  ]);
  let output = '',
    tail = '',
    loading,
    receipt;
  try {
    const deadline = Date.now() + 180000;
    while (!loading && Date.now() < deadline) {
      receipt = native.observe(child);
      output += receipt.output;
      tail += receipt.output;
      if (Buffer.byteLength(output) > 65536 || receipt.exitCode !== -1)
        throw new Error('STARTUP_DIAGNOSTIC_FAILED');
      let newline;
      while ((newline = tail.indexOf('\n')) !== -1) {
        const line = tail.slice(0, newline).replace(/\r$/u, '');
        tail = tail.slice(newline + 1);
        if (line.startsWith('DIAGNOSTIC ')) {
          const event = JSON.parse(line.slice(11));
          if (event.phase === 'ready') throw new Error('CANCELLATION_TOO_LATE');
          if (event.phase === 'loading') loading = event;
        }
      }
      if (!loading) await delay(20);
    }
    if (!loading) throw new Error('START_TIMEOUT');
    native.captureServer(child, loading.pid, loading.server);
    native.abortFixture(child);
    await confirmExit(() => {
      receipt = native.observe(child);
      return receipt.exitCode !== -1 && receipt.activeProcesses === 0;
    }, 2000);
    if (receipt.exitCode !== 91) throw new Error('STARTUP_CANCELLATION_FAILED');
    const file = path.join(base, 'evidence/lifecycle.json');
    const evidence = JSON.parse(await readFile(file, 'utf8'));
    evidence.tests.push(
      'owner cancellation before authenticated readiness leaves no owned processes',
    );
    evidence.startupCancellation = { ...loading, exit: receipt };
    evidence.completed = true;
    await writeFile(file, JSON.stringify(evidence, null, 2));
    console.log('Cancellation before readiness passed; the owned job is empty.');
  } finally {
    native.closeDeployment(root);
    await confirmExit(() => {
      const o = native.observe(child);
      return o.exitCode !== -1 && o.activeProcesses === 0;
    });
    native.release(child);
    // This is the same fixed, protected ignored diagnostic directory used by the worker.
    await rm(temporary, { recursive: true, force: true });
  }
}

if (worker) await runWorker();
else {
  await runParent();
  await cancelBeforeReadiness();
}
