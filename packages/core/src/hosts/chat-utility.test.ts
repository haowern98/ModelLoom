import { expect, it } from 'vitest';
import { runUtility } from './utility.js';
import { DatabaseSync } from 'node:sqlite';
import { HistoryStore } from '../history/store.js';
it('accepts Chat only from the admitted owner caller and closes it on full Quit', async () => {
  let receive!: (input: unknown) => void;
  const replies: Record<string, unknown>[] = [];
  const history = new HistoryStore(new DatabaseSync(':memory:'));
  runUtility(
    {
      send: (text) => replies.push(JSON.parse(text) as Record<string, unknown>),
      receive: (handler) => {
        receive = handler;
      },
      exit: () => undefined,
    },
    history,
  );
  receive(
    JSON.stringify({
      type: 'admitted',
      deploymentId: 'desktop',
      packageId: 'package',
      modelId: 'model',
      chat: {
        applicationData: 'C:\\fixture',
        caller: 'window',
        provenance: {
          packageId: 'package',
          upstreamCommit: 'a'.repeat(40),
          configuration: {
            modelSha256: 'a'.repeat(64),
            slots: 4,
            contextPerSlot: 7680,
            gpuLayers: 0,
            cacheK: 'f16',
            cacheV: 'f16',
            seed: 7,
            temperature: 0.8,
          },
        },
      },
    }),
  );
  receive(
    JSON.stringify({
      type: 'chat-command',
      id: 1,
      caller: 'forged',
      command: { action: 'newConversation' },
    }),
  );
  receive(
    JSON.stringify({
      type: 'chat-command',
      id: 2,
      caller: 'window',
      command: { action: 'newConversation' },
    }),
  );
  await new Promise<void>((yes) => setImmediate(yes));
  expect(
    replies.find((reply) => reply.type === 'chat-reply' && reply.id === 1)?.reply,
  ).toMatchObject({ ok: false });
  expect(
    replies.find((reply) => reply.type === 'chat-reply' && reply.id === 2)?.reply,
  ).toMatchObject({ ok: true });
  receive(JSON.stringify({ type: 'command', text: JSON.stringify({ id: 1, action: 'quit' }) }));
  await new Promise<void>((yes) => setImmediate(yes));
  receive(
    JSON.stringify({
      type: 'chat-command',
      id: 3,
      caller: 'window',
      command: { action: 'newConversation' },
    }),
  );
  await new Promise<void>((yes) => setImmediate(yes));
  expect(
    replies.find((reply) => reply.type === 'chat-reply' && reply.id === 3)?.reply,
  ).toMatchObject({ ok: false });
  history.close();
});
it('still completes full Quit when protected history cannot open', async () => {
  let receive!: (input: unknown) => void;
  const replies: Record<string, unknown>[] = [];
  const exits: number[] = [];
  runUtility({
    send: (text) => replies.push(JSON.parse(text) as Record<string, unknown>),
    receive: (handler) => {
      receive = handler;
    },
    exit: (code) => {
      exits.push(code);
    },
  });
  receive(
    JSON.stringify({
      type: 'admitted',
      deploymentId: 'desktop',
      packageId: 'package',
      modelId: 'model',
      chat: { applicationData: 'relative', caller: 'window', provenance: {} },
    }),
  );
  receive(
    JSON.stringify({
      type: 'chat-command',
      id: 1,
      caller: 'window',
      command: { action: 'newConversation' },
    }),
  );
  await new Promise<void>((yes) => setImmediate(yes));
  expect(replies.find((reply) => reply.type === 'chat-reply')?.reply).toEqual({
    ok: false,
    error: 'HISTORY_UNAVAILABLE',
  });
  receive(JSON.stringify({ type: 'command', text: JSON.stringify({ id: 1, action: 'quit' }) }));
  await new Promise<void>((yes) => setImmediate(yes));
  expect(replies.find((reply) => reply.type === 'reply')).toMatchObject({ quit: true });
  expect(exits).toEqual([]);
});
