import type * as MotionReact from 'motion/react';
import { createRef } from 'react';
import type { ComponentProps } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, it, vi } from 'vitest';
import { ClusterPanel } from './ClusterPanel';
import { demoDevices } from '../../mocks/cluster';
import { createDemoLibrary } from '../../mocks/modelLibrary';

vi.mock('motion/react', async (load) => ({
  ...(await load<typeof MotionReact>()),
  useReducedMotion: () => true,
}));
// The SDK scrolls the highlighted option; jsdom has no layout/scroll implementation.
const scrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
HTMLElement.prototype.scrollIntoView = vi.fn();
afterAll(() => {
  if (scrollIntoView)
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollIntoView);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
});

function props(): ComponentProps<typeof ClusterPanel> {
  return {
    id: 'summary',
    local: true,
    selection: { type: 'overview' },
    devices: [demoDevices[0]!],
    activeModel: undefined,
    selectedModel: createDemoLibrary().models[0],
    contextLabel: '8,192 tokens',
    loading: false,
    editingDisabled: false,
    canvasMutationDisabled: false,
    ranges: [],
    assignmentStates: {},
    panelRef: createRef(),
    onClose: vi.fn(),
    onOverview: vi.fn(),
    onModelConfiguration: vi.fn(),
    canvasCandidates: [],
    onAddToCanvas: vi.fn(),
    onAddDevice: vi.fn(),
    speculation: {
      enabled: true,
      method: 'MTP',
      proposer: true,
      retrieval: true,
      device: 'auto',
      devices: [{ value: 'cpu', label: 'This PC CPU' }],
      onDevice: vi.fn(),
    },
  };
}

it('keeps combined speculative workloads and placement in the summary without an enable toggle', async () => {
  const user = userEvent.setup();
  const input = props();
  render(<ClusterPanel {...input} />);
  const panel = screen.getByRole('complementary', { name: 'Cluster panel' });
  const disclosure = within(panel).getByRole('button', { name: 'Speculative workload' });
  expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  expect(within(panel).getByText('CPU retrieval')).not.toBeVisible();
  await user.click(disclosure);
  expect(within(panel).getByText('MTP', { exact: true })).toBeVisible();
  expect(within(panel).getByText('CPU retrieval')).toBeVisible();
  expect(within(panel).getByText('This PC · CPU')).toBeVisible();
  expect(within(panel).queryByRole('switch')).not.toBeInTheDocument();
  await user.click(within(panel).getByRole('button', { name: 'Automatic' }));
  await user.click(screen.getByRole('option', { name: 'This PC CPU' }));
  expect(input.speculation.onDevice).toHaveBeenCalledExactlyOnceWith('cpu');
  await user.click(within(panel).getByRole('button', { name: 'Model configuration' }));
  expect(input.onModelConfiguration).toHaveBeenCalledOnce();
  await user.click(within(panel).getByRole('button', { name: 'Speculative workload' }));
  expect(within(panel).getByText('CPU retrieval')).not.toBeVisible();
  expect(within(panel).getByRole('heading', { name: 'Layer assignment' })).toBeVisible();
});

it('locks target-linked heads and distinguishes configured and running models', async () => {
  const user = userEvent.setup();
  const input = props();
  input.activeModel = createDemoLibrary().models[1];
  input.speculation.placementNote = 'Follows target output placement';
  render(<ClusterPanel {...input} />);
  await user.click(screen.getByRole('button', { name: 'Speculative workload' }));
  expect(screen.getByText('Follows target')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Automatic' })).not.toBeInTheDocument();
  expect(screen.getByText('Currently running').parentElement).toHaveTextContent(
    input.activeModel!.name,
  );
  expect(screen.getByText('Configured context').parentElement).toHaveTextContent('8,192 tokens');
});

it('shows stale placement honestly and locks the selector during loading', async () => {
  const user = userEvent.setup();
  const input = props();
  input.loading = true;
  input.editingDisabled = true;
  input.speculation.device = 'missing-gpu';
  input.speculation.pendingHint = 'Save, then reload to apply.';
  render(<ClusterPanel {...input} />);
  await user.click(screen.getByRole('button', { name: 'Speculative workload' }));
  expect(screen.getByText('Loading…')).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('Selected device unavailable');
  expect(screen.getByText('Save, then reload to apply.')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Selected device unavailable' }));
  expect(screen.queryByRole('option')).not.toBeInTheDocument();
  expect(input.speculation.onDevice).not.toHaveBeenCalled();
});

it('starts connection details collapsed and keeps live measurements current across toggles', async () => {
  const user = userEvent.setup();
  const input = props();
  const worker = {
    ...demoDevices[1]!,
    telemetry: {
      state: 'active' as const,
      latencyMs: 4.2,
      latencyMeasuredAt: 1,
      uploadMbps: null,
      downloadMbps: null,
      bandwidthMeasuredAt: null,
      sendingBytesPerSecond: 2048,
      receivingBytesPerSecond: 4096,
    },
  };
  input.devices = [demoDevices[0]!, worker];
  input.selection = { type: 'connection', from: demoDevices[0]!.id, to: worker.id };
  const { rerender } = render(<ClusterPanel {...input} />);
  const disclosure = screen.getByRole('button', { name: 'Connection details' });
  expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByText('4.2 ms')).not.toBeVisible();
  disclosure.focus();
  await user.keyboard('{Enter}');
  expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText('4.2 ms')).toBeVisible();
  expect(screen.getByText('2.0 KiB/s')).toBeVisible();
  expect(screen.getByText('From').nextElementSibling).toHaveTextContent(demoDevices[0]!.name);
  expect(screen.getByText('To').nextElementSibling).toHaveTextContent(worker.name);
  expect(screen.queryByRole('heading', { name: 'Devices' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Connection' })).not.toBeInTheDocument();
  await user.click(disclosure);
  rerender(
    <ClusterPanel
      {...input}
      devices={[
        demoDevices[0]!,
        {
          ...worker,
          telemetry: { ...worker.telemetry, latencyMs: 8.5 },
        },
      ]}
    />,
  );
  expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await user.click(disclosure);
  expect(screen.getByText('8.5 ms')).toBeVisible();
  expect(input.speculation.onDevice).not.toHaveBeenCalled();
});
