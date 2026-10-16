import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { runUtility } from './utility.js';
import { HistoryStore } from '../history/store.js';
import { ModelConfigurationStore } from '../model-configuration/store.js';
import { ConfigurationController } from '../model-configuration/controller.js';
import { ClusterController } from '../cluster/controller.js';
import { capabilities, record } from '../model-configuration/test-fixtures.js';

it('keeps configuration management caller-bound and closes it on full Quit', async () => {
  const history = new HistoryStore(new DatabaseSync(':memory:'));
  const database = new DatabaseSync(':memory:');
  const store = new ModelConfigurationStore(
    database,
    () => {},
    (id) => id === record().modelId,
    capabilities,
    record().load,
  );
  const configuration = new ConfigurationController(
    store,
    'window',
    capabilities,
    record().load,
    () => null,
  );
  let receive!: (input: unknown) => void;
  const replies: Record<string, unknown>[] = [];
  runUtility(
    {
      send: (text) => replies.push(decodeFixture(text)),
      receive: (handler) => {
        receive = handler;
      },
      exit: () => {},
    },
    history,
    configuration,
    undefined,
    new ClusterController(store, 'window', { cacheK: 'q8_0', cacheV: 'q8_0' }),
  );
  receive(
    JSON.stringify({
      type: 'admitted',
      deploymentId: 'desktop',
      packageId: 'package',
      modelId: record().modelId,
      chat: {
        applicationData: 'C:\\fixture',
        caller: 'window',
        provenance: {
          packageId: 'package',
          upstreamCommit: 'a'.repeat(40),
          configuration: {
            modelSha256: record().modelId,
            contextPerSlot: 7680,
            slots: 4,
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
  for (const [id, caller] of [
    [1, 'forged'],
    [2, 'window'],
  ] as const)
    receive(
      JSON.stringify({
        type: 'configuration-command',
        id,
        caller,
        command: { action: 'read', modelId: record().modelId },
      }),
    );
  await new Promise<void>((resolve) => setImmediate(resolve));
  receive(
    JSON.stringify({
      type: 'cluster-command',
      id: 1,
      caller: 'forged',
      command: { action: 'list' },
    }),
  );
  receive(
    JSON.stringify({
      type: 'cluster-command',
      id: 2,
      caller: 'window',
      command: { action: 'read', modelId: record().modelId, configurationId: null },
    }),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(replies.find((v) => v.type === 'cluster-reply' && v.id === 1)?.reply).toEqual({
    ok: false,
    error: 'NOT_READY',
  });
  expect(replies.find((v) => v.type === 'cluster-reply' && v.id === 2)?.reply).toMatchObject({
    ok: true,
    draft: null,
    configurations: [],
  });
  expect(
    replies.find((value) => value.type === 'configuration-reply' && value.id === 1)?.reply,
  ).toEqual({ ok: false, error: 'NOT_READY' });
  expect(
    replies.find((value) => value.type === 'configuration-reply' && value.id === 2)?.reply,
  ).toMatchObject({ ok: true, record: { modelId: record().modelId } });
  receive(JSON.stringify({ type: 'command', text: JSON.stringify({ id: 1, action: 'quit' }) }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  receive(
    JSON.stringify({
      type: 'configuration-command',
      id: 3,
      caller: 'window',
      command: { action: 'read', modelId: record().modelId },
    }),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(
    replies.find((value) => value.type === 'configuration-reply' && value.id === 3)?.reply,
  ).toEqual({ ok: false, error: 'NOT_READY' });
  history.close();
  database.close();
});

it('captures changed saved load settings before requesting native launch', async () => {
  const history = new HistoryStore(new DatabaseSync(':memory:')),
    database = new DatabaseSync(':memory:');
  const store = new ModelConfigurationStore(
    database,
    () => {},
    (id) => id === record().modelId,
    capabilities,
    record().load,
  );
  const configuration = new ConfigurationController(
    store,
    'window',
    capabilities,
    record().load,
    () => null,
  );
  const initial = await store.read(record().modelId);
  await store.save(initial.modelId, 0, {
    ...initial,
    load: { ...initial.load, contextLength: 4096 },
  });
  let receive!: (input: unknown) => void;
  const replies: Record<string, unknown>[] = [];
  runUtility(
    {
      send: (text) => {
        const message = decodeFixture(text);
        replies.push(message);
        if (message.type === 'broker' && message.action === 'launch')
          queueMicrotask(() =>
            receive(
              JSON.stringify({
                type: 'engine',
                phase: 'failed',
                selection: message.selection,
                code: 0,
              }),
            ),
          );
      },
      receive: (handler) => {
        receive = handler;
      },
      exit: () => {},
    },
    history,
    configuration,
  );
  receive(
    JSON.stringify({
      type: 'admitted',
      deploymentId: 'desktop',
      packageId: 'package',
      modelId: initial.modelId,
    }),
  );
  receive(
    JSON.stringify({
      type: 'command',
      text: JSON.stringify({
        id: 1,
        action: 'load',
        selection: {
          deploymentId: 'desktop',
          sessionId: 'session',
          operationId: 'load',
          packageId: 'package',
          modelId: initial.modelId,
        },
      }),
    }),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(
    replies.filter((message) => message.type === 'broker' && message.action === 'launch'),
  ).toHaveLength(1);
  expect(replies.find((message) => message.type === 'reply')?.reply).toMatchObject({
    id: 1,
    snapshot: { phase: 'failed' },
  });
  await configuration.close();
  history.close();
  database.close();
});

function decodeFixture(text: string): Record<string, unknown> {
  const input: unknown = JSON.parse(text);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid fixture');
  return input as Record<string, unknown>;
}
