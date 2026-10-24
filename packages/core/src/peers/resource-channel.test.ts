import { expect, it } from 'vitest';
import { peerResourceClient, servePeerResources } from './resource-channel.js';

it('returns validated resources and preserves a missing verified-package error', async () => {
  let missing = false;
  const client = peerResourceClient((value) => {
    void servePeerResources(
      value as Record<string, unknown>,
      () => {
        if (missing) return Promise.reject(Error('RPC_PACKAGE_REQUIRED'));
        return Promise.resolve({ runtimeId: 'a'.repeat(64), ram: 1024, gpus: [] });
      },
      (reply) => client.receive(reply as Record<string, unknown>),
    );
  });
  expect((await client.read(null)).runtimeId).toBe('a'.repeat(64));
  missing = true;
  await expect(client.read(null)).rejects.toThrow('RPC_PACKAGE_REQUIRED');
  client.close();
  await expect(client.read(null)).rejects.toThrow('NOT_READY');
});
