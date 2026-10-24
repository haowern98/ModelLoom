import { useReducer, useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ClusterViews } from './ClusterViews';
import { ClusterSidebar } from './ClusterSidebar';
import type { ClusterView } from './ClusterSidebar';
import {
  createDemoJoining,
  incomingExamples,
  transitionDemoJoining,
} from '../../mocks/clusterJoining';

function Connections() {
  const [view, navigate] = useState<ClusterView>('connections');
  const [joining, onJoining] = useReducer(transitionDemoJoining, undefined, createDemoJoining);
  const pending = incomingExamples.filter((request) => !joining.decisions[request.id]).length;
  return (
    <>
      <ClusterSidebar
        view={view}
        onNavigate={navigate}
        devices={[]}
        onSelect={vi.fn()}
        pendingRequests={pending}
        local={false}
      />
      {view !== 'overview' && (
        <ClusterViews
          view={view}
          demo
          joining={joining}
          onJoining={onJoining}
          devices={[]}
          links={[]}
          local={false}
          onLink={vi.fn()}
          onConnectionAction={navigate}
        />
      )}
    </>
  );
}

it('keeps the two connection flows under one heading and one sidebar destination', async () => {
  const user = userEvent.setup();
  render(<Connections />);
  const navigation = screen.getByRole('navigation', { name: 'Cluster navigation' });
  expect(within(navigation).queryByRole('button', { name: /^Requests/u })).not.toBeInTheDocument();
  expect(within(navigation).queryByRole('button', { name: 'Add device' })).not.toBeInTheDocument();
  expect(within(navigation).getByRole('button', { name: /^Connections/u })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(screen.queryByText('Approved PCs and shared hardware.')).not.toBeInTheDocument();
  const tabs = screen.getByRole('tablist', { name: 'Connection options' });
  expect(within(tabs).getAllByRole('tab')).toHaveLength(2);
  expect(screen.queryByRole('tab', { name: 'Join cluster' })).not.toBeInTheDocument();
  for (const label of ['Share this PC', 'Add device']) {
    await user.click(within(tabs).getByRole('tab', { name: label }));
    expect(screen.getByRole('heading', { name: 'Connections', level: 1 })).toBeVisible();
    expect(screen.getByRole('tabpanel', { name: label })).toBeVisible();
    expect(within(tabs).getByRole('tab', { name: label })).toHaveAttribute('aria-selected', 'true');
  }
  expect(screen.getByRole('textbox', { name: 'Private address' })).toBeVisible();
});

it('supports arrow, Home and End navigation between connection tabs', async () => {
  const user = userEvent.setup();
  render(<Connections />);
  const tabs = screen.getByRole('tablist', { name: 'Connection options' });
  const share = within(tabs).getByRole('tab', { name: 'Share this PC' });
  share.focus();
  await user.keyboard('{ArrowRight}');
  expect(within(tabs).getByRole('tab', { name: 'Add device' })).toHaveFocus();
  await user.keyboard('{ArrowRight}');
  expect(within(tabs).getByRole('tab', { name: 'Share this PC' })).toHaveFocus();
  await user.keyboard('{ArrowLeft}');
  expect(within(tabs).getByRole('tab', { name: 'Add device' })).toHaveFocus();
  await user.keyboard('{End}');
  expect(within(tabs).getByRole('tab', { name: 'Add device' })).toHaveFocus();
  await user.keyboard('{Home}');
  expect(within(tabs).getByRole('tab', { name: 'Share this PC' })).toHaveFocus();
});

it('handles requests inside sharing and updates the Connections sidebar badge', async () => {
  const user = userEvent.setup();
  render(<Connections />);
  const navigation = screen.getByRole('navigation', { name: 'Cluster navigation' });
  expect(within(navigation).getByLabelText('2 pending requests')).toBeVisible();
  const content = screen.getByRole('tabpanel', { name: 'Share this PC' });
  await user.click(
    within(content).getByRole('button', {
      name: 'Approve invitation from render-coordinator',
    }),
  );
  expect(within(navigation).getByLabelText('1 pending request')).toBeVisible();
  await user.click(
    within(content).getByRole('button', {
      name: 'Decline invitation from office-pc',
    }),
  );
  expect(within(navigation).queryByLabelText(/pending requests?/u)).not.toBeInTheDocument();
  expect(within(content).getByText('Approved · demo')).toBeVisible();
  expect(within(content).getByText('Declined · demo')).toBeVisible();
});
