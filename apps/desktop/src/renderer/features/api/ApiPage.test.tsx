import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiPage } from './ApiPage';
import type { ApiManagementCommand, ApiManagementStatus } from '../../../shared/local-api';
const secret = `ml_${'b'.repeat(64)}`;
const calls: ApiManagementCommand[] = [];
afterEach(() => {
  delete window.modelLoomApi;
  calls.length = 0;
  vi.useRealTimers();
});
function setup(keyPresent = false) {
  let status: ApiManagementStatus = {
    phase: 'stopped',
    configuredPort: 8000,
    address: null,
    model: null,
    uptimeMs: null,
    requests: 0,
    responseTimeMs: null,
    logs: [],
    error: null,
    keyPresent,
    keyGeneration: keyPresent ? 1 : 0,
  };
  window.modelLoomApi = {
    command: (input) => {
      calls.push(input);
      if (input.action === 'generateKey')
        status = { ...status, keyPresent: true, keyGeneration: status.keyGeneration + 1 };
      if (input.action === 'start')
        status = {
          ...status,
          phase: 'running',
          address: 'http://127.0.0.1:8000/v1',
          model: { id: `model-${'a'.repeat(64)}`, created: 123 },
          uptimeMs: 0,
        };
      if (input.action === 'stop')
        status = { ...status, phase: 'stopped', address: null, uptimeMs: null };
      return Promise.resolve({
        ok: true,
        status,
        ...(input.action === 'revealKey' ? { secret } : {}),
      });
    },
  };
  render(<ApiPage activeModel={undefined} demo={false} onCluster={() => {}} />);
}
it('connects existing key and server controls and uses the actual endpoint and model in examples', async () => {
  const user = userEvent.setup();
  setup();
  await screen.findByRole('button', { name: 'Generate key' });
  await user.click(screen.getByRole('button', { name: 'Generate key' }));
  expect(await screen.findByText('API key created')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Start server' }));
  expect(await screen.findByRole('button', { name: 'Stop server' })).toBeEnabled();
  expect(screen.getByRole('tabpanel')).toHaveTextContent(`model-${'a'.repeat(64)}`);
  expect(screen.queryByText(secret)).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Copy API key' }));
  expect(calls.some((input) => input.action === 'copyKey')).toBe(true);
  expect(screen.queryByText(secret)).not.toBeInTheDocument();
});
it('reveals only explicitly and masks on blur', async () => {
  const user = userEvent.setup();
  setup(true);
  await user.click(await screen.findByRole('button', { name: 'Reveal API key' }));
  expect(await screen.findByText(secret)).toBeVisible();
  act(() => {
    window.dispatchEvent(new Event('blur'));
  });
  expect(screen.queryByText(secret)).not.toBeInTheDocument();
  act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  await user.click(screen.getByRole('button', { name: 'Reveal API key' }));
  expect(await screen.findByText(secret)).toBeVisible();
});
it('keeps the reveal button focused while an asynchronous key reply is pending', async () => {
  const user = userEvent.setup();
  setup(true);
  const original = window.modelLoomApi!;
  let resolve!: (reply: Awaited<ReturnType<typeof original.command>>) => void;
  window.modelLoomApi = {
    command: (input) =>
      input.action === 'revealKey'
        ? new Promise((yes) => {
            resolve = yes;
          })
        : original.command(input),
  };
  const reveal = await screen.findByRole('button', { name: 'Reveal API key' });
  await user.click(reveal);
  expect(reveal).toBeEnabled();
  expect(reveal).toHaveFocus();
  const status = await original.command({ action: 'status' });
  await act(async () => {
    resolve({ ...status, ...(status.ok ? { secret } : {}) });
    await Promise.resolve();
  });
  expect(await screen.findByText(secret)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Start server' }));
  expect(screen.queryByText(secret)).not.toBeInTheDocument();
});
it('expires a revealed key after thirty seconds', async () => {
  vi.useFakeTimers();
  setup(true);
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Reveal API key' }));
    await Promise.resolve();
  });
  expect(screen.getByText(secret)).toBeVisible();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30001);
  });
  expect(screen.queryByText(secret)).not.toBeInTheDocument();
});
it('reports protected storage failure without claiming key creation', async () => {
  setup();
  const original = window.modelLoomApi!;
  window.modelLoomApi = {
    command: (input) =>
      input.action === 'generateKey'
        ? Promise.resolve({ ok: false, error: 'CREDENTIAL_UNAVAILABLE' })
        : original.command(input),
  };
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Generate key' }));
  expect(
    await screen.findByText('Windows could not protect or recover the API key.'),
  ).toBeVisible();
  expect(screen.queryByText('API key created')).not.toBeInTheDocument();
});
