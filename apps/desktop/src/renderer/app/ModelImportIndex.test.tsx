import { act, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { RuntimeCommand, RuntimeModel, RuntimeView } from '../../shared/runtime';
import { App } from './App';

afterEach(() => {
  delete window.modelLoomRuntime;
});

const saved: RuntimeModel = {
  id: 'model-saved',
  name: 'Previously indexed model',
  filename: 'saved.gguf',
  size: '2.0 GB',
  quantization: 'Q4_K_M',
};

async function openModels() {
  const user = userEvent.setup();
  await user.click(
    within(screen.getByRole('complementary', { name: 'Main navigation' })).getByRole('button', {
      name: 'Models',
    }),
  );
  return { user, models: within(screen.getByRole('region', { name: 'Models' })) };
}

it('keeps saved models visible while an import indexes, then replaces its pending row with metadata', async () => {
  let view: RuntimeView = {
    enabled: true,
    model: null,
    models: [saved],
    phase: 'stopped',
    error: null,
  };
  let finishImport!: (value: RuntimeView) => void;
  const imported: RuntimeModel = {
    id: 'model-imported',
    name: 'New indexed model',
    filename: 'new-model.gguf',
    size: '4.7 GB',
    quantization: 'Q6_K',
  };
  window.modelLoomRuntime = {
    command: vi.fn((command: RuntimeCommand) => {
      if (command.action === 'import') {
        view = { ...view, indexing: 'new-model.gguf' };
        return new Promise<RuntimeView>((resolve) => {
          finishImport = resolve;
        });
      }
      return Promise.resolve(view);
    }),
  };
  render(<App />);
  const { user, models } = await openModels();
  expect(await models.findByRole('article', { name: saved.name })).toBeVisible();
  await user.click(models.getByRole('button', { name: 'Import GGUF' }));
  const pending = within(await models.findByRole('article', { name: 'new-model.gguf' }));
  expect(pending.getByRole('status')).toHaveTextContent('Indexing…');
  expect(pending.queryByRole('group', { name: /Metadata/ })).not.toBeInTheDocument();
  expect(pending.queryByRole('button')).not.toBeInTheDocument();
  expect(models.getByRole('article', { name: saved.name })).toBeVisible();
  expect(models.getByRole('button', { name: 'Import GGUF' })).toBeDisabled();

  await act(async () => {
    view = { ...view, indexing: null, models: [saved, imported] };
    finishImport(view);
    await Promise.resolve();
  });
  const complete = within(await models.findByRole('article', { name: imported.name }));
  expect(complete.getByRole('group', { name: `Metadata for ${imported.name}` })).toHaveTextContent(
    '4.7 GBGGUFQ6_K',
  );
  expect(models.queryByText('Indexing…')).not.toBeInTheDocument();
  expect(complete.getByRole('button', { name: `Configure ${imported.name}` })).toBeEnabled();
});

it('restores the library after remount without loading and flags a missing model file', async () => {
  const view: RuntimeView = {
    enabled: true,
    model: null,
    models: [saved, { ...saved, id: 'model-missing', name: 'Missing model', unavailable: true }],
    phase: 'stopped',
    error: null,
  };
  const command = vi.fn((request: RuntimeCommand) => {
    expect(request.action).toBe('snapshot');
    return Promise.resolve(view);
  });
  window.modelLoomRuntime = { command };
  const first = render(<App />);
  let page = await openModels();
  expect(await page.models.findByRole('article', { name: saved.name })).toBeVisible();
  first.unmount();
  render(<App />);
  page = await openModels();
  expect(await page.models.findByRole('article', { name: saved.name })).toBeVisible();
  const missing = within(page.models.getByRole('article', { name: 'Missing model' }));
  expect(missing.getByText('File unavailable. Re-import this model.')).toBeVisible();
  expect(missing.getByRole('button', { name: 'Configure Missing model' })).toBeDisabled();
  await waitFor(() => expect(command).toHaveBeenCalled());
  expect(command.mock.calls.every(([value]) => value.action === 'snapshot')).toBe(true);
});
