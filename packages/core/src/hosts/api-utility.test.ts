import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { runUtility } from './utility.js';
import { HistoryStore } from '../history/store.js';
import { ModelConfigurationStore } from '../model-configuration/store.js';
import { capabilities, record } from '../model-configuration/test-fixtures.js';
import { ApiController } from '../local-api/controller.js';
it('keeps API management caller-bound and registers an import independently of protected-key availability', async () => {
  const database = new DatabaseSync(':memory:'),
    history = new HistoryStore(new DatabaseSync(':memory:'));
  const store = new ModelConfigurationStore(
    database,
    () => {},
    () => true,
    capabilities,
    record().load,
  );
  const api = new ApiController(
    store,
    'window',
    record().modelId,
    capabilities,
    () => {
      throw new Error('CREDENTIAL_UNAVAILABLE');
    },
    () => false,
    () => undefined,
    0,
  );
  let receive!: (input: unknown) => void;
  const replies: Record<string, unknown>[] = [];
  runUtility(
    {
      send: (text) => {
        const value: unknown = JSON.parse(text);
        if (value && typeof value === 'object') replies.push(value as Record<string, unknown>);
      },
      receive: (handler) => {
        receive = handler;
      },
      exit: () => {},
    },
    history,
    undefined,
    api,
  );
  receive(
    JSON.stringify({
      type: 'admitted',
      deploymentId: 'desktop',
      packageId: 'package',
      modelId: record().modelId,
    }),
  );
  for (const [id, caller, command] of [
    [1, 'forged', { action: 'status' }],
    [2, 'window', { action: 'registerImport', modelId: record().modelId, created: 123 }],
  ] as const)
    receive(JSON.stringify({ type: 'api-command', id, caller, command }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(replies.find((value) => value.type === 'api-reply' && value.id === 1)?.reply).toEqual({
    ok: false,
    error: 'NOT_READY',
  });
  expect(replies.find((value) => value.type === 'api-reply' && value.id === 2)?.reply).toEqual({
    ok: true,
    registered: true,
  });
  expect(await store.readImport(record().modelId)).toBe(123);
  const source = {
    modelId: record().modelId,
    file: 'E:\\Models\\model.gguf',
    name: 'Indexed model',
    size: '1 GB',
    sizeBytes: 100,
    modifiedMs: 1234,
    architecture: 'llama',
    contextLimit: 4096,
    quantization: 'Unknown',
    parameters: 'Unknown',
  };
  expect(
    await api.command('window', {
      action: 'registerImport',
      modelId: source.modelId,
      created: 456,
      source,
    }),
  ).toEqual({ ok: true, registered: true });
  expect(await api.command('window', { action: 'readImportSource' })).toEqual({ ok: true, source });
  expect(await api.command('window', { action: 'readModelUsage' })).toEqual({
    ok: true,
    lastUsedAt: null,
  });
  const timestamp = Date.now();
  await store.recordUse(record().modelId, timestamp);
  expect(await api.command('window', { action: 'readModelUsage' })).toEqual({
    ok: true,
    lastUsedAt: timestamp,
  });
  expect(await api.command('forged', { action: 'readModelUsage' })).toEqual({
    ok: false,
    error: 'NOT_READY',
  });
  expect(await api.command('forged', { action: 'readImportSource' })).toEqual({
    ok: false,
    error: 'NOT_READY',
  });
  receive(JSON.stringify({ type: 'command', text: JSON.stringify({ id: 1, action: 'quit' }) }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(await api.command('window', { action: 'status' })).toEqual({
    ok: false,
    error: 'NOT_READY',
  });
  history.close();
  database.close();
});
