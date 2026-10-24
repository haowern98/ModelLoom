import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { demoDevices } from '../../mocks/cluster';
import { DeviceInventory } from './DeviceInventory';
import { ClusterSidebar } from './ClusterSidebar';

it('distinguishes this PC from a shared remote PC in the sidebar and inventory', () => {
  const coordinator = {
    ...demoDevices.find((device) => device.role === 'Coordinator')!,
    id: 'local',
    role: 'Worker' as const,
  };
  const worker = {
    ...demoDevices.find((device) => device.role === 'Worker')!,
    role: 'Coordinator' as const,
  };
  render(
    <>
      <ClusterSidebar
        view="devices"
        onNavigate={() => {}}
        devices={[coordinator, worker]}
        onSelect={() => {}}
        pendingRequests={0}
        local
      />
      <DeviceInventory devices={[coordinator, worker]} demo={false} local />
    </>,
  );
  const remoteButton = screen.getByRole('button', { name: `Inspect ${worker.name}` });
  expect(within(remoteButton).queryByText('This device')).not.toBeInTheDocument();
  expect(within(remoteButton).getByText('Coordinator')).toBeVisible();
  const remoteInventory = screen.getByRole('article', { name: worker.name });
  expect(within(remoteInventory).queryByText('This device')).not.toBeInTheDocument();
  expect(within(remoteInventory).getByText('Approved remote device')).toBeVisible();
});

it('shows every supplied PC with plain hardware rows and no details actions', () => {
  const { container } = render(<DeviceInventory devices={demoDevices} demo local={false} />);
  expect(screen.getAllByRole('article')).toHaveLength(demoDevices.length);
  for (const device of demoDevices) {
    const pc = within(screen.getByRole('article', { name: device.name }));
    expect(pc.getByRole('heading', { name: device.name })).toBeVisible();
    for (const hardware of device.hardware) {
      expect(pc.getByText(hardware.name, { exact: true })).toBeVisible();
    }
  }
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(container.querySelector('svg')).toBeNull();
});

it('reports unknown fields instead of inventing local memory or backend support', () => {
  render(<DeviceInventory devices={[{ ...demoDevices[0]!, id: 'local' }]} demo={false} local />);
  expect(screen.getByText('This device', { exact: true })).toBeVisible();
  expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0);
  expect(screen.queryByText(/Not reported:/)).not.toBeInTheDocument();
  expect(screen.queryByText('Connected', { exact: true })).not.toBeInTheDocument();
  expect(screen.queryByText(/CUDA|Metal|Vulkan/)).not.toBeInTheDocument();
});

it('renders supplied facts per PC and per GPU without a blanket missing-fields note', () => {
  const device = {
    ...demoDevices[0]!,
    os: 'Microsoft Windows 11 Home · 24H2 · Build 26100.7623',
    inventory: {
      architecture: 'AMD64',
      installedRamBytes: 32 * 2 ** 30,
      availableRamBytes: 12 * 2 ** 30,
      usableRamBytes: 31.7 * 2 ** 30,
      runtimeBackends: ['cuda (b10964)'],
      sampledAt: Date.now(),
      gpus: [
        {
          id: 'gpu-0',
          name: 'Real GPU',
          pciVendorId: '10de',
          totalMemoryBytes: 16 * 2 ** 30,
          availableMemoryBytes: 9 * 2 ** 30,
          driverVersion: '570.00',
        },
      ],
    },
  };
  render(<DeviceInventory devices={[device]} demo={false} local />);
  expect(screen.getByText(device.os)).toBeVisible();
  expect(screen.getByText('AMD64')).toBeVisible();
  expect(screen.getByText('32.0 GiB')).toBeVisible();
  expect(screen.getByText('9.0 GiB')).toBeVisible();
  expect(screen.getByText('570.00')).toBeVisible();
  expect(screen.getByText('cuda (b10964)')).toBeVisible();
  expect(screen.queryByText(/Not reported:/)).not.toBeInTheDocument();
});

it('excludes unsupported, virtual and disabled GPUs and renumbers the remaining cards', () => {
  const device = {
    ...demoDevices[0]!,
    inventory: {
      sampledAt: Date.now(),
      gpus: [
        { id: 'gpu-0', name: 'Virtual display' },
        { id: 'gpu-1', name: 'Intel GPU', pciVendorId: '8086' },
        { id: 'gpu-2', name: 'Disabled GPU', pciVendorId: '10de', enabled: false },
        { id: 'gpu-3', name: 'AMD GPU', pciVendorId: '1002', enabled: true },
      ],
    },
  };
  const { rerender } = render(<DeviceInventory devices={[device]} demo={false} local />);
  expect(screen.getByText('AMD GPU')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'GPU' })).toBeVisible();
  for (const name of ['Virtual display', 'Intel GPU', 'Disabled GPU'])
    expect(screen.queryByText(name)).not.toBeInTheDocument();
  rerender(
    <DeviceInventory
      devices={[{ ...device, inventory: { ...device.inventory, gpus: [] } }]}
      demo={false}
      local
    />,
  );
  expect(screen.queryByText('AMD GPU')).not.toBeInTheDocument();
  expect(screen.getByText('No enabled AMD or NVIDIA GPU detected')).toBeVisible();
});

it('groups hardware underneath each PC and omits the last-checked timestamp', () => {
  const device = {
    ...demoDevices[0]!,
    inventory: { sampledAt: Date.now(), architecture: 'x86_64' },
  };
  render(<DeviceInventory devices={[device, demoDevices[1]!]} demo local={false} />);
  const pcs = screen.getAllByRole('article');
  expect(pcs).toHaveLength(2);
  const pc = within(pcs[0]!);
  for (const name of ['System', 'CPU', 'Memory', 'GPU 0', 'GPU 1']) {
    expect(pc.getByRole('region', { name })).toBeVisible();
  }
  expect(pc.getByText('x86_64')).toBeVisible();
  expect(screen.queryByText(/Last checked:/)).not.toBeInTheDocument();
});

it('shows Apple unified memory once without counting it as separate VRAM', () => {
  const mac = demoDevices.find((device) => device.id === 'mac');
  if (!mac) throw new Error('Missing Mac fixture');
  render(<DeviceInventory devices={[mac]} demo local={false} />);
  expect(screen.getByText('192 GB unified memory', { exact: true })).toBeVisible();
  expect(screen.getByText('Unified memory', { selector: 'dt' })).toBeVisible();
  expect(screen.queryByText(/VRAM/, { selector: 'dt' })).not.toBeInTheDocument();
});
