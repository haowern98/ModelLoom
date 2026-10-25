import { render, screen } from '@testing-library/react';
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
it('shows last measured bandwidth and current latency for a local peer connection', () => {
  render(<ConnectionDetails from={demoDevices[0]} to={{ ...demoDevices[1]!, telemetry }} />);
  expect(screen.getByText('4.2 ms')).toBeInTheDocument();
  expect(screen.getByText('14.3 MiB/s')).toBeInTheDocument();
  expect(screen.getByText('Last measured bandwidth')).toBeInTheDocument();
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

it('updates measurements when the inventory publishes a newer sample', () => {
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
  expect(screen.getByText('Testing connection while idle...')).toBeInTheDocument();
});
it('reports a disconnected endpoint without retaining its old measurement', () => {
  render(<ConnectionDetails from={demoDevices[0]} to={undefined} />);
  expect(screen.getByText('Disconnected')).toBeInTheDocument();
  expect(screen.queryByText('4.2 ms')).not.toBeInTheDocument();
});

it('labels retained latency as historical and transfer direction from the local PC', () => {
  render(
    <ConnectionDetails
      from={{ ...demoDevices[1]!, telemetry: { ...telemetry, state: 'unavailable' } }}
      to={demoDevices[0]}
    />,
  );
  expect(screen.getByText('Last latency')).toBeInTheDocument();
  expect(
    screen.getByText('Control connection round-trip, including connection setup.'),
  ).toBeInTheDocument();
  expect(screen.getByText('Sending from this PC')).toBeInTheDocument();
  expect(screen.getByText('Receiving on this PC')).toBeInTheDocument();
});
