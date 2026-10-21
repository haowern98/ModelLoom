import { useReducer } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ClusterPage } from './ClusterPage';
import { createDemoLibrary } from '../../mocks/modelLibrary';
import { createDemoPlacement, demoDevices } from '../../mocks/cluster';
import { createDemoJoining, transitionDemoJoining } from '../../mocks/clusterJoining';

function Cluster({
  demo = true,
  selectedId = null,
  activeId = null,
  pendingPeerRequests = 0,
}: {
  demo?: boolean;
  selectedId?: string | null;
  activeId?: string | null;
  pendingPeerRequests?: number;
}) {
  const models = createDemoLibrary().models;
  const [joining, onJoining] = useReducer(transitionDemoJoining, undefined, createDemoJoining);
  return (
    <ClusterPage
      demo={demo}
      pendingPeerRequests={pendingPeerRequests}
      joining={joining}
      onJoining={onJoining}
      devices={demo ? demoDevices : []}
      onRenameDevice={vi.fn()}
      activeModel={models.find((model) => model.id === activeId)}
      models={selectedId ? models : []}
      placement={createDemoPlacement(selectedId)}
      dispatch={vi.fn()}
      onStop={vi.fn()}
    />
  );
}

it.each([false, true])('shows requests only inside Connections sharing (demo=%s)', async (demo) => {
  const user = userEvent.setup();
  render(<Cluster demo={demo} />);
  await user.click(screen.getByRole('button', { name: 'Cluster panel' }));
  const panel = screen.getByRole('complementary', { name: 'Cluster panel' });
  expect(
    within(panel).queryByRole('heading', { name: /Participation requests|Pending requests/u }),
  ).not.toBeInTheDocument();
  const navigation = screen.getByRole('navigation', { name: 'Cluster navigation' });
  await user.click(within(navigation).getByRole('button', { name: /^Connections/u }));
  expect(
    screen.getByRole('heading', { name: demo ? /Pending requests/u : 'Requests' }),
  ).toBeVisible();
});

it('updates the right-side Requests count and hides it when no requests remain', () => {
  const view = render(<Cluster demo={false} pendingPeerRequests={1} />);
  const navigation = screen.getByRole('navigation', { name: 'Cluster navigation' });
  expect(within(navigation).getByLabelText('1 pending request')).toHaveTextContent('1');
  view.rerender(<Cluster demo={false} pendingPeerRequests={2} />);
  expect(within(navigation).getByLabelText('2 pending requests')).toHaveTextContent('2');
  view.rerender(<Cluster demo={false} pendingPeerRequests={0} />);
  expect(within(navigation).queryByLabelText(/pending requests?/u)).not.toBeInTheDocument();
});

it('keeps empty layer fields visible and disabled before a model is selected', async () => {
  const user = userEvent.setup();
  render(<Cluster />);
  await user.click(screen.getByRole('button', { name: 'Select studio-desktop' }));
  const panel = screen.getByRole('complementary', { name: 'Cluster panel' });
  expect(within(panel).getByText('Choose a model to assign layers.')).toBeVisible();
  const fields = within(panel).getAllByRole('spinbutton');
  expect(fields).toHaveLength(4);
  for (const gpu of [0, 1]) {
    for (const boundary of ['First', 'Last']) {
      const field = within(panel).getByRole('spinbutton', {
        name: `${boundary} layer for GPU ${gpu}`,
      });
      expect(field).toBeVisible();
      expect(field).toBeDisabled();
      expect(field).toHaveValue('');
      expect(field).toHaveAttribute('placeholder', '\u2014');
      expect(field).not.toHaveAttribute('aria-valuemax');
      expect(field).not.toHaveAttribute('max', '-1');
    }
  }
  const steppers = within(panel).getAllByRole('button', { name: /^(Increase|Decrease) / });
  expect(steppers).toHaveLength(8);
  for (const stepper of steppers) {
    expect(stepper).toBeVisible();
    expect(stepper).toBeDisabled();
  }
  expect(within(panel).queryByText('Not used for model layers')).not.toBeInTheDocument();
});

