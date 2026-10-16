import { useReducer } from 'react';
import { DatabaseSync } from 'node:sqlite';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ModelConfigurationStore } from '../../../../../../packages/core/src/model-configuration/store';
import { ClusterController } from '../../../../../../packages/core/src/cluster/controller';
import {
  capabilities,
  record,
} from '../../../../../../packages/core/src/model-configuration/test-fixtures';
import type { ClusterBridge } from '../../../shared/cluster-configuration';
import type { RuntimeView } from '../../../shared/runtime';
import { ClusterPage } from './ClusterPage';
import { useClusterConfigurations } from './useClusterConfigurations';
import { createDemoPlacement } from '../../mocks/cluster';
import { createDemoLibrary } from '../../mocks/modelLibrary';
import { createDemoJoining, transitionDemoJoining } from '../../mocks/clusterJoining';
const uuid = 'GPU-12345678-1234-1234-1234-123456789abc';
const secondUuid = 'GPU-87654321-4321-4321-4321-cba987654321';
const model = {
  ...createDemoLibrary().models[0]!,
  id: `model-${record().modelId}`,
  name: 'Observed model',
  blockCount: 8,
};

it('requires assignment choice before Play, preserves unsaved model drafts, and prompts again after Undo clears them', async () => {
  const database = new DatabaseSync(':memory:');
  const qwenId = 'b'.repeat(64);
  const bonsaiId = record().modelId;
  const store = new ModelConfigurationStore(
    database,
    () => {},
    (id) => [qwenId, bonsaiId].includes(id),
    capabilities,
    record().load,
  );
  const controller = new ClusterController(store, 'window', { cacheK: 'q8_0', cacheV: 'q8_0' });
  for (const [modelId, name, blockCount] of [
    [qwenId, 'Qwen', 16],
    [bonsaiId, 'Bonsai', 8],
  ] as const) {
    await store.recordImport(modelId, 123, {
      modelId,
      name,
      blockCount,
      file: `E:\\Models\\${name}.gguf`,
      size: '4 GB',
      sizeBytes: 4000,
      modifiedMs: 1,
      architecture: 'llama',
      contextLimit: 32768,
      quantization: 'Q4_K_M',
      parameters: '4B',
    });
  }
  const command = vi.fn<ClusterBridge['command']>(async (input) => {
    if (input.action !== 'auto-place') return controller.command('window', input);
    const previous = store.cluster.readDraft(input.key)!;
    const draft = store.cluster.writeDraft(input.key, input.revision, {
      modelId: previous.modelId,
      load: previous.load,
      runs: [{ uuid, first: '0', last: previous.modelId === qwenId ? '15' : '7' }],
    });
    return {
      ok: true,
      configurations: store.cluster.list(),
      configuration: null,
      draft,
      load: draft.load,
      issues: [],
    };
  });
  const onRunDraft = vi.fn();
  const onRun = vi.fn();
  const user = userEvent.setup();
  const view = render(
    <Harness
      bridge={{ command }}
      onRun={onRun}
      onRunDraft={onRunDraft}
      models={[
        { ...model, id: `model-${qwenId}`, name: 'Qwen', blockCount: 16 },
        { ...model, id: `model-${bonsaiId}`, name: 'Bonsai', blockCount: 8 },
      ]}
    />,
  );
  try {
    await user.click(screen.getByRole('button', { name: 'Choose model' }));
    await user.click(screen.getByRole('menuitem', { name: /Qwen/ }));
    await user.click(screen.getByRole('button', { name: 'Edit layers for Observed device GPU' }));
    await user.type(screen.getByRole('spinbutton', { name: 'First layer for GPU' }), '0');
    await user.type(screen.getByRole('spinbutton', { name: 'Last layer for GPU' }), '15');
    await user.click(screen.getByRole('button', { name: 'Run model' }));
    await waitFor(() =>
      expect(onRunDraft).toHaveBeenCalledWith({
        key: `model:${qwenId}`,
        revision: expect.any(Number) as number,
        modelId: qwenId,
      }),
    );
    expect(command.mock.calls.some(([input]) => input.action === 'auto-place')).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Selected local model: Qwen' }));
    await user.click(screen.getByRole('menuitem', { name: /Bonsai/ }));
    expect(onRunDraft).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Planned layers 0 – 15')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Run model' }));
    let dialog = await screen.findByRole('dialog');
    expect(onRunDraft).toHaveBeenCalledTimes(1);
    expect(command.mock.calls.some(([input]) => input.action === 'auto-place')).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Place manually' }));
    expect(screen.getByRole('spinbutton', { name: 'Last layer for GPU' })).toHaveValue('');
    expect(onRunDraft).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Run model' }));
    dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Auto place' }));
    await waitFor(() =>
      expect(screen.getByRole('spinbutton', { name: 'Last layer for GPU' })).toHaveValue('7'),
    );
    expect(onRunDraft).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Selected local model: Bonsai' }));
    await user.click(screen.getByRole('menuitem', { name: /Qwen/ }));
    expect(screen.getByRole('spinbutton', { name: 'Last layer for GPU' })).toHaveValue('15');
    expect(onRunDraft).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Selected local model: Qwen' }));
    await user.click(screen.getByRole('menuitem', { name: /Bonsai/ }));
    expect(screen.getByRole('spinbutton', { name: 'Last layer for GPU' })).toHaveValue('7');
    expect(onRunDraft).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Run model' }));
    await waitFor(() =>
      expect(onRunDraft).toHaveBeenLastCalledWith({
        key: `model:${bonsaiId}`,
        revision: expect.any(Number) as number,
        modelId: bonsaiId,
      }),
    );
    expect(
      command.mock.calls
        .filter(([input]) => input.action === 'auto-place')
        .map(([input]) => ('key' in input ? input.key : null)),
    ).toEqual([`model:${bonsaiId}`]);
    expect(screen.getByRole('spinbutton', { name: 'Last layer for GPU' })).toHaveValue('7');
    expect(screen.queryByText('Planned layers 0 – 15')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onRunDraft).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run model' })).toBeEnabled());
    expect(screen.getByRole('spinbutton', { name: 'Last layer for GPU' })).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Run model' }));
    await screen.findByRole('dialog');
    expect(screen.getByRole('button', { name: 'Auto place' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Place manually' })).toBeVisible();
    expect(onRunDraft).toHaveBeenCalledTimes(2);
    expect(store.cluster.list()).toEqual([]);
    expect(command.mock.calls.some(([input]) => input.action === 'save')).toBe(false);
    expect(onRun).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    await controller.close();
    database.close();
  }
});
it('shows saved physical GPU ranges immediately and only marks them in use after verified loading', async () => {
  const database = new DatabaseSync(':memory:');
  const store = new ModelConfigurationStore(
    database,
    () => {},
    (id) => id === record().modelId,
    capabilities,
    record().load,
  );
  const controller = new ClusterController(store, 'window', { cacheK: 'q8_0', cacheV: 'q8_0' });
  const bridge: ClusterBridge = { command: (input) => controller.command('window', input) };
  await store.recordImport(record().modelId, 123, {
    modelId: record().modelId,
    file: 'E:\\Models\\fixture.gguf',
    name: model.name,
    size: '4 GB',
    sizeBytes: 4000,
    modifiedMs: 1,
    architecture: 'llama',
    contextLimit: 32768,
    blockCount: 64,
    quantization: 'Q4_K_M',
    parameters: '4B',
  });
  const user = userEvent.setup();
  const run = vi.fn();
  let view = render(<Harness bridge={bridge} onRun={run} twoGpus blockCount={64} />);
  const checkRanges = () => {
    for (const [index, text, width] of [
      [0, 'Layers 0 – 15', '25%'],
      [1, 'Layers 16 – 63', '75%'],
    ] as const) {
      const tile = screen.getByRole('region', { name: `Observed device GPU ${index}` });
      expect(within(tile).getByText(text)).toBeInTheDocument();
      const bar = tile.querySelector(
        '[title="Layer allocation share, not measured memory use"] > span',
      );
      expect(bar).toHaveStyle({ width });
      expect(within(tile).queryByText('Unassigned')).not.toBeInTheDocument();
    }
  };
  const checkOverview = async (state: string) => {
    let panel = screen.queryByRole('complementary', { name: 'Cluster panel' });
    if (!panel) {
      await user.click(screen.getByRole('button', { name: 'Cluster panel' }));
      panel = screen.getByRole('complementary', { name: 'Cluster panel' });
    } else {
      const back = within(panel).queryByRole('button', { name: 'Back to cluster overview' });
      if (back) await user.click(back);
    }
    expect(within(panel).getByRole('heading', { name: 'Hardware' })).toBeVisible();
    expect(within(panel).getByText('1 device \u00b7 2 GPUs')).toBeVisible();
    expect(within(panel).getByText('16.0 GiB')).toBeVisible();
    expect(within(panel).queryByText('Unified memory')).not.toBeInTheDocument();
    expect(within(panel).queryByText('Placement not confirmed')).not.toBeInTheDocument();
    expect(
      within(panel).queryByText('Proposed layer assignments. Save before Run.'),
    ).not.toBeInTheDocument();
    const row = within(panel).getByRole('button', {
      name: new RegExp(`Observed device.*${state}`),
    });
    expect(within(row).getByText(state)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cluster panel' }));
  };
  try {
    for (const name of ['Undo', 'Redo', 'Reset to default', 'Save configuration']) {
      expect(screen.getByRole('button', { name })).toBeVisible();
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    const history = screen.getByRole('group', { name: 'Assignment history' });
    const picker = screen.getByRole('button', { name: 'Choose model' });
    expect(history.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Choose model' }));
    await user.click(screen.getByRole('menuitem', { name: /Observed model/ }));
    await checkOverview('No assignment');
    await user.click(screen.getByRole('button', { name: 'Edit layers for Observed device GPU 0' }));
    for (const [index, first, last] of [
      [0, '0', '15'],
      [1, '16', '63'],
    ] as const) {
      await user.type(
        screen.getByRole('spinbutton', { name: `First layer for GPU ${index}` }),
        first,
      );
      await user.type(
        screen.getByRole('spinbutton', { name: `Last layer for GPU ${index}` }),
        last,
      );
    }
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Save configuration' })).toBeEnabled();
    let lastDraft = screen.getByRole('spinbutton', { name: 'Last layer for GPU 1' });
    await user.clear(lastDraft);
    await user.type(lastDraft, '-');
    await checkOverview('Draft');
    await user.click(screen.getByRole('button', { name: 'Edit layers for Observed device GPU 1' }));
    lastDraft = screen.getByRole('spinbutton', { name: 'Last layer for GPU 1' });
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(lastDraft).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Redo' }));
    expect(lastDraft).toHaveValue('-');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(lastDraft).toHaveValue('63');
    const panel = screen.getByRole('complementary', { name: 'Cluster panel' });
    expect(within(panel).getByText('64 layers \u00b7 0\u201363')).toBeVisible();
    expect(within(panel).getByRole('heading', { name: 'Observed device' })).toBeVisible();
    expect(within(panel).getByText('This device \u00b7 Coordinator')).toBeVisible();
    await user.click(within(panel).getByText('Device details'));
    for (const name of ['OS', 'Address', 'Connection'])
      expect(within(panel).getByText(name)).toBeVisible();
    const editor = within(panel)
      .getByRole('heading', { name: 'Layer assignment' })
      .closest('section')!;
    expect(within(editor).queryByRole('heading', { name: 'CPU' })).not.toBeInTheDocument();
    expect(within(editor).queryByText(/dedicated memory|NVIDIA/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save configuration' }));
    await user.type(screen.getByRole('textbox', { name: 'Configuration name' }), 'Two GPUs');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Save$/u }));
    await screen.findByRole('button', { name: 'Two GPUs' });
    for (const name of ['Undo', 'Redo', 'Reset to default', 'Save configuration']) {
      await waitFor(() => expect(screen.getByRole('button', { name })).toBeDisabled());
    }
    checkRanges();
    expect(screen.queryByText('In use')).not.toBeInTheDocument();
    await checkOverview('Saved');
    const saved = store.cluster.list()[0]!;
    expect(saved.runs).toEqual([
      { uuid, first: 0, last: 15 },
      { uuid: secondUuid, first: 16, last: 63 },
    ]);
    view.unmount();
    view = render(<Harness bridge={bridge} onRun={run} twoGpus blockCount={64} />);
    await user.click(await screen.findByRole('button', { name: 'Two GPUs' }));
    await waitFor(checkRanges);
    await user.click(screen.getByRole('button', { name: 'Run model' }));
    expect(run).toHaveBeenCalledWith(saved.id, saved.revision);
    await checkOverview('Saved');
    expect(screen.queryByText('In use')).not.toBeInTheDocument();
    view.rerender(
      <Harness
        bridge={bridge}
        onRun={run}
        twoGpus
        blockCount={64}
        activeCluster={{ configurationId: saved.id, revision: saved.revision, runs: saved.runs }}
      />,
    );
    checkRanges();
    expect(screen.getAllByText('In use')).toHaveLength(2);
    await checkOverview('In use');
    await user.click(screen.getByRole('button', { name: 'Edit layers for Observed device GPU 0' }));
    await user.clear(screen.getByRole('spinbutton', { name: 'Last layer for GPU 0' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Last layer for GPU 0' }), '14');
    expect(screen.getByText('Planned layers 0 – 14')).toBeInTheDocument();
    expect(screen.getByText('Active layers 0 – 15')).toBeInTheDocument();
    await checkOverview('Draft');
    expect(screen.getAllByText('In use')).toHaveLength(2);
  } finally {
    view.unmount();
    await controller.close();
    database.close();
  }
});
function Harness({
  bridge,
  onRun,
  twoGpus = false,
  blockCount = 8,
  activeCluster = null,
  models,
  onRunDraft = vi.fn(),
}: {
  bridge: ClusterBridge;
  onRun: (id: string, revision: number) => void;
  twoGpus?: boolean;
  blockCount?: number;
  activeCluster?: RuntimeView['activeCluster'];
  models?: readonly (typeof model)[];
  onRunDraft?: (target: { key: string; revision: number; modelId: string }) => void;
}) {
  const configurations = useClusterConfigurations(bridge);
  const [joining, onJoining] = useReducer(transitionDemoJoining, undefined, createDemoJoining);
  return (
    <ClusterPage
      demo={false}
      configurations={configurations}
      joining={joining}
      onJoining={onJoining}
      devices={[
        {
          id: 'local',
          name: 'Observed device',
          role: 'Coordinator',
          os: 'Windows',
          address: 'This device',
          hardware: (twoGpus ? [uuid, secondUuid] : [uuid]).map((id, index) => ({
            id: `local-${id}`,
            label: twoGpus ? `GPU ${index}` : 'GPU',
            name: 'Observed GPU',
            kind: 'gpu',
            memoryGb: 8,
            detail: 'Observed memory',
          })),
          inventory: {
            sampledAt: 1,
            gpus: (twoGpus ? [uuid, secondUuid] : [uuid]).map((id, index) => ({
              id,
              name: 'Observed GPU',
              pciVendorId: '10de',
              executionIdentity: {
                vendor: 'nvidia' as const,
                uuid: id,
                pciBus: `00000000:0${index + 1}:00.0`,
              },
            })),
          },
        },
      ]}
      models={models ?? [{ ...model, blockCount }]}
      activeModel={activeCluster ? { ...model, blockCount } : undefined}
      placement={createDemoPlacement(null)}
      dispatch={vi.fn()}
      onStop={vi.fn()}
      onRenameDevice={vi.fn()}
      localRuntime={{
        activeCluster,
        loading: false,
        onChoose: (chosen) => {
          void configurations.selectModel(chosen.id);
        },
        onRun: vi.fn(),
        onRunConfiguration: onRun,
        onRunDraft,
      }}
    />
  );
}
it('uses durable core storage for Save-only validation, named selection and restart restoration', async () => {
  const database = new DatabaseSync(':memory:');
  const store = new ModelConfigurationStore(
    database,
    () => {},
    (id) => id === record().modelId,
    capabilities,
    record().load,
  );
  const controller = new ClusterController(store, 'window', { cacheK: 'q8_0', cacheV: 'q8_0' });
  const bridge: ClusterBridge = { command: (input) => controller.command('window', input) };
  await store.recordImport(record().modelId, 123, {
    modelId: record().modelId,
    file: 'E:\\Models\\fixture.gguf',
    name: model.name,
    size: '4 GB',
    sizeBytes: 4000,
    modifiedMs: 1,
    architecture: 'llama',
    contextLimit: 32768,
    blockCount: 8,
    quantization: 'Q4_K_M',
    parameters: '4B',
  });
  const user = userEvent.setup(),
    run = vi.fn();
  const first = render(<Harness bridge={bridge} onRun={run} />);
  try {
    await user.click(screen.getByRole('button', { name: 'Choose model' }));
    await user.click(screen.getByRole('menuitem', { name: /Observed model/ }));
    await screen.findByRole('button', { name: 'Selected local model: Observed model' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save configuration' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Edit layers for Observed device GPU' }));
    await user.type(screen.getByRole('spinbutton', { name: 'First layer for GPU' }), '0');
    await user.type(screen.getByRole('spinbutton', { name: 'Last layer for GPU' }), '-');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save configuration' }));
    await user.type(screen.getByRole('textbox', { name: 'Configuration name' }), 'Laptop');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Save$/u }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Use whole numbers and cover all model layers exactly once, without gaps or overlaps.',
    );
    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save configuration' }));
    await user.type(screen.getByRole('textbox', { name: 'Configuration name' }), 'Laptop');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Save$/u }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(await screen.findByRole('button', { name: 'Dismiss notification' }));
    expect(screen.getByRole('spinbutton', { name: 'Last layer for GPU' })).toHaveValue('-');
    expect(store.cluster.list()).toEqual([]);
    await user.clear(screen.getByRole('spinbutton', { name: 'Last layer for GPU' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Last layer for GPU' }), '7');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save configuration' }));
    await user.type(screen.getByRole('textbox', { name: 'Configuration name' }), 'Laptop');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Save$/u }));
    await screen.findByRole('button', { name: 'Laptop' });
    expect(screen.getByRole('button', { name: 'Save configuration' })).toBeDisabled();
    expect(run).not.toHaveBeenCalled();
    first.unmount();
    const second = render(<Harness bridge={bridge} onRun={run} />);
    await user.click(await screen.findByRole('button', { name: 'Laptop' }));
    await screen.findByRole('button', { name: 'Selected local model: Observed model' });
    expect(screen.getByRole('button', { name: 'Save configuration' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Run model' }));
    expect(run).toHaveBeenCalledWith(store.cluster.list()[0]!.id, 1);
    await user.click(screen.getByRole('button', { name: 'Delete configuration: Laptop' }));
    let confirmation = screen.getByRole('dialog', { name: 'Delete configuration?' });
    expect(within(confirmation).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
    expect(store.cluster.list()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Delete configuration: Laptop' }));
    confirmation = screen.getByRole('dialog', { name: 'Delete configuration?' });
    await user.click(within(confirmation).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Laptop' })).not.toBeInTheDocument(),
    );
    expect(store.cluster.list()).toEqual([]);
    expect(run).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run model' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Run model' }));
    expect(screen.getByRole('dialog', { name: 'Plan layer placement' })).toBeVisible();
    second.unmount();
  } finally {
    first.unmount();
    await controller.close();
    database.close();
  }
});
