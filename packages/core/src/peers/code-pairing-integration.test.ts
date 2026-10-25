import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { PeerNode } from './node.js';
import { openWindowsPeerIdentity } from './windows-identity.js';
import type { WindowsPeerIdentity } from './windows-identity.js';
import type { PeerTrust } from './trust-store.js';
import { PeerTrustStore } from './trust-store.js';
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ownershipBinding } from '../hosts/windows-ownership.js';
import { duplexPair } from 'node:stream';
import type { Duplex } from 'node:stream';
import { probeNetworkPeer } from '../network/http.js';
import { overlayChannel } from './overlay-channel.js';
import * as ipc from './ipc-rpc.js';

it('pairs through both parent/core IPC boundaries', async () => {
  const errors: string[] = [];
  let phase = 'invite';
  const original = ipc.rpcIpcStream;
  const spy = vi.spyOn(ipc, 'rpcIpcStream').mockImplementation((id, send) => {
    const p = original(id, send);
    p.stream.on('error', (e) => errors.push(e.message));
    return p;
  });
  const worker = new PeerNode(b, 'IPC worker', [{ id: 'gpu-one', name: 'GPU', memoryBytes: 4096 }]);
  const client = new PeerNode(a, 'IPC client', []);
  nodes.push(worker, client);
  // The overlay's admitted secure port is fixed, including its advertisement.
  await worker.share('127.0.0.1', 0, 49302, ['gpu-one']);
  let live = true;
  const receiverParent = overlayChannel((m) =>
    queueMicrotask(() => {
      if (live) receiverCore.receive(m as Record<string, unknown>);
    }),
  );
  const receiverCore = overlayChannel((m) =>
    queueMicrotask(() => {
      if (live) receiverParent.receive(m as Record<string, unknown>);
    }),
  );
  let arrive!: (port: number, stream: Duplex) => void;
  receiverParent.attach({
    addresses: () => ['100.64.0.1'],
    subscribe: () => () => {},
    incoming: (fn) => {
      arrive = fn;
      return () => {};
    },
    dial: () => Promise.reject(Error('UNEXPECTED_DIAL')),
  });
  receiverCore.incoming((port, stream) => worker.acceptOverlay(port, stream));
  const senderParent = overlayChannel((m) =>
    queueMicrotask(() => {
      if (live) senderCore.receive(m as Record<string, unknown>);
    }),
  );
  const senderCore = overlayChannel((m) =>
    queueMicrotask(() => {
      if (live) senderParent.receive(m as Record<string, unknown>);
    }),
  );
  senderParent.attach({
    addresses: () => ['100.64.0.2'],
    subscribe: () => () => {},
    incoming: () => () => {},
    dial: (_address, port) => {
      const pair = duplexPair();
      arrive(port, pair[1]);
      return Promise.resolve(pair[0]);
    },
  });
  client.setOverlay(senderCore.transport);
  await new Promise((resolve) => setImmediate(resolve));
  try {
    const invited = await client.invite('100.64.0.2');
    expect((await client.invite('100.64.0.2')).id).toBe(invited.id);
    expect(worker.snapshot().incoming).toHaveLength(1);
    phase = 'verify';
    const pending = worker.snapshot().incoming.find((p) => p.id === invited.id)!;
    await client.verifyCode(invited.id, pending.pairingCode!);
    phase = 'approve';
    await worker.approve(invited.id, a.fingerprint);
    phase = 'inventory';
    expect((await client.inventory(invited.id)).length).toBe(1);
  } catch (error) {
    throw Error(`${phase}: ${String(error)}; ${errors.join(',')}`, { cause: error });
  } finally {
    live = false;
    senderParent.close();
    senderCore.close();
    receiverParent.close();
    receiverCore.close();
    spy.mockRestore();
    await worker.close();
    await client.close();
  }
}, 30000);

