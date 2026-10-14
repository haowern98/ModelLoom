import { afterEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createRuntimeController } from './runtime-controller';
import { ModelConfigurationStore } from '../../../../packages/core/src/model-configuration/store';
import { ConfigurationController } from '../../../../packages/core/src/model-configuration/controller';
import {
  record,
  capabilities,
} from '../../../../packages/core/src/model-configuration/test-fixtures';

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));
function setup() {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  const store = new ModelConfigurationStore(
    database,
    () => {},
    (id) => id === record().modelId,
    capabilities,
    record().load,
  );
  const settings = new ConfigurationController(
    store,
    'window',
    capabilities,
    record().load,
    () => null,
  );
  let phase = 'stopped';
  const host = {
    command(text: string) {
      const input: unknown = JSON.parse(text);
      if (!input || typeof input !== 'object' || !('action' in input))
        throw Error('Invalid fixture');
      if (input.action === 'load') phase = 'ready';
      if (input.action === 'stop' || input.action === 'quit') phase = 'stopped';
      return Promise.resolve({ snapshot: { phase } });
    },
    async close() {},
    configuration: (caller: string, input: unknown) => settings.command(caller, input),
  };
  const controller = createRuntimeController(
    {
      enabled: true,
      expectedHash: record().modelId,
      packageId: 'package',
      pick() {
        return Promise.resolve('private/model.gguf');
      },
      inspect() {
        return Promise.resolve({ sha256: record().modelId, size: '1 GB' });
      },
      async preflight() {},
      createHost() {
        return Promise.resolve(host);
      },
      createHistoryHost() {
        return Promise.resolve(host);
      },
    },
    'window',
  );
  return controller;
}

it('keeps configuration attached to the same verified model after reimport', async () => {
  const controller = setup();
  const first = await controller.command({ action: 'import' });
  const second = await controller.command({ action: 'import' });
  expect(first.model?.id).toBe(second.model?.id);
  await controller.quit();
});

it('requires import and saves actual defaults without starting the runtime', async () => {
  const controller = setup();
  expect(
    await controller.configuration({ action: 'read', modelId: record().modelId }),
  ).toMatchObject({ ok: false });
  await controller.command({ action: 'import' });
  const current = await controller.configuration({ action: 'read', modelId: record().modelId });
  if (!current.ok) throw Error('Expected configuration');
  const saved = await controller.configuration({
    action: 'save',
    modelId: record().modelId,
    expectedRevision: 0,
    record: { ...current.record, generation: { ...current.record.generation, temperature: 0.2 } },
  });
  expect(saved).toMatchObject({
    ok: true,
    record: { revision: 1, generation: { temperature: 0.2 } },
  });
  expect((await controller.command({ action: 'snapshot' })).phase).toBe('stopped');
  expect(await controller.configuration({ action: 'read', modelId: 'b'.repeat(64) })).toMatchObject(
    { ok: false },
  );
  await expect(
    controller.configuration({ action: 'read', modelId: record().modelId, path: 'private' }),
  ).rejects.toThrow('INVALID_CONTROL');
  await controller.quit();
});

it('rejects an unverified pending load tuple before entering the runtime', async () => {
  const controller = setup();
  const imported = await controller.command({ action: 'import' });
  const current = await controller.configuration({ action: 'read', modelId: record().modelId });
  if (!current.ok || !imported.model) throw Error('Expected imported model');
  await controller.configuration({
    action: 'save',
    modelId: record().modelId,
    expectedRevision: 0,
    record: { ...current.record, load: { ...current.record.load, contextLength: 4096 } },
  });
  const rejected = await controller.command({ action: 'load', modelId: imported.model.id });
  expect(rejected.phase).toBe('failed');
  expect(rejected.error).toContain('validated memory budget');
  await controller.quit();
});
