import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { PeerFailureJournal } from './failure-journal.js';

it('retains only the latest bounded connection events without arbitrary error text', async () => {
  const root = await mkdtemp(path.resolve('out/peer-failures-'));
  try {
    const journal = new PeerFailureJournal(root);
    for (let i = 0; i < 80; ++i)
      journal.record({
        stage: 'inventory',
        decision: 'retry',
        error: Error('OVERLAY_UNAVAILABLE'),
      });
    journal.record({
      stage: 'heartbeat',
      decision: 'close',
      error: new Error('PEER_UNAVAILABLE', {
        cause: Object.assign(Error('private prompt'), { code: 'ETIMEDOUT' }),
      }),
    });
    journal.record({ stage: 'rpc-close', decision: 'close', error: Error('private prompt') });
    await journal.flush();
    const text = await readFile(path.join(root, 'connection-failures.json'), 'utf8');
    const events = JSON.parse(text) as unknown[];
    expect(events).toHaveLength(64);
    expect(events.at(-2)).toMatchObject({
      stage: 'heartbeat',
      decision: 'close',
      code: 'PEER_UNAVAILABLE',
      cause: 'ETIMEDOUT',
    });
    expect(events.at(-1)).toMatchObject({ stage: 'rpc-close', code: 'UNKNOWN' });
    expect(text).not.toContain('private prompt');
    journal.record({
      stage: 'inventory',
      decision: 'disconnect',
      error: Error('PEER_NOT_APPROVED'),
    });
    await journal.flush();
    const updated = JSON.parse(
      await readFile(path.join(root, 'connection-failures.json'), 'utf8'),
    ) as unknown[];
    expect(updated.at(-1)).toMatchObject({ code: 'PEER_NOT_APPROVED' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('does not interrupt runtime cleanup when its diagnostic directory cannot be written', async () => {
  const journal = new PeerFailureJournal(path.resolve('out/absent-peer-failures/absent'));
  journal.record({ stage: 'rpc-close', decision: 'close', error: Error('RPC_STREAM_CLOSED') });
  await expect(journal.flush()).resolves.toBeUndefined();
});
