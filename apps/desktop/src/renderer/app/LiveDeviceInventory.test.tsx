import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { App } from './App';

afterEach(() => {
  delete window.modelLoomRuntime;
});

it.each(['8086', undefined])(
  'keeps the CPU when GPU vendor identity is unsupported or unknown (%s)',
  async (pciVendorId) => {
    const user = userEvent.setup();
    window.modelLoomRuntime = {
      command: () =>
        Promise.resolve({
          enabled: true,
          model: null,
          phase: 'stopped',
          error: null,
          device: {
            name: 'cpu-only-pc',
            os: 'Observed OS',
            cpuName: 'Observed CPU',
            threads: 8,
            role: 'Coordinator',
            gpuName: 'NVIDIA name alone is insufficient',
            gpuMemoryGiB: 8,
            ...(pciVendorId
              ? {
                  inventory: {
                    sampledAt: Date.now(),
                    gpus: [{ id: 'gpu-0', name: 'Unsupported GPU', pciVendorId }],
                  },
                }
              : {}),
          },
        }),
    };
    render(<App />);
    await user.click(
      within(screen.getByRole('complementary', { name: 'Main navigation' })).getByRole('button', {
        name: 'Cluster',
      }),
    );
    const canvas = within(screen.getByRole('region', { name: 'Cluster canvas' }));
    expect(await canvas.findByRole('region', { name: 'cpu-only-pc CPU' })).toBeVisible();
    expect(canvas.queryByRole('heading', { name: /^GPU/ })).not.toBeInTheDocument();
    expect(canvas.queryByText('NVIDIA name alone is insufficient')).not.toBeInTheDocument();
    await user.click(
      within(screen.getByRole('navigation', { name: 'Cluster navigation' })).getByRole('button', {
        name: 'Devices',
      }),
    );
    const inventory = within(screen.getByRole('region', { name: 'Devices' }));
    expect(await inventory.findByText('Observed CPU')).toBeVisible();
  },
);

it('filters both GPU views and updates Devices when the observed GPU is disabled or enabled', async () => {
  const user = userEvent.setup();
  let gpuEnabled = true;
  window.modelLoomRuntime = {
    command: () =>
      Promise.resolve({
        enabled: true,
        model: null,
        phase: 'stopped',
        error: null,
        device: {
          name: 'observed-laptop',
          os: 'Microsoft Windows 11 Pro · 24H2 · Build 26100.7623',
          cpuName: 'Observed processor',
          threads: 12,
          role: 'Coordinator',
          inventory: {
            architecture: 'ARM64',
            cpuCores: 6,
            installedRamBytes: 16 * 2 ** 30,
            availableRamBytes: 7 * 2 ** 30,
            sampledAt: Date.now(),
            gpus: [
              {
                id: 'gpu-0',
                name: 'Observed integrated GPU',
                pciVendorId: '8086',
                driverVersion: '31.2',
              },
              {
                id: 'gpu-1',
                name: 'Observed discrete GPU',
                pciVendorId: '10de',
                enabled: gpuEnabled,
                totalMemoryBytes: 8 * 2 ** 30,
                availableMemoryBytes: 5 * 2 ** 30,
                driverVersion: '32.1',
              },
              { id: 'gpu-2', name: 'AMD physical GPU', pciVendorId: '1002' },
              { id: 'gpu-3', name: 'StarDesk Virtual Display Adapter' },
              { id: 'gpu-4', name: 'NVIDIA named adapter with unknown identity' },
            ],
          },
        },
      }),
  };
  render(<App />);
  await user.click(
    within(screen.getByRole('complementary', { name: 'Main navigation' })).getByRole('button', {
      name: 'Cluster',
    }),
  );
  const canvas = within(screen.getByRole('region', { name: 'Cluster canvas' }));
  expect(await canvas.findByText('Observed discrete GPU')).toBeVisible();
  expect(canvas.getByText('AMD physical GPU')).toBeVisible();
  expect(canvas.getByRole('region', { name: 'observed-laptop CPU' })).toBeVisible();
  expect(canvas.queryByText('Observed integrated GPU')).not.toBeInTheDocument();
  expect(canvas.queryByText('StarDesk Virtual Display Adapter')).not.toBeInTheDocument();
  expect(canvas.queryByText('NVIDIA named adapter with unknown identity')).not.toBeInTheDocument();
  expect(canvas.getByText('GPU 0')).toBeVisible();
  expect(canvas.getByText('GPU 1')).toBeVisible();
  await user.click(
    within(screen.getByRole('navigation', { name: 'Cluster navigation' })).getByRole('button', {
      name: 'Devices',
    }),
  );
  const inventory = within(screen.getByRole('region', { name: 'Devices' }));
  expect(await inventory.findByText('ARM64')).toBeVisible();
  expect(inventory.getByText('Observed processor')).toBeVisible();
  expect(inventory.getByText('6 cores · 12 threads')).toBeVisible();
  expect(inventory.getByText('Microsoft Windows 11 Pro · 24H2 · Build 26100.7623')).toBeVisible();
  expect(inventory.queryByText('Observed integrated GPU')).not.toBeInTheDocument();
  expect(inventory.queryByText('StarDesk Virtual Display Adapter')).not.toBeInTheDocument();
  expect(inventory.getByText('Observed discrete GPU')).toBeVisible();
  expect(inventory.getByText('5.0 GiB')).toBeVisible();
  expect(screen.queryByText(/Not reported:/)).not.toBeInTheDocument();
  gpuEnabled = false;
  await waitFor(() =>
    expect(inventory.queryByText('Observed discrete GPU')).not.toBeInTheDocument(),
  );
  expect(canvas.queryByText('Observed discrete GPU')).not.toBeInTheDocument();
  expect(inventory.getByText('AMD physical GPU')).toBeVisible();
  gpuEnabled = true;
  expect(await inventory.findByText('Observed discrete GPU')).toBeVisible();
});