it.each([
  ['truncated', 'HTTP/1.1 200 OK\r\nContent-Length: 100\r\nConnection: close\r\n\r\n{}'],
  ['malformed JSON', 'HTTP/1.1 200 OK\r\nContent-Length: 1\r\nConnection: close\r\n\r\n{'],
])('rejects a %s pairing reply when the transport closes', async (_name, response) => {
  const client = new PeerNode(a, 'Invalid reply client', []);
  nodes.push(client);
  client.setOverlay({
    has: () => true,
    dial: () => {
      const [local, remote] = duplexPair();
      remote.on('error', () => undefined);
      remote.once('data', () => remote.end(response));
      local.once('close', () => remote.destroy());
      return Promise.resolve(local);
    },
  });
  await expect(client.invite('100.64.0.2')).rejects.toThrow();
  expect(client.snapshot().outgoing).toHaveLength(0);
});

it('pairs over owned overlay streams and discovery never creates requests', async () => {
  const worker = new PeerNode(b, 'Overlay worker', [
    { id: 'gpu-one', name: 'Fixture', memoryBytes: 4096 },
  ]);
  const client = new PeerNode(a, 'Overlay coordinator', []);
  nodes.push(worker, client);
  await worker.share('127.0.0.1', 0, 0, ['gpu-one']);
  const advert = await probeNetworkPeer(
    async () => {
      const pair = duplexPair();
      worker.acceptOverlay(49301, pair[1]);
      return Promise.resolve(pair[0]);
    },
    '100.101.102.103',
    AbortSignal.timeout(3000),
  );
  expect(Reflect.get(advert as object, 'sharing')).toBe(true);
  expect(worker.snapshot().incoming).toHaveLength(0);
  client.setOverlay({
    has: (address) => address === '100.101.102.103',
    dial: (_address, port) => {
      const pair = duplexPair();
      worker.acceptOverlay(port === 49301 ? 49301 : 49302, pair[1]);
      return Promise.resolve(pair[0]);
    },
  });
  const request = await client.invite('100.101.102.103:49301');
  expect(worker.snapshot().incoming).toHaveLength(1);
  const pending = worker.snapshot().incoming[0]!;
  await expect(client.inventory(request.id)).rejects.toThrow();
  await client.verifyCode(request.id, pending.pairingCode!);
  await worker.approve(request.id, a.fingerprint);
  expect(await client.inventory(request.id)).toEqual([
    { id: 'gpu-one', name: 'Fixture', memoryBytes: 4096 },
  ]);
  await worker.decline(request.id);
  await expect(client.inventory(request.id)).rejects.toThrow();
  await expect(client.invite('100.101.102.103:49301', 'f'.repeat(64))).rejects.toThrow(
    'PEER_IDENTITY_CHANGED',
  );
});

let a: WindowsPeerIdentity, b: WindowsPeerIdentity, c: WindowsPeerIdentity;
const nodes: PeerNode[] = [];
it('reuses one pending code request for sequential and concurrent invitations from the same identity', async () => {
  const worker = new PeerNode(b, 'Retry worker', [{ id: 'gpu', name: 'GPU', memoryBytes: 4096 }]);
  const client = new PeerNode(a, 'Retry client', []);
  nodes.push(worker, client);
  const address = await worker.share('127.0.0.1', 0, 0, ['gpu']);
  const first = await client.invite(address);
  expect(worker.snapshot().incoming).toHaveLength(1);
  const code = worker.snapshot().incoming[0]!.pairingCode!;
  const retried = await client.invite(address);
  const simultaneous = await Promise.all([client.invite(address), client.invite(address)]);
  expect([retried.id, ...simultaneous.map((request) => request.id)]).toEqual([
    first.id,
    first.id,
    first.id,
  ]);
  expect(worker.snapshot().incoming).toHaveLength(1);
  expect(worker.snapshot().incoming[0]!.pairingCode).toBe(code);
  await client.verifyCode(first.id, code);
  expect((await client.invite(address)).id).toBe(first.id);
  expect(client.snapshot().outgoing[0]!.verified).toBe(true);
  await worker.approve(first.id, a.fingerprint);
  expect(await client.inventory(first.id)).toHaveLength(1);
});

