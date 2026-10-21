import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { PeerView } from '../../../shared/peers';
import { LivePeerRequests, LivePeerPanel } from './LivePeers';
import { ClusterViews } from './ClusterViews';
import { createDemoJoining } from '../../mocks/clusterJoining';

const fingerprint = 'a'.repeat(64),
  remote = 'b'.repeat(64);
function bridge(incoming: PeerView['incoming'] = [], outgoing: PeerView['outgoing'] = []) {
  const view: PeerView = {
    fingerprint,
    name: 'This PC',
    sharing: false,
    addresses: ['100.64.1.2'],
    gpus: [{ id: 'gpu-one', name: 'GPU one', memoryBytes: 4096 }],
    sharedGpuIds: [],
    incoming,
    outgoing,
  };
  const command = vi.fn(() => Promise.resolve({ ok: true as const, view }));
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
  expect(screen.queryByText('Unapproved PC', { exact: true })).not.toBeInTheDocument();
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
  expect(await screen.findByText('Malaysia', { exact: true })).toBeVisible();
  expect(screen.getByText('Approved worker')).toBeVisible();
  expect(screen.getByText('Shared GPU · 12.0 GiB')).toBeVisible();
});
afterEach(() => {
  delete window.modelLoomPeers;
});

it('requires explicit GPU selection before starting sharing', async () => {
  const command = bridge(),
    user = userEvent.setup();
  render(<LivePeerPanel kind="share" />);
  const toggle = await screen.findByRole('switch', { name: 'Allow participation requests' });
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
