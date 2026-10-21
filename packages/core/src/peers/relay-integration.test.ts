import { expect, it, vi } from 'vitest';
import type { OwnedPeerRpc } from './rpc.js';
import { setTimeout as delay } from 'node:timers/promises';
import { DiagnosticRpcBackend } from './diagnostic-rpc.js';
import { launchOwnedRpcSession } from './rpc-relay.js';
import { fileURLToPath } from 'node:url';

it('reuses one elevated native helper for three separate restricted stock workers', async () => {
  const session = await launchOwnedRpcSession(
    {
      device: 'cpu',
      script: fileURLToPath(new URL('../../scripts/relay-network-worker.ps1', import.meta.url)),
      arguments: ['-Session'],
    },
    [],
  );
  try {
    for (let i = 0; i < 3; i++) {
      const worker = await session.start();
      const hello = Buffer.alloc(33);
      hello[0] = 14;
      hello.writeBigUInt64LE(24n, 1);
      const response = new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        worker.stream.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          const bytes = Buffer.concat(chunks);
          if (bytes.length >= 36) resolve(bytes);
        });
        worker.stream.once('error', reject);
      });
      worker.stream.write(hello);
      const bytes = await response;
      expect(bytes.length).toBe(36);
      expect(bytes.readBigUInt64LE()).toBe(28n);
      expect([...bytes.subarray(8, 11)]).toEqual([7, 0, 0]);
      await worker.close();
    }
  } finally {
    await session.close();
  }
}, 60000);

it('cleans a crashed worker and can start another without another elevation', async () => {
  const session = await launchOwnedRpcSession(
    {
      device: 'cpu',
      script: fileURLToPath(new URL('../../scripts/relay-network-worker.ps1', import.meta.url)),
      arguments: ['-Session'],
    },
    [],
  );
  try {
    const worker = await session.start();
    const ended = new Promise<void>((resolve) => worker.stream.once('close', resolve));
    // Stock RPC rejects an unknown command and closes its connection.
    worker.stream.write(Buffer.alloc(9, 255));
    await ended;
    await worker.close();
    const replacement = await session.start();
    await replacement.close();
  } finally {
    await session.close();
  }
}, 30000);

it('confirms native worker cleanup when sharing closes during startup', async () => {
  const session = await launchOwnedRpcSession(
    {
      device: 'cpu',
      script: fileURLToPath(new URL('../../scripts/relay-network-worker.ps1', import.meta.url)),
      arguments: ['-Session'],
    },
    [],
  );
  const opening = session.start();
  const rejected = expect(opening).rejects.toThrow('RPC_UNAVAILABLE');
  await session.close();
  await rejected;
}, 30000);

it('retains an idle loaded RPC worker beyond two minutes until explicitly stopped', async () => {
  const session = await launchOwnedRpcSession(
    {
      device: 'cpu',
      script: fileURLToPath(new URL('../../scripts/relay-network-worker.ps1', import.meta.url)),
      arguments: ['-Session'],
    },
    [],
  );
  const worker = await session.start();
  try {
    await delay(125000);
    expect(worker.stream.destroyed).toBe(false);
    const response = new Promise<Buffer>((resolve, reject) => {
      let bytes = Buffer.alloc(0);
      worker.stream.on('data', (chunk: Buffer) => {
        bytes = Buffer.concat([bytes, chunk]);
        if (bytes.length >= 36) resolve(bytes);
      });
      worker.stream.once('error', reject);
      worker.stream.once('close', () => reject(Error('Idle worker lost')));
    });
    const hello = Buffer.alloc(33);
    hello[0] = 14;
    hello.writeBigUInt64LE(24n, 1);
    worker.stream.write(hello);
    expect([...(await response).subarray(8, 11)]).toEqual([7, 0, 0]);
    await worker.close();
  } finally {
    await session.close();
  }
}, 180000);

it('can stop immediately without requiring callers to install stream error handlers', async () => {
  const owned = await new DiagnosticRpcBackend('cpu').start([]);
  await owned.close();
}, 30000);

it('relays the actual stock handshake without consuming or appending protocol bytes', async () => {
  const owned = await new DiagnosticRpcBackend('cpu').start([]);
  try {
    const chunks: Buffer[] = [];
    const hello = Buffer.alloc(33);
    hello[0] = 14;
    hello.writeBigUInt64LE(24n, 1);
    const response = new Promise<Buffer>((resolve, reject) => {
      owned.stream.on('data', (data: Buffer) => {
        chunks.push(data);
        const bytes = Buffer.concat(chunks);
        if (bytes.length >= 36) resolve(bytes);
      });

      owned.stream.once('error', reject);
    });
    owned.stream.write(hello);
    const bytes = await response;
    expect(bytes.length).toBe(36);
    expect(bytes.readBigUInt64LE()).toBe(28n);
    expect([...bytes.subarray(8, 11)]).toEqual([7, 0, 0]);
  } finally {
    await owned.close();
  }
}, 30000);

it('confirms full native helper cleanup after losing a worker close acknowledgement', async () => {
  const session = await launchOwnedRpcSession(
    {
      device: 'cpu',
      script: fileURLToPath(new URL('../../scripts/relay-network-worker.ps1', import.meta.url)),
      arguments: ['-Session'],
    },
    [],
  );
  const worker = await session.start();
  const helper = Reflect.get(session, 'helper') as OwnedPeerRpc;
  helper.stream.pause();
  const resume = vi.spyOn(helper.stream, 'resume').mockReturnValue(helper.stream);
  try {
    await expect(worker.close()).rejects.toThrow('RPC_CLEANUP_FAILED');
  } finally {
    resume.mockRestore();
    await session.close();
  }
}, 60000);
