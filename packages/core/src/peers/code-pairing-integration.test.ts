import { afterAll, beforeAll, expect, it } from 'vitest';
import { PeerNode } from './node.js';
import { openWindowsPeerIdentity } from './windows-identity.js';
import type { WindowsPeerIdentity } from './windows-identity.js';
import type { PeerTrust } from './trust-store.js';
import { PeerTrustStore } from './trust-store.js';
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ownershipBinding } from '../hosts/windows-ownership.js';

let a: WindowsPeerIdentity, b: WindowsPeerIdentity;
const nodes: PeerNode[] = [];
beforeAll(async () => {
  a = await openWindowsPeerIdentity();
  b = await openWindowsPeerIdentity();
}, 30000);
afterAll(async () => {
  await Promise.all(nodes.map((n) => n.close()));
  a?.close();
  b?.close();
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
  }
}, 20000);
