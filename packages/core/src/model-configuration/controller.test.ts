import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { ConfigurationController } from './controller.js';
import { ModelConfigurationStore } from './store.js';
import { capabilities, record } from './test-fixtures.js';

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
  let active: Awaited<ReturnType<ConfigurationController['captureLoad']>> | null = null;
  const controller = new ConfigurationController(
    store,
    'window',
    capabilities,
    record().load,
    () => active,
  );
  return {
    controller,
    activate: async () => {
      active = await controller.captureLoad(record().modelId);
    },
  };
}

it('denies management callers and model identities that do not belong to this deployment', async () => {
  const { controller } = setup();
  expect(await controller.command('forged', { action: 'read', modelId: record().modelId })).toEqual(
    { ok: false, error: 'NOT_READY' },
  );
  expect(await controller.command('window', { action: 'read', modelId: 'b'.repeat(64) })).toEqual({
    ok: false,
    error: 'UNKNOWN_MODEL',
  });
});

it('saves generation defaults without changing the active load and detects pending reloads', async () => {
  const { controller, activate } = setup();
  await activate();
  const first = await controller.command('window', { action: 'read', modelId: record().modelId });
  if (!first.ok) throw Error('Expected configuration');
  const saved = await controller.command('window', {
    action: 'save',
    modelId: first.record.modelId,
    expectedRevision: 0,
    record: { ...first.record, generation: { ...first.record.generation, temperature: 0.2 } },
  });
  expect(saved).toMatchObject({
    ok: true,
    pendingReload: false,
    record: { revision: 1, generation: { temperature: 0.2 } },
  });
  const pending = await controller.command('window', {
    action: 'save',
    modelId: first.record.modelId,
    expectedRevision: 1,
    record: { ...first.record, revision: 1, load: { ...first.record.load, contextLength: 4096 } },
  });
  expect(pending).toMatchObject({ ok: true, pendingReload: true });
  expect(await controller.captureLoad(first.record.modelId)).toMatchObject({
    revision: 2,
    load: { contextLength: 4096 },
  });
});

it('editing an inactive library model does not report a reload of the active model', async () => {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  const store = new ModelConfigurationStore(
    database,
    () => {},
    () => true,
    capabilities,
    record().load,
  );
  const controller = new ConfigurationController(
    store,
    'window',
    capabilities,
    record().load,
    () => ({
      modelId: 'b'.repeat(64),
      revision: 1,
      profileId: capabilities.profileId,
      load: { ...record().load, contextLength: 4096 },
    }),
  );
  expect(
    await controller.command('window', { action: 'read', modelId: record().modelId }),
  ).toMatchObject({ ok: true, pendingReload: false });
});

it('resolves newly admitted defaults independently of later Save', async () => {
  const { controller } = setup();
  const active = await controller.captureLoad(record().modelId);
  const first = await controller.resolve(active);
  const read = await controller.command('window', { action: 'read', modelId: active.modelId });
  if (!read.ok) throw Error('Expected configuration');
  await controller.command('window', {
    action: 'save',
    modelId: active.modelId,
    expectedRevision: 0,
    record: { ...read.record, generation: { ...read.record.generation, temperature: 0 } },
  });
  expect(first.parameters.temperature).toBe(0.8);
  expect((await controller.resolve(active)).parameters.temperature).toBe(0);
});

it('closes management admission and joins operations before storage can be released', async () => {
  const { controller } = setup();
  const read = controller.command('window', { action: 'read', modelId: record().modelId });
  await controller.close();
  expect(await read).toMatchObject({ ok: true });
  expect(await controller.command('window', { action: 'read', modelId: record().modelId })).toEqual(
    { ok: false, error: 'NOT_READY' },
  );
});

it('captures immutable next-load preferences and reports their changes as pending reload', async () => {
  const { controller, activate } = setup();
  await activate();
  const captured = await controller.captureLoad(record().modelId);
  const first = await controller.command('window', { action: 'read', modelId: record().modelId });
  if (!first.ok) throw Error('Expected configuration');
  const preferences = {
    ...first.record.preferences,
    ropeBase: { enabled: true, value: 20000 },
    customTemplate: true,
    chatTemplate: 'custom template',
  };
  const saved = await controller.command('window', {
    action: 'save',
    modelId: first.record.modelId,
    expectedRevision: 0,
    record: { ...first.record, preferences },
  });
  expect(saved).toMatchObject({ ok: true, pendingReload: true });
  expect(captured.preferences?.ropeBase.enabled).toBe(false);
  expect(captured.preferences?.chatTemplate).toBe('');
  expect(Object.isFrozen(captured.preferences)).toBe(true);
  expect(await controller.captureLoad(first.record.modelId)).toMatchObject({ preferences });
  await activate();
  expect(
    await controller.command('window', { action: 'read', modelId: first.record.modelId }),
  ).toMatchObject({ ok: true, pendingReload: false });
});

it.each(['stop', 'truncate-middle', 'rolling'] as const)(
  'saves and captures the validated %s overflow policy',
  async (overflow) => {
    const { controller } = setup();
    const first = await controller.command('window', { action: 'read', modelId: record().modelId });
    if (!first.ok) throw Error('Expected configuration');
    const saved = await controller.command('window', {
      action: 'save',
      modelId: first.record.modelId,
      expectedRevision: 0,
      record: { ...first.record, preferences: { ...first.record.preferences, overflow } },
    });
    expect(saved).toMatchObject({ ok: true, record: { preferences: { overflow } } });
    expect(await controller.captureLoad(first.record.modelId)).toMatchObject({
      preferences: { overflow },
    });
  },
);

it.each(['automatic', 'argumentsEnabled'] as const)(
  'still refuses unsupported %s',
  async (field) => {
    const { controller } = setup();
    const first = await controller.command('window', { action: 'read', modelId: record().modelId });
    if (!first.ok) throw Error('Expected configuration');
    const changed =
      field === 'automatic'
        ? { ...first.record, load: { ...first.record.load, automatic: true } }
        : { ...first.record, preferences: { ...first.record.preferences, argumentsEnabled: true } };
    expect(
      await controller.command('window', {
        action: 'save',
        modelId: first.record.modelId,
        expectedRevision: 0,
        record: changed,
      }),
    ).toEqual({ ok: false, error: 'UNSUPPORTED_SETTING' });
  },
);