it('coalesces simultaneous first invitations before asynchronous code creation finishes', async () => {
  const worker = new PeerNode(b, 'Concurrent worker', [
    { id: 'gpu', name: 'GPU', memoryBytes: 4096 },
  ]);
  const one = new PeerNode(a, 'Concurrent client', []);
  const two = new PeerNode(a, 'Concurrent client', []);
  nodes.push(worker, one, two);
  const address = await worker.share('127.0.0.1', 0, 0, ['gpu']);
  const requests = await Promise.all([one.invite(address), two.invite(address)]);
  expect(requests[0].id).toBe(requests[1].id);
  expect(worker.snapshot().incoming).toHaveLength(1);
  await one.verifyCode(requests[0].id, worker.snapshot().incoming[0]!.pairingCode!);
  await worker.approve(requests[0].id, a.fingerprint);
  expect(await one.inventory(requests[0].id)).toHaveLength(1);
});

it('keeps different device identities separate even when they have the same display name', async () => {
  const worker = new PeerNode(b, 'Worker', [{ id: 'gpu', name: 'GPU', memoryBytes: 4096 }]);
  const first = new PeerNode(a, 'Same name', []);
  const second = new PeerNode(c, 'Same name', []);
  nodes.push(worker, first, second);
  const address = await worker.share('127.0.0.1', 0, 0, ['gpu']);
  const requests = await Promise.all([first.invite(address), second.invite(address)]);
  expect(requests[0].id).not.toBe(requests[1].id);
  expect(worker.snapshot().incoming).toHaveLength(2);
  expect(
    worker
      .snapshot()
      .incoming.every((request) => !request.localVerified && !request.remoteVerified),
  ).toBe(true);
  await expect(first.inventory(requests[0].id)).rejects.toThrow('PEER_NOT_APPROVED');
  await expect(second.inventory(requests[1].id)).rejects.toThrow('PEER_NOT_APPROVED');
});

it('keeps the original code transcript when the same identity retries under a different name', async () => {
  const worker = new PeerNode(b, 'Worker', [{ id: 'gpu', name: 'GPU', memoryBytes: 4096 }]);
  const original = new PeerNode(a, 'Original name', []);
  const renamed = new PeerNode(a, 'Different name', []);
  nodes.push(worker, original, renamed);
  const address = await worker.share('127.0.0.1', 0, 0, ['gpu']);
  const request = await original.invite(address);
  const code = worker.snapshot().incoming[0]!.pairingCode!;
  await expect(renamed.invite(address)).rejects.toThrow('DUPLICATE_PEER_REQUEST');
  expect(worker.snapshot().incoming).toHaveLength(1);
  expect(worker.snapshot().incoming[0]!.pairingCode).toBe(code);
  await original.verifyCode(request.id, code);
  await worker.approve(request.id, a.fingerprint);
  expect(await original.inventory(request.id)).toHaveLength(1);
});

it('does not prolong a pending request when Connect is retried', async () => {
  const worker = new PeerNode(b, 'Worker', [{ id: 'gpu', name: 'GPU', memoryBytes: 4096 }]);
  const client = new PeerNode(a, 'Client', []);
  nodes.push(worker, client);
  const address = await worker.share('127.0.0.1', 0, 0, ['gpu']);
  let elapsed = 0;
  const clock = performance.now.bind(performance);
  const spy = vi.spyOn(performance, 'now').mockImplementation(() => clock() + elapsed);
  try {
    const first = await client.invite(address);
    elapsed = 299000;
    expect((await client.invite(address)).id).toBe(first.id);
    elapsed = 301000;
    const replacement = await client.invite(address);
    expect(replacement.id).not.toBe(first.id);
    expect(worker.snapshot().incoming.map((request) => request.id)).toEqual([replacement.id]);
    await client.verifyCode(replacement.id, worker.snapshot().incoming[0]!.pairingCode!);
    await worker.approve(replacement.id, a.fingerprint);
    expect(await client.inventory(replacement.id)).toHaveLength(1);
  } finally {
    spy.mockRestore();
  }
});