it('keeps a newly approved peer off the canvas until its PC card is chosen', async () => {
  const user = userEvent.setup();
  const local = { ...demoDevices[0]!, id: 'local' };
  const remote = { ...demoDevices[1]!, id: 'peer:approved', name: 'Approved PC' };
  render(
    <ClusterPage
      demo={false}
      joining={createDemoJoining()}
      onJoining={vi.fn()}
      devices={[local, remote]}
      onRenameDevice={vi.fn()}
      activeModel={undefined}
      models={[]}
      placement={createDemoPlacement(null)}
      dispatch={vi.fn()}
      onStop={vi.fn()}
      localRuntime={{ loading: false, onChoose: vi.fn(), onRun: vi.fn() }}
    />,
  );
  expect(screen.queryByRole('article', { name: 'Approved PC' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: `Add device near ${local.name}` }));
  const panel = screen.getByRole('complementary', { name: 'Cluster panel' });
  expect(within(panel).getByRole('heading', { name: 'Add to canvas' })).toBeVisible();
  expect(within(panel).getByText('Choose a PC to add to this canvas.')).toBeVisible();
  expect(within(panel).queryByRole('textbox')).not.toBeInTheDocument();
  await user.click(within(panel).getByRole('button', { name: 'Add Approved PC to canvas' }));
  expect(screen.getByRole('article', { name: 'Approved PC' })).toBeVisible();
  expect(screen.queryByRole('complementary', { name: 'Cluster panel' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: `Actions for ${local.name}` }));
  expect(screen.queryByRole('button', { name: 'Remove from canvas' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: `Actions for ${local.name}` }));
  await user.click(screen.getByRole('button', { name: 'Actions for Approved PC' }));
  await user.click(screen.getByRole('button', { name: 'Remove from canvas' }));
  expect(screen.queryByRole('article', { name: 'Approved PC' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Inspect Approved PC' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: `Add device near ${local.name}` }));
  await user.click(screen.getByRole('button', { name: 'Add Approved PC to canvas' }));
  await user.click(screen.getByRole('button', { name: `Add device near ${local.name}` }));
  const empty = screen.getByRole('complementary', { name: 'Cluster panel' });
  expect(
    within(empty).queryByRole('button', { name: 'Add Approved PC to canvas' }),
  ).not.toBeInTheDocument();
  await user.click(within(empty).getByRole('button', { name: 'Add device in Connections' }));
  expect(screen.getByRole('tabpanel', { name: 'Add device' })).toBeVisible();
});

it('disables remote removal while a model is loading or running', async () => {
  const user = userEvent.setup();
  const model = createDemoLibrary().models[0]!;
  const props = {
    demo: true,
    joining: createDemoJoining(),
    onJoining: vi.fn(),
    devices: demoDevices,
    onRenameDevice: vi.fn(),
    models: [],
    placement: createDemoPlacement(null),
    dispatch: vi.fn(),
    onStop: vi.fn(),
  };
  const runtime = { loading: false, onChoose: vi.fn(), onRun: vi.fn() };
  const view = render(<ClusterPage {...props} activeModel={undefined} localRuntime={runtime} />);
  await user.click(screen.getByRole('button', { name: 'Actions for ml-workstation' }));
  expect(screen.getByRole('button', { name: 'Remove from canvas' })).toBeEnabled();
  view.rerender(<ClusterPage {...props} activeModel={model} localRuntime={runtime} />);
  expect(screen.getByRole('button', { name: 'Remove from canvas' })).toBeDisabled();
  view.rerender(
    <ClusterPage {...props} activeModel={undefined} localRuntime={{ ...runtime, loading: true }} />,
  );
  expect(screen.getByRole('button', { name: 'Remove from canvas' })).toBeDisabled();
  view.rerender(<ClusterPage {...props} activeModel={undefined} localRuntime={runtime} />);
  expect(screen.getByRole('button', { name: 'Remove from canvas' })).toBeEnabled();
});

it('keeps device details collapsed and uses the header back control and outer panel toggle', async () => {
  const user = userEvent.setup();
  render(<Cluster />);
  await user.click(screen.getByRole('button', { name: 'Select studio-desktop' }));
  let panel = screen.getByRole('complementary', { name: 'Cluster panel' });
  const title = within(panel).getByRole('heading', { name: 'studio-desktop' });
  const back = within(panel).getByRole('button', { name: 'Back to cluster overview' });
  expect(back.closest('header')).toBe(title.closest('header'));
  expect(back.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(panel).getByText('Sample device · Coordinator')).toBeVisible();
  expect(
    within(panel).queryByRole('button', { name: 'Close cluster panel' }),
  ).not.toBeInTheDocument();
  const disclosure = within(panel).getByText('Device details').closest('details')!;
  const summary = within(disclosure).getByText('Device details').closest('summary')!;
  expect(disclosure).not.toHaveAttribute('open');
  expect(within(disclosure).getByText('OS')).not.toBeVisible();
  summary.focus();
  expect(summary).toHaveFocus();
  await user.click(summary);
  expect(disclosure).toHaveAttribute('open');
  for (const name of ['OS', 'Address', 'Connection']) {
    expect(within(disclosure).getByText(name)).toBeVisible();
  }
  await user.click(summary);
  expect(disclosure).not.toHaveAttribute('open');
  await user.click(back);
  expect(within(panel).getByRole('heading', { name: 'Cluster overview' })).toBeVisible();
  const toggle = screen.getByRole('button', { name: 'Cluster panel' });
  await user.click(toggle);
  expect(screen.queryByRole('complementary', { name: 'Cluster panel' })).not.toBeInTheDocument();
  await user.click(toggle);
  panel = screen.getByRole('complementary', { name: 'Cluster panel' });
  expect(within(panel).getByRole('heading', { name: 'Cluster overview' })).toBeVisible();
});

it('shows a different running model without repeating the selected model when it is ready', async () => {
  const user = userEvent.setup();
  const models = createDemoLibrary().models;
  const selected = models[0]!;
  const other = models[1]!;
  const view = render(<Cluster selectedId={selected.id} />);
  await user.click(screen.getByRole('button', { name: 'Cluster panel' }));
  let panel = screen.getByRole('complementary', { name: 'Cluster panel' });
  expect(within(panel).getByText(selected.name)).toBeVisible();
  expect(within(panel).queryByText('Running model')).not.toBeInTheDocument();
  view.rerender(<Cluster selectedId={selected.id} activeId={other.id} />);
  panel = screen.getByRole('complementary', { name: 'Cluster panel' });
  expect(within(panel).getByText('Running model')).toBeVisible();
  expect(within(panel).getByText(other.name)).toBeVisible();
  view.rerender(<Cluster selectedId={selected.id} activeId={selected.id} />);
  panel = screen.getByRole('complementary', { name: 'Cluster panel' });
  expect(within(panel).getByText(/Ready/)).toBeVisible();
  expect(within(panel).getAllByText(selected.name)).toHaveLength(1);
  expect(within(panel).queryByText('Running model')).not.toBeInTheDocument();
});

it('navigates distinct Cluster views and retains the canvas across navigation', async () => {
  const user = userEvent.setup();
  render(<Cluster />);
  const navigation = screen.getByRole('navigation', { name: 'Cluster navigation' });
  const canvas = screen.getByRole('region', { name: 'Cluster canvas' });
  const controls = screen.getByRole('group', { name: 'Canvas controls' });
  await user.click(within(navigation).getByRole('button', { name: 'Devices' }));
  expect(screen.getByRole('heading', { name: 'Devices' })).toBeVisible();
  expect(canvas).not.toBeVisible();
  await user.click(within(navigation).getByRole('button', { name: /^Connections/u }));
  expect(screen.getByRole('heading', { name: /^Connections/u })).toBeVisible();
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
  await user.click(within(navigation).getByRole('button', { name: /^Connections/u }));
  expect(screen.getByText('Example requests · approval is simulated.')).toBeVisible();
  await user.click(
    screen.getByRole('button', { name: 'Approve invitation from render-coordinator' }),
  );
  await user.click(screen.getByRole('button', { name: 'Decline join request from office-pc' }));
  expect(within(navigation).getByRole('button', { name: /^Connections/u })).toHaveTextContent(
    'Connections',
  );
  expect(
    screen.getByText('No device is connected or granted access by these demo actions.'),
  ).toBeVisible();
});

it('shows honest unavailable networking views without demo peers in ordinary builds', async () => {
  const user = userEvent.setup();
  render(<Cluster demo={false} />);
  const navigation = screen.getByRole('navigation', { name: 'Cluster navigation' });
  await user.click(within(navigation).getByRole('button', { name: /^Connections/u }));
  await user.click(screen.getByRole('tab', { name: 'Add device' }));
  expect(screen.getByRole('tabpanel', { name: 'Add device' })).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Private address' })).toBeDisabled();
  expect(screen.queryByText('office-pc')).not.toBeInTheDocument();
  await user.click(within(navigation).getByRole('button', { name: /^Connections/u }));
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
