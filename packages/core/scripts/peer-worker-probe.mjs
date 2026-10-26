// Isolated two-PC control test. These ephemeral test identities are never
// substituted for either desktop's identity or approval records.
import { hostname, networkInterfaces } from 'node:os';
import { PeerNode } from '../src/peers/node.ts';
import { openWindowsPeerIdentity } from '../src/peers/windows-identity.ts';
import { discoverResources } from '../src/hosts/resource-probe.ts';
import { DiagnosticRpcBackend } from '../src/peers/diagnostic-rpc.ts';
import { PassThrough } from 'node:stream';

const expected = process.argv[2];
const cpu = process.argv.length === 4 && process.argv[3] === '--cpu-only';
const echo = process.argv.length === 4 && process.argv[3] === '--echo-only';
if (
  (!cpu && !echo && process.argv.length !== 3) ||
  !/^[a-f0-9]{64}$/u.test(expected ?? '') ||
  hostname().toLowerCase() !== 'ptss'
)
  throw new Error('Unexpected worker diagnostic context');
const host = Object.values(networkInterfaces())
  .flat()
  .find((value) => value?.address === '100.69.84.91')?.address;
if (!host) throw new Error('Expected worker Tailscale address unavailable');
const identity = await openWindowsPeerIdentity();
const resources = await discoverResources();
if (!resources.gpus?.length) {
  identity.close();
  throw new Error('No verified worker GPU inventory');
}
const gpus = resources.gpus.map((gpu) => ({
  id: gpu.uuid,
  name: gpu.name ?? 'NVIDIA GPU',
  memoryBytes: gpu.total ?? 0,
}));
const node = new PeerNode(
  identity,
  hostname(),
  gpus,
  echo
    ? {
        start: () => {
          const stream = new PassThrough();
          return Promise.resolve({
            stream,
            close: () => {
              stream.destroy();
              return Promise.resolve();
            },
          });
        },
      }
    : new DiagnosticRpcBackend(cpu ? 'cpu' : 'cuda'),
);
let timer,
  deadline,
  closed = false;
async function close() {
  if (closed) return;
  closed = true;
  clearInterval(timer);
  clearTimeout(deadline);
  await node.close();
  identity.close();
  process.stdin.destroy();
  console.log(JSON.stringify({ phase: 'worker-stopped' }));
}
try {
  const address = await node.share(
    host,
    49301,
    49302,
    gpus.map((gpu) => gpu.id),
  );
  console.log(
    JSON.stringify({
      phase: 'worker-ready',
      address,
      fingerprint: identity.fingerprint,
      gpuCount: gpus.length,
    }),
  );
  timer = setInterval(() => {
    for (const value of node.snapshot().incoming) {
      if (value.phase !== 'pending' || value.localVerified) continue;
      if (value.peerFingerprint !== expected) node.decline(value.id);
      else
        void node.approve(value.id, expected).catch(() => {
          void close();
        });
    }
  }, 100);
  deadline = setTimeout(() => {
    void close();
  }, 240000);
  process.stdin.once('data', () => {
    void close();
  });
  process.stdin.once('end', () => {
    void close();
  });
  process.stdin.resume();
} catch (error) {
  await close();
  throw error;
}
import { setTimeout, clearTimeout, setInterval, clearInterval } from 'node:timers';
