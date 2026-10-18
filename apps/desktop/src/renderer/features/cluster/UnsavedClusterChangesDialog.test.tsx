import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { UnsavedClusterChangesDialog } from './UnsavedClusterChangesDialog';

it('offers exactly Save changes and Discard changes, with X preserving the editor', async () => {
  const onSave = vi.fn(() => Promise.resolve(true)),
    onDiscard = vi.fn(() => Promise.resolve(true)),
    onClose = vi.fn();
  render(
    <UnsavedClusterChangesDialog
      modelName="Qwen"
      saved
      busy={false}
      onSave={onSave}
      onDiscard={onDiscard}
      onClose={onClose}
    />,
  );
  const dialog = screen.getByRole('dialog', { name: 'Unsaved changes' });
  expect(
    within(dialog)
      .getAllByRole('button')
      .map((button) => button.textContent),
  ).toEqual(['', 'Save changes', 'Discard changes']);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Close dialog' }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(onSave).not.toHaveBeenCalled();
  expect(onDiscard).not.toHaveBeenCalled();
});

it('keeps the dialog open with feedback when Save fails and names a new configuration', async () => {
  const onSave = vi.fn(() => Promise.resolve(false));
  render(
    <UnsavedClusterChangesDialog
      modelName="Bonsai"
      saved={false}
      busy={false}
      onSave={onSave}
      onDiscard={() => Promise.resolve(true)}
      onClose={vi.fn()}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(onSave).toHaveBeenCalledWith('Bonsai');
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved');
  expect(screen.getByRole('dialog', { name: 'Unsaved changes' })).toBeVisible();
});
