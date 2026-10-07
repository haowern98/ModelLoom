import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DeviceCard } from './DeviceCard';
import { demoDevices } from '../../mocks/cluster';
it('shows full offload only after the local runtime is ready without inventing layer ranges', () => {
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
  expect(screen.getByText('Full GPU offload')).toBeInTheDocument();
  expect(screen.queryByText('Unassigned')).not.toBeInTheDocument();
});
