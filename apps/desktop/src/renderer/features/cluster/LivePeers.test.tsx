import { render, screen, waitFor, within } from '@testing-library/react';
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
  await user.click(screen.getByRole('button', { name: 'Invite' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not connect.');
  expect(address).toHaveValue('100.69.84.91');
  expect(screen.getByRole('button', { name: 'Invite' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: 'Invite' }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith({ action: 'invite', address: '100.69.84.91' }),
  );
});

it('confirms outgoing identities only after comparing both fingerprints', async () => {
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
  render(<LivePeerPanel kind="add" expanded />);
  await user.click(await screen.findByRole('button', { name: 'Verify identity' }));
  const confirm = screen.getByRole('button', { name: 'Confirm verified identity' });
  expect(confirm).toBeDisabled();
  expect(screen.getByText(fingerprint)).toBeVisible();
  expect(screen.getByText(remote)).toBeVisible();
  await user.click(screen.getByRole('checkbox', { name: /checked both fingerprints/u }));
  await user.click(confirm);
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith({ action: 'confirm', id: 'worker', fingerprint: remote }),
  );
});

it('requires both displayed fingerprints to be checked before approval', async () => {
  const command = bridge([
      {
        id: 'request',
        name: 'Other PC',
        peerFingerprint: remote,
        phase: 'pending',
        localVerified: false,
        remoteVerified: false,
        gpus: [],
      },
    ]),
    user = userEvent.setup();
  render(<LivePeerRequests />);
  await user.click(await screen.findByRole('button', { name: 'Approve Other PC' }));
  const approve = screen.getByRole('button', { name: 'Approve verified identity' });
  expect(approve).toBeDisabled();
  expect(screen.getByText(fingerprint)).toBeInTheDocument();
  expect(screen.getByText(remote)).toBeInTheDocument();
  await user.click(screen.getByRole('checkbox', { name: /checked both fingerprints/u }));
  await user.click(approve);
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith({ action: 'approve', id: 'request', fingerprint: remote }),
  );
});
