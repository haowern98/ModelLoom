import { act, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DeviceCard } from './DeviceCard';
import type { DemoDevice } from '../../mocks/cluster';

const device: DemoDevice = {
  id: 'local',
  name: 'Mac',
  role: 'Coordinator',
  os: 'macOS',
  address: 'This device',
  hardware: [
    {
      id: 'local-ioreg-1',
      name: 'Apple M4 GPU',
      label: 'GPU',
      detail: '',
      memoryGb: 0,
      kind: 'gpu',
    },
  ],
  inventory: {
    sampledAt: Date.now(),
    cpuUsagePercent: 20,
    diskReadBytesPerSecond: 0,
    diskWriteBytesPerSecond: 1048576,
    usableRamBytes: 16 * 2 ** 30,
    availableRamBytes: 8 * 2 ** 30,
    gpus: [
      {
        id: 'ioreg-1',
        name: 'Apple M4 GPU',
        vendor: 'apple',
        memoryKind: 'unified',
        utilizationPercent: 45,
        usedMemoryBytes: 2 * 2 ** 30,
      },
    ],
  },
};
const props = {
  device,
  ranges: [],
  appliedRanges: [],
  layerCount: 0,
  loading: false,
  proposed: false,
  active: false,
  selected: false,
  showAddHint: false,
  onAdd: vi.fn(),
  onDetails: vi.fn(),
  onRename: vi.fn(),
  onEdit: vi.fn(),
};

it.each(['1002', '10de'])(
  'binds %s readings to the physical GPU when a virtual adapter has no execution ID',
  (pciVendorId) => {
    const physical = {
      id: 'physical',
      name: 'Physical GPU',
      pciVendorId,
      utilizationPercent: 61,
      totalMemoryBytes: 8 * 2 ** 30,
      availableMemoryBytes: 6 * 2 ** 30,
    };
    render(
      <DeviceCard
        {...props}
        device={{
          ...device,
          hardware: [
            { ...device.hardware[0]!, id: 'local-physical', name: physical.name, memoryGb: 8 },
          ],
          inventory: {
            sampledAt: Date.now(),
            gpus: [{ id: 'virtual', name: 'Virtual display' }, physical],
          },
        }}
      />,
    );
    expect(screen.getByText('61%')).toBeVisible();
    expect(screen.getByText('2.0 / 8.0 GiB')).toBeVisible();
  },
);

it('shows real CPU/GPU activity and labels Apple allocation as unified memory', () => {
  render(<DeviceCard {...props} />);
  expect(screen.getByText('20%')).toBeVisible();
  expect(screen.getByText('45%')).toBeVisible();
  expect(screen.getByText(/R 0 B\/s · W 1.0 MiB\/s/u)).toBeVisible();
  expect(screen.getByText('Unified memory')).toBeVisible();
  expect(screen.getByText('2.0 GiB')).toBeVisible();
  expect(screen.queryByText('VRAM')).not.toBeInTheDocument();
});

it('hides stale utilization and memory instead of keeping old readings', () => {
  render(
    <DeviceCard
      {...props}
      device={{ ...device, inventory: { ...device.inventory!, sampledAt: Date.now() - 20000 } }}
    />,
  );
  expect(screen.queryByText('45%')).not.toBeInTheDocument();
  expect(screen.queryByText('20%')).not.toBeInTheDocument();
  expect(screen.queryByText('2.0 GiB')).not.toBeInTheDocument();
});

it('expires a disconnected sample without another inventory update and clears its display timer', () => {
  vi.useFakeTimers();
  try {
    const view = render(
      <DeviceCard
        {...props}
        device={{ ...device, inventory: { ...device.inventory!, sampledAt: Date.now() } }}
      />,
    );
    expect(screen.getByText('45%')).toBeVisible();
    act(() => {
      vi.advanceTimersByTime(16000);
    });
    expect(screen.queryByText('45%')).not.toBeInTheDocument();
    expect(screen.getByText('Unified memory')).toBeVisible();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
