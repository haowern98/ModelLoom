// Fixed, bounded control-plane acceptance across the two authorized PCs.
import { spawn, execFile } from 'node:child_process';
import { URL } from 'node:url';
import { Buffer } from 'node:buffer';
import { setTimeout, clearTimeout } from 'node:timers';
import { promisify } from 'node:util';
import { networkInterfaces } from 'node:os';
import { createInterface } from 'node:readline';
import { readFile, writeFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { openWindowsPeerIdentity } from '../out/peers/windows-identity.js';
import { PeerNode } from '../out/peers/node.js';
import { runPeerGpuProbe } from './peer-gpu-probe.mjs';
import { cleanupAll, deadline, stopDiagnostic } from './diagnostic-lifecycle.mjs';
import { runStockCpuProbe } from './probe-peer-stock-cpu.mjs';
import { runRpcByteProbe } from './peer-rpc-bytes.mjs';
const exec = promisify(execFile);
const config = 'E:/ModelLoom/.remote/modelloom-scp-config';
const remoteRoot = 'D:/ModelLoom/ModelLoom-Project-Peer-Test-20261020';
const rule = `ModelLoom-Peer-Diagnostic-${process.pid}`;
const address = Object.values(networkInterfaces())
  .flat()
  .find(
    (value) =>
      value?.family === 'IPv4' && /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./u.test(value.address),
  )?.address;
const remoteOnly = process.argv.length === 3 && process.argv[2] === '--remote-gpu';
const gpuTest = remoteOnly || (process.argv.length === 3 && process.argv[2] === '--gpu');
const cpuBytes = process.argv.length === 3 && process.argv[2] === '--cpu-bytes';
const echoBytes = process.argv.length === 3 && process.argv[2] === '--echo-bytes';
const cpuRpc = cpuBytes || (process.argv.length === 3 && process.argv[2] === '--cpu-rpc');
if (!address || (!gpuTest && !cpuRpc && !echoBytes && process.argv.length !== 2))
  throw new Error('Unexpected coordinator diagnostic context');
const identity = await openWindowsPeerIdentity();
const node = new PeerNode(identity, 'HAOWERNSLAPPY test', []);
const ssh = ['-F', config, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', 'modelloom-controller'];
async function powershell(script) {
  const encoded = Buffer.from(
    `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; ${script}`,
    'utf16le',
  ).toString('base64');
  try {
    const { stdout } = await exec(
      'ssh',
      [...ssh, 'powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: 20000, maxBuffer: 65536 },
    );
    return stdout.trim();
  } catch (error) {
    await writeFile(
      new URL('../out/peer-acceptance/remote-error.txt', import.meta.url),
      String(error.stderr ?? 'Remote operation failed'),
    );
    throw new Error('REMOTE_DIAGNOSTIC_FAILED: see ignored remote-error.txt', { cause: error });
  }
}
let worker, ended, mining, miningEnded;
const miningLease = randomBytes(16).toString('hex');
let workerErrors = '',
  miningErrors = '';
const report = { passed: false, nativeInference: false, miningPaused: false };
// Clear the historical result before admission. A failed attempt cannot leave
// an earlier successful control-plane report masquerading as this GPU result.
await writeFile(
  new URL('../out/peer-acceptance/result.json', import.meta.url),
  JSON.stringify(report),
);
try {
  const manifest = JSON.parse(
    await readFile(new URL('../out/peer-acceptance/manifest.json', import.meta.url), 'utf8'),
  );
  const expected = Object.fromEntries(manifest.map((value) => [value.file, value.sha256]));
  for (const key of ['worker.mjs', 'ownership.node', 'peer-identity.node', 'node.exe'])
    if (!/^[a-f0-9]{64}$/u.test(expected[key] ?? '')) throw new Error('Invalid manifest');
  const checks = [
    ['node.exe', 'node.exe'],
    ['out/peers/worker.mjs', 'worker.mjs'],
    ['out/native/ownership.node', 'ownership.node'],
    ['out/native/peer-identity.node', 'peer-identity.node'],
  ]
    .map(
      ([file, key]) =>
        `if ((Get-FileHash -LiteralPath '${remoteRoot}/${file}' -Algorithm SHA256).Hash.ToLowerInvariant() -ne '${expected[key]}') { throw 'Asset hash mismatch' }`,
    )
    .join('\n');
  await powershell(checks);
  if (gpuTest || cpuRpc) {
    const rpcFolder = gpuTest ? 'stock-rpc-gpu' : 'stock-rpc';
    const folder = new URL(`../out/network-guard-probe/${rpcFolder}/`, import.meta.url);
    const assets = [
      ...(await readdir(folder)).map((name) => `out/network-guard-probe/${rpcFolder}/${name}`),
      'out/network-guard-probe/network-guard-probe.exe',
      'scripts/relay-network-worker.ps1',
      'scripts/mining-test-lease.ps1',
    ];
    let batch = [];
    for (const file of assets) {
      if (!/^[a-zA-Z0-9_./-]+$/u.test(file)) throw new Error('Invalid probe asset path');
      const hash = createHash('sha256')
        .update(await readFile(new URL(`../${file}`, import.meta.url)))
        .digest('hex');
      batch.push(
        `if ((Get-FileHash -LiteralPath '${remoteRoot}/${file}' -Algorithm SHA256).Hash.ToLowerInvariant() -ne '${hash}') { throw 'GPU asset hash mismatch' }`,
      );
      if (batch.length === 4) {
        await powershell(batch.join('\n'));
        batch = [];
      }
    }
    if (batch.length) await powershell(batch.join('\n'));
  }
  await powershell(
    `New-NetFirewallRule -Name '${rule}' -DisplayName 'ModelLoom bounded peer diagnostic' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 49301,49302 -LocalAddress 100.69.84.91 -RemoteAddress '${address}' -Program ([IO.Path]::GetFullPath('${remoteRoot}/node.exe')) -Profile Any -PolicyStore ActiveStore | Out-Null`,
  );
  if (gpuTest) {
    mining = spawn(
      'ssh',
      [
        ...ssh,
        'powershell.exe',
        '-NoProfile',
        '-NonInteractive',
        '-File',
        `${remoteRoot}/scripts/mining-test-lease.ps1`,
        '-Lease',
        miningLease,
      ],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    miningEnded = new Promise((resolve, reject) => {
      mining.once('exit', (code) =>
        code === 0 ? resolve() : reject(new Error('Remote mining restore failed')),
      );
      mining.once('error', reject);
    });
    void miningEnded.catch(() => undefined);
    mining.stderr.on('data', (chunk) => {
      miningErrors = (miningErrors + chunk.toString()).slice(-32768);
    });
    const reader = createInterface({ input: mining.stdout });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Mining pause deadline')), 20000);
      reader.once('line', (line) => {
        clearTimeout(timeout);
        if (line.includes('mining-paused')) resolve();
        else reject(new Error('Mining not paused'));
      });
      mining.once('exit', () => {
        clearTimeout(timeout);
        reject(new Error('Mining pause exited'));
      });
    });
    report.miningPaused = true;
  }
  worker = spawn(
    'ssh',
    [
      ...ssh,
      `${remoteRoot}/node.exe`,
      `${remoteRoot}/out/peers/worker.mjs`,
      identity.fingerprint,
      ...(cpuRpc ? ['--cpu-only'] : []),
      ...(echoBytes ? ['--echo-only'] : []),
    ],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  ended = new Promise((resolve, reject) => {
    worker.once('exit', (code) => (code === 0 ? resolve() : reject(new Error('Worker failed'))));
    worker.once('error', reject);
  });
  void ended.catch(() => undefined);
  worker.stderr.on('data', (chunk) => {
    workerErrors = (workerErrors + chunk.toString()).slice(-32768);
  });
  const reader = createInterface({ input: worker.stdout });
  const ready = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Worker readiness timeout')), 20000);
    reader.once('line', (line) => {
      clearTimeout(timeout);
      try {
        const value = JSON.parse(line);
        if (value.phase !== 'worker-ready') throw new Error('Not ready');
        resolve(value);
      } catch {
        reject(new Error('Invalid worker readiness'));
      }
    });
    worker.once('exit', () => {
      clearTimeout(timeout);
      reject(new Error('Worker exited before readiness'));
    });
  });
  if (ready.address !== 'http://100.69.84.91:49301/' || !/^[a-f0-9]{64}$/u.test(ready.fingerprint))
    throw new Error('Wrong worker identity/address');
  const outgoing = await node.invite(ready.address);
  if (outgoing.peerFingerprint !== ready.fingerprint) throw new Error('Wrong peer fingerprint');
  try {
    await node.inventory(outgoing.id);
    throw new Error('Pre-approval inventory succeeded');
  } catch (error) {
    if (error.message !== 'PEER_NOT_APPROVED') throw error;
  }
  try {
    await node.confirm(outgoing.id, '0'.repeat(64));
    throw new Error('Wrong pin succeeded');
  } catch (error) {
    if (error.message !== 'FINGERPRINT_MISMATCH') throw error;
  }
  await node.confirm(outgoing.id, ready.fingerprint);
  const approvalDeadline = Date.now() + 5000;
  while ((await node.status(outgoing.id)).phase !== 'approved') {
    if (Date.now() > approvalDeadline) throw new Error('Approval deadline');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const gpus = await node.inventory(outgoing.id);
  if (!gpus.some((gpu) => gpu.name.includes('4070 SUPER')))
    throw new Error('Wrong remote GPU inventory');
  if (gpuTest) Object.assign(report, await runPeerGpuProbe(node, outgoing.id, remoteOnly));
  if (cpuRpc)
    report.cpuRpc = cpuBytes
      ? await runRpcByteProbe(node, outgoing.id)
      : await runStockCpuProbe(node, outgoing.id, true);
  if (echoBytes) report.echo = await runRpcByteProbe(node, outgoing.id, true);
  worker.stdin.end('S');
  await deadline(ended, 10000, 'WORKER_SHUTDOWN_TIMEOUT');
  let disconnected = false;
  try {
    await node.inventory(outgoing.id);
  } catch {
    disconnected = true;
  }
  if (!disconnected) throw new Error('Stopped worker still served inventory');
  Object.assign(report, {
    passed: true,
    mutualTls: true,
    bothFingerprintChecks: true,
    preApprovalDenied: true,
    wrongPinDenied: true,
    disconnectDenied: true,
    gpus,
  });
} catch (error) {
  report.error = error instanceof Error ? error.message : 'DIAGNOSTIC_FAILED';
  throw error;
} finally {
  try {
    await cleanupAll(
      [
        { name: 'worker', run: () => stopDiagnostic(worker, ended) },
        { name: 'peer', run: () => node.close().finally(() => identity.close()) },
        {
          name: 'mining',
          run: async () => {
            if (!mining) return;
            await powershell(
              `[IO.File]::WriteAllText('${remoteRoot}/out/mining-${miningLease}.stop', 'restore')`,
            );
            await stopDiagnostic(mining, miningEnded, '', 40000);
          },
        },
        {
          name: 'firewall',
          run: () =>
            powershell(
              `$existing = Get-NetFirewallRule -PolicyStore ActiveStore -Name '${rule}' -ErrorAction SilentlyContinue; if ($existing) { $existing | Remove-NetFirewallRule }; if (Get-NetFirewallRule -PolicyStore ActiveStore -Name '${rule}' -ErrorAction SilentlyContinue) { throw 'Rule cleanup failed' }`,
            ),
        },
      ],
      45000,
    );
    report.cleanupConfirmed = true;
  } catch (error) {
    report.passed = false;
    report.cleanupConfirmed = false;
    await Promise.reject(error);
  } finally {
    await Promise.all([
      writeFile(
        new URL('../out/peer-acceptance/result.json', import.meta.url),
        JSON.stringify(report, null, 2),
      ),
      writeFile(new URL('../out/peer-acceptance/worker-errors.log', import.meta.url), workerErrors),
      writeFile(new URL('../out/peer-acceptance/mining-errors.log', import.meta.url), miningErrors),
    ]);
  }
}
await writeFile(
  new URL('../out/peer-acceptance/result.json', import.meta.url),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
