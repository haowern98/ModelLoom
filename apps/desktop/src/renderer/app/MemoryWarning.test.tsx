import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App';
import type { RuntimeCommand, RuntimeView } from '../../shared/runtime';

afterEach(() => {
  delete window.modelLoomRuntime;
});
it.each(['Cancel', 'Load anyway', 'Close dialog', 'Escape'] as const)(
  'uses the shared memory dialog and submits %s without changing the load settings',
  async (choice) => {
    const id = '12345678-1234-1234-1234-123456789abc';
    const base: RuntimeView = { enabled: true, phase: 'loading', model: null, error: null };
    const command = vi.fn((input: RuntimeCommand) =>
      Promise.resolve({
        ...base,
        memoryWarning: input.action === 'memory-decision' ? null : { id },
      }),
    );
    window.modelLoomRuntime = { command };
    const user = userEvent.setup();
    render(<App />);
    const dialog = await screen.findByRole('dialog', { name: 'Not enough available memory' });
    expect(dialog.tagName).toBe('DIALOG');
    expect(
      within(dialog).getByText(
        /This configuration is estimated to need more memory than is currently available/,
      ),
    ).toHaveTextContent(
      'Loading may fail or run slowly. Your model and settings will stay the same.',
    );
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
    expect(cancel).toHaveFocus();
    expect(within(dialog).getByRole('button', { name: 'Load anyway' })).toBeEnabled();
    if (choice === 'Escape')
      fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
    else await user.click(within(dialog).getByRole('button', { name: choice }));
    expect(command).toHaveBeenCalledWith({
      action: 'memory-decision',
      id,
      loadAnyway: choice === 'Load anyway',
    });
  },
);
