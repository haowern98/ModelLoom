import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { ApiController } from '../../../../packages/core/src/local-api/controller';
import { ConfigurationController } from '../../../../packages/core/src/model-configuration/controller';
import type { ModelSource } from '../../../../packages/core/src/model-configuration/model-source';
import { ModelConfigurationStore } from '../../../../packages/core/src/model-configuration/store';
import {
  capabilities,
  record,
} from '../../../../packages/core/src/model-configuration/test-fixtures';
import { createRuntimeController } from './runtime-controller';

vi.mock('node:path', async (importOriginal) => {
  const original = await importOriginal<typeof path>();
  return {
    ...original,
    default: { ...original, resolve: (...parts: string[]) => original.win32.resolve(...parts) },
  };
});

type Head = 'eagle3' | 'dflash' | 'dspark';
type ImportedSource = ModelSource & { speculativeHead?: Head };

function setup(head: Head = 'dflash') {
  const database = new DatabaseSync(':memory:');
  const store = new ModelConfigurationStore(
    database,
    () => {},
    () => true,
    capabilities,
    record().load,
  );
  const source = (key: string, name: string): ImportedSource => ({
    modelId: key.repeat(64),
    file: path.resolve('E:/Models', `${name}.gguf`),
    name,
    size: '2 GB',
    sizeBytes: 2_000_000_000,
    modifiedMs: 1234,
    architecture: 'qwen3',
    contextLimit: capabilities.contextLimit,
    blockCount: 4,
    quantization: 'Q8_0',
    parameters: 'Unknown',
    classificationVersion: 1,
  });
  const target = source('a', 'Target');
  const companion = {
    ...source('b', 'Companion'),
    architecture: head === 'eagle3' ? 'eagle3' : 'dflash',
    contextLimit: 0,
    speculativeHead: head,
  };
  const sources = [target, companion];
  let selected: ImportedSource = companion;
  const owners: string[] = [];
  const loads: string[] = [];
  const ownerCommands: unknown[] = [];
  const cluster = vi.fn(() => Promise.resolve({ ok: false as const, error: 'NOT_READY' as const }));
  const deps = {
    enabled: true as const,
    expectedHash: target.modelId,
    packageId: 'package',
    pick: vi.fn(() => Promise.resolve(selected.file)),
    inspect: vi.fn((file: string) => {
      const found = sources.find((entry) => entry.file === file)!;
      return Promise.resolve({ ...found, sha256: found.modelId });
    }),
    available: vi.fn(() => Promise.resolve(true)),
    preflight: vi.fn(() => Promise.resolve()),
    planCluster: vi.fn(() => Promise.resolve([])),
    createHost: vi.fn(),
    createHistoryHost: vi.fn((entry?: ModelSource) => {
      const modelId = entry?.modelId ?? target.modelId;
      owners.push(modelId);
      let phase = 'stopped';
      const configuration = new ConfigurationController(
        store,
        'window',
        capabilities,
        record().load,
        () => null,
      );
      const api = new ApiController(
        store,
        'window',
        modelId,
        capabilities,
        () => {
          throw Error('CREDENTIAL_UNAVAILABLE');
        },
        () => phase === 'ready',
        () => undefined,
      );
      return Promise.resolve({
        command: (text: string) => {
          const command = JSON.parse(text) as { action: string; selection?: { modelId: string } };
          if (command.action === 'load') {
            loads.push(command.selection!.modelId);
            phase = 'ready';
          }
          if (command.action === 'stop' || command.action === 'quit') phase = 'stopped';
          return Promise.resolve({ snapshot: { phase } });
        },
        close: async () => {
          await api.close();
          await configuration.close();
        },
        api: (caller: string, input: unknown) => {
          ownerCommands.push(input);
          return api.command(caller, input);
        },
        configuration: (caller: string, input: unknown) => configuration.command(caller, input),
        cluster,
      });
    }),
  };
  let controller = createRuntimeController(deps, 'window');
  const restored = async () => {
    await vi.waitFor(async () =>
      expect((await controller.command({ action: 'snapshot' })).restoring).toBe(false),
    );
    return controller.command({ action: 'snapshot' });
  };
  return {
    store,
    deps,
    target,
    companion,
    owners,
    loads,
    ownerCommands,
    cluster,
    get controller() {
      return controller;
    },
    select(entry: ImportedSource) {
      selected = entry;
    },
    restored,
    async restart() {
      await controller.quit();
      controller = createRuntimeController(deps, 'window');
      return restored();
    },
    async close() {
      await controller.quit();
      database.close();
    },
  };
}

