import '@testing-library/jest-dom/vitest';
import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { ClusterPanel } from './ClusterPanel';

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});
afterAll(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
});

async function show(proposer = true, device = 'cpu', sharedPlacement = false) {
  const onProposerDevice = vi.fn();
  render(
    <ClusterPanel
      id="cluster"
      local
      selection={{ type: 'overview' }}
      devices={[]}
      activeModel={undefined}
      selectedModel={undefined}
      loading={false}
      editingDisabled={false}
      canvasMutationDisabled={false}
      ranges={[]}
      contextLabel="—"
      assignmentStates={{}}
      panelRef={createRef()}
      onClose={vi.fn()}
      onOverview={vi.fn()}
      canvasCandidates={[]}
      onAddToCanvas={vi.fn()}
      onAddDevice={vi.fn()}
      speculation={{
        enabled: true,
        method: 'MTP',
        retrieval: !proposer,
        proposer,
        device,
        devices: sharedPlacement ? [] : [{ value: 'cpu', label: 'This PC CPU' }],
        ...(sharedPlacement
          ? { placementNote: 'This head follows the target output placement.' }
          : {}),
        onDevice: onProposerDevice,
      }}
    />,
  );
  await userEvent.setup().click(screen.getByRole('button', { name: 'Speculative workload' }));
  return onProposerDevice;
}
it('changes proposer placement without a separate Save control', async () => {
  const change = await show();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'This PC CPU' }));
  await user.click(screen.getByRole('option', { name: 'Automatic' }));
  expect(change).toHaveBeenCalledWith('auto');
  expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
});
it('retains an unavailable selected device', async () => {
  await show(true, 'GPU-missing');
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Selected device unavailable' }));
  expect(screen.getByRole('option', { name: 'Selected device unavailable' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
});
it('keeps retrieval on CPU without a GPU placement selector', async () => {
  await show(false);
  expect(
    screen.queryByRole('button', { name: /Automatic|This PC CPU|Selected device unavailable/ }),
  ).not.toBeInTheDocument();
  expect(screen.getByText('CPU retrieval')).toBeInTheDocument();
});

it('explains shared head placement without offering an independent device', async () => {
  await show(true, 'cpu', true);
  expect(screen.getByText('This head follows the target output placement.')).toBeVisible();
  expect(
    screen.queryByRole('button', { name: /Automatic|This PC CPU|Selected device unavailable/ }),
  ).not.toBeInTheDocument();
});
