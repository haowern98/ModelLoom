// Diagnostic only: exact stock binaries and the previously indexed Qwen GGUF.
import { createServer } from 'node:net';
import { randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { setTimeout } from 'node:timers';
const { fetch, AbortSignal } = globalThis;
import { localRpcGateway } from '../out/peers/rpc.js';
import { ownershipBinding, confirmExit } from '../out/hosts/windows-ownership.js';
import { cleanupAll } from './diagnostic-lifecycle.mjs';

const output = new URL('../out/peer-acceptance/', import.meta.url);
const runtime = new URL('../out/activation/b11306/candidate/', import.meta.url);
const model =
  'E:/ollama-models/blobs/sha256-4a188102020e9c9530b687fd6400f775c45e90a0d7baafe65bd0a36963fbb7ba';
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
export async function runPeerGpuProbe(node, id, remoteOnly = false) {
  const selectedRuntime = remoteOnly
    ? new URL('../out/peer-acceptance/stock-client-cpu/', import.meta.url)
    : runtime;
  const inventory = JSON.parse(
    await readFile(
      new URL('../out/activation/b11306/repository/inventory.json', import.meta.url),
      'utf8',
    ),
  );
  const files = remoteOnly
    ? inventory.files.filter((file) =>
        [
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
        ].includes(file.path),
      )
    : inventory.files;
  for (const file of files) {
    if (!/^[a-zA-Z0-9_.-]+$/u.test(file.path)) throw new Error('Unexpected runtime manifest path');
    const bytes = await readFile(new URL(file.path, selectedRuntime));
    if (
      bytes.length !== file.length ||
      createHash('sha256').update(bytes).digest('hex') !== file.sha256
    )
      throw new Error('Pinned runtime hash mismatch');
  }
  const key = randomBytes(32).toString('hex');
  const keyFile = new URL('gpu-api-key.txt', output);
  await writeFile(keyFile, key, { flag: 'wx' });
  const runs = [];
  const native = ownershipBinding();
  try {
    for (const mode of remoteOnly ? ['remote-only'] : ['single', 'remote-split']) {
      let child, gateway, serverPid;
      const deployment = native.createDeployment();
      const temporary = fileURLToPath(new URL(`gpu-private-${mode}`, output));
      native.privateDirectory(temporary);
      let log = '';
      const observe = () => {
        const state = native.observe(child);
        log = (log + state.output).slice(-500000);
        if (remoteOnly) serverPid = state.pid;
        else if (!serverPid) {
          const receipt = /^ENGINE ([1-9][0-9]*)\r?\n/u.exec(log);
          if (receipt && state.exitCode === -1) {
            native.captureServer(
              child,
              Number(receipt[1]),
              fileURLToPath(new URL('llama-server.exe', runtime)),
            );
            serverPid = Number(receipt[1]);
          }
        }
        return state;
      };
      try {
        if (mode !== 'single')
          gateway = await localRpcGateway(
            (pid) => !!child && observe().exitCode === -1 && serverPid === pid,
            () => node.openRpc(id),
          );
        const port = await freePort();
        const args = [
          ...(gateway ? ['--rpc', `127.0.0.1:${gateway.port}`] : []),
          '--model',
          model,
          '--alias',
          'peer-test',
          '--host',
          '127.0.0.1',
          '--port',
          String(port),
          '--api-key-file',
          fileURLToPath(keyFile),
          '--no-ui',
          '--no-agent',
          '--no-mmproj',
          '--fit',
          'off',
          '--ctx-size',
          '512',
          '--parallel',
          '1',
          '--batch-size',
          '64',
          '--ubatch-size',
          '64',
          '--threads',
          '4',
          '--flash-attn',
          'on',
          '--n-gpu-layers',
          '37',
          '--device',
          remoteOnly ? 'RPC0' : gateway ? 'CUDA0,RPC0' : 'CUDA0',
          '--split-mode',
          gateway && !remoteOnly ? 'layer' : 'none',
          '--main-gpu',
          '0',
          '--tensor-split',
          gateway && !remoteOnly ? '1,1' : '1',
          '--no-warmup',
          '--log-verbosity',
          '5',
        ];
        child = remoteOnly
          ? native.launch(
              deployment,
              fileURLToPath(new URL('llama-server.exe', selectedRuntime)),
              args,
            )
          : native.launchCudaPlanConsole(
              deployment,
              fileURLToPath(new URL('ModelLoom-runtime-host.exe', runtime)),
              [fileURLToPath(new URL('llama-server.exe', runtime)), ...args],
              temporary,
              ['GPU-22c23971-dacf-2123-2169-ad70d8f6729a'],
            );
        const deadline = Date.now() + 105000;
        let nextProgress = Date.now() + 15000;
        for (;;) {
          const state = observe();
          if (state.exitCode !== -1) throw new Error(`Stock runtime exited: ${state.exitCode}`);
          try {
            if (
              (await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(700) }))
                .ok
            )
              break;
          } catch {
            /* Loading. */
          }
          if (gateway && Date.now() >= nextProgress) {
            process.stdout.write(
              JSON.stringify({ phase: 'tensor-upload', ...gateway.progress() }) + '\n',
            );
            nextProgress = Date.now() + 15000;
          }
          if (Date.now() > deadline) throw new Error('Stock runtime readiness deadline');
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'peer-test',
            messages: [
              {
                role: 'user',
                content: 'What is the capital of France? Reply with just the city name.',
              },
            ],
            temperature: 0,
            seed: 1234,
            max_tokens: 12,
            stream: false,
          }),
          signal: AbortSignal.timeout(45000),
        });
        if (!response.ok) throw new Error(`Inference failed: ${response.status}`);
        const value = await response.json();
        observe();
        const content = value.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || !content.includes('Paris'))
          throw new Error('Incorrect generated output');
        if (gateway && !/RPC0.*(?:model buffer|buffer size).*MiB/iu.test(log))
          throw new Error('Remote GPU model placement not established');
        runs.push({ mode, content, usage: value.usage });
      } finally {
        // Kill-on-close job ownership also covers a complete controller crash.
        // Independent cleanup cannot wait forever on a remote channel.
        await cleanupAll([
          {
            name: 'stock runtime',
            run: async () => {
              try {
                if (child) {
                  native.requestStop(child);
                  const stopped = () => {
                    const state = observe();
                    return state.exitCode !== -1 && state.activeProcesses === 0;
                  };
                  try {
                    await confirmExit(stopped, 5000);
                  } catch {
                    native.forceStop(child);
                    await confirmExit(stopped, 3000);
                  }
                  native.release(child);
                }
              } finally {
                native.closeDeployment(deployment);
              }
            },
          },
          {
            name: 'gateway',
            run: async () => {
              await gateway?.close();
            },
          },
          { name: 'log', run: () => writeFile(new URL(`gpu-${mode}.log`, output), log) },
        ]);
      }
    }
    if (!remoteOnly && runs[0].content !== runs[1].content)
      throw new Error('Single versus remote-split output differs');
    return {
      runs,
      exactOutputMatch: remoteOnly ? null : true,
      nativeInference: true,
      stockPin: inventory.upstreamCommit,
    };
  } finally {
    await unlink(keyFile);
  }
}
