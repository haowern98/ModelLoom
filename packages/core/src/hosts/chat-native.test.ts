import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import type { ChatReply } from '../generation/chat-wire.js';

it('persists a stopped partial through the real Electron utility and reopens it without replay', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'modelloom-chat-host-'));
  const children: ReturnType<typeof spawn>[] = [];
  async function start() {
    const executable = String(
      createRequire(new URL('../../../../apps/desktop/package.json', import.meta.url))('electron'),
    );
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(
      executable,
      [fileURLToPath(new URL('../../tests/chat-entry.cjs', import.meta.url)), root],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env },
    );
    children.push(child);
    let id = 0,
      errors = '';
    const waiting = new Map<number, (reply: ChatReply & { quit?: boolean }) => void>();
    child.stderr?.on('data', (chunk: Buffer) => {
      errors += chunk.toString();
    });
    child.on('message', (input: { id: number; reply: ChatReply & { quit?: boolean } }) => {
      waiting.get(input.id)?.(input.reply);
    });
    const reply = (key: number) =>
      new Promise<ChatReply & { quit?: boolean }>((yes, no) => {
        const timer = setTimeout(() => {
          waiting.delete(key);
          no(new Error(`Chat fixture timeout: ${errors}`));
        }, 8000);
        waiting.set(key, (value) => {
          clearTimeout(timer);
          waiting.delete(key);
          yes(value);
        });
      });
    await reply(0);
    return {
      child,
      async send(input: Record<string, unknown>) {
        const key = ++id,
          result = reply(key);
        child.send({ id: key, ...input });
        return result;
      },
    };
  }
  try {
    const first = await start();
    await first.send({
      command: {
        id: 1,
        action: 'load',
        selection: {
          deploymentId: 'fixture-host',
          sessionId: 's1',
          operationId: 'op1',
          packageId: 'fixture',
          modelId: 'fixture',
        },
      },
    });
    const created = await first.send({ chat: { action: 'newConversation' } });
    expect(created.ok).toBe(true);
    const sent = await first.send({
      chat: { action: 'send', conversationId: created.conversationId, text: 'Synthetic prompt' },
    });
    expect(sent.ok).toBe(true);
    await expect
      .poll(
        async () =>
          (await first.send({ chat: { action: 'read', conversationId: created.conversationId } }))
            .page?.payload,
      )
      .toContain('Synthetic saved partial');
    expect(
      (
        await first.send({
          chat: { action: 'cancelConversation', conversationId: created.conversationId },
        })
      ).ok,
    ).toBe(true);
    await expect
      .poll(
        async () =>
          (await first.send({ chat: { action: 'read', conversationId: created.conversationId } }))
            .page?.payload,
      )
      .toContain('cancelled');
    await first.send({ command: { id: 2, action: 'quit' } });
    await new Promise<void>((yes) =>
      first.child.exitCode !== null ? yes() : first.child.once('exit', () => yes()),
    );
    expect(first.child.exitCode).toBe(0);
    const reopened = await start();
    const saved = await reopened.send({
      chat: { action: 'read', conversationId: created.conversationId },
    });
    expect(saved.ok).toBe(true);
    expect(saved.page?.payload).toContain('Synthetic saved partial');
    expect(saved.page?.payload).toContain('cancelled');
    const found = await reopened.send({ chat: { action: 'search', query: 'saved partial' } });
    expect(found.ok).toBe(true);
    const hits = JSON.parse(found.page!.payload) as Record<string, unknown>[];
    expect(hits).toMatchObject([{ id: created.conversationId }]);
    expect(typeof hits[0]?.updated).toBe('number');
    expect(found.page!.payload).not.toContain('Synthetic saved partial');
    const kept = await reopened.send({ chat: { action: 'newConversation' } });
    await reopened.send({
      chat: { action: 'saveDraft', conversationId: kept.conversationId, text: 'Retained draft' },
    });
    expect(
      await reopened.send({
        chat: { action: 'deleteConversation', conversationId: created.conversationId },
      }),
    ).toEqual({ ok: true });
    await reopened.send({ command: { id: 1, action: 'quit' } });
    await new Promise<void>((yes) =>
      reopened.child.exitCode !== null ? yes() : reopened.child.once('exit', () => yes()),
    );
    const deleted = await start();
    const remaining = await deleted.send({ chat: { action: 'list' } });
    expect(JSON.parse(remaining.page!.payload)).toMatchObject([{ id: kept.conversationId }]);
    expect(
      (await deleted.send({ chat: { action: 'read', conversationId: kept.conversationId } })).page
        ?.payload,
    ).toContain('Retained draft');
    expect(
      (await deleted.send({ chat: { action: 'read', conversationId: created.conversationId } })).ok,
    ).toBe(false);
    await deleted.send({ command: { id: 1, action: 'quit' } });
    await new Promise<void>((yes) =>
      deleted.child.exitCode !== null ? yes() : deleted.child.once('exit', () => yes()),
    );
  } finally {
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await new Promise<void>((yes) => child.once('exit', () => yes()));
      }
    // Exact test-created root, verified before recursive cleanup.
    expect(realpathSync(root).startsWith(realpathSync(tmpdir()) + path.sep)).toBe(true);
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);
