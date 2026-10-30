import { spawn } from 'node:child_process';
import { Duplex } from 'node:stream';
import path from 'node:path';
import { ownershipBinding } from '../hosts/windows-ownership.js';
import type { OwnedPeerRpc } from './rpc.js';
import { peerDeadline, SHARING_APPROVAL_MS } from './deadline.js';
import { RpcRelaySession } from './rpc-session.js';

type RelayOptions = { device: 'cpu' | 'cuda'; script: string; arguments: readonly string[] };

/** Issued only after the fixed launcher's no-helper UAC cancellation exit.
 * Other failures cannot prove that privileged ownership was never acquired. */
export class ConfirmedNetworkSetupFailure extends Error {
  constructor() {
    super('SHARING_FIREWALL_PERMISSION_DENIED');
  }
}

/** The fixed network helper has no GPU authority and a separate readiness receipt. */
export async function launchOwnedSharingNetwork(
  options: RelayOptions,
  approvalMilliseconds: number,
): Promise<OwnedPeerRpc> {
  if (
    !Number.isSafeInteger(approvalMilliseconds) ||
    approvalMilliseconds < 1 ||
    approvalMilliseconds > SHARING_APPROVAL_MS
  )
    throw Error('INVALID_RPC_DEADLINE');
  return launchRelay({ ...options, device: 'cpu' }, [], 'network-ready', approvalMilliseconds);
}

/** Elevation belongs to sharing, never to a remote connection. */
export async function launchOwnedRpcSession(
  options: RelayOptions,
  gpuIds: readonly string[],
  approvalMilliseconds = SHARING_APPROVAL_MS,
) {
  if (
    !Number.isSafeInteger(approvalMilliseconds) ||
    approvalMilliseconds < 1 ||
    approvalMilliseconds > SHARING_APPROVAL_MS
  )
    throw Error('INVALID_RPC_DEADLINE');
  return new RpcRelaySession(
    await launchRelay(options, gpuIds, 'helper-ready', approvalMilliseconds),
  );
}

/** Trusted owner launch only. The caller supplies a sealed package path, never peer input. */
export async function launchOwnedRpcRelay(
  options: RelayOptions,
  gpuIds: readonly string[],
): Promise<OwnedPeerRpc> {
  return launchRelay(options, gpuIds, 'relay-ready');
}

async function launchRelay(
  options: RelayOptions,
  gpuIds: readonly string[],
  phase: 'relay-ready' | 'helper-ready' | 'network-ready',
  approvalMilliseconds = SHARING_APPROVAL_MS,
): Promise<OwnedPeerRpc> {
  const system = ownershipBinding().systemDirectory();
  const child = spawn(
    path.join(system, 'WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', options.script, ...options.arguments],
    {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        SystemRoot: path.dirname(system),
        PATH: system,
        ...(options.device === 'cuda' ? { MODELLOOM_PROBE_GPU_UUID: gpuIds[0]! } : {}),
      },
    },
  );
  let failure = false;
  let exitCode: number | null | undefined;
  const exited = new Promise<void>((resolve, reject) => {
    child.once('error', () => {
      failure = true;
      reject(new Error('RPC_UNAVAILABLE'));
    });
    child.once('exit', (code) => {
      console.error(`[ModelLoom][worker] helper.exit code=${code} device=${options.device}`);
      exitCode = code;
      failure = code !== 0;
      if (failure) reject(new Error('RPC_CLEANUP_FAILED'));
      else resolve();
    });
  });
  void exited.catch(() => undefined);
  let errors = '';
  child.stderr.on('data', (chunk: Buffer) => {
    errors = (errors + chunk.toString()).slice(-16384);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      let bytes = Buffer.alloc(0);
      const timeout = setTimeout(
        () => {
          child.stdin.destroy();
          reject(new Error('RPC_START_TIMEOUT'));
        },
        phase === 'relay-ready' ? 20000 : approvalMilliseconds,
      );
      const read = (chunk: Buffer) => {
        bytes = Buffer.concat([bytes, chunk]);
        if (bytes.length > 4096) {
          clearTimeout(timeout);
          child.stdout.off('data', read);
          reject(new Error('INVALID_RPC_REPORT'));
          return;
        }
        const newline = bytes.indexOf(10);
        if (newline < 0) return;
        clearTimeout(timeout);
        child.stdout.off('data', read);
        child.stdout.pause();
        try {
          const report: unknown = JSON.parse(bytes.subarray(0, newline).toString('utf8'));
          if (
            !report ||
            typeof report !== 'object' ||
            Reflect.get(report, 'phase') !== phase ||
            (phase === 'relay-ready' && Reflect.get(report, 'workerRestricted') !== true)
          )
            throw new Error('INVALID_RPC_REPORT');
          const remaining = bytes.subarray(newline + 1);
          if (remaining.length) child.stdout.unshift(remaining);
          resolve();
        } catch {
          reject(new Error('INVALID_RPC_REPORT'));
        }
      };
      child.stdout.on('data', read);
      child.once('exit', () => {
        clearTimeout(timeout);
        reject(new Error('RPC_START_FAILED'));
      });
    });
  } catch (error) {
    child.stdin.destroy();
    try {
      await peerDeadline(exited, 12000, 'RPC_CLEANUP_FAILED');
    } catch {
      child.kill();
      await peerDeadline(
        exited.catch(() => undefined),
        2000,
        'RPC_CLEANUP_FAILED',
      );
    }
    // This is local diagnostic output only. It never crosses the peer API.
    if (errors) process.stderr.write(`RPC owned startup: ${errors}\n`);
    if (
      phase === 'network-ready' &&
      error instanceof Error &&
      error.message === 'RPC_START_FAILED'
    ) {
      if (exitCode === 1223 && errors.includes('SHARING_FIREWALL_PERMISSION_DENIED'))
        throw new ConfirmedNetworkSetupFailure();
      throw Error(
        errors.includes('SHARING_FIREWALL_PERMISSION_DENIED')
          ? 'SHARING_FIREWALL_PERMISSION_DENIED'
          : 'SHARING_FIREWALL_FAILED',
        { cause: error },
      );
    }
    throw error;
  }
  const stream = Duplex.from({ readable: child.stdout, writable: child.stdin });
  let closing: Promise<void> | undefined;
  let stopping = false;
  // Duplex.from emits ABORT_ERR even for an intentional early destroy.
  // Retain an owner listener before returning the stream; consumer listeners
  // still receive transport failures, and close separately confirms exit.
  stream.on('error', () => {
    if (!stopping) child.stdin.destroy();
  });
  return {
    stream,
    close() {
      return (closing ??= (async () => {
        stopping = true;
        stream.destroy();
        child.stdin.destroy();
        child.stdout.destroy();
        await peerDeadline(exited, 12000, 'RPC_CLEANUP_FAILED');
        if (failure) throw new Error('RPC_CLEANUP_FAILED');
      })().catch((error: unknown) => {
        closing = undefined;
        throw error;
      }));
    },
  };
}
