import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { NetworkBridge, NetworkView } from '../../../shared/network';
import { NetworkSettings } from './NetworkSettings';

afterEach(() => {
  cleanup();
  delete window.modelLoomNetwork;
});

function setup(initial: NetworkView) {
  let view = initial;
  let listener = () => {};
  const unsubscribe = vi.fn();
  const command = vi.fn<NetworkBridge['command']>(() => Promise.resolve({ ok: true, view }));
  window.modelLoomNetwork = {
    command,
    subscribe: (next) => {
      listener = next;
      return unsubscribe;
    },
  };
  const rendered = render(<NetworkSettings onApi={vi.fn()} />);
  return {
    ...rendered,
    command,
    unsubscribe,
    update: async (next: NetworkView) => {
      view = next;
      await act(() => {
        listener();
        return Promise.resolve();
      });
    },
  };
}
const disconnected: NetworkView = { state: 'disconnected', addresses: [], candidates: [] };

it('connects only on explicit action and retains manual LAN and API access', async () => {
  const { command } = setup(disconnected);
  fireEvent.click(await screen.findByRole('button', { name: 'Connect to Tailscale' }));
  await waitFor(() => expect(command).toHaveBeenCalledWith({ action: 'connect' }));
  expect(screen.getByText(/manual.*IP/i)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Open API settings' })).toBeTruthy();
});

it('shows browser sign-in and cancellation without exposing URLs', async () => {
  const { command } = setup({ ...disconnected, state: 'needs-login' });
  fireEvent.click(await screen.findByRole('button', { name: 'Open browser to sign in' }));
  await waitFor(() => expect(command).toHaveBeenCalledWith({ action: 'open-login' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(command).toHaveBeenCalledWith({ action: 'disconnect' }));
});

it('shows connected details and delegates disconnect and sign out', async () => {
  const { command, update, unmount, unsubscribe } = setup({
    ...disconnected,
    state: 'connected',
    account: 'person@example.com',
    tailnet: 'example.ts.net',
    addresses: ['100.64.1.2'],
  });
  expect(await screen.findByText('person@example.com')).toBeTruthy();
  expect(screen.getByText('100.64.1.2')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
  await waitFor(() => expect(command).toHaveBeenCalledWith({ action: 'disconnect' }));
  await update({ ...disconnected, state: 'expired' });
  expect(await screen.findByText('Sign-in expired')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  await waitFor(() => expect(command).toHaveBeenCalledWith({ action: 'sign-out' }));
  unmount();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

it('preserves safe details on read errors and offers retry without leaking backend errors', async () => {
  const { command, update } = setup({
    ...disconnected,
    state: 'connected',
    account: 'person@example.com',
  });
  await screen.findByText('person@example.com');
  command.mockResolvedValue({ ok: false, error: 'PROTECTED_STATE_UNAVAILABLE' });
  await update(disconnected);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByText('person@example.com')).toBeTruthy();
  expect(screen.queryByText('PROTECTED_STATE_UNAVAILABLE')).toBeNull();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
});

it('shows unavailable integration without suggesting plaintext fallback', async () => {
  render(<NetworkSettings onApi={vi.fn()} />);
  expect(await screen.findByText(/not available in this build/i)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Connect to Tailscale' })).toBeNull();
});

it('shows a protected storage failure and reconnects only on user action', async () => {
  const { command } = setup({
    ...disconnected,
    state: 'failed',
    error: 'NETWORK_STORAGE_UNAVAILABLE',
  });
  await screen.findByText('Tailscale could not connect');
  expect(command.mock.calls).toEqual([[{ action: 'read' }]]);
  expect(screen.getByText(/secure credential storage/i)).toBeTruthy();
  expect(screen.getByText(/could not read your saved Tailscale sign-in/i)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
  await waitFor(() => expect(command).toHaveBeenCalledWith({ action: 'connect' }));
});

it('explains incomplete sign out and retries cleanup instead of reconnecting', async () => {
  const { command } = setup({
    ...disconnected,
    state: 'failed',
    error: 'NETWORK_SIGNOUT_INCOMPLETE',
  });
  expect(await screen.findByText(/Sign out could not be completed/)).toBeTruthy();
  expect(screen.getByText(/Tailscale admin console/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry sign out' }));
  await waitFor(() => expect(command).toHaveBeenCalledWith({ action: 'sign-out' }));
});

it('coalesces subscription notifications while a read is in flight', async () => {
  const { command, update } = setup(disconnected);
  await screen.findByRole('button', { name: 'Connect to Tailscale' });
  let resolve!: (reply: Awaited<ReturnType<NetworkBridge['command']>>) => void;
  command.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await update(disconnected);
  await update(disconnected);
  await update(disconnected);
  expect(command).toHaveBeenCalledTimes(2);
  await act(() => {
    resolve({ ok: true, view: disconnected });
    return Promise.resolve();
  });
  expect(command).toHaveBeenCalledTimes(3);
});
