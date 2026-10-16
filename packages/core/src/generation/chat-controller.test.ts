import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { HistoryStore } from '../history/store.js';
import { ChatController } from './chat-controller.js';
import { decodeChatCommand } from './chat-wire.js';

it('bounds search and Stop to closed commands without caller or path authority', () => {
  expect(decodeChatCommand({ action: 'cancelConversation', conversationId: 'chat' })).toEqual({
    action: 'cancelConversation',
    conversationId: 'chat',
  });
  expect(decodeChatCommand({ action: 'search', query: 'café' })).toEqual({
    action: 'search',
    query: 'café',
  });
  for (const command of [
    { action: 'cancelConversation', conversationId: 'chat', callerId: 'forged' },
    { action: 'cancelConversation', conversationId: '../private' },
    { action: 'search', query: '\ud800' },
    { action: 'search', query: 'x'.repeat(12001) },
    { action: 'search', query: 'word', sql: 'DROP TABLE attempts' },
  ])
    expect(() => decodeChatCommand(command)).toThrow('INVALID_CONTROL');
});
it('searches persisted text with literal Unicode matching and binds paged cursors to the query', async () => {
  const db = new DatabaseSync(':memory:'),
    store = new HistoryStore(db),
    controller = new ChatController(store, 'window');
  try {
    for (let i = 0; i < 35; i++) {
      const c = await store.newConversation();
      // Synthetic saved user messages avoid loading any model or exposing message bodies in summaries.
      db.prepare('INSERT INTO user_turns VALUES(?,?,?,?,?)').run(
        `turn-${i}`,
        c.id,
        0,
        'CAFÉ 100%_ literal',
        1,
      );
    }
    const first = await controller.command('window', { action: 'search', query: 'café 100%_' });
    expect(first.ok).toBe(true);
    const items = JSON.parse(first.page!.payload) as { id: string; updated: number }[];
    expect(items).toHaveLength(32);
    expect(items[0]!.updated).toEqual(expect.any(Number));
    expect(first.page!.payload).not.toContain('CAFÉ');
    expect(first.page!.payload).not.toContain('provenance');
    const second = await controller.command('window', {
      action: 'search',
      query: 'café 100%_',
      cursor: first.page!.next!,
    });
    expect(JSON.parse(second.page!.payload)).toHaveLength(3);
    const cursor = (await controller.command('window', { action: 'search', query: 'CAFÉ' })).page!
      .next!;
    expect(
      await controller.command('window', { action: 'search', query: 'different', cursor }),
    ).toEqual({ ok: false, error: 'STALE_VIEW' });
    expect(await controller.command('intruder', { action: 'search', query: 'café' })).toEqual({
      ok: false,
      error: 'NOT_READY',
    });
  } finally {
    await controller.close();
    store.close();
  }
});
it('reuses an empty conversation atomically and preserves existing drafts', async () => {
  const store = new HistoryStore(new DatabaseSync(':memory:')),
    controller = new ChatController(store, 'window');
  try {
    const first = await controller.command('window', { action: 'newConversation' });
    const repeated = await Promise.all([
      controller.command('window', { action: 'newConversation' }),
      controller.command('window', { action: 'newConversation' }),
    ]);
    expect(repeated.map((reply) => reply.conversationId)).toEqual([
      first.conversationId,
      first.conversationId,
    ]);
    await store.saveDraft(first.conversationId!, 'Keep this draft');
    const next = await controller.command('window', { action: 'newConversation' });
    expect(next.conversationId).not.toBe(first.conversationId);
    expect((await store.readConversation(first.conversationId!)).draft).toBe('Keep this draft');
  } finally {
    await controller.close();
    store.close();
  }
});

