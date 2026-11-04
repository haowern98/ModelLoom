import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { ConnectionDetails } from './ConnectionDetails';
import { demoDevices } from '../../mocks/cluster';
const telemetry = {
  state: 'idle' as const,
  latencyMs: 4.2,
  latencyMeasuredAt: 1,
  uploadMbps: 120,
  downloadMbps: 95,
  bandwidthMeasuredAt: 1,
  sendingBytesPerSecond: 2048,
  receivingBytesPerSecond: 4096,
};
// jsdom has no layout, so the SDK treats positioned tooltips as detached.
// Check their content/lifecycle here; Playwright verifies actual visibility.
it('shows last measured bandwidth and current latency for a local peer connection', async () => {
  const user = userEvent.setup();
  render(<ConnectionDetails from={demoDevices[0]} to={{ ...demoDevices[1]!, telemetry }} />);
  expect(screen.getByText('4.2 ms')).toBeInTheDocument();
  expect(screen.getByText('14.3 MiB/s')).toBeInTheDocument();
  await user.tab();
  await user.tab();
  expect(screen.getByRole('button', { name: 'About bandwidth' })).toHaveFocus();
  expect(await screen.findByRole('tooltip', { hidden: true })).toHaveTextContent(
    'Last measured bandwidth',
  );
});
it('shows actual transfer rates while inference is active', () => {
  render(
    <ConnectionDetails
      from={demoDevices[0]}
      to={{ ...demoDevices[1]!, telemetry: { ...telemetry, state: 'active' } }}
    />,
  );
  expect(screen.getByText('2.0 KiB/s')).toBeInTheDocument();
  expect(screen.queryByText('120.0 Mbps')).not.toBeInTheDocument();
});
it('keeps bandwidth and live transfer in the same byte units at the same actual speed', () => {
  const { rerender } = render(
    <ConnectionDetails from={demoDevices[0]} to={{ ...demoDevices[1]!, telemetry }} />,
  );
  expect(screen.getByText('14.3 MiB/s')).toBeInTheDocument();
  rerender(
    <ConnectionDetails
      from={demoDevices[0]}
      to={{
        ...demoDevices[1]!,
        telemetry: {
          ...telemetry,
          state: 'active',
          sendingBytesPerSecond: (120 * 1000000) / 8,
        },
      }}
    />,
  );
  expect(screen.getByText('14.3 MiB/s')).toBeInTheDocument();
});
it('does not imply a direct connection between two remote devices', () => {
  render(
    <ConnectionDetails
      from={{ ...demoDevices[1]!, id: 'peer:a', telemetry }}
      to={{ ...demoDevices[1]!, id: 'peer:b', telemetry }}
    />,
  );
  expect(screen.getByText('Canvas placement only')).toBeInTheDocument();
  expect(screen.queryByText('4.2 ms')).not.toBeInTheDocument();
});

it('updates measurements when the inventory publishes a newer sample', async () => {
  const user = userEvent.setup();
  const { rerender } = render(
    <ConnectionDetails from={demoDevices[0]} to={{ ...demoDevices[1]!, telemetry }} />,
  );
  rerender(
    <ConnectionDetails
      from={demoDevices[0]}
      to={{ ...demoDevices[1]!, telemetry: { ...telemetry, latencyMs: 8, state: 'testing' } }}
    />,
  );
  expect(screen.getByText('8.0 ms')).toBeInTheDocument();
  await user.tab();
  await user.tab();
  expect(await screen.findByRole('tooltip', { hidden: true })).toHaveTextContent(
    'Testing connection while idle...',
  );
});
it('reports a disconnected endpoint without retaining its old measurement', () => {
  render(<ConnectionDetails from={demoDevices[0]} to={undefined} />);
  expect(screen.getByText('Disconnected')).toBeInTheDocument();
  expect(screen.queryByText('4.2 ms')).not.toBeInTheDocument();
});

it('labels retained latency as historical and transfer direction from the local PC', async () => {
  const user = userEvent.setup();
  render(
    <ConnectionDetails
      from={{ ...demoDevices[1]!, telemetry: { ...telemetry, state: 'unavailable' } }}
      to={demoDevices[0]}
    />,
  );
  expect(screen.getByText('Last latency')).toBeInTheDocument();
  await user.tab();
  expect(await screen.findByRole('tooltip', { hidden: true })).toHaveTextContent(
    'Control connection round-trip, including connection setup.',
  );
  expect(screen.getByText('Sending from this PC')).toBeInTheDocument();
  expect(screen.getByText('Receiving on this PC')).toBeInTheDocument();
});

it('puts latency and live-transfer explanations in dismissible information tooltips', async () => {
  const user = userEvent.setup();
  render(
    <ConnectionDetails
      from={demoDevices[0]}
      to={{ ...demoDevices[1]!, telemetry: { ...telemetry, state: 'active' } }}
    />,
  );
  expect(
    screen.queryByText('Control connection round-trip, including connection setup.'),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText('Application traffic during loading and inference.'),
  ).not.toBeInTheDocument();
  await user.tab();
  expect(screen.getByRole('button', { name: 'About latency' })).toHaveFocus();
  expect(await screen.findByRole('tooltip', { hidden: true })).toHaveTextContent(
    'Control connection round-trip',
  );
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('tooltip', { hidden: true })).not.toBeInTheDocument();
  await user.tab();
  expect(screen.getByRole('button', { name: 'About live transfer rate' })).toHaveFocus();
  expect(await screen.findByRole('tooltip', { hidden: true })).toHaveTextContent(
    'Application traffic during loading and inference.',
  );
  expect(screen.getByText('2.0 KiB/s')).toBeVisible();
});
