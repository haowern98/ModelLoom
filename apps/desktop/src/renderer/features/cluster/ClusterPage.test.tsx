import { useReducer } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ClusterPage } from './ClusterPage';
import { createDemoPlacement, demoDevices } from '../../mocks/cluster';
import { createDemoJoining, transitionDemoJoining } from '../../mocks/clusterJoining';

function Cluster({ demo = true }: { demo?: boolean }) {
  const [joining, onJoining] = useReducer(transitionDemoJoining, undefined, createDemoJoining);
  return (
    <ClusterPage
      demo={demo}
      joining={joining}
      onJoining={onJoining}
      devices={demo ? demoDevices : []}
      onRenameDevice={vi.fn()}
      activeModel={undefined}
      models={[]}
      placement={createDemoPlacement(null)}
      dispatch={vi.fn()}
      onStop={vi.fn()}
    />
  );
}

it('navigates distinct Cluster views and retains the canvas across navigation', async () => {
  const user = userEvent.setup();
  render(<Cluster />);
  const navigation = screen.getByRole('navigation', { name: 'Cluster navigation' });
  const canvas = screen.getByRole('region', { name: 'Cluster canvas' });
  const controls = screen.getByRole('group', { name: 'Canvas controls' });
  await user.click(within(navigation).getByRole('button', { name: 'Devices' }));
  expect(screen.getByRole('heading', { name: 'Devices' })).toBeVisible();
  expect(canvas).not.toBeVisible();
  await user.click(within(navigation).getByRole('button', { name: 'Connections' }));
  expect(screen.getByRole('heading', { name: 'Connections' })).toBeVisible();
  await user.click(within(navigation).getByRole('button', { name: 'Overview' }));
  expect(screen.getByRole('region', { name: 'Cluster canvas' })).toBe(canvas);
  expect(screen.getByRole('group', { name: 'Canvas controls' })).toBe(controls);
  expect(within(controls).getByRole('button', { name: 'Fit to view' })).toBeVisible();
});

it('opens a device from the sidebar without a device search field', async () => {
  const user = userEvent.setup();
  render(<Cluster />);
  const sidebar = screen.getByRole('complementary', { name: 'Cluster' });
  await user.click(within(sidebar).getByRole('button', { name: 'Inspect ml-workstation' }));
  const panel = screen.getByRole('complementary', { name: 'Cluster panel' });
  expect(within(panel).getByRole('heading', { name: 'ml-workstation' })).toBeVisible();
  expect(within(sidebar).queryByRole('searchbox')).not.toBeInTheDocument();
  expect(screen.getAllByRole('article')).toHaveLength(demoDevices.length);
  expect(screen.getByRole('article', { name: 'mac-studio' })).toBeVisible();
});

it('keeps approvals explicitly simulated and removes their pending count after decisions', async () => {
  const user = userEvent.setup();
  render(<Cluster />);
  const navigation = screen.getByRole('navigation', { name: 'Cluster navigation' });
  await user.click(within(navigation).getByRole('button', { name: /Requests/ }));
  expect(screen.getByText('Example requests · approval is simulated.')).toBeVisible();
  await user.click(
    screen.getByRole('button', { name: 'Approve invitation from render-coordinator' }),
  );
  await user.click(screen.getByRole('button', { name: 'Decline join request from office-pc' }));
  expect(within(navigation).getByRole('button', { name: 'Requests' })).toHaveTextContent(
    'Requests',
  );
  expect(
    screen.getByText('No device is connected or granted access by these demo actions.'),
  ).toBeVisible();
});

it('shows honest unavailable networking views without demo peers in ordinary builds', async () => {
  const user = userEvent.setup();
  render(<Cluster demo={false} />);
  const navigation = screen.getByRole('navigation', { name: 'Cluster navigation' });
  await user.click(within(navigation).getByRole('button', { name: 'Add device' }));
  expect(screen.getByRole('heading', { name: 'Add device' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Connect manually' }));
  expect(screen.getByRole('textbox', { name: 'Private address' })).toBeDisabled();
  expect(screen.queryByText('office-pc')).not.toBeInTheDocument();
  await user.click(within(navigation).getByRole('button', { name: 'Requests' }));
  expect(screen.queryByRole('button', { name: /Approve|Decline/ })).not.toBeInTheDocument();
});

it('shows all devices across sidebar navigation', async () => {
  const user = userEvent.setup();
  render(<Cluster />);
  const navigation = screen.getByRole('navigation', { name: 'Cluster navigation' });
  const canvas = screen.getByRole('region', { name: 'Cluster canvas' });
  await user.click(within(navigation).getByRole('button', { name: 'Devices' }));
  const inventory = screen.getByRole('region', { name: 'Devices' });
  expect(within(inventory).getAllByRole('article')).toHaveLength(demoDevices.length);
  expect(within(inventory).getByRole('heading', { name: 'ml-workstation' })).toBeVisible();
  expect(within(inventory).queryByRole('button')).not.toBeInTheDocument();
  await user.click(within(navigation).getByRole('button', { name: 'Overview' }));
  expect(screen.getByRole('region', { name: 'Cluster canvas' })).toBe(canvas);
});
