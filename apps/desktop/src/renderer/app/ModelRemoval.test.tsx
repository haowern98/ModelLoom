import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App';
import type { RuntimeBridge, RuntimeView } from '../../shared/runtime';

afterEach(() => {
  delete window.modelLoomRuntime;
});

it('confirms removal before sending only the model identity and refreshes the library', async () => {
  const model = { id: `model-${'a'.repeat(64)}`, name: 'Indexed model', size: '4 GB' };
  let view: RuntimeView = { enabled: true, model, models: [model], phase: 'stopped', error: null };
  const command = vi.fn<RuntimeBridge['command']>((input) => {
    if (input.action === 'remove') view = { ...view, model: null, models: [] };
    return Promise.resolve(view);
  });
  window.modelLoomRuntime = { command };
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('button', { name: 'Actions for Indexed model' }));
  await user.click(screen.getByRole('button', { name: 'Remove model entry' }));
  expect(screen.getByRole('dialog', { name: 'Remove model entry?' })).toBeVisible();
  expect(command.mock.calls.some(([input]) => input.action === 'remove')).toBe(false);
  expect(screen.getByText(/model files will be deleted/i)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Remove entry' }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith({ action: 'remove', modelId: model.id }),
  );
  expect(await screen.findByText('No models imported')).toBeVisible();
});
