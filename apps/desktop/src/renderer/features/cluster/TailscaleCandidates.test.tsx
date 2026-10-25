import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { NetworkBridge, NetworkView } from '../../../shared/network';
import type { PeerView } from '../../../shared/peers';
import { TailscaleCandidates } from './TailscaleCandidates';

afterEach(() => {
  cleanup();
  delete window.modelLoomNetwork;
});
const candidate = {
  id: 'candidate-id',
  name: 'ptss',
  fingerprint: 'a'.repeat(64),
  address: '100.64.1.2',
};
const connected: NetworkView = { state: 'connected', addresses: [], candidates: [candidate] };
function setup(view = connected) {
  let listener = () => {};
  const unsubscribe = vi.fn();
  const command = vi.fn<NetworkBridge['command']>(() => Promise.resolve({ ok: true, view }));
  const invite = vi.fn<NonNullable<NetworkBridge['invite']>>();
  window.modelLoomNetwork = {
    command,
    invite,
    subscribe: (next) => {
      listener = next;
      return unsubscribe;
    },
  };
  const onInvited = vi.fn();
  return {
    ...render(<TailscaleCandidates onInvited={onInvited} />),
    command,
    invite,
    onInvited,
    unsubscribe,
    notify: async () => {
      await act(() => {
        listener();
        return Promise.resolve();
      });
    },
  };
}

it('discovers without automatically pairing and sends only the candidate ID on Connect', async () => {
  const { invite, onInvited } = setup();
  await screen.findByText('ptss');
  expect(invite).not.toHaveBeenCalled();
  const view: PeerView = {
    fingerprint: 'b'.repeat(64),
    name: 'Local',
    sharing: false,
    addresses: [],
    gpus: [],
    sharedGpuIds: [],
    incoming: [],
    outgoing: [
      {
        id: 'invitation-id',
        name: 'ptss',
        peerFingerprint: candidate.fingerprint,
        address: candidate.address,
        phase: 'pending',
        localVerified: false,
        remoteVerified: false,
        gpus: [],
      },
    ],
  };
  invite.mockResolvedValue({ ok: true, view });
  fireEvent.click(screen.getByRole('button', { name: 'Connect to ptss' }));
  await waitFor(() => expect(onInvited).toHaveBeenCalledWith('invitation-id'));
  expect(invite.mock.calls).toEqual([['candidate-id']]);
  expect(screen.queryByText(/GPU/)).toBeNull();
});

it('retains safe discovery information when reads fail and unsubscribes', async () => {
  const { command, notify, unmount, unsubscribe } = setup();
  await screen.findByText('ptss');
  command.mockRejectedValue(Error('secret backend detail'));
  await notify();
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByText('ptss')).toBeTruthy();
  expect(screen.queryByText('secret backend detail')).toBeNull();
  unmount();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

it('accepts an already approved reconnection without opening code verification', async () => {
  const { invite, onInvited } = setup();
  invite.mockResolvedValue({
    ok: true,
    view: {
      fingerprint: 'b'.repeat(64),
      name: 'Local',
      sharing: false,
      addresses: [],
      gpus: [],
      sharedGpuIds: [],
      incoming: [],
      outgoing: [
        {
          id: 'reconnected-id',
          name: 'ptss',
          peerFingerprint: candidate.fingerprint,
          address: candidate.address,
          phase: 'approved',
          localVerified: true,
          remoteVerified: true,
          gpus: [],
        },
      ],
    },
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Connect to ptss' }));
  await waitFor(() => expect(invite).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Connect to ptss' })).not.toBeDisabled(),
  );
  expect(screen.queryByRole('alert')).toBeNull();
  expect(onInvited).not.toHaveBeenCalled();
});

it('reports invitation failures without opening verification', async () => {
  const { invite, onInvited } = setup();
  invite.mockResolvedValue({ ok: false, error: 'PEER_UNAVAILABLE' });
  fireEvent.click(await screen.findByRole('button', { name: 'Connect to ptss' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(onInvited).not.toHaveBeenCalled();
});

it('shows the pairing limit and leaves Connect available for a later retry', async () => {
  const { invite } = setup();
  invite.mockResolvedValue({ ok: false, error: 'PAIRING_LIMIT' });
  fireEvent.click(await screen.findByRole('button', { name: 'Connect to ptss' }));
  expect(
    await screen.findByText('Too many pairing requests. Wait a minute and try again.'),
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Connect to ptss' })).not.toBeDisabled();
});

it('prevents duplicate invitations while Connect is pending', async () => {
  const { invite } = setup();
  let finish!: (reply: Awaited<ReturnType<NonNullable<NetworkBridge['invite']>>>) => void;
  invite.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const connect = await screen.findByRole('button', { name: 'Connect to ptss' });
  fireEvent.click(connect);
  expect(connect).toBeDisabled();
  fireEvent.click(connect);
  expect(invite).toHaveBeenCalledTimes(1);
  await act(() => {
    finish({ ok: false, error: 'PEER_UNAVAILABLE' });
    return Promise.resolve();
  });
});

it('coalesces discovery change notifications during a pending read', async () => {
  const { command, notify } = setup();
  await screen.findByText('ptss');
  let finish!: (reply: Awaited<ReturnType<NetworkBridge['command']>>) => void;
  command.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await notify();
  await notify();
  await notify();
  expect(command).toHaveBeenCalledTimes(2);
  await act(() => {
    finish({ ok: true, view: connected });
    return Promise.resolve();
  });
  expect(command).toHaveBeenCalledTimes(3);
});

it.each([
  ['disconnected', 'Connect to Tailscale in Network settings to discover PCs.'],
  ['starting', 'Searching for ModelLoom PCs…'],
  ['connected', 'No eligible ModelLoom PCs found on your tailnet.'],
] as const)('shows an honest empty state for %s', async (state, text) => {
  setup({ ...connected, state, candidates: [] });
  expect(await screen.findByText(text)).toBeTruthy();
});