it.each<Head>(['eagle3', 'dflash', 'dspark'])(
  'persists a first %s head import without selecting it as the target, including after restart',
  async (head) => {
    const f = setup(head);
    try {
      await f.restored();
      const imported = await f.controller.command({ action: 'import' });
      expect(imported.error).toBeNull();
      expect(imported.model).toBeNull();
      expect(imported.models).toEqual([
        expect.objectContaining({ id: `model-${f.companion.modelId}`, speculativeHead: head }),
      ]);
      expect(await f.store.readImportSource(f.companion.modelId)).toEqual(f.companion);
      expect(f.ownerCommands).toContainEqual(
        expect.objectContaining({
          action: 'registerCompanion',
          modelId: f.companion.modelId,
          source: f.companion,
        }),
      );
      const reopened = await f.restart();
      expect(reopened.error).toBeNull();
      expect(reopened.model).toBeNull();
      expect(reopened.phase).toBe('stopped');
      expect(reopened.models).toEqual(imported.models);
      expect(f.owners).not.toContain(f.companion.modelId);
      expect(f.loads).toEqual([]);
      expect(f.deps.preflight).not.toHaveBeenCalled();
      expect(f.deps.createHost).not.toHaveBeenCalled();
      expect(JSON.stringify(reopened)).not.toContain(JSON.stringify(f.companion.file).slice(1, -1));
    } finally {
      await f.close();
    }
  },
);

it('keeps the selected target and existing owner when importing a head, including after restart', async () => {
  const f = setup();
  try {
    f.select(f.target);
    const target = await f.controller.command({ action: 'import' });
    expect(target.error).toBeNull();
    const ownersBefore = [...f.owners];
    f.select(f.companion);
    const imported = await f.controller.command({ action: 'import' });
    expect(imported.error).toBeNull();
    expect(imported.phase).toBe('stopped');
    expect(imported.model).toEqual(target.model);
    expect(imported.models).toHaveLength(2);
    expect(f.owners).toEqual(ownersBefore);
    expect(await f.store.readImportSource(f.target.modelId)).toEqual(f.target);
    const reopened = await f.restart();
    expect(reopened.model?.id).toBe(target.model?.id);
    expect(reopened.models).toHaveLength(2);
    expect(f.owners).not.toContain(f.companion.modelId);
    expect(f.loads).toEqual([]);
  } finally {
    await f.close();
  }
});

it('rejects target loading and target configuration for a registered head without GPU preparation', async () => {
  const f = setup();
  try {
    await f.controller.command({ action: 'import' });
    const ownersBefore = [...f.owners];
    const loaded = await f.controller.command({
      action: 'load',
      modelId: `model-${f.companion.modelId}`,
    });
    expect(loaded.error).toBeTruthy();
    expect(loaded.phase).not.toBe('ready');
    expect(
      await f.controller.configuration({ action: 'read', modelId: f.companion.modelId }),
    ).toMatchObject({ ok: false });
    expect(f.owners).toEqual(ownersBefore);
    expect(f.loads).toEqual([]);
    expect(f.deps.preflight).not.toHaveBeenCalled();
    expect(f.deps.createHost).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});

it('deduplicates repeated head imports and removes only the head registration', async () => {
  const f = setup();
  try {
    f.select(f.target);
    const target = await f.controller.command({ action: 'import' });
    f.select(f.companion);
    await f.controller.command({ action: 'import' });
    const created = await f.store.readImport(f.companion.modelId);
    const duplicate = await f.controller.command({ action: 'import' });
    expect(duplicate.error).toBeNull();
    expect(duplicate.models).toHaveLength(2);
    expect(duplicate.model).toEqual(target.model);
    expect(await f.store.readImport(f.companion.modelId)).toBe(created);
    const removed = await f.controller.command({
      action: 'remove',
      modelId: `model-${f.companion.modelId}`,
    });
    expect(removed.error).toBeNull();
    expect(removed.model).toEqual(target.model);
    expect(removed.models).toEqual([target.model]);
    expect(await f.store.readImport(f.companion.modelId)).toBeNull();
    expect(await f.store.readImportSource(f.target.modelId)).toEqual(f.target);
    expect((await f.restart()).models).toEqual([target.model]);
  } finally {
    await f.close();
  }
});

it('rejects head identities nested in cluster edits and auto-placement before forwarding or GPU planning', async () => {
  const f = setup();
  try {
    await f.controller.command({ action: 'import' });
    const key = `model:${f.companion.modelId}`;
    expect(
      await f.controller.cluster({
        action: 'edit',
        key,
        expectedRevision: null,
        edit: {
          modelId: f.companion.modelId,
          load: { defaults: record().load, cacheK: 'q8_0', cacheV: 'q8_0' },
          runs: [],
        },
      }),
    ).toEqual({ ok: false, error: 'UNKNOWN_MODEL' });
    expect(await f.controller.cluster({ action: 'auto-place', key, revision: 1 })).toEqual({
      ok: false,
      error: 'UNKNOWN_MODEL',
    });
    expect(f.cluster).not.toHaveBeenCalled();
    expect(f.deps.planCluster).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});
