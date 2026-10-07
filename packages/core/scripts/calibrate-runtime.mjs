import path from 'node:path';
import { Buffer } from 'node:buffer';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  createDevelopmentRuntimeVerifier,
  requireLivePackage,
} from '../out/runtime-package/verifier.js';
import { installExpanded, revalidateInstalled } from '../out/runtime-package/install.js';
import { ownershipBinding, confirmExit } from '../out/hosts/windows-ownership.js';
import { inspectGGUF } from '../out/runtime/gguf.js';
import { discoverResources } from '../out/hosts/resource-probe.js';
// Explicit signed diagnostic. --fit-print inspects the exact configuration with no model allocation;
// it neither lowers settings nor grants an uncertain planner result live-loader admission.
if (process.argv.length !== 3) throw new Error('Use calibrate-runtime.mjs <Bonsai-Q1_0.gguf>');
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
const capability = await createDevelopmentRuntimeVerifier().verify(
  path.join(base, 'repository'),
  path.join(base, 'verification'),
);
const inventory = requireLivePackage(capability).inventory;
if (
  inventory.upstreamCommit !== '4f31296a907d73f3409f720429bcf31111615d77' ||
  inventory.backend !== 'cuda' ||
  !inventory.files.some((f) => f.path === 'llama-fit-params.exe')
)
  throw new Error('UNSUPPORTED_RUNTIME');
const installed = await installExpanded(
  capability,
  path.join(base, 'candidate'),
  path.join(base, 'installed'),
);
const lock = await revalidateInstalled(installed),
  native = ownershipBinding(),
  root = native.createDeployment();
const temp = path.join(base, 'planner-temporary');
native.privateDirectory(temp);
let child, modelLock;
try {
  modelLock = native.sealFiles([model]);
  const info = await inspectGGUF(model);
  if (info.sha256 !== cfg.modelSha256 || info.contextLimit < cfg.contextPerSlot)
    throw new Error('INVALID_CONFIGURATION');
  const resources = await discoverResources();
  if (!resources.gpus?.some((g) => g.uuid === cfg.gpuDevice))
    throw new Error('NEEDS_RESOURCE_EVIDENCE');
  requireLivePackage(capability);
  const planner = path.join(installed.directory, 'llama-fit-params.exe');
  child = native.launchCudaConsole(
    root,
    path.join(installed.directory, inventory.helper),
    [
      planner,
      '--model',
      model,
      '--fit-print',
      'on',
      '--ctx-size',
      String(cfg.contextPerSlot),
      '--parallel',
      '1',
      '--n-gpu-layers',
      String(cfg.gpuLayers),
      '--device',
      'CUDA0',
      '--split-mode',
      'none',
      '--main-gpu',
      '0',
      '--cache-type-k',
      cfg.cacheK,
      '--cache-type-v',
      cfg.cacheV,
      '--flash-attn',
      'on',
    ],
    temp,
    cfg.gpuDevice,
  );
  let output = '',
    captured = false,
    status;
  const deadline = Date.now() + 180000;
  do {
    const observation = native.observe(child);
    output += observation.output;
    if (Buffer.byteLength(output) > 1024 * 1024) throw new Error('OUTPUT_LIMIT');
    if (!captured && output.includes('\n')) {
      const receipt = /^ENGINE ([1-9][0-9]*)\r?$/u.exec(output.slice(0, output.indexOf('\n')));
      if (!receipt) throw new Error('INVALID_CONTROL');
      native.captureServer(child, Number(receipt[1]), planner);
      captured = true;
    }
    if (observation.exitCode !== -1 && observation.activeProcesses === 0) {
      status = observation.exitCode;
      break;
    }
    if (Date.now() >= deadline) throw new Error('PLANNER_TIMEOUT');
    await delay(20);
  } while (Date.now() < deadline);
  if (status === undefined) throw new Error('PLANNER_TIMEOUT');
  await mkdir(path.join(base, 'evidence'), { recursive: true });
  await writeFile(path.join(base, 'evidence/planner.log'), output);
  await writeFile(
    path.join(base, 'evidence/planner-input.json'),
    JSON.stringify(
      {
        configuration: cfg,
        inventory,
        resources,
        status,
        uncertainty: 'Estimator requires independent validation before live admission',
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      status,
      directory: installed.directory,
      log: path.join(base, 'evidence/planner.log'),
      configuration: cfg,
    }),
  );
  if (status !== 0) throw new Error('PLANNER_FAILED');
} finally {
  native.closeDeployment(root);
  if (child) {
    await confirmExit(() => native.observe(child).activeProcesses === 0);
    native.release(child);
  }
  lock.release();
  if (modelLock) native.releaseFiles(modelLock);
}