it.each([
  { action: 'send', conversationId: 'chat', text: 'hi', callerId: 'forged' },
  { action: 'read', conversationId: '../secret' },
  { action: 'cancel', requestId: 'r', slot: 0 },
  { action: 'saveDraft', conversationId: 'chat', text: '\ud800' },
  { action: 'deleteConversation', conversationId: '../secret' },
  { action: 'deleteConversation', conversationId: 'chat', callerId: 'forged' },
])('rejects forged renderer fields %j', (input) => {
  expect(() => decodeChatCommand(input)).toThrow('INVALID_CONTROL');
});
it('deletes a saved chat before loading a model, rejects another caller and stale deleted cursors', async () => {
  const store = new HistoryStore(new DatabaseSync(':memory:'));
  const controller = new ChatController(store, 'window');
  try {
    const c = await store.newConversation();
    await store.saveDraft(c.id, 'x'.repeat(12000));
    const first = await controller.command('window', { action: 'read', conversationId: c.id });
    expect(
      await controller.command('intruder', { action: 'deleteConversation', conversationId: c.id }),
    ).toEqual({ ok: false, error: 'NOT_READY' });
    expect(
      await controller.command('window', { action: 'deleteConversation', conversationId: c.id }),
    ).toEqual({ ok: true });
    expect(await store.listConversations()).toEqual([]);
    expect(
      (
        await controller.command('window', {
          action: 'read',
          conversationId: c.id,
          cursor: first.page!.next!,
        })
      ).ok,
    ).toBe(false);
  } finally {
    await controller.close();
    store.close();
  }
});
it('pages saved content below 64 KiB and rejects forged or revision-stale cursors', async () => {
  const store = new HistoryStore(new DatabaseSync(':memory:'));
  const controller = new ChatController(store, 'window');
  const chat = await store.newConversation();
  await store.saveDraft(chat.id, '"'.repeat(12000));
  const first = await controller.command('window', { action: 'read', conversationId: chat.id });
  expect(first.ok).toBe(true);
  expect(first.page?.next).not.toBeNull();
  expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThan(65536);
  await expect(
    controller.command('intruder', { action: 'newConversation' }),
  ).resolves.toMatchObject({ ok: false });
  await store.saveDraft(chat.id, 'changed');
  expect(
    await controller.command('window', {
      action: 'read',
      conversationId: chat.id,
      cursor: first.page!.next!,
    }),
  ).toEqual({ ok: false, error: 'STALE_VIEW' });
  expect(
    await controller.command('window', {
      action: 'read',
      conversationId: chat.id,
      cursor: 'forged',
    }),
  ).toEqual({ ok: false, error: 'STALE_VIEW' });
  await controller.close();
  store.close();
});
it('lists beyond the first 32 conversations without returning drafts or provenance', async () => {
  const store = new HistoryStore(new DatabaseSync(':memory:'));
  const controller = new ChatController(store, 'window');
  for (let i = 0; i < 35; i++) await store.newConversation();
  let cursor: string | undefined;
  const seen: string[] = [];
  do {
    const reply = await controller.command('window', {
      action: 'list',
      ...(cursor ? { cursor } : {}),
    });
    expect(reply.ok).toBe(true);
    const items = JSON.parse(reply.page!.payload) as { id: string }[];
    seen.push(...items.map((item) => item.id));
    expect(reply.page!.payload).not.toContain('provenance');
    cursor = reply.page!.next ?? undefined;
  } while (cursor);
  expect(new Set(seen).size).toBe(35);
  await controller.close();
  store.close();
});
it('rejects invalid native slot settings while keeping saved history available', async () => {
  const store = new HistoryStore(new DatabaseSync(':memory:'));
  const controller = new ChatController(store, 'window');
  try {
    await expect(
      controller.bind({
        session: { deploymentId: 'desktop', sessionId: 'session', operationId: 'load' },
        provenance: {
          packageId: 'package',
          upstreamCommit: 'a'.repeat(40),
          configuration: {
            modelSha256: 'a'.repeat(64),
            slots: 0,
            contextPerSlot: 7680,
            gpuLayers: 0,
            cacheK: 'f16',
            cacheV: 'f16',
            seed: 7,
            temperature: 0.8,
          },
        },
        transport: {
          tokenCount: () => Promise.resolve(10),
          start: () => {
            throw new Error('must not run');
          },
        },
        cleanup: () => Promise.resolve(),
      }),
    ).rejects.toThrow('INVALID_CONFIGURATION');
    const created = await controller.command('window', { action: 'newConversation' });
    expect(created.ok).toBe(true);
    expect(
      await controller.command('window', {
        action: 'send',
        conversationId: created.conversationId,
        text: 'hello',
      }),
    ).toEqual({ ok: false, error: 'NOT_READY' });
  } finally {
    await controller.close();
    store.close();
  }
});
