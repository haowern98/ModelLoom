import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { PeerCommand, PeerView } from '../../../shared/peers';
import { LivePeerRequests, LivePeerPanel } from './LivePeers';
import { ClusterViews } from './ClusterViews';
import { createDemoJoining } from '../../mocks/clusterJoining';

const fingerprint = 'a'.repeat(64),
  remote = 'b'.repeat(64);
function bridge(incoming: PeerView['incoming'] = [], outgoing: PeerView['outgoing'] = []) {
  let view: PeerView = {
    fingerprint,
    name: 'This PC',
    sharing: false,
    addresses: ['100.64.1.2', '192.168.1.2'],
    gpus: [{ id: 'gpu-one', name: 'GPU one', memoryBytes: 4096 }],
    sharedGpuIds: [],
    incoming,
    outgoing,
  };
  const command = vi.fn((request: PeerCommand) => {
    if (request.action === 'share') {
      view = { ...view, sharing: true, sharedGpuIds: request.gpuIds };
    } else if (request.action === 'stop-sharing') {
      view = { ...view, sharing: false };
    }
    return Promise.resolve({ ok: true as const, view: structuredClone(view) });
  });
  window.modelLoomPeers = { command };
  return command;
}

it('shows approved coordinators in Connections and allows revoking their access', async () => {
  const command = bridge([
    {
      id: 'approved',
      name: 'Singapore',
      peerFingerprint: remote,
      phase: 'approved',
      localVerified: true,
      remoteVerified: true,
      gpus: [],
    },
    {
      id: 'pending',
      name: 'Unapproved PC',
      peerFingerprint: 'c'.repeat(64),
      phase: 'pending',
      localVerified: false,
      remoteVerified: false,
      gpus: [],
    },
  ]);
  const user = userEvent.setup();
  render(
    <ClusterViews
      view="connections"
      demo={false}
      joining={createDemoJoining()}
      onJoining={vi.fn()}
      devices={[]}
      links={[]}
      local
      onLink={vi.fn()}
      onConnectionAction={vi.fn()}
    />,
  );
  expect(await screen.findByText('Singapore', { exact: true })).toBeVisible();
  expect(screen.getByText('Approved coordinator')).toBeVisible();
  expect(
    within(screen.getByRole('region', { name: 'Requests' })).getByText('Unapproved PC', {
      exact: true,
    }),
  ).toBeVisible();
  expect(screen.queryByText('No verified network connections.')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Revoke access for Singapore' }));
  await waitFor(() => expect(command).toHaveBeenCalledWith({ action: 'decline', id: 'approved' }));
});

it('shows approved workers and their shared hardware on Connections', async () => {
  bridge(
    [],
    [
      {
        id: 'worker',
        name: 'Malaysia',
        peerFingerprint: remote,
        phase: 'approved',
        localVerified: true,
        remoteVerified: true,
        gpus: [{ id: 'gpu-one', name: 'Shared GPU', memoryBytes: 12 * 2 ** 30 }],
      },
    ],
  );
  render(
    <ClusterViews
      view="add"
      demo={false}
      joining={createDemoJoining()}
      onJoining={vi.fn()}
      devices={[]}
      links={[]}
      local
      onLink={vi.fn()}
      onConnectionAction={vi.fn()}
    />,
  );
  expect(await screen.findByText('Malaysia', { exact: true })).toBeVisible();
  expect(screen.getByText('Approved worker')).toBeVisible();
  expect(screen.getByText('Shared GPU · 12.0 GiB')).toBeVisible();
});
afterEach(() => {
  delete window.modelLoomPeers;
});

it('uses the app address menu and keeps identity and setup instructions off the page', async () => {
  const command = bridge();
  const user = userEvent.setup();
  render(<LivePeerPanel kind="share" />);
  const trigger = await screen.findByRole('combobox', { name: "This PC's address" });
  expect(trigger.tagName).toBe('BUTTON');
  expect(screen.queryByText('App identity')).not.toBeInTheDocument();
  expect(
    screen.queryByText('Select a GPU and an address, then turn on sharing.'),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(fingerprint)).not.toBeInTheDocument();
  await user.click(trigger);
  expect(screen.getByRole('option', { name: '100.64.1.2' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await user.keyboard('{End}{Enter}');
  expect(trigger).toHaveTextContent('192.168.1.2');
  expect(trigger).toHaveFocus();
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  await user.click(trigger);
  await user.keyboard('{Escape}');
  expect(trigger).toHaveFocus();
  await user.click(screen.getByRole('checkbox', { name: /GPU one/u }));
  await user.click(screen.getByRole('switch', { name: 'Allow connections' }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith({
      action: 'share',
      address: '192.168.1.2',
      gpuIds: ['gpu-one'],
    }),
  );
  expect(trigger).toBeDisabled();
});

it('requires explicit GPU selection before starting sharing', async () => {
  const command = bridge(),
    user = userEvent.setup();
  render(<LivePeerPanel kind="share" />);
  const toggle = await screen.findByRole('switch', { name: 'Allow connections' });
  expect(toggle).toBeDisabled();
  await user.click(screen.getByRole('checkbox', { name: /GPU one/u }));
  await user.click(toggle);
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith({
      action: 'share',
      address: '100.64.1.2',
      gpuIds: ['gpu-one'],
    }),
  );
  expect(toggle).toBeChecked();
  expect(screen.getByRole('checkbox', { name: /GPU one/u })).toBeDisabled();
  await user.click(toggle);
  await waitFor(() => expect(command).toHaveBeenCalledWith({ action: 'stop-sharing' }));
  expect(toggle).not.toBeChecked();
  expect(screen.getByRole('checkbox', { name: /GPU one/u })).toBeEnabled();
});

it('invites a private address through Add device and preserves it after a failed invitation', async () => {
  const command = bridge();
  const user = userEvent.setup();
  render(<LivePeerPanel kind="add" expanded />);
  const address = screen.getByRole('textbox', { name: 'Private address' });
  await user.type(address, '100.69.84.91');
  command.mockRejectedValueOnce(new Error('PEER_UNAVAILABLE'));
  await user.click(screen.getByRole('button', { name: 'Connect' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not connect.');
  expect(address).toHaveValue('100.69.84.91');
  expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: 'Connect' }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith({ action: 'invite', address: '100.69.84.91' }),
  );
});

it('verifies six digits while preserving leading zeros', async () => {
  const command = bridge(
    [],
    [
      {
        id: 'worker',
        name: 'Malaysia',
        peerFingerprint: remote,
        phase: 'pending',
        localVerified: false,
        remoteVerified: false,
        gpus: [],
      },
    ],
  );
  const user = userEvent.setup();
  render(<LivePeerPanel kind="add" />);
  await user.click(await screen.findByRole('button', { name: 'Verify code' }));
  const verify = screen.getByRole('button', { name: 'Verify' });
  expect(verify).toBeDisabled();
  await user.type(screen.getByRole('textbox', { name: 'Verification code' }), '012345');
  await user.click(verify);
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith({ action: 'verify-code', id: 'worker', code: '012345' }),
  );
  expect(screen.queryByText(fingerprint)).not.toBeInTheDocument();
});
it('shows the receiver code without offering early approval', async () => {
  bridge([
    {
      id: 'request',
      name: 'Other PC',
      peerFingerprint: remote,
      phase: 'pending',
      localVerified: false,
      remoteVerified: false,
      pairingCode: '012345',
      gpus: [],
    },
  ]);
  const user = userEvent.setup();
  render(<LivePeerRequests />);
  await user.click(await screen.findByRole('button', { name: 'Review Other PC' }));
  expect(screen.getByLabelText('Pairing code')).toHaveTextContent('012 345');
  expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument();
});
it('approves a code-verified request without fingerprint commands', async () => {
  const command = bridge([
    {
      id: 'request',
      name: 'Other PC',
      peerFingerprint: remote,
      phase: 'pending',
      localVerified: false,
      remoteVerified: true,
      gpus: [],
    },
  ]);
  const user = userEvent.setup();
  render(<LivePeerRequests />);
  await user.click(await screen.findByRole('button', { name: 'Review Other PC' }));
  await user.click(screen.getByRole('button', { name: 'Allow' }));
  await waitFor(() => expect(command).toHaveBeenCalledWith({ action: 'approve', id: 'request' }));
});

it('retains the verification dialog and code after incorrect code and failed cancellation', async () => {
  const command = bridge(
    [],
    [
      {
        id: 'worker',
        name: 'Malaysia',
        peerFingerprint: remote,
        phase: 'pending',
        localVerified: false,
        remoteVerified: false,
        gpus: [],
      },
    ],
  );
  const user = userEvent.setup();
  render(<LivePeerPanel kind="add" />);
  await user.click(await screen.findByRole('button', { name: 'Verify code' }));
  const input = screen.getByRole('textbox', { name: 'Verification code' });
  await user.type(input, '012345');
  command.mockRejectedValueOnce(new Error('PAIRING_CODE_INVALID'));
  await user.click(screen.getByRole('button', { name: 'Verify' }));
  expect(await screen.findByText('Incorrect verification code. Try again.')).toBeVisible();
  expect(input).toHaveValue('012345');
  command.mockRejectedValueOnce(new Error('PEER_UNAVAILABLE'));
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(await screen.findByText(/Could not connect/u)).toBeVisible();
  expect(input).toHaveValue('012345');
  await user.click(screen.getByRole('button', { name: 'Verify' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(command).toHaveBeenCalledWith({ action: 'verify-code', id: 'worker', code: '012345' });
  expect(command).toHaveBeenCalledWith({ action: 'cancel', id: 'worker' });
});
it('updates the same incoming dialog from code display to approval after polling', async () => {
  const incoming = {
    id: 'request',
    name: 'Other PC',
    peerFingerprint: remote,
    phase: 'pending' as const,
    localVerified: false,
    remoteVerified: false,
    pairingCode: '012345',
    gpus: [],
  };
  const command = bridge([incoming]);
  const user = userEvent.setup();
  render(<LivePeerRequests />);
  await user.click(await screen.findByRole('button', { name: 'Review Other PC' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByLabelText('Pairing code')).toHaveTextContent('012 345');
  command.mockImplementation(() =>
    Promise.resolve({
      ok: true,
      view: {
        fingerprint,
        name: 'This PC',
        sharing: true,
        addresses: ['100.64.1.2'],
        gpus: [],
        sharedGpuIds: [],
        incoming: [{ ...incoming, remoteVerified: true }],
        outgoing: [],
      },
    }),
  );
  expect(await screen.findByRole('button', { name: 'Allow' }, { timeout: 3000 })).toBeVisible();
  expect(screen.getByRole('dialog')).toBe(dialog);
  expect(within(dialog).getByText('Allow Other PC to use your shared GPUs?')).toBeVisible();
  expect(within(dialog).queryByLabelText('Pairing code')).not.toBeInTheDocument();
});

it('allows cancellation while waiting for the receiver to approve', async () => {
  const command = bridge(
    [],
    [
      {
        id: 'worker',
        name: 'Malaysia',
        peerFingerprint: remote,
        phase: 'pending',
        localVerified: true,
        remoteVerified: false,
        gpus: [],
      },
    ],
  );
  const user = userEvent.setup();
  render(<LivePeerPanel kind="add" />);
  await user.click(await screen.findByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(command).toHaveBeenCalledWith({ action: 'cancel', id: 'worker' }));
  expect(screen.queryByRole('button', { name: 'Verify code' })).not.toBeInTheDocument();
});

it('reports local GPU sharing startup failure and leaves sharing off for retry', async () => {
  const command = bridge(),
    user = userEvent.setup();
  render(<LivePeerPanel kind="share" />);
  const toggle = await screen.findByRole('switch', { name: 'Allow connections' });
  const gpu = screen.getByRole('checkbox', { name: /GPU one/u });
  await user.click(gpu);
  command.mockRejectedValueOnce(new Error('RPC_SHARING_FAILED'));
  await user.click(toggle);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Could not start sharing on this PC. Approve the Windows permission prompts for the selected GPUs, then try again.',
  );
  expect(toggle).not.toBeChecked();
  expect(toggle).toBeEnabled();
  expect(gpu).toBeChecked();
  expect(gpu).toBeEnabled();
  expect(
    screen.queryByText(/Check the address, sharing and Windows Firewall/u),
  ).not.toBeInTheDocument();
  await user.click(toggle);
  await waitFor(() => expect(toggle).toBeChecked());
});

it('shows sharing startup beside the label only until the share command finishes', async () => {
  const command = bridge(),
    user = userEvent.setup();
  render(<LivePeerPanel kind="share" />);
  const toggle = await screen.findByRole('switch', { name: 'Allow connections' });
  await user.click(screen.getByRole('checkbox', { name: /GPU one/u }));
  let rejectShare: (error: Error) => void = () => {
    throw Error('Share not started');
  };
  command.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectShare = reject;
      }),
  );
  await user.click(toggle);
  expect(screen.getByRole('status')).toHaveTextContent('Starting sharing');
  const spinner = screen.getByTestId('sharing-spinner');
  expect(spinner.parentElement).toHaveTextContent('Allow connections');
  expect(toggle).toBeDisabled();
  expect(toggle).not.toBeChecked();
  expect(toggle).toHaveAttribute('aria-busy', 'true');
  await act(() => {
    rejectShare(new Error('SHARING_FIREWALL_PERMISSION_DENIED'));
    return Promise.resolve();
  });
  expect(screen.queryByTestId('sharing-spinner')).not.toBeInTheDocument();
  expect(
    screen.getByText('Sharing allows requests. You approve each PC before it gets access.'),
  ).toBeVisible();
  expect(
    screen.getByText(
      'Windows permission was not granted. Allow ModelLoom to set up sharing, then try again.',
      { selector: 'p' },
    ),
  ).toBeVisible();
  expect(toggle).toBeEnabled();
  expect(toggle).not.toBeChecked();
  await user.click(toggle);
  await waitFor(() => expect(toggle).toBeChecked());
  expect(screen.queryByTestId('sharing-spinner')).not.toBeInTheDocument();
  expect(
    screen.queryByText(
      'Windows permission was not granted. Allow ModelLoom to set up sharing, then try again.',
      { selector: 'p' },
    ),
  ).not.toBeInTheDocument();
});
it('does not show sharing startup during a manual refresh', async () => {
  const command = bridge(),
    user = userEvent.setup();
  render(<LivePeerPanel kind="share" />);
  await screen.findByRole('switch', { name: 'Allow connections' });
  let finish: () => void = () => {
    throw Error('Refresh not started');
  };
  command.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () =>
          resolve({
            ok: true,
            view: {
              fingerprint,
              name: 'This PC',
              sharing: false,
              addresses: [],
              gpus: [],
              sharedGpuIds: [],
              incoming: [],
              outgoing: [],
            },
          });
      }),
  );
  await user.click(screen.getByRole('button', { name: 'Refresh connections' }));
  expect(screen.queryByTestId('sharing-spinner')).not.toBeInTheDocument();
  expect(screen.queryByText(/Starting sharing/u)).not.toBeInTheDocument();
  await act(() => {
    finish();
    return Promise.resolve();
  });
});
