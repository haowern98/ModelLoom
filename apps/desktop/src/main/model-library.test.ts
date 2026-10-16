import { expect, it, vi } from 'vitest';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createRuntimeController } from './runtime-controller';
import { ModelConfigurationStore } from '../../../../packages/core/src/model-configuration/store';
import { ConfigurationController } from '../../../../packages/core/src/model-configuration/controller';
import { ApiController } from '../../../../packages/core/src/local-api/controller';
import {
  capabilities,
  record,
} from '../../../../packages/core/src/model-configuration/test-fixtures';
import type { ModelSource } from '../../../../packages/core/src/model-configuration/model-source';

it('retains all imports through refresh, settings, switching, reimport and restart', async () => {
  const database = new DatabaseSync(':memory:');
  const store = new ModelConfigurationStore(
    database,
    () => {},
    () => true,
    capabilities,
    record().load,
  );
  const sources: ModelSource[] = ['a', 'b'].map((key) => ({
    modelId: key.repeat(64),
    file: path.resolve('models', `${key}.gguf`),
    name: key === 'a' ? 'Bonsai' : 'Qwen',
    size: '4 GB',
    sizeBytes: 4000000000,
    modifiedMs: 1,
    architecture: 'llama',
    contextLimit: capabilities.contextLimit,
    blockCount: 64,
    quantization: 'Q4_K_M',
    parameters: '27B',
  }));
  let selected = sources[0]!;
  const loads: string[] = [];
  const owners: string[] = [];
  const deps = {
    enabled: true as const,
    expectedHash: sources[0]!.modelId,
    packageId: 'package',
    pick: () => Promise.resolve(selected.file),
    inspect: vi.fn((file: string) =>
      Promise.resolve({
        ...sources.find((source) => source.file === file)!,
        sha256: sources.find((source) => source.file === file)!.modelId,
      }),
    ),
    available: (source: ModelSource) => Promise.resolve(source.modelId !== sources[1]!.modelId),
    preflight: async () => {},
    createHost: vi.fn(),
    createHistoryHost: vi.fn((source?: ModelSource) => {
      const modelId = source?.modelId ?? sources[0]!.modelId;
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
        () => false,
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
        api: (caller: string, input: unknown) => api.command(caller, input),
        configuration: (caller: string, input: unknown) => configuration.command(caller, input),
      });
    }),
  };
  let controller = createRuntimeController(deps, 'window');
  try {
    await controller.command({ action: 'import' });
    await store.recordUse(sources[0]!.modelId, 1000);
    selected = sources[1]!;
    const imported = await controller.command({ action: 'import' });
    expect(imported.models?.map((model) => model.name).sort()).toEqual(['Bonsai', 'Qwen']);
    expect(imported.model?.name).toBe('Qwen');
    expect((await controller.command({ action: 'snapshot' })).models).toHaveLength(2);
    const oldSettings = await controller.configuration({
      action: 'read',
      modelId: sources[0]!.modelId,
    });
    expect(oldSettings.ok).toBe(true);
    if (!oldSettings.ok) throw Error('Expected settings');
    expect(
      await controller.configuration({
        action: 'save',
        modelId: sources[0]!.modelId,
        expectedRevision: 0,
        record: {
          ...oldSettings.record,
          generation: { ...oldSettings.record.generation, temperature: 0.3 },
        },
      }),
    ).toMatchObject({ ok: true, record: { revision: 1 } });
    expect(
      await controller.configuration({ action: 'read', modelId: 'c'.repeat(64) }),
    ).toMatchObject({ ok: false, error: 'UNKNOWN_MODEL' });
    deps.createHistoryHost.mockRejectedValueOnce(Error('START_FAILED'));
    expect(
      (await controller.command({ action: 'load', modelId: `model-${sources[0]!.modelId}` })).phase,
    ).toBe('failed');
    expect(
      (await controller.command({ action: 'load', modelId: `model-${sources[0]!.modelId}` })).phase,
    ).toBe('ready');
    expect(owners.at(-1)).toBe(sources[0]!.modelId);
    expect(loads).toEqual([sources[0]!.modelId]);
    expect((await controller.command({ action: 'snapshot' })).models).toHaveLength(2);
    await controller.command({ action: 'stop' });
    await controller.command({ action: 'import' });
    expect((await controller.command({ action: 'snapshot' })).models).toHaveLength(2);
    await controller.quit();
    controller = createRuntimeController(deps, 'window');
    await vi.waitFor(async () =>
      expect((await controller.command({ action: 'snapshot' })).restoring).toBe(false),
    );
    const restored = await controller.command({ action: 'snapshot' });
    expect(restored.models).toHaveLength(2);
    expect(restored.models?.find((model) => model.name === 'Bonsai')).toMatchObject({
      unavailable: false,
      lastUsedAt: 1000,
    });
    expect(restored.models?.find((model) => model.name === 'Qwen')).toMatchObject({
      unavailable: true,
    });
    expect(restored.phase).toBe('stopped');
    for (const source of sources)
      expect(JSON.stringify(restored)).not.toContain(JSON.stringify(source.file).slice(1, -1));
  } finally {
    await controller.quit();
    database.close();
  }
});
