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

type ReclassifiedSource = ModelSource & { classificationVersion: 1 };

async function setup(
  options: { headOnly?: boolean; unavailable?: 'null' | 'throw'; classifiedTarget?: boolean } = {},
) {
  const database = new DatabaseSync(':memory:');
  const store = new ModelConfigurationStore(
    database,
    () => {},
    () => true,
    capabilities,
    record().load,
  );
  const source = (key: string, name: string, architecture: string): ModelSource => ({
    modelId: key.repeat(64),
    file: path.resolve('E:/Models', `${name}.gguf`),
    name,
    size: '2 GB',
    sizeBytes: 2_000_000_000,
    modifiedMs: 1234,
    architecture,
    contextLimit: capabilities.contextLimit,
    blockCount: 4,
    quantization: 'Q8_0',
    parameters: 'Unknown',
  });
  const target = {
    ...source('a', 'Target', 'qwen3'),
    ...(options.classifiedTarget ? { classificationVersion: 1 as const } : {}),
  };
  const extracted = source('b', 'Extracted MTP', 'qwen35');
  if (!options.headOnly) await store.recordImport(target.modelId, 100, target);
  await store.recordImport(extracted.modelId, 200, extracted);
  const repaired: ReclassifiedSource = {
    ...extracted,
    speculativeHead: 'mtp',
    classificationVersion: 1,
    nextnPredictLayers: 1,
  };
  const owners: string[] = [];
  const ownerCommands: unknown[] = [];
  const reinspect = vi.fn((entry: ModelSource): Promise<ReclassifiedSource | null> => {
    if (entry.modelId === extracted.modelId) {
      if (options.unavailable === 'null') return Promise.resolve(null);
      if (options.unavailable === 'throw') return Promise.reject(Error('MODEL_FILE_UNAVAILABLE'));
      return Promise.resolve(repaired);
    }
    return Promise.resolve({ ...entry, classificationVersion: 1, nextnPredictLayers: 0 });
  });
  const deps = {
    enabled: true as const,
    expectedHash: target.modelId,
    packageId: 'package',
    pick: vi.fn(() => Promise.resolve(null)),
    inspect: vi.fn(() => Promise.reject(Error('UNEXPECTED_MODEL_LOAD'))),
    reinspect,
    available: vi.fn(() => Promise.resolve(true)),
    preflight: vi.fn(() => Promise.resolve()),
    createHost: vi.fn(),
    createHistoryHost: vi.fn((entry?: ModelSource) => {
      const modelId = entry?.modelId ?? target.modelId;
      owners.push(modelId);
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
        () => false,
        () => undefined,
      );
      return Promise.resolve({
        command: vi.fn(() => Promise.resolve({ snapshot: { phase: 'stopped' } })),
        close: async () => {
          await api.close();
          await configuration.close();
        },
        api: (caller: string, input: unknown) => {
          ownerCommands.push(input);
          return api.command(caller, input);
        },
        configuration: (caller: string, input: unknown) => configuration.command(caller, input),
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
    extracted,
    repaired,
    owners,
    ownerCommands,
    get controller() {
      return controller;
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

it('repairs an old extracted MTP import before choosing the latest full target and persists the repair once', async () => {
  const f = await setup();
  try {
    const restored = await f.restored();
    expect(restored.error).toBeNull();
    expect(
      restored.models?.find((entry) => entry.id === `model-${f.extracted.modelId}`),
    ).toMatchObject({
      speculativeHead: 'mtp',
      unavailable: false,
    });
    expect(restored.model?.id).toBe(`model-${f.target.modelId}`);
    expect(await f.store.readImportSource(f.extracted.modelId)).toEqual(f.repaired);
    expect(await f.store.readImport(f.extracted.modelId)).toBe(200);
    expect(await f.store.readImport(f.target.modelId)).toBe(100);
    expect(f.ownerCommands).toContainEqual({
      action: 'reinspectImport',
      modelId: f.extracted.modelId,
      source: f.repaired,
    });
    expect(f.owners).not.toContain(f.extracted.modelId);
    const readsBefore = f.deps.reinspect.mock.calls.length;
    expect(readsBefore).toBe(2);
    const reopened = await f.restart();
    expect(reopened.model?.id).toBe(`model-${f.target.modelId}`);
    expect(reopened.models).toEqual(restored.models);
    expect(f.deps.reinspect).toHaveBeenCalledTimes(readsBefore);
    expect(
      await f.controller.configuration({ action: 'read', modelId: f.extracted.modelId }),
    ).toMatchObject({ ok: false });
    expect(
      (await f.controller.command({ action: 'load', modelId: `model-${f.extracted.modelId}` }))
        .error,
    ).toBeTruthy();
    expect(f.deps.inspect).not.toHaveBeenCalled();
    expect(f.deps.preflight).not.toHaveBeenCalled();
    expect(f.deps.createHost).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});

it('restores a repaired MTP-only library without selecting a target', async () => {
  const f = await setup({ headOnly: true });
  try {
    const restored = await f.restored();
    expect(restored.error).toBeNull();
    expect(restored.model).toBeNull();
    expect(restored.models).toHaveLength(1);
    expect(restored.models?.[0]).toMatchObject({ speculativeHead: 'mtp', unavailable: false });
    expect((await f.restart()).model).toBeNull();
    expect(f.deps.reinspect).toHaveBeenCalledTimes(1);
    expect(f.owners).not.toContain(f.extracted.modelId);
  } finally {
    await f.close();
  }
});

it('refreshes a classified legacy source once when its NextN hint is missing', async () => {
  const f = await setup({ classifiedTarget: true });
  try {
    const view = await f.restored();
    expect(f.deps.reinspect).toHaveBeenCalledWith(f.target);
    expect(view.model?.embeddedMtp).toBe(false);
    expect((await f.store.readImportSource(f.target.modelId))?.nextnPredictLayers).toBe(0);
    const reads = f.deps.reinspect.mock.calls.length;
    await f.restart();
    expect(f.deps.reinspect).toHaveBeenCalledTimes(reads);
  } finally {
    await f.close();
  }
});

it.each(['null', 'throw'] as const)(
  'keeps an old entry unavailable without persisting replacement metadata when reinspection returns %s',
  async (unavailable) => {
    const f = await setup({ unavailable });
    try {
      const restored = await f.restored();
      expect(restored.error).toBeNull();
      expect(
        restored.models?.find((entry) => entry.id === `model-${f.extracted.modelId}`),
      ).toMatchObject({ unavailable: true });
      expect(await f.store.readImportSource(f.extracted.modelId)).toEqual(f.extracted);
      expect(await f.store.readImport(f.extracted.modelId)).toBe(200);
      expect(f.ownerCommands).not.toContainEqual(
        expect.objectContaining({ action: 'reinspectImport', modelId: f.extracted.modelId }),
      );
      expect(f.deps.preflight).not.toHaveBeenCalled();
      expect(f.deps.createHost).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  },
);
