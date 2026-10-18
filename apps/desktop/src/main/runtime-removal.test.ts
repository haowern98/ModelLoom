import { expect, it, vi } from 'vitest';
import { createRuntimeController } from './runtime-controller';
import type { ModelSource } from '../../../../packages/core/src/model-configuration/model-source';

function setup() {
  const a = 'a'.repeat(64),
    b = 'b'.repeat(64);
  const source = (modelId: string): ModelSource => ({
    modelId,
    file: `E:\\Models\\${modelId}.gguf`,
    name: modelId,
    size: '4 GB',
    sizeBytes: 4e9,
    modifiedMs: 1234,
    architecture: 'llama',
    contextLimit: 4096,
    quantization: 'Q4_K_M',
    parameters: '4B',
  });
  const entries = new Map([
    [a, source(a)],
    [b, source(b)],
  ]);
  let phase = 'stopped';
  const api = vi.fn((_caller: string, input: unknown) => {
    const command = input as { action: string; modelId: string; after: string | null };
    if (command.action === 'readImportSource')
      return Promise.resolve({ ok: true as const, source: entries.values().next().value ?? null });
    if (command.action === 'readLibraryEntry') {
      const next = [...entries.values()].find(
        (entry) => !command.after || entry.modelId > command.after,
      );
      return Promise.resolve({
        ok: true as const,
        entry: next ? { source: next, lastUsedAt: null } : null,
      });
    }
    if (command.action === 'removeImport') {
      entries.delete(command.modelId);
      return Promise.resolve({ ok: true as const, removed: true as const });
    }
    return Promise.resolve({ ok: true as const, lastUsedAt: null });
  });
  const host = {
    api,
    close: vi.fn(() => Promise.resolve()),
    command: vi.fn((text: string) => {
      const command = JSON.parse(text) as { action: string };
      if (command.action === 'load') phase = 'ready';
      if (command.action === 'stop' || command.action === 'quit') phase = 'stopped';
      return Promise.resolve({ snapshot: { phase } });
    }),
  };
  const deps = {
    enabled: true as const,
    expectedHash: a,
    packageId: 'package',
    pick: vi.fn(() => Promise.resolve(null)),
    inspect: vi.fn(() => Promise.resolve({ sha256: a, size: '4 GB' })),
    preflight: vi.fn(() => Promise.resolve()),
    createHost: vi.fn(() => Promise.resolve(host)),
    createHistoryHost: vi.fn(() => Promise.resolve(host)),
    available: vi.fn(() => Promise.resolve(true)),
  };
  const controller = createRuntimeController(deps, 'window');
  return { controller, deps, api, a, b };
}
async function restored(controller: ReturnType<typeof createRuntimeController>) {
  await vi.waitFor(async () =>
    expect((await controller.command({ action: 'snapshot' })).restoring).toBe(false),
  );
}

it('removes a stopped selected entry, rejects stale load references, and keeps it absent after restart', async () => {
  const { controller, api, deps, a, b } = setup();
  await restored(controller);
  const removed = await controller.command({ action: 'remove', modelId: `model-${a}` });
  expect(api).toHaveBeenCalledWith('window', { action: 'removeImport', modelId: a });
  expect(removed.model).toBeNull();
  expect(removed.models?.map((model) => model.id)).toEqual([`model-${b}`]);
  expect((await controller.command({ action: 'load', modelId: `model-${a}` })).error).toBe(
    'Select the imported model.',
  );
  await controller.quit();
  const reopened = createRuntimeController(deps, 'window');
  await restored(reopened);
  expect((await reopened.command({ action: 'snapshot' })).models?.map((model) => model.id)).toEqual(
    [`model-${b}`],
  );
  await reopened.quit();
});

it('rejects active and unknown removals while allowing removal of another stopped entry', async () => {
  const { controller, api, a, b } = setup();
  await restored(controller);
  expect((await controller.command({ action: 'load', modelId: `model-${a}` })).phase).toBe('ready');
  const rejected = await controller.command({ action: 'remove', modelId: `model-${a}` });
  expect(rejected.phase).toBe('ready');
  expect(rejected.error).toContain('Stop this model');
  expect(
    api.mock.calls.some(([, input]) => (input as { action: string }).action === 'removeImport'),
  ).toBe(false);
  expect(
    (await controller.command({ action: 'remove', modelId: `model-${'c'.repeat(64)}` })).error,
  ).toBe('Select the imported model.');
  const other = await controller.command({ action: 'remove', modelId: `model-${b}` });
  expect(other.phase).toBe('ready');
  expect(other.model?.id).toBe(`model-${a}`);
  expect(other.models).toHaveLength(1);
  await controller.quit();
});

it('retains the entry and phase when persistence rejects removal', async () => {
  const { controller, api, a } = setup();
  await restored(controller);
  api.mockRejectedValueOnce(Error('STORAGE_UNAVAILABLE'));
  const reply = await controller.command({ action: 'remove', modelId: `model-${a}` });
  expect(reply.phase).toBe('stopped');
  expect(reply.models).toHaveLength(2);
  expect(reply.model?.id).toBe(`model-${a}`);
  expect(reply.error).toBeTruthy();
  expect(
    (await controller.command({ action: 'remove', modelId: `model-${a}` })).models,
  ).toHaveLength(1);
  await controller.quit();
});
