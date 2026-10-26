// GPU-free compatibility check: stock device discovery over mTLS and both
// process gates. The staged client contains no CUDA backend or CUDA libraries.
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, URL } from 'node:url';
import { setTimeout } from 'node:timers';
import { PeerNode } from '../out/peers/node.js';
import { DiagnosticRpcBackend } from '../out/peers/diagnostic-rpc.js';
import { localRpcGateway } from '../out/peers/rpc.js';
import { openWindowsPeerIdentity } from '../out/peers/windows-identity.js';
import { ownershipBinding, confirmExit } from '../out/hosts/windows-ownership.js';
import path from 'node:path';

export async function runStockCpuProbe(coordinator, requestId, estimate = false) {
  const root = new URL('../out/peer-acceptance/stock-client-cpu/', import.meta.url);
  const inventory = JSON.parse(
    await readFile(
      new URL('../out/activation/b11306/repository/inventory.json', import.meta.url),
      'utf8',
    ),
  );
  await mkdir(root, { recursive: true });
  const names = [
    'llama-server.exe',
    'llama-server-impl.dll',
    'llama-common.dll',
    'llama.dll',
    'mtmd.dll',
    'ggml.dll',
    'ggml-base.dll',
    'ggml-cpu-x64.dll',
    'ggml-rpc.dll',
    'libomp.dll',
    'msvcp140.dll',
    'vcruntime140.dll',
    'vcruntime140_1.dll',
    ...(estimate ? ['llama-fit-params.exe', 'llama-fit-params-impl.dll'] : []),
  ];
  for (const name of names) {
    const source = new URL(`../out/activation/b11306/candidate/${name}`, import.meta.url);
    const file = inventory.files.find((item) => item.path === name);
    const bytes = await readFile(source);
    if (
      !file ||
      bytes.length !== file.length ||
      createHash('sha256').update(bytes).digest('hex') !== file.sha256
    )
      throw new Error('Invalid pinned CPU diagnostic asset');
    await copyFile(source, new URL(name, root));
  }
  const native = ownershipBinding();
  const deployment = native.createDeployment();
  let child,
    gateway,
    log = '',
    result;
  try {
    gateway = await localRpcGateway(
      (pid) => !!child && native.observe(child).pid === pid,
      () => coordinator.openRpc(requestId),
    );
    child = native.launch(
      deployment,
      fileURLToPath(new URL(estimate ? 'llama-fit-params.exe' : 'llama-server.exe', root)),
      [
        '--rpc',
        `127.0.0.1:${gateway.port}`,
        ...(estimate
          ? [
              '--model',
              'E:/ollama-models/blobs/sha256-4a188102020e9c9530b687fd6400f775c45e90a0d7baafe65bd0a36963fbb7ba',
              '--fit-print',
              'on',
              '--device',
              'RPC0',
              '--n-gpu-layers',
              '37',
              '--ctx-size',
              '512',
              '--parallel',
              '1',
              '--batch-size',
              '64',
              '--ubatch-size',
              '64',
            ]
          : ['--list-devices']),
      ],
    );
    const end = Date.now() + 35000;
    for (;;) {
      const state = native.observe(child);
      log = (log + state.output).slice(-65536);
      if (state.exitCode !== -1 && state.activeProcesses === 0) {
        if (
          state.exitCode !== 0 ||
          !(estimate ? /RPC0/u : /Available devices:\s+RPC0: 127\.0\.0\.1:/u).test(log) ||
          /CUDA\d/u.test(log)
        )
          throw new Error(`Stock RPC discovery failed: ${state.exitCode}`);
        result = { passed: true, gpuUsed: false, stockDeviceDiscovery: true, estimate };
        break;
      }
      if (Date.now() >= end) throw new Error('Stock CPU RPC discovery deadline');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  } finally {
    native.closeDeployment(deployment);
    if (child) {
      await confirmExit(() => {
        const state = native.observe(child);
        log = (log + state.output).slice(-65536);
        return state.activeProcesses === 0 && state.exitCode !== -1;
      }, 3000);
      native.release(child);
    }
    try {
      await gateway?.close();
    } finally {
      await writeFile(new URL('../out/peer-acceptance/stock-cpu.log', import.meta.url), log);
    }
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const estimate = process.argv.length === 3 && process.argv[2] === '--estimate';
  if (!estimate && process.argv.length !== 2) throw new Error('Only --estimate is accepted');
  const sg = await openWindowsPeerIdentity(),
    my = await openWindowsPeerIdentity();
  const gpu = 'GPU-11111111-1111-1111-1111-111111111111';
  const coordinator = new PeerNode(sg, 'CPU coordinator', []);
  const worker = new PeerNode(
    my,
    'CPU worker',
    [{ id: gpu, name: 'CPU protocol diagnostic', memoryBytes: 4096 }],
    new DiagnosticRpcBackend('cpu'),
  );
  try {
    const address = await worker.share('127.0.0.1', 0, 0, [gpu]);
    const request = await coordinator.invite(address);
    await coordinator.confirm(request.id, my.fingerprint);
    await worker.approve(request.id, sg.fingerprint);
    console.log(JSON.stringify(await runStockCpuProbe(coordinator, request.id, estimate)));
  } finally {
    try {
      await Promise.all([coordinator.close(), worker.close()]);
    } finally {
      sg.close();
      my.close();
    }
  }
}