beforeAll(async () => {
  a = await openWindowsPeerIdentity();
  b = await openWindowsPeerIdentity();
  c = await openWindowsPeerIdentity();
}, 30000);
afterAll(async () => {
  await Promise.all(nodes.map((n) => n.close()));
  a?.close();
  b?.close();
  c?.close();
});
it('requires code then consent, remembers both directions of trust and persists revocation', async () => {
  let receiver: PeerTrust[] = [],
    sender: PeerTrust[] = [];
  const makeWorker = () =>
    new PeerNode(
      b,
      'Worker',
      [{ id: 'gpu-one', name: 'GPU', memoryBytes: 4096 }],
      undefined,
      undefined,
      {
        initial: receiver,
        save: async (records) => {
          receiver = await Promise.resolve(structuredClone([...records]));
        },
      },
    );
  let worker = makeWorker();
  let client = new PeerNode(a, 'Laptop', [], undefined, undefined, {
    initial: sender,
    save: async (records) => {
      sender = await Promise.resolve(structuredClone([...records]));
    },
  });
  nodes.push(worker, client);
  let address = await worker.share('127.0.0.1', 0, 0, ['gpu-one']);
  let invitation = await client.invite(address);
  const code = worker.snapshot().incoming[0]!.pairingCode!;
  await expect(worker.approve(invitation.id, a.fingerprint)).rejects.toThrow(
    'PAIRING_NOT_VERIFIED',
  );
  await expect(
    client.verifyCode(invitation.id, code === '000000' ? '111111' : '000000'),
  ).rejects.toThrow('PAIRING_CODE_INVALID');
  await client.verifyCode(invitation.id, code);
  await expect(client.inventory(invitation.id)).rejects.toThrow('PEER_NOT_APPROVED');
  expect(receiver).toEqual([]);
  expect(sender).toEqual([]);
  await worker.approve(invitation.id, a.fingerprint);
  expect((await client.status(invitation.id)).phase).toBe('approved');
  expect(await client.inventory(invitation.id)).toHaveLength(1);
  expect(receiver[0]!.gpuIds).toEqual(['gpu-one']);
  expect(sender[0]!.direction).toBe('outgoing');
  await Promise.all([worker.close(), client.close()]);
  worker = makeWorker();
  expect(worker.snapshot().incoming[0]?.localVerified).toBe(true);
  expect(worker.snapshot().sharing).toBe(false);
  client = new PeerNode(a, 'Laptop', [], undefined, undefined, {
    initial: sender,
    save: async (records) => {
      sender = await Promise.resolve(structuredClone([...records]));
    },
  });
  nodes.push(worker, client);
  address = await worker.share('127.0.0.1', 0, 0, ['gpu-one']);
  invitation = await client.invite(address);
  expect((await client.status(invitation.id)).phase).toBe('approved');
  expect(worker.snapshot().incoming[0]!.pairingCode).toBeUndefined();
  await worker.decline(invitation.id);
  await worker.flushTrust();
  expect(receiver).toEqual([]);
  await expect(client.inventory(invitation.id)).rejects.toThrow('PEER_DECLINED');
  expect((await client.status(invitation.id)).phase).toBe('declined');
  expect(sender).toEqual([]);
}, 20000);

it('protects saved trust with CurrentUser DPAPI and rejects corruption', async () => {
  const parent = path.resolve('out/code-trust-native');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'test-'));
  const native = ownershipBinding();
  native.privateDirectory(root);
  expect(root.startsWith(parent + path.sep)).toBe(true);
  try {
    const store = new PeerTrustStore(root, a.fingerprint, undefined, native);
    const record: PeerTrust = {
      direction: 'incoming',
      fingerprint: b.fingerprint,
      name: 'Worker',
      certificate: b.certificate.toString('base64'),
      authority: b.authority.toString('base64'),
      gpuIds: ['gpu-one'],
    };
    await store.write([record]);
    expect(await store.read()).toEqual([record]);
    const ciphertext = await readFile(path.join(root, 'trust.dpapi'));
    expect(ciphertext.includes(Buffer.from(b.fingerprint))).toBe(false);
    ciphertext[20] = ciphertext[20]! ^ 1;
    await writeFile(path.join(root, 'trust.dpapi'), ciphertext);
    await expect(store.read()).rejects.toThrow('PEER_TRUST_UNAVAILABLE');
  } finally {
    if (root.startsWith(parent + path.sep)) await rm(root, { recursive: true, force: true });
  }
}, 20000);

