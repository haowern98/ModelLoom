import type * as MotionReact from 'motion/react';
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
vi.mock('motion/react', async (load) => ({
  ...(await load<typeof MotionReact>()),
  useReducedMotion: () => true,
}));

async function editCard(
  user: ReturnType<typeof userEvent.setup>,
  device: string,
  gpu: string,
  first: string,
  last: string,
) {
  await user.click(screen.getByRole('button', { name: `Edit layers for ${device} ${gpu}` }));
  await user.clear(screen.getByRole('textbox', { name: /^First layer for / }));
  await user.type(screen.getByRole('textbox', { name: /^First layer for / }), first);
  await user.clear(screen.getByRole('textbox', { name: /^Last layer for / }));
  await user.type(screen.getByRole('textbox', { name: /^Last layer for / }), last);
  await user.click(screen.getByRole('button', { name: 'Done' }));
}

const uuid = 'GPU-12345678-1234-1234-1234-123456789abc';
const secondUuid = 'GPU-87654321-4321-4321-4321-cba987654321';
const peerId = `peer:${'b'.repeat(64)}`;
const model = {
  ...createDemoLibrary().models[0]!,
  id: `model-${record().modelId}`,
  name: 'Observed model',
  blockCount: 8,
};

it('confirms unsaved model switches, discards assignments, and plans the next model independently', async () => {
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
    await user.click(screen.getByRole('button', { name: 'Select Observed device' }));
    await editCard(user, 'Observed device', 'GPU', '0', '15');
    await user.click(screen.getByRole('button', { name: 'Load model' }));
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
    await user.click(screen.getByRole('menuitem', { name: 'No model' }));
    expect(screen.getByRole('dialog', { name: 'Unsaved changes' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(screen.getByRole('button', { name: 'Selected local model: Qwen' })).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Edit layers for Observed device GPU' }),
    ).toHaveTextContent('0–15');
    await user.click(screen.getByRole('button', { name: 'Selected local model: Qwen' }));
    await user.click(screen.getByRole('menuitem', { name: 'No model' }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await screen.findByRole('button', { name: 'Choose model' });
    expect(screen.getByRole('button', { name: 'Load model' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Choose model' }));
    await user.click(screen.getByRole('menuitem', { name: /Bonsai/ }));
    await screen.findByRole('button', { name: 'Selected local model: Bonsai' });
    expect(onRunDraft).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Planned layers 0 – 15')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Load model' }));
    let dialog = await screen.findByRole('dialog');
    expect(onRunDraft).toHaveBeenCalledTimes(1);
    expect(command.mock.calls.some(([input]) => input.action === 'auto-place')).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Place manually' }));
    expect(
      screen.getByRole('button', { name: 'Edit layers for Observed device GPU' }),
    ).toHaveTextContent('Unassigned');
    expect(onRunDraft).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Load model' }));
    dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Auto place' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Edit layers for Observed device GPU' }),
      ).toHaveTextContent('0–7'),
    );
    expect(onRunDraft).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Selected local model: Bonsai' }));
    await user.click(screen.getByRole('menuitem', { name: /Qwen/ }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await screen.findByRole('button', { name: 'Selected local model: Qwen' });
    expect(
      screen.getByRole('button', { name: 'Edit layers for Observed device GPU' }),
    ).toHaveTextContent('Unassigned');
    expect(onRunDraft).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Selected local model: Qwen' }));
    await user.click(screen.getByRole('menuitem', { name: /Bonsai/ }));
    expect(
      screen.getByRole('button', { name: 'Edit layers for Observed device GPU' }),
    ).toHaveTextContent('Unassigned');
    await user.click(screen.getByRole('button', { name: 'Load model' }));
    await user.click(screen.getByRole('button', { name: 'Auto place' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Edit layers for Observed device GPU' }),
      ).toHaveTextContent('0–7'),
    );
    expect(onRunDraft).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Load model' }));
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
    ).toEqual([`model:${bonsaiId}`, `model:${bonsaiId}`]);
    expect(
      screen.getByRole('button', { name: 'Edit layers for Observed device GPU' }),
    ).toHaveTextContent('0–7');
    expect(screen.queryByText('Planned layers 0 – 15')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onRunDraft).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load model' })).toBeEnabled());
    expect(
      screen.getByRole('button', { name: 'Edit layers for Observed device GPU' }),
    ).toHaveTextContent('Unassigned');
    await user.click(screen.getByRole('button', { name: 'Load model' }));
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
it.each(['edit and save', 'restore and load'] as const)(
  'shows physical GPU ranges through %s without claiming unverified use',
  async (scenario) => {
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
    if (scenario === 'restore and load') {
      const draft = store.cluster.writeDraft(`model:${record().modelId}`, null, {
        modelId: record().modelId,
        load: { defaults: record().load, cacheK: 'q8_0', cacheV: 'q8_0' },
        runs: [
          { uuid, first: '0', last: '15' },
          { uuid: secondUuid, first: '16', last: '63' },
        ],
      });
      const saved = store.cluster.saveDraft(draft.key, draft.revision, 'Two GPUs');
      if (!saved.ok) throw Error('fixture save failed');
    }
    const user = userEvent.setup();
    const run = vi.fn();
    let view = render(<Harness bridge={bridge} onRun={run} twoGpus blockCount={64} />);
    const checkRanges = () => {
      for (const [index, first, last, count] of [
        [0, 0, 15, 16],
        [1, 16, 63, 48],
      ] as const) {
        const tile = screen.getByRole('region', { name: `Observed device GPU ${index}` });
        expect(
          within(tile).getByRole('button', {
            name: `Edit layers for Observed device GPU ${index}`,
          }),
        ).toHaveTextContent(`${first}\u2013${last}`);
        expect(within(tile).getByRole('slider')).toHaveAttribute(
          'aria-valuetext',
          `Layers ${first} through ${last}, ${count} layers assigned`,
        );
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
      const row = within(panel).getByRole('group', {
        name: 'Layer assignment for Observed device',
      });
      expect(row).toHaveAttribute('title', state);
      expect(row).toHaveTextContent(state === 'No assignment' ? 'No assignment' : /0–/);
      await user.click(screen.getByRole('button', { name: 'Cluster panel' }));
    };
    try {
      if (scenario === 'edit and save') {
        for (const name of ['Undo', 'Redo', 'Save configuration']) {
          expect(screen.getByRole('button', { name })).toBeVisible();
          expect(screen.getByRole('button', { name })).toBeDisabled();
        }
        const history = screen.getByRole('group', { name: 'Assignment history' });
        const picker = screen.getByRole('button', { name: 'Choose model' });
        expect(
          picker.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        await user.click(screen.getByRole('button', { name: 'Choose model' }));
        await user.click(screen.getByRole('menuitem', { name: /Observed model/ }));
        await checkOverview('No assignment');
        await user.click(screen.getByRole('button', { name: 'Select Observed device' }));
        for (const [index, first, last] of [
          [0, '0', '15'],
          [1, '16', '63'],
        ] as const) {
          await editCard(user, 'Observed device', `GPU ${index}`, first, last);
        }
        expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Save configuration' })).toBeEnabled();
        await user.click(
          screen.getByRole('button', { name: 'Edit layers for Observed device GPU 1' }),
        );
        const lastDraft = screen.getByRole('textbox', { name: /^Last layer for / });
        await user.clear(lastDraft);
        await user.type(lastDraft, '-');
        await user.click(screen.getByRole('button', { name: 'Done' }));
        expect(screen.getByText('Enter a whole number in both fields.')).toBeVisible();
        await user.clear(lastDraft);
        await user.type(lastDraft, '63');
        await user.click(screen.getByRole('button', { name: 'Done' }));
        await checkOverview('Draft');
        await user.click(screen.getByRole('button', { name: 'Save configuration' }));
        await user.type(screen.getByRole('textbox', { name: 'Configuration name' }), 'Two GPUs');
        await user.click(
          within(screen.getByRole('dialog')).getByRole('button', { name: /^Save$/u }),
        );
        await screen.findByRole('button', { name: 'Two GPUs' });
        for (const name of ['Undo', 'Redo', 'Save configuration']) {
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
        expect(run).not.toHaveBeenCalled();
        return;
      }
      const saved = store.cluster.list()[0]!;
      view.unmount();
      view = render(<Harness bridge={bridge} onRun={run} twoGpus blockCount={64} />);
      await user.click(await screen.findByRole('button', { name: 'Two GPUs' }));
      await waitFor(checkRanges);
      await user.click(screen.getByRole('button', { name: 'Load model' }));
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
      expect(screen.getAllByRole('img', { name: 'GPU in use' })).toHaveLength(2);
      await checkOverview('In use');
      await user.click(screen.getByRole('button', { name: 'Select Observed device' }));
      await editCard(user, 'Observed device', 'GPU 0', '0', '14');
      expect(
        screen.getByRole('button', { name: 'Edit layers for Observed device GPU 0' }),
      ).toHaveTextContent('0\u201314');
      expect(
        within(screen.getByRole('region', { name: 'Observed device GPU 0' })).getByRole('img', {
          name: 'GPU in use',
        }),
      ).toBeInTheDocument();
      await checkOverview('Draft');
      expect(screen.getAllByRole('img', { name: 'GPU in use' })).toHaveLength(2);
      view.rerender(
        <Harness bridge={bridge} onRun={run} twoGpus blockCount={64} activeCluster={null} />,
      );
      expect(screen.queryByRole('img', { name: 'GPU in use' })).not.toBeInTheDocument();
    } finally {
      view.unmount();
      await controller.close();
      database.close();
    }
  },
);
function Harness({
  bridge,
  onRun,
  twoGpus = false,
  blockCount = 8,
  activeCluster = null,
  models,
  onRunDraft = vi.fn(),
  remote = false,
}: {
  bridge: ClusterBridge;
  onRun: (id: string, revision: number) => void;
  twoGpus?: boolean;
  displayNames,
  blockCount?: number;
  activeCluster?: RuntimeView['activeCluster'];
  models?: readonly (typeof model)[];
  onRunDraft?: (target: { key: string; revision: number; modelId: string }) => void;
  remote?: boolean;
}) {
  const configurations = useClusterConfigurations(bridge);
  const [joining, onJoining] = useReducer(transitionDemoJoining, undefined, createDemoJoining);
  return (
  displayNames?: Readonly<Record<string, string>>;
    <ClusterPage
      demo={false}
      configurations={configurations}
      joining={joining}
      onJoining={onJoining}
      devices={[
        {
          id: 'local',
          name: displayNames?.local ?? 'Observed device',
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
        ...(remote
          ? [
              {
                id: peerId,
                name: displayNames?.[peerId] ?? 'Observed worker',
                role: 'Worker' as const,
                os: 'Windows',
                address: 'Connected device',
                hardware: [
                  {
                    id: `${peerId}:${secondUuid}`,
                    assignmentId: `${peerId}:${secondUuid}`,
                    label: 'GPU',
                    name: 'Observed remote GPU',
                    kind: 'gpu' as const,
                    memoryGb: 12,
                    detail: 'Observed memory',
                  },
                ],
              },
            ]
          : []),
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

it('reopens a legacy saved placement with connected equal-width live canvas columns', async () => {
  const database = new DatabaseSync(':memory:');
  const store = new ModelConfigurationStore(
    database,
    () => {},
    () => true,
    capabilities,
    record().load,
  );
  const controller = new ClusterController(store, 'window', { cacheK: 'q8_0', cacheV: 'q8_0' });
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
  const draft = store.cluster.writeDraft(`model:${record().modelId}`, null, {
    modelId: record().modelId,
    load: { defaults: record().load, cacheK: 'q8_0', cacheV: 'q8_0' },
    runs: [
      { uuid, first: '0', last: '3' },
      { uuid: `${peerId}:${secondUuid}`, first: '4', last: '7' },
    ],
  });
  const saved = store.cluster.saveDraft(draft.key, draft.revision, 'Restored pair');
  if (!saved.ok) throw Error('fixture save failed');
  const bridge: ClusterBridge = { command: (input) => controller.command('window', input) };
  const run = vi.fn();
  const user = userEvent.setup();
  const view = render(<Harness bridge={bridge} onRun={run} remote />);
  try {
    await user.click(await screen.findByRole('button', { name: 'Restored pair' }));
    const worker = await screen.findByRole('article', { name: 'Observed worker' });
    const local = screen.getByRole('article', { name: 'Observed device' });
    const world = local.closest<HTMLElement>('[data-canvas-device]')!.parentElement!;
    expect(world.style.gridTemplateColumns).toBe('repeat(2, minmax(0, 520px))');
    expect(local.closest<HTMLElement>('[data-canvas-device]')!.style.gridColumn).toBe('1');
    expect(worker.closest<HTMLElement>('[data-canvas-device]')!.style.gridColumn).toBe('2');
    const lines = screen.getByRole('img', { name: 'Canvas layout connections' });
    expect(lines.querySelector('path')).toHaveAttribute('data-from', 'local');
    expect(lines.querySelector('path')).toHaveAttribute('data-to', peerId);
    expect(screen.getByRole('button', { name: 'Save configuration' })).toBeDisabled();
    expect(run).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    await controller.close();
    database.close();
  }
});
it('saves a bottom-edge connection with assignments and restores both after a new session', async () => {
  const database = new DatabaseSync(':memory:');
  const store = new ModelConfigurationStore(
    database,
    () => {},
    () => true,
    capabilities,
    record().load,
  );
  const controller = new ClusterController(store, 'window', { cacheK: 'q8_0', cacheV: 'q8_0' });
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
  const bridge: ClusterBridge = { command: (input) => controller.command('window', input) };
  const run = vi.fn();
  const user = userEvent.setup();
  let view = render(<Harness bridge={bridge} onRun={run} remote />);
  try {
    await user.click(screen.getByRole('button', { name: 'Choose model' }));
    await user.click(screen.getByRole('menuitem', { name: /Observed model/ }));
    const add = screen.getByRole('button', { name: 'Add device near Observed device' });
    add.focus();
    await user.keyboard('{ArrowDown}{Enter}');
    await user.click(screen.getByRole('button', { name: 'Add Observed worker to canvas' }));
    for (const [device, first, last] of [
      ['Observed device', '0', '3'],
      ['Observed worker', '4', '7'],
    ]) {
      await user.click(screen.getByRole('button', { name: `Select ${device}` }));
      await editCard(user, device!, 'GPU', first!, last!);
    }
    await user.click(screen.getByRole('button', { name: 'Save configuration' }));
    await user.type(screen.getByRole('textbox', { name: 'Configuration name' }), 'Bottom pair');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Save$/u }));
    await screen.findByRole('button', { name: 'Bottom pair' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save configuration' })).toBeDisabled(),
    );
    expect(store.cluster.list()[0]?.canvas).toEqual({
      positions: { local: { column: 0, row: 0 }, [peerId]: { column: 0, row: 1 } },
      links: [{ from: 'local', to: peerId, edge: 'bottom' }],
    });
    view.unmount();
    store.cluster.clearSessionDrafts();
    view = render(
      <Harness
        bridge={bridge}
        onRun={run}
        remote
        displayNames={{ local: 'Renamed coordinator', [peerId]: 'Renamed worker' }}
      />,
    );
    await user.click(await screen.findByRole('button', { name: 'Bottom pair' }));
    const worker = await screen.findByRole('article', { name: 'Renamed worker' });
    const local = screen.getByRole('article', { name: 'Renamed coordinator' });
    expect(local.closest<HTMLElement>('[data-canvas-device]')!.style.gridRow).toBe('1');
    expect(worker.closest<HTMLElement>('[data-canvas-device]')!.style.gridRow).toBe('2');
    expect(
      screen.getByRole('img', { name: 'Canvas layout connections' }).querySelector('path'),
    ).toHaveAttribute('data-to', peerId);
    expect(
      screen.getByRole('button', { name: 'Edit layers for Renamed coordinator GPU' }),
    ).toHaveTextContent('0\u20133');
    expect(
      screen.getByRole('button', { name: 'Edit layers for Renamed worker GPU' }),
    ).toHaveTextContent('4\u20137');
    expect(screen.getByRole('button', { name: 'Save configuration' })).toBeDisabled();
    expect(run).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    await controller.close();
    database.close();
  }
});
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
    await user.click(screen.getByRole('button', { name: 'Select Observed device' }));
    await editCard(user, 'Observed device', 'GPU', '0', '6');
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
    expect(
      screen.getByRole('button', { name: 'Edit layers for Observed device GPU' }),
    ).toHaveTextContent('0–6');
    expect(store.cluster.list()).toEqual([]);
    await editCard(user, 'Observed device', 'GPU', '0', '7');
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
    await user.click(screen.getByRole('button', { name: 'Load model' }));
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load model' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Load model' }));
    expect(screen.getByRole('dialog', { name: 'Plan layer placement' })).toBeVisible();
    second.unmount();
  } finally {
    first.unmount();
    await controller.close();
    database.close();
  }
});

it('applies card previews across local and remote GPUs as one undoable draft edit', async () => {
  const database = new DatabaseSync(':memory:');
  const store = new ModelConfigurationStore(
    database,
    () => {},
    () => true,
    capabilities,
    record().load,
  );
  const controller = new ClusterController(store, 'window', { cacheK: 'q8_0', cacheV: 'q8_0' });
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
  const original = [
    { uuid, first: '0', last: '21' },
    { uuid: secondUuid, first: '22', last: '42' },
    { uuid: `${peerId}:${secondUuid}`, first: '43', last: '63' },
  ];
  const draft = store.cluster.writeDraft(`model:${record().modelId}`, null, {
    modelId: record().modelId,
    load: { defaults: record().load, cacheK: 'q8_0', cacheV: 'q8_0' },
    runs: original,
    canvas: {
      positions: { local: { column: 0, row: 0 }, [peerId]: { column: 1, row: 0 } },
      links: [{ from: 'local', to: peerId, edge: 'right' }],
    },
  });
  const saved = store.cluster.saveDraft(draft.key, draft.revision, 'Card allocation');
  if (!saved.ok) throw Error('fixture save failed');
  const command = vi.fn<ClusterBridge['command']>((input) => controller.command('window', input));
  const user = userEvent.setup();
  const view = render(
    <Harness bridge={{ command }} onRun={vi.fn()} twoGpus remote blockCount={64} />,
  );
  try {
    await user.click(await screen.findByRole('button', { name: 'Card allocation' }));
    const peerRange = () =>
      screen.getByRole('button', { name: 'Edit layers for Observed worker GPU' });
    const edits = () => command.mock.calls.filter(([input]) => input.action === 'edit').length;
    const baseline = edits();
    await user.click(screen.getByRole('button', { name: 'Edit layers for Observed device GPU 1' }));
    const slider = screen.getByRole('slider', { name: 'Observed device GPU 1 ending layer' });
    slider.focus();
    await user.keyboard('{ArrowRight}');
    expect(peerRange()).toHaveTextContent('44\u201363');
    expect(
      screen.getByRole('textbox', { name: 'Last layer for Observed device GPU 1' }),
    ).toHaveValue('43');
    expect(screen.getByRole('button', { name: 'Save configuration' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Load model' })).toBeDisabled();
    expect(edits()).toBe(baseline);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(peerRange()).toHaveTextContent('43\u201363');
    expect(edits()).toBe(baseline);
    await user.click(screen.getByRole('button', { name: 'Edit layers for Observed device GPU 1' }));
    const last = screen.getByRole('textbox', { name: 'Last layer for Observed device GPU 1' });
    await user.clear(last);
    await user.type(last, '43');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(edits()).toBe(baseline);
    expect(peerRange()).toHaveTextContent('44\u201363');
    expect(screen.getByRole('button', { name: 'Save configuration' })).toBeEnabled();
    expect(command.mock.calls.some(([input]) => input.action === 'save')).toBe(false);
    expect(
      screen.getByRole('button', { name: 'Edit layers for Observed device GPU 1' }),
    ).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(peerRange()).toHaveTextContent('43\u201363');
    expect(
      screen.getByRole('slider', { name: 'Observed device GPU 1 ending layer' }),
    ).toHaveAttribute('aria-valuenow', '42');
    await user.click(screen.getByRole('button', { name: 'Redo' }));
    expect(peerRange()).toHaveTextContent('44\u201363');
    expect(edits()).toBe(baseline);
    const localRange = () =>
      screen.getByRole('button', { name: 'Edit layers for Observed device GPU 1' });
    for (const action of ['Cancel', 'Done'] as const) {
      await user.click(localRange());
      await user.clear(
        screen.getByRole('textbox', { name: 'First layer for Observed device GPU 1' }),
      );
      expect(screen.getByRole('alert')).toHaveTextContent('Enter a whole number in both fields.');
      await user.clear(
        screen.getByRole('textbox', { name: 'Last layer for Observed device GPU 1' }),
      );
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(localRange()).toHaveTextContent('Unassigned');
      expect(screen.getByLabelText('Observed device GPU 1 assigned layer count')).toHaveTextContent(
        '0 layers',
      );
      expect(peerRange()).toHaveTextContent('44\u201363');
      await user.click(screen.getByRole('button', { name: action }));
      expect(localRange()).toHaveTextContent(action === 'Cancel' ? '22\u201343' : 'Unassigned');
      expect(edits()).toBe(baseline);
    }
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(localRange()).toHaveTextContent('22\u201343');
    expect(peerRange()).toHaveTextContent('44\u201363');
    await user.click(screen.getByRole('button', { name: 'Save configuration' }));
    await waitFor(() => expect(edits()).toBe(baseline + 1));
    const edit = command.mock.calls
      .map(([input]) => input)
      .filter((input) => input.action === 'edit')
      .at(-1)!;
    expect(edit.edit).toMatchObject({
      runs: [
        original[0],
        { uuid: secondUuid, first: '22', last: '43' },
        { uuid: `${peerId}:${secondUuid}`, first: '44', last: '63' },
      ],
    });
    await waitFor(() =>
      expect(store.cluster.read(saved.configuration.id)?.runs).toEqual([
        { uuid, first: 0, last: 21 },
        { uuid: secondUuid, first: 22, last: 43 },
        { uuid: `${peerId}:${secondUuid}`, first: 44, last: 63 },
      ]),
    );
  } finally {
    view.unmount();
    await controller.close();
    database.close();
  }
});
