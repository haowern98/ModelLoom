import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DeviceCard } from './DeviceCard';
import { demoDevices } from '../../mocks/cluster';
it('never infers per-device full offload from model readiness alone', () => {
  const props = {
    device: demoDevices[1]!,
    ranges: [],
    appliedRanges: [],
    layerCount: 64,
    loading: false,
    proposed: false,
    active: false,
    selected: false,
    alwaysShowAdd: false,
    onAdd: vi.fn(),
    onDetails: vi.fn(),
    onRename: vi.fn(),
    onEdit: vi.fn(),
    localReady: false,
  };
  const { rerender } = render(<DeviceCard {...props} />);
  expect(screen.getByText('Unassigned')).toBeInTheDocument();
  rerender(<DeviceCard {...props} localReady />);
  expect(screen.queryByText('Full GPU offload')).not.toBeInTheDocument();
  expect(screen.getByText('Unassigned')).toBeInTheDocument();
  rerender(
    <DeviceCard
      {...props}
      ranges={[{ hardwareId: 'workstation-gpu', first: 48, last: 63 }]}
      proposed
      active
    />,
  );
  expect(screen.getByText('Planned layers 48 – 63')).toBeInTheDocument();
  expect(screen.queryByText('In use')).not.toBeInTheDocument();
});
