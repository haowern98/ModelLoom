import { afterEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { HistoryStore } from './store.js';
import { ChatController } from '../generation/chat-controller.js';
import { decodeChatCommand } from '../generation/chat-wire.js';

const stores: HistoryStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

it('persists pin/archive independently without changing chat contents or chronology', async () => {
  const db = new DatabaseSync(':memory:');
  const store = new HistoryStore(db);
  stores.push(store);
  const chat = await store.newConversation();
  await store.saveDraft(chat.id, 'Keep my draft');
  const before = await store.readConversation(chat.id);
  const controller = new ChatController(store, 'window');
  expect(
    await controller.command('wrong-window', {
      action: 'pinConversation',
      conversationId: chat.id,
      value: true,
    }),
  ).toEqual({ ok: false, error: 'NOT_READY' });
  for (const action of ['pinConversation', 'archiveConversation'])
    expect(
      await controller.command('window', { action, conversationId: chat.id, value: true }),
    ).toEqual({ ok: true });
  const saved = await store.readConversation(chat.id);
  expect(saved).toMatchObject({
    pinned: true,
    archived: true,
    draft: before.draft,
    updated: before.updated,
    turns: before.turns,
  });
  expect(saved.revision).toBe(before.revision + 2);
  const listed = await controller.command('window', { action: 'list' });
  expect(JSON.parse(listed.page!.payload)).toEqual([
    expect.objectContaining({ id: chat.id, pinned: true, archived: true, generating: false }),
  ]);
  expect((await store.newConversation(true)).id).not.toBe(chat.id);
  expect(
    await controller.command('window', {
      action: 'archiveConversation',
      conversationId: chat.id,
      value: false,
    }),
  ).toEqual({ ok: true });
  expect(await store.readConversation(chat.id)).toMatchObject({ pinned: true, archived: false });
  await controller.close();
});

it('rejects malformed sidebar commands instead of coercing values', () => {
  for (const value of ['true', 1, null, undefined, {}, []])
    expect(() =>
      decodeChatCommand({ action: 'pinConversation', conversationId: 'chat', value }),
    ).toThrow('INVALID_CONTROL');
  expect(() =>
    decodeChatCommand({
      action: 'archiveConversation',
      conversationId: 'chat',
      value: true,
      extra: true,
    }),
  ).toThrow('INVALID_CONTROL');
});

it('migrates verified v5 history atomically and retains sidebar flags after reopening', async () => {
  const db = new DatabaseSync(':memory:');
  const original = new HistoryStore(db);
  const chat = await original.newConversation();
  await original.saveDraft(chat.id, 'Saved draft');
  db.exec(
    'ALTER TABLE conversations DROP COLUMN pinned; ALTER TABLE conversations DROP COLUMN archived; DROP TABLE schema_version; CREATE TABLE schema_version(version INTEGER NOT NULL CHECK(version=5)); INSERT INTO schema_version VALUES(5);',
  );
  const reopened = new HistoryStore(db);
  stores.push(reopened);
  expect(await reopened.readConversation(chat.id)).toMatchObject({
    pinned: false,
    archived: false,
    draft: 'Saved draft',
  });
  await reopened.setSidebarFlag(chat.id, 'pinned', true);
  const again = new HistoryStore(db);
  expect(await again.readConversation(chat.id)).toMatchObject({ pinned: true, archived: false });
});

it('rolls back a failed sidebar write and leaves its saved flags and revision intact', async () => {
  const db = new DatabaseSync(':memory:');
  const store = new HistoryStore(db);
  stores.push(store);
  const chat = await store.newConversation();
  await store.setSidebarFlag(chat.id, 'pinned', true);
  const before = await store.readConversation(chat.id);
  db.exec(
    "CREATE TRIGGER fail_sidebar BEFORE UPDATE ON conversations BEGIN SELECT RAISE(ABORT,'synthetic failure'); END",
  );
  await expect(store.setSidebarFlag(chat.id, 'archived', true)).rejects.toThrow(
    'HISTORY_UNAVAILABLE',
  );
  expect(await store.readConversation(chat.id)).toEqual(before);
});
