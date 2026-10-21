import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

async function chooseConnection(user: ReturnType<typeof userEvent.setup>, name: string) {
  const navigation = within(screen.getByRole('navigation', { name: 'Cluster navigation' }));
  if (name === 'Add device') {
    await user.click(navigation.getByRole('button', { name }));
  } else {
    await user.click(navigation.getByRole('button', { name: 'Connections' }));
    await user.click(screen.getByRole('button', { name }));
  }
}

async function overview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    within(screen.getByRole('navigation', { name: 'Cluster navigation' })).getByRole('button', {
      name: 'Overview',
    }),
  );
}

describe('Cluster joining demo', () => {
  it('switches direction, retains outgoing requests across navigation and never adds a connected peer', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Cluster' }));
    await chooseConnection(user, 'Add device');
    expect(screen.getByText('Invite another PC to contribute to your cluster.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Invite office-pc' }));
    expect(screen.getByRole('button', { name: 'Invitation pending for office-pc' })).toBeDisabled();
    await chooseConnection(user, 'Join cluster');
    expect(screen.getByText('Ask a coordinator to use this PC in its cluster.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Request to join render-coordinator' }));
    expect(
      screen.getByRole('button', { name: 'Join request pending for render-coordinator' }),
    ).toBeDisabled();
    await overview(user);
    expect(screen.getAllByRole('article')).toHaveLength(4);
    expect(screen.getAllByText(/^Layers /)).toHaveLength(5);
    await user.click(screen.getByRole('button', { name: 'Models' }));
    await user.click(screen.getByRole('button', { name: 'Cluster' }));
    await chooseConnection(user, 'Join cluster');
    expect(
      screen.getByRole('button', { name: 'Join request pending for render-coordinator' }),
    ).toBeDisabled();
    await chooseConnection(user, 'Add device');
    expect(screen.getByRole('button', { name: 'Invitation pending for office-pc' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Connect manually' }));
    const invite = screen.getByRole('button', { name: 'Invite private address' });
    expect(invite).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'Private address' }), '192.168.1.42');
    await user.click(invite);
    expect(screen.getByText('Invitation pending · demo')).toBeVisible();
    await overview(user);
    await chooseConnection(user, 'Add device');
    await user.click(screen.getByRole('button', { name: 'Connect manually' }));
    expect(screen.getByRole('textbox', { name: 'Private address' })).toHaveValue('192.168.1.42');
    expect(screen.getByText('Invitation pending · demo')).toBeVisible();
    expect(screen.getByText(/No discovery, request delivery or pairing occurs/)).toBeVisible();
    await overview(user);
    expect(screen.getAllByRole('article')).toHaveLength(4);
  });

  it('explains both incoming directions and resolves only the selected request', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Cluster' }));
    expect(screen.getByLabelText('2 pending requests')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cluster panel' }));
    const panel = screen.getByRole('complementary', { name: 'Cluster panel' });
    expect(within(panel).queryByText('Participation requests')).not.toBeInTheDocument();
    expect(within(panel).getByText('4 devices · 5 GPUs')).toBeVisible();
    await user.keyboard('{Escape}');
    const navigation = within(screen.getByRole('navigation', { name: 'Cluster navigation' }));
    await user.click(navigation.getByRole('button', { name: /^Requests/ }));
    const requests = screen.getByRole('region', { name: 'Requests' });
    expect(
      within(requests).getByText('render-coordinator coordinates; this PC contributes.'),
    ).toBeVisible();
    expect(within(requests).getByText('This PC coordinates; office-pc contributes.')).toBeVisible();
    await user.click(
      within(requests).getByRole('button', { name: 'Approve invitation from render-coordinator' }),
    );
    expect(screen.getByLabelText('1 pending request')).toBeVisible();
    expect(within(requests).getByText('Approved · demo')).toBeVisible();
    await user.click(
      within(requests).getByRole('button', { name: 'Decline join request from office-pc' }),
    );
    expect(screen.queryByLabelText(/pending requests?$/)).not.toBeInTheDocument();
    expect(within(requests).getByText('Declined · demo')).toBeVisible();
    await overview(user);
    expect(screen.getAllByText(/^Layers /)).toHaveLength(5);
    await user.click(screen.getByRole('button', { name: 'Cluster panel' }));
    expect(screen.queryByRole('button', { name: /Approve invitation/ })).not.toBeInTheDocument();
  });

  it('sharing is independent of approval, remembers hardware choices and can be stopped', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Cluster' }));
    await chooseConnection(user, 'Share this PC');
    const sharing = screen.getByRole('switch', { name: 'Allow participation requests' });
    expect(sharing).not.toBeChecked();
    await user.click(sharing);
    await user.click(screen.getByRole('checkbox', { name: 'CPU' }));
    expect(screen.getByLabelText('2 pending requests')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Models' }));
    await user.click(screen.getByRole('button', { name: 'Cluster' }));
    await chooseConnection(user, 'Share this PC');
    expect(screen.getByRole('switch', { name: 'Allow participation requests' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'CPU' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Stop sharing' }));
    expect(screen.getByRole('switch', { name: 'Allow participation requests' })).not.toBeChecked();
    await overview(user);
    expect(screen.getAllByRole('article')).toHaveLength(4);
  });

  it('never offers sample peers or simulated approval in the non-demo build', async () => {
    vi.stubGlobal('__DEMO_DATA_ENABLED__', false);
    try {
      const user = userEvent.setup();
      render(<App />);
      await user.click(screen.getByRole('button', { name: 'Cluster' }));
      await chooseConnection(user, 'Add device');
      expect(screen.queryByText('office-pc')).not.toBeInTheDocument();
      expect(screen.getByText('No available devices')).toBeVisible();
      await chooseConnection(user, 'Share this PC');
      expect(screen.getByRole('switch', { name: 'Allow participation requests' })).toBeDisabled();
      await overview(user);
      expect(screen.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
