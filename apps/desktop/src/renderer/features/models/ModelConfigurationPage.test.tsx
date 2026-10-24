import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ModelConfigurationPage } from './ModelConfigurationPage';
import { createDemoDefaults } from './configuration';
import type { DemoModelDefaults } from './configuration';
import { createDemoLibrary } from '../../mocks/modelLibrary';
import toastStyles from '../../components/Toast.module.css';

function setup(
  onSave: () => void | Promise<void>,
  overrides: Partial<DemoModelDefaults> = {},
  live = false,
) {
  const saved = createDemoDefaults();
  render(
    <ModelConfigurationPage
      model={createDemoLibrary().models[0]!}
      configuration={{
        saved,
        draft: { ...structuredClone(saved), systemPrompt: 'Updated', ...overrides },
      }}
      onChange={vi.fn()}
      onSave={onSave}
      onBack={vi.fn()}
      onCluster={vi.fn()}
      {...(live
        ? {
            live: {
              maxOutputTokens: 2048,
              thinkingSupported: true,
              pendingReload: false,
              resetDefaults: saved,
            },
          }
        : {})}
    />,
  );
  return screen.getByRole('group', { name: 'Model configuration actions' });
}

function expectButtonsOnly(footer: HTMLElement) {
  expect(within(footer).getAllByRole('button')).toHaveLength(2);
  expect(footer).toHaveTextContent(/^Reset defaultsSave changes$/);
}

it('keeps the footer clear throughout a pending save and the success popup', async () => {
  let acknowledge!: () => void;
  const pending = new Promise<void>((resolve) => {
    acknowledge = resolve;
  });
  const footer = setup(() => pending);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Save changes' }));
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  expectButtonsOnly(footer);
  await act(async () => {
    acknowledge();
    await pending;
  });
  expect(screen.getByRole('status')).toHaveTextContent('Defaults saved');
  expectButtonsOnly(footer);
});

it.each([
  ['STALE_CONFIGURATION', 'These settings changed. Reopen configuration before saving again.'],
  ['INVALID_CONFIGURATION', 'Check the model settings and try again.'],
  ['UNSUPPORTED_SETTING', 'This setting is not available for the current model profile.'],
  ['UNEXPECTED_FAILURE', 'Settings could not be confirmed. Reopen to check saved defaults.'],
])('shows %s save failures only in a red popup', async (code, message) => {
  const footer = setup(() => Promise.reject(new Error(code)));
  await userEvent.setup().click(screen.getByRole('button', { name: 'Save changes' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(message);
  expect(alert.parentElement).toHaveClass(toastStyles.error!);
  expectButtonsOnly(footer);
  expect(screen.getByRole('textbox', { name: 'System Prompt' })).toHaveValue('Updated');
});

it.each([false, true])('shows stop-string overflow in a red popup (live: %s)', async (live) => {
  const save = vi.fn();
  const footer = setup(
    save,
    {
      stopStrings: Array.from({ length: live ? 4 : 16 }, (_, index) => `stop-${index}`),
      stopInput: 'extra',
    },
    live,
  );
  await userEvent.setup().click(screen.getByRole('button', { name: 'Save changes' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(
    live ? 'Use no more than four stop strings.' : 'Use no more than 16 stop strings in this demo.',
  );
  expect(alert.parentElement).toHaveClass(toastStyles.error!);
  expectButtonsOnly(footer);
  expect(save).not.toHaveBeenCalled();
});
