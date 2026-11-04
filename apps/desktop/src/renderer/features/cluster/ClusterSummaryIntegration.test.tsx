import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ClusterPage } from './ClusterPage';
import { demoDevices, createDemoPlacement } from '../../mocks/cluster';
import { createDemoLibrary } from '../../mocks/modelLibrary';
import { createDemoJoining } from '../../mocks/clusterJoining';

function fixture(remote = false) {
  const model = createDemoLibrary().models[0]!;
  const local = { ...demoDevices[0]!, id: 'local' };
  const peer = { ...demoDevices[1]!, id: 'peer:approved', name: 'Approved PC' };
  const dispatch = vi.fn();
  const onRun = vi.fn();
  const onStop = vi.fn();
  render(
    <ClusterPage
      demo={false}
      joining={createDemoJoining()}
      onJoining={vi.fn()}
      devices={remote ? [local, peer] : [local]}
      onRenameDevice={vi.fn()}
      models={[model]}
      activeModel={undefined}
      placement={createDemoPlacement(model.id)}
      dispatch={dispatch}
      onStop={onStop}
      localRuntime={{ loading: false, onChoose: vi.fn(), onRun }}
    />,
  );
  return { local, peer, model, dispatch, onRun, onStop };
}

it('keeps the summary visible and highlights its device row without editing or loading', async () => {
  const user = userEvent.setup();
  const { local, dispatch, onRun, onStop } = fixture();
  await user.click(screen.getByRole('button', { name: `Select ${local.name}` }));
  const panel = screen.getByRole('complementary', { name: 'Cluster panel' });
  await waitFor(() =>
    expect(within(panel).getByRole('heading', { name: 'Cluster overview' })).toBeVisible(),
  );
  expect(within(panel).getByText('Model file size')).toBeVisible();
  expect(within(panel).getByText('Configured context')).toBeVisible();
  expect(within(panel).queryByRole('spinbutton')).not.toBeInTheDocument();
  expect(
    within(panel).queryByRole('button', { name: 'Back to cluster overview' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('article', { name: local.name })).toHaveAttribute(
    'data-selected',
    'true',
  );
  const assignment = within(panel).getByRole('group', {
    name: `Layer assignment for ${local.name}`,
  });
  expect(assignment).toHaveAttribute('aria-current', 'true');
  expect(dispatch).not.toHaveBeenCalled();
  expect(onRun).not.toHaveBeenCalled();
  expect(onStop).not.toHaveBeenCalled();
});

it('adds a peer inline below assignments, leaves it unassigned and keeps the overview open', async () => {
  const user = userEvent.setup();
  const { local, peer, dispatch, onRun } = fixture(true);
  await user.click(screen.getByRole('button', { name: `Add device near ${local.name}` }));
  const panel = screen.getByRole('complementary', { name: 'Cluster panel' });
  await waitFor(() =>
    expect(within(panel).getByRole('heading', { name: 'Cluster overview' })).toBeVisible(),
  );
  const picker = within(panel).getByRole('region', { name: 'Add device' });
  const assignments = within(panel).getByRole('heading', { name: 'Layer assignment' });
  expect(
    assignments.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  await user.click(within(picker).getByRole('button', { name: `Add ${peer.name} to canvas` }));
  expect(screen.getByRole('article', { name: peer.name })).toBeVisible();
  expect(within(panel).queryByRole('region', { name: 'Add device' })).not.toBeInTheDocument();
  expect(
    within(panel).getByRole('group', { name: `Layer assignment for ${peer.name}` }),
  ).toHaveTextContent('No assignment');
  expect(within(panel).getByText('2 devices · 3 GPUs')).toBeVisible();
  expect(dispatch).not.toHaveBeenCalled();
  expect(onRun).not.toHaveBeenCalled();
});
