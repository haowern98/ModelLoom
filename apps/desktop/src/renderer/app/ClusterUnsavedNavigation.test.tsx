import { DatabaseSync } from 'node:sqlite';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { ModelConfigurationStore } from '../../../../../packages/core/src/model-configuration/store';
import { ClusterController } from '../../../../../packages/core/src/cluster/controller';
import {
  capabilities,
  record,
} from '../../../../../packages/core/src/model-configuration/test-fixtures';

afterEach(() => {
  delete window.modelLoomRuntime;
  delete window.modelLoomCluster;
});

it('guards leaving Cluster, preserves edits on X or failed Save, and restores empty assignments after Discard', async () => {
  const database = new DatabaseSync(':memory:');
  const id = record().modelId;
  const store = new ModelConfigurationStore(
    database,
    () => {},
    () => true,
    capabilities,
    record().load,
  );
  await store.recordImport(id, 123, {
    modelId: id,
    name: 'Qwen',
    file: 'E:\\Models\\Qwen.gguf',
    size: '4 GB',
    sizeBytes: 4000,
    modifiedMs: 1,
    architecture: 'llama',
    contextLimit: 32768,
    quantization: 'Q4_K_M',
    parameters: '4B',
    blockCount: 8,
  });
  const controller = new ClusterController(store, 'window', { cacheK: 'q8_0', cacheV: 'q8_0' });
  window.modelLoomCluster = { command: (input) => controller.command('window', input) };
  const uuid = 'GPU-12345678-1234-1234-1234-123456789abc';
  window.modelLoomRuntime = {
    command: vi.fn(() =>
      Promise.resolve({
        enabled: true,
        model: null,
        models: [{ id: `model-${id}`, name: 'Qwen', size: '4 GB', blockCount: 8 }],
        phase: 'stopped' as const,
        error: null,
        device: {
          name: 'Local',
          os: 'Windows',
          cpuName: 'CPU',
          threads: 8,
          role: 'Coordinator' as const,
          inventory: {
            sampledAt: 1,
            gpus: [
              {
                id: uuid,
                name: 'GPU',
                pciVendorId: '10de',
                totalMemoryBytes: 8 * 2 ** 30,
                executionIdentity: { vendor: 'nvidia' as const, uuid, pciBus: '00000000:01:00.0' },
              },
            ],
          },
        },
      }),
    ),
  };
  const user = userEvent.setup();
  const app = render(<App />);
  try {
    await screen.findByRole('button', { name: 'Configure Qwen' });
    await user.click(screen.getByRole('button', { name: 'Cluster' }));
    await user.click(screen.getByRole('button', { name: 'Choose model' }));
    await user.click(screen.getByRole('menuitem', { name: /Qwen/ }));
    await user.click(screen.getByRole('button', { name: /Edit layers for .* GPU/ }));
    await user.clear(screen.getByRole('textbox', { name: /^First layer for / }));
    await user.type(screen.getByRole('textbox', { name: /^First layer for / }), '0');
    await user.clear(screen.getByRole('textbox', { name: /^Last layer for / }));
    await user.type(screen.getByRole('textbox', { name: /^Last layer for / }), '3');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(database.prepare('SELECT COUNT(*) AS n FROM cluster_drafts').get()?.n).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Models' }));
    expect(screen.getByRole('dialog', { name: 'Unsaved changes' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(screen.getByRole('button', { name: /Edit layers for .* GPU/ })).toHaveTextContent(
      '0\u20133',
    );
    await user.click(screen.getByRole('button', { name: 'Models' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await within(screen.getByRole('dialog', { name: 'Unsaved changes' })).findByRole('alert'),
    ).toHaveTextContent('could not be saved');
    expect(screen.getByRole('dialog', { name: 'Unsaved changes' })).toBeVisible();
    expect(store.cluster.list()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await screen.findByRole('button', { name: 'Configure Qwen' });
    await user.click(screen.getByRole('button', { name: 'Cluster' }));
    await user.click(screen.getByRole('button', { name: /Edit layers for .* GPU/ }));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /^Last layer for / })).toHaveValue(''),
    );
    expect(database.prepare('SELECT COUNT(*) AS n FROM cluster_drafts').get()?.n).toBe(0);
  } finally {
    app.unmount();
    await controller.close();
    database.close();
  }
});
