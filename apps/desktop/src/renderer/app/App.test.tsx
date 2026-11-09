import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { RuntimeCommand, RuntimeView } from '../../shared/runtime';
import type { CatalogSnapshot } from '../../shared/runtime-catalog';

afterEach(() => {
  delete window.modelLoomRuntime;
  delete window.modelLoomRuntimeCatalog;
  localStorage.removeItem('modelloom.runtimeSetup');
  localStorage.removeItem('modelloom.device-display-names');
});

it('routes first-launch runtime setup through the desktop catalog bridge', async () => {
  const build = {
    packageId: 'fixture-vulkan',
    version: 'b11306',
    artifact: 'fixture',
    platform: 'win32',
    arch: 'x64',
    backend: 'vulkan',
    upstreamCommit: 'a'.repeat(40),
  } as const;
  const snapshot: CatalogSnapshot = {
    installed: [],
    selected: null,
    offers: [{ build, size: '1 MB' }],
  };
  const command = vi.fn<NonNullable<Window['modelLoomRuntimeCatalog']>['command']>((input) => {
    if (input.action === 'install') snapshot.installed = [build];
    if (input.action === 'select') snapshot.selected = build;
    return Promise.resolve(structuredClone(snapshot));
  });
  window.modelLoomRuntimeCatalog = { command };
  const user = userEvent.setup();
  render(<App />);
  const setup = await screen.findByRole('dialog', { name: 'Set up a runtime' });
  await user.click(await within(setup).findByRole('button', { name: 'Download Vulkan' }));
  expect(command.mock.calls.map(([input]) => input)).toEqual([
    { action: 'read' },
    { action: 'read' },
    { action: 'install', backend: 'vulkan' },
    { action: 'select', backend: 'vulkan' },
  ]);
  expect(setup).not.toBeInTheDocument();
  expect(localStorage.getItem('modelloom.runtimeSetup')).toBe('done');
});