it('never grants access if approval cannot be saved and cancels after verification', async () => {
  const worker = new PeerNode(
    b,
    'Worker',
    [{ id: 'gpu-one', name: 'GPU', memoryBytes: 4096 }],
    undefined,
    undefined,
    {
      initial: [],
      save: () => Promise.reject(Error('disk failure')),
    },
  );
  const client = new PeerNode(a, 'Laptop', []);
  nodes.push(worker, client);
  const address = await worker.share('127.0.0.1', 0, 0, ['gpu-one']);
  const request = await client.invite(address);
  await client.verifyCode(request.id, worker.snapshot().incoming[0]!.pairingCode!);
  await expect(worker.approve(request.id, a.fingerprint)).rejects.toThrow('PEER_TRUST_UNAVAILABLE');
  await expect(client.inventory(request.id)).rejects.toThrow('PEER_NOT_APPROVED');
  await client.cancel(request.id);
  expect(worker.snapshot().incoming[0]!.phase).toBe('declined');
}, 20000);

it('rejects approval that expires while protected storage is being written', async () => {
  let release!: () => void, began!: () => void;
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let saved: readonly PeerTrust[] = [];
  const worker = new PeerNode(
    b,
    'Worker',
    [{ id: 'gpu-one', name: 'GPU', memoryBytes: 4096 }],
    undefined,
    undefined,
    {
      initial: [],
      save: (records) => {
        saved = records;
        if (records.length) {
          began();
          return pending;
        }
        return Promise.resolve();
      },
    },
  );
  const client = new PeerNode(a, 'Laptop', []);
  nodes.push(worker, client);
  const address = await worker.share('127.0.0.1', 0, 0, ['gpu-one']);
  const request = await client.invite(address);
  await client.verifyCode(request.id, worker.snapshot().incoming[0]!.pairingCode!);
  const approval = worker.approve(request.id, a.fingerprint);
  await started;
  const incoming = Reflect.get(worker, 'incoming') as Map<string, { expires: number }>;
  incoming.get(request.id)!.expires = 0;
  release();
  await expect(approval).rejects.toThrow('PAIRING_EXPIRED');
  expect(saved).toEqual([]);
  await expect(client.inventory(request.id)).rejects.toThrow();
}, 20000);

it('keeps the online guessing budget across newly created request IDs', async () => {
  const worker = new PeerNode(b, 'Worker', [{ id: 'gpu-one', name: 'GPU', memoryBytes: 4096 }]);
  const client = new PeerNode(a, 'Laptop', []);
  nodes.push(worker, client);
  const address = await worker.share('127.0.0.1', 0, 0, ['gpu-one']);
  for (let requestIndex = 0; requestIndex < 3; requestIndex++) {
    const request = await client.invite(address);
    const code = worker.snapshot().incoming.find((p) => p.id === request.id)!.pairingCode!;
    const wrong = code === '000000' ? '111111' : '000000';
    if (requestIndex < 2)
      for (let attempt = 0; attempt < 5; attempt++)
        await expect(client.verifyCode(request.id, wrong)).rejects.toThrow('PAIRING_CODE_INVALID');
    else
      await expect(client.verifyCode(request.id, code)).rejects.toThrow(
        'PAIRING_ATTEMPTS_EXCEEDED',
      );
    await expect(client.inventory(request.id)).rejects.toThrow('PEER_NOT_APPROVED');
    // Explicit cancellation forces a fresh ID; merely retrying Connect now
    // retains the existing transcript and its stricter five-attempt limit.
    if (requestIndex < 2) await client.cancel(request.id);
  }
}, 20000);
