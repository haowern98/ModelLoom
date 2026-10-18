import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { record } from '../../../../../packages/core/src/model-configuration/test-fixtures';
import type { RuntimeBridge } from '../../shared/runtime';

afterEach(() => {
  delete window.modelLoomRuntime;
  delete window.modelLoomConfiguration;
  delete window.modelLoomCluster;
});

it('selects the imported model being configured without asking the runtime to load it', async () => {
  const saved = record();
  const runtime = vi.fn<RuntimeBridge['command']>().mockResolvedValue({
    enabled: true,
    model: { id: `model-${saved.modelId}`, name: 'Configured model', size: '4 GB' },
    phase: 'stopped',
    error: null,
  });
  window.modelLoomRuntime = { command: runtime };
  window.modelLoomConfiguration = {
    command: vi.fn().mockResolvedValue({
      ok: true,
      record: saved,
      defaults: saved,
      pendingReload: false,
      thinkingSupported: false,
      maxOutputTokens: 512,
    }),
  };
  const cluster = vi.fn().mockResolvedValue({
    ok: true,
    configurations: [],
    configuration: null,
    draft: null,
    load: { defaults: saved.load, preferences: saved.preferences, cacheK: 'f16', cacheV: 'f16' },
    issues: [],
  });
  window.modelLoomCluster = { command: cluster };
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('button', { name: 'Configure Configured model' }));
  await user.click(await screen.findByRole('button', { name: 'Set in Cluster' }));
  expect(cluster).toHaveBeenCalledWith({
    action: 'read',
    modelId: saved.modelId,
    configurationId: null,
  });
  expect(
    await screen.findByRole('button', { name: 'Selected local model: Configured model' }),
  ).toBeVisible();
  expect(runtime.mock.calls.every(([command]) => command.action !== 'load')).toBe(true);
});

it('opens placement for the configured model without loading it or discarding its editor draft', async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: 'Configure Llama 3.1 8B' }));
  await user.type(screen.getByRole('textbox', { name: 'System Prompt' }), 'Pending instruction');
  await user.click(screen.getByRole('button', { name: 'Set in Cluster' }));
  expect(screen.getByRole('button', { name: 'Selected demo model: Llama 3.1 8B' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Run model' })).toBeVisible();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Cancel loading' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Models' }));
  await user.click(screen.getByRole('button', { name: 'Configure Llama 3.1 8B' }));
  expect(screen.getByRole('textbox', { name: 'System Prompt' })).toHaveValue('Pending instruction');
});