it('restores a live device display name after reopening without sending any runtime writes', async () => {
  const user = userEvent.setup();
  const device: NonNullable<RuntimeView['device']> = {
    name: 'Original hostname',
    os: 'Windows',
    cpuName: 'Test CPU',
    threads: 8,
    role: 'Coordinator',
  };
  const command = vi.fn<(input: RuntimeCommand) => Promise<RuntimeView>>().mockResolvedValue({
    enabled: true,
    model: null,
    phase: 'stopped',
    error: null,
    device,
  });
  window.modelLoomRuntime = { command };
  const first = render(<App />);
  await user.click(screen.getByRole('button', { name: 'Cluster' }));
  await user.click(await screen.findByRole('button', { name: 'Actions for Original hostname' }));
  await user.click(screen.getByRole('menuitem', { name: 'Rename device' }));
  const input = screen.getByRole('textbox', { name: 'Device name' });
  await user.clear(input);
  await user.type(input, 'My laptop');
  await user.click(screen.getByRole('button', { name: 'Save name' }));
  expect(await screen.findByRole('article', { name: 'My laptop' })).toBeVisible();
  first.unmount();
  device.name = 'Updated hostname';
  render(<App />);
  await user.click(screen.getByRole('button', { name: 'Cluster' }));
  expect(await screen.findByRole('article', { name: 'My laptop' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Inspect My laptop' })).toBeVisible();
  expect(
    command.mock.calls.every(([input]) => ['snapshot', 'runtime-selection'].includes(input.action)),
  ).toBe(true);
});

it('shows an unloaded local worker before any model import, without requiring GPU details', async () => {
  const user = userEvent.setup();
  const command = vi.fn<(input: RuntimeCommand) => Promise<RuntimeView>>(() =>
    Promise.resolve({
      enabled: true,
      model: null,
      phase: 'stopped' as const,
      error: null,
      device: {
        name: 'own-pc',
        os: 'Windows',
        cpuName: 'Actual CPU',
        threads: 8,
        role: 'Worker' as const,
      },
    }),
  );
  window.modelLoomRuntime = { command };
  render(<App />);
  await user.click(screen.getByRole('button', { name: 'Cluster' }));
  const device = within(await screen.findByRole('article', { name: 'own-pc' }));
  expect(device.getByText('Worker')).toBeVisible();
  expect(device.queryByText('Windows · This device')).not.toBeInTheDocument();
  expect(device.getByRole('region', { name: 'own-pc CPU' })).toBeVisible();
  expect(device.queryByText('NVIDIA GPU')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Load model' })).toBeDisabled();
  expect(screen.queryByText('No devices connected')).not.toBeInTheDocument();
  expect(
    command.mock.calls.every(
      ([input]) => input && ['snapshot', 'runtime-selection'].includes(input.action),
    ),
  ).toBe(true);
  await user.click(device.getByRole('button', { name: 'Actions for own-pc' }));
  await user.click(screen.getByRole('menuitem', { name: 'Device details' }));
  expect(await screen.findByRole('heading', { name: 'Devices', level: 1 })).toBeVisible();
  const details = within(screen.getByRole('article', { name: 'own-pc' }));
  expect(details.getByRole('heading', { name: 'own-pc', level: 2 })).toHaveFocus();
  expect(details.getByText('Worker')).toBeVisible();
  expect(details.getByText('This device', { selector: 'p' })).toBeVisible();
  const system = within(details.getByRole('region', { name: 'System' }));
  expect(system.getByText('Operating system', { selector: 'dt' })).toBeVisible();
  expect(system.getByText('Windows')).toBeVisible();
  const cpu = within(details.getByRole('region', { name: 'CPU' }));
  expect(cpu.getByText('Model', { selector: 'dt' })).toBeVisible();
  expect(cpu.getByText('Actual CPU')).toBeVisible();
});

it('offers import for an empty connected runtime without reporting that the runtime is missing', async () => {
  window.modelLoomRuntime = {
    command: () => Promise.resolve({ enabled: true, model: null, phase: 'stopped', error: null }),
  };
  render(<App />);

  expect(await screen.findByRole('heading', { name: 'No models imported' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Import GGUF' })).toBeEnabled();
  expect(screen.queryByRole('heading', { name: 'No runtime connected' })).not.toBeInTheDocument();
});

it('displays the detected GPU model beside the observed VRAM without loading a model', async () => {
  const user = userEvent.setup();
  window.modelLoomRuntime = {
    command: () =>
      Promise.resolve({
        enabled: true,
        model: null,
        phase: 'stopped',
        error: null,
        device: {
          name: 'own-gpu-pc',
          os: 'Windows',
          cpuName: 'Actual CPU',
          threads: 8,
          role: 'Coordinator',
          gpuMemoryGiB: 16,
          gpuName: 'NVIDIA GeForce RTX 4060 Ti',
          inventory: {
            sampledAt: Date.now(),
            gpus: [
              {
                id: 'gpu-0',
                name: 'NVIDIA GeForce RTX 4060 Ti',
                pciVendorId: '10de',
                totalMemoryBytes: 16 * 2 ** 30,
              },
            ],
          },
        },
      }),
  };
  render(<App />);
  await user.click(screen.getByRole('button', { name: 'Cluster' }));
  const device = within(await screen.findByRole('article', { name: 'own-gpu-pc' }));
  expect(device.getByText('NVIDIA GeForce RTX 4060 Ti')).toBeVisible();
  expect(device.getByText('16.0 GiB')).toBeVisible();
  expect(device.getByRole('region', { name: 'own-gpu-pc GPU' })).toBeVisible();
  expect(device.getByRole('button', { name: 'Load a model to assign layers' })).toBeDisabled();
  expect(device.queryByText('NVIDIA GPU')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Load model' })).toBeDisabled();
});

describe('Models milestone', () => {
  it('discloses sample data and renders compact model rows without launch controls', () => {
    render(<App />);
    expect(screen.getByText('Demo data')).toBeVisible();
    expect(screen.getAllByRole('article')).toHaveLength(5);
    const qwen = within(screen.getByRole('article', { name: 'Qwen3.8-27B' }));
    expect(qwen.getByText('16.4 GB')).toBeVisible();
    expect(qwen.getByText('GGUF')).toBeVisible();
    expect(qwen.getByText('Q4_K_M')).toBeVisible();
    expect(qwen.getByText('qwen3.8')).toBeVisible();
    expect(screen.getAllByLabelText('Last used: unknown')).toHaveLength(5);
    expect(
      screen.queryByRole('button', { name: /Start|Stop|Open in Cluster/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/^(Running|Ready|Stopped|Fully compatible)$/),
    ).not.toBeInTheDocument();
  });

  it('filters case-insensitively and recovers from no matches', async () => {
    const user = userEvent.setup();
    render(<App />);
    const search = screen.getByRole('searchbox', { name: 'Find model' });
    await user.type(search, 'LLAMA');
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('article', { name: 'Llama 3.1 8B' })).toBeVisible();
    await user.clear(search);
    await user.type(search, '<script>unknown</script>');
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.getByText('No models found')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getAllByRole('article')).toHaveLength(5);
  });

  it('opens six configuration sections and saves model defaults without changing Cluster', async () => {
    const user = userEvent.setup();
    render(<App />);
    const configure = screen.getByRole('button', { name: 'Configure Llama 3.1 8B' });
    await user.click(configure);
    expect(screen.getByRole('heading', { name: 'Model configuration' })).toBeVisible();
    for (const name of [
      'Prompt',
      'Context and Performance',
      'Generation',
      'Reasoning',
      'Speculative decoding',
      'Advanced',
    ])
      expect(screen.getByRole('region', { name })).toBeVisible();
    const temperature = screen.getByRole('spinbutton', { name: 'Temperature' });
    await user.clear(temperature);
    await user.type(temperature, '0.6');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(screen.getByRole('status')).toHaveTextContent('Defaults saved for this demo session');
    await user.click(screen.getByRole('button', { name: 'Back to Models' }));
    expect(screen.getByRole('button', { name: 'Configure Llama 3.1 8B' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Configure Llama 3.1 8B' }));
    expect(screen.getByRole('spinbutton', { name: 'Temperature' })).toHaveValue(0.6);
    await user.click(screen.getByRole('button', { name: 'Cluster' }));
    expect(screen.getByRole('button', { name: 'Selected demo model: Qwen3.8-27B' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Unload model' })).toBeVisible();
  });

  it('protects active removal until the model is stopped in Cluster', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Actions for Qwen3.8-27B' }));
    expect(screen.getByRole('button', { name: 'Remove model entry' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Stop demo model' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Cluster' }));
    await user.click(screen.getByRole('button', { name: 'Unload model' }));
    await user.click(screen.getByRole('button', { name: 'Models' }));
    await user.click(screen.getByRole('button', { name: 'Actions for Qwen3.8-27B' }));
    await user.click(screen.getByRole('button', { name: 'Remove model entry' }));
    expect(screen.getByRole('dialog', { name: 'Remove model entry?' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Remove entry' }));
    expect(screen.queryByRole('article', { name: 'Qwen3.8-27B' })).not.toBeInTheDocument();
  });

  it('navigates without presenting unfinished screens as operational', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Cluster' }));
    expect(screen.getByRole('heading', { name: 'Cluster' })).toBeVisible();
    expect(screen.getByText('Demo data')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Models' }));
    expect(screen.getByRole('heading', { name: 'Model library' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'API' }));
    expect(screen.getByRole('heading', { name: 'API' })).toBeVisible();
    expect(screen.getByText('No API server is running.')).toBeVisible();
  });

  it('explains unavailable imports instead of pretending to load a GGUF', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Import GGUF' }));
    expect(screen.getByRole('dialog', { name: 'GGUF import' })).toBeVisible();
    expect(screen.getByText(/No file is imported in this demo/)).toBeVisible();
  });
});

it('shows the selected build while the installed runtime files are still being checked', async () => {
  const selected = {
    packageId: 'llama-cuda-development',
    version: 'b11306-dev14-speculation-tensor-cache-v1',
    artifact: 'b11306-cuda12.4-msvc14.44-dev1',
    platform: 'win32',
    arch: 'x64',
    backend: 'cuda',
    upstreamCommit: '4f31296a907d73f3409f720429bcf31111615d77',
  } as const;
  const view: RuntimeView = {
    enabled: true,
    model: null,
    phase: 'ready',
    error: null,
    activeRuntime: { ...selected, version: 'b11306-dev12-tensor-cache-v1' },
  };
  let finishInventory!: (reply: RuntimeView) => void;
  const inventory = new Promise<RuntimeView>((resolve) => {
    finishInventory = resolve;
  });
  window.modelLoomRuntime = {
    command: async (input) => {
      if (input.action === 'runtime-inventory') return inventory;
      if (input.action === 'runtime-selection') return { ...view, selectedRuntime: selected };
      return view;
    },
  };
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: /^Settings$/ }));
  await user.click(screen.getByRole('button', { name: /^Runtime$/ }));
  expect(screen.getByText('Checking installed runtimes…')).toBeVisible();
  expect(screen.queryByRole('combobox', { name: 'GGUF runtime' })).not.toBeInTheDocument();
  expect(screen.getByText('llama.cpp · CUDA (Windows) · b11306 · dev14')).toBeVisible();
  expect(screen.getByText('llama.cpp · CUDA (Windows) · b11306 · dev12')).toBeVisible();
  finishInventory({ ...view, runtimeInventory: { status: 'ready', selected, installed: true } });
  expect(await screen.findByText('1 verified version installed.')).toBeVisible();
  expect(screen.queryByText('Engine log level')).not.toBeInTheDocument();
  expect(screen.queryByText('Show runtime downloads')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Manage installed runtimes' }));
  const dialog = screen.getByRole('dialog', { name: 'Installed runtimes' });
  expect(within(dialog).getByRole('heading', { name: 'llama.cpp · CUDA' })).toBeVisible();
  expect(within(dialog).getByText('b11306 · dev14')).toBeVisible();
  expect(within(dialog).getByText('Selected')).toBeVisible();
  expect(dialog).not.toHaveTextContent('In use');
});
