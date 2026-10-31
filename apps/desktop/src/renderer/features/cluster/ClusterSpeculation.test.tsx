import '@testing-library/jest-dom/vitest';
import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ClusterPanel } from './ClusterPanel';
import { createDemoJoining } from '../../mocks/clusterJoining';

function show(proposer = true, device = 'cpu', sharedPlacement = false) {
  const onProposerDevice = vi.fn();
  render(
    <ClusterPanel
      id="cluster"
      demo={false}
      joining={createDemoJoining()}
      onJoining={vi.fn()}
      selection={{ type: 'speculation' }}
      devices={[]}
      activeModel={undefined}
      selectedModel={undefined}
      loading={false}
      editingDisabled={false}
      canvasMutationDisabled={false}
      inputs={[]}
      layerCount={0}
      assignmentStates={{}}
      canPlace={false}
      panelRef={createRef()}
      onClose={vi.fn()}
      onOverview={vi.fn()}
      onSelect={vi.fn()}
      onDeviceDetails={vi.fn()}
      onEdit={vi.fn()}
      onStartRename={vi.fn()}
      onCancelRename={vi.fn()}
      onRename={vi.fn()}
      speculation={{
        enabled: true,
        summary: 'MTP',
        proposer,
        device,
        devices: sharedPlacement ? [] : [{ value: 'cpu', label: 'This PC CPU' }],
        ...(sharedPlacement
          ? { placementNote: 'This head follows the target output placement in this runtime.' }
          : {}),
        onDevice: onProposerDevice,
      }}
    />,
  );
  return onProposerDevice;
}
it('changes proposer placement without a separate Save control', async () => {
  const change = show();
  const user = userEvent.setup();
  await user.click(screen.getByRole('combobox', { name: 'Execution device' }));
  await user.click(screen.getByRole('option', { name: 'Automatic' }));
  expect(change).toHaveBeenCalledWith('auto');
  expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
});
it('retains an unavailable selected device', async () => {
  show(true, 'GPU-missing');
  await userEvent.setup().click(screen.getByRole('combobox', { name: 'Execution device' }));
  expect(screen.getByRole('option', { name: 'Selected device unavailable' })).toBeDisabled();
});
it('keeps retrieval on CPU without a GPU placement selector', () => {
  show(false);
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(screen.getByText('CPU retrieval')).toBeInTheDocument();
});

it('explains shared head placement and retains an incompatible saved device as unavailable', async () => {
  show(true, 'cpu', true);
  expect(
    screen.getByText('This head follows the target output placement in this runtime.'),
  ).toBeVisible();
  await userEvent.setup().click(screen.getByRole('combobox', { name: 'Execution device' }));
  expect(screen.getByRole('option', { name: 'Automatic' })).toBeEnabled();
  expect(screen.getByRole('option', { name: 'Selected device unavailable' })).toBeDisabled();
  expect(screen.queryByRole('option', { name: 'This PC CPU' })).toBeNull();
});
