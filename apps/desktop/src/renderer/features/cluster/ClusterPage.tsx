import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Dispatch } from 'react';
import { AnimatePresence } from 'motion/react';
import { Button as SdkButton } from '@openai/apps-sdk-ui/components/Button';
import {
  ArrowRotateCcw,
  ArrowRotateCw,
  SidebarRight,
  StopOutline,
} from '@openai/apps-sdk-ui/components/Icon';
import { Menu } from '@openai/apps-sdk-ui/components/Menu';
import { ModelLoadingIcon } from './ModelLoadingIcon';
import { DeviceNameEditor } from './DeviceNameEditor';
import summaryStyles from './ClusterPanel.module.css';
import type { ClusterConfigurations } from './useClusterConfigurations';
import type { SavedClusterConfiguration } from '../../../shared/cluster-configuration';
import type { RuntimeView } from '../../../shared/runtime';
import { Network } from '@phosphor-icons/react/dist/csr/Network';
import { ChatGptPlayIcon } from '../../components/ChatGptPlayIcon';
import { ChatGptHistoryIcon } from '../../components/ChatGptHistoryIcon';
import { ChatNavIcon } from '../../components/ChatNavIcon';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { Toast } from '../../components/Toast';
import type { ToastMessage } from '../../components/Toast';
import type { DemoModel } from '../../mocks/modelLibrary';
import {
  completeSamplePlacement,
  demoLinks,
  demoLayerCount,
  hasPlacementChanges,
  parseLayerInputs,
  validSampleRange,
} from '../../mocks/cluster';
import type { DemoDevice, DemoPlacement, PlacementAction } from '../../mocks/cluster';
import { DeviceCard } from './DeviceCard';
import { useCardAllocation } from './useCardAllocation';
import { ClusterCanvas } from './ClusterCanvas';
import { ClusterPanel } from './ClusterPanel';
import { ClusterModelPicker } from './ClusterModelPicker';
import { UnsavedClusterChangesDialog } from './UnsavedClusterChangesDialog';
import { ClusterSidebar } from './ClusterSidebar';
import type { ClusterView } from './ClusterSidebar';
import { ClusterViews } from './ClusterViews';
import { incomingExamples } from '../../mocks/clusterJoining';
import type { JoiningProps } from './ClusterJoiningPanel';
import type { AssignmentStatus, ClusterSelection } from './ClusterPanel';
import styles from './ClusterPage.module.css';
import { canvasPositions, placeBeside, restoreCanvas } from './canvas-layout';
import type { CanvasLink, CanvasPosition } from './canvas-layout';
import { CanvasPlacementLinks } from './CanvasPlacementLinks';

const edgeHintKey = 'modelloom.canvas-edge-add-discovered';

type Modal =
  | { type: 'placement'; model: DemoModel }
  | { type: 'restart' }
  | { type: 'rename-device'; device: DemoDevice }
  | { type: 'name' }
  | { type: 'delete'; configuration: SavedClusterConfiguration };
const configurationErrors: Readonly<Record<string, string>> = {
  GPU_BUSY: 'The selected GPU is in use by another ModelLoom workload. Stop it and try again.',
  PEER_UNAVAILABLE: 'The other PC disconnected. Check its connection and sharing, then try again.',
  PEER_NOT_APPROVED: 'Verify and approve both app identities before assigning a remote GPU.',
  GPU_NOT_SHARED: 'The selected GPU is no longer shared. Choose a currently shared GPU.',
  INCOMPATIBLE_RUNTIME:
    'Both PCs need the same compatible stock RPC runtime. Update and reconnect.',
  RPC_PACKAGE_REQUIRED:
    'A verified peer runtime is required on both PCs before using a remote GPU.',
  UNSUPPORTED_PEER_GPU: 'Share one GPU on the other PC for the current peer runtime.',
  CLEANUP_FAILED:
    'Runtime shutdown could not be confirmed. Restart the app before trying another allocation.',
  NEEDS_RESOURCE_EVIDENCE:
    'These load settings are not supported by the validated runtime yet. Choose supported settings and try again.',
  NEEDS_SPECULATIVE_EVIDENCE:
    'The selected runtime needs the verified speculative estimator before this configuration can load.',
  INCOMPATIBLE_SPECULATIVE_ASSET: 'Choose a companion compatible with the selected target model.',
  UNSUPPORTED_SPECULATIVE_DEVICE:
    'This head shares target weights. Choose Automatic so it follows the target output device.',
  UNSUPPORTED_SPECULATIVE_RETRIEVAL:
    'Choose n-gram simple or n-gram mod. This retrieval variant has no proven memory bound.',
  PLANNING_CANCELLED: 'Automatic assignment was cancelled. Your previous edits are still here.',
  PLANNING_INCOMPLETE:
    'Automatic assignment could not finish. Try again or assign layers manually.',
  INSUFFICIENT_RESOURCES: 'There is not enough available memory for this configuration.',
  INCOMPATIBLE_DRIVER:
    'The GPU driver is not compatible with this runtime. Update it and try again.',
  NEEDS_MODEL_METADATA:
    'Model layer information is unavailable. Re-import the model before saving an assignment.',
  CONFIGURATION_UNAVAILABLE:
    'Changes could not be saved. Your edits are still here; try editing again to retry.',
  STALE_CONFIGURATION: 'This configuration changed. Select it again before saving or running.',
  NOT_READY: 'Configurations are not available yet. Wait for the model library to finish opening.',
  INVALID_CLUSTER_CONFIGURATION: 'Check the configuration name and settings, then try again.',
};

interface ClusterPageProps extends JoiningProps {
  navigation?: {
    view: ClusterView;
    deviceId: string | null;
    onChange: (view: ClusterView, deviceId: string | null) => void;
  };
  speculativeRequest?: number;
  onSpeculationOpened?: () => void;
  onModelConfiguration?: (modelId: string) => void;
  connectionsRequest?: number;
  onConnectionsOpened?: () => void;
  demo: boolean;
  pendingPeerRequests?: number;
  configurations?: ClusterConfigurations;
  devices: readonly DemoDevice[];
  onRenameDevice: (id: string, name: string) => boolean | void;
  activeModel: DemoModel | undefined;
  models: readonly DemoModel[];
  placement: DemoPlacement;
  dispatch: Dispatch<PlacementAction>;
  onStop: () => void;
  localRuntime?: {
    loading: boolean;
    loadingStage?: number | undefined;
    activeCluster?: RuntimeView['activeCluster'];
    onChoose(model: DemoModel): void;
    onRun(): void;
    onRunConfiguration?(id: string, revision: number): void;
    onRunDraft?(target: { key: string; revision: number; modelId: string }): void;
  };
}

/** Cluster presentation delegates local runtime actions; networking previews remain session-only. */
export function ClusterPage({
  navigation,
  demo,
  joining,
  onJoining,
  devices: availableDevices,
  onRenameDevice,
  activeModel,
  models,
  placement,
  dispatch,
  onStop,
  localRuntime,
  configurations,
  pendingPeerRequests = 0,
  connectionsRequest = 0,
  onConnectionsOpened,
  speculativeRequest = 0,
  onSpeculationOpened,
  onModelConfiguration,
}: ClusterPageProps) {
  const [configurationName, setConfigurationName] = useState('');
  const [localNavigation, setLocalNavigation] = useState<{
    view: ClusterView;
    deviceId: string | null;
  }>({ view: 'overview', deviceId: null });
  const { view, deviceId: deviceDetailsTarget } = navigation ?? localNavigation;
  const onNavigationChange = navigation?.onChange;
  const setRoute = useCallback(
    (view: ClusterView, deviceId: string | null = null) => {
      if (onNavigationChange) onNavigationChange(view, deviceId);
      else setLocalNavigation({ view, deviceId });
    },
    [onNavigationChange],
  );
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const panelId = useId();
  const panelToggle = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const canvasBackground = useRef<HTMLDivElement>(null);
  const [notification, setNotification] = useState<ToastMessage | null>(null);
  const notificationId = useRef(0);
  const dismissNotification = useCallback(() => setNotification(null), []);
  const notify = useCallback((kind: ToastMessage['kind'], message: string) => {
    setNotification({
      id: ++notificationId.current,
      kind,
      message,
      origin: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    });
  }, []);
  const configurationError = configurations?.error;
  const speculativeProposer = configurations?.raw?.load.speculation?.proposer;
  const sharesPlacement = Boolean(
    speculativeProposer &&
    (speculativeProposer.source.kind === 'embedded' ||
      ['dflash', 'dspark', 'eagle3'].includes(speculativeProposer.method)),
  );
  useEffect(() => {
    if (configurationError)
      notify('error', configurationErrors[configurationError] ?? configurationError);
  }, [configurationError, notify]);
  const reportError = (message: string) => {
    if (message) notify('error', message);
  };
  const [selection, setSelection] = useState<ClusterSelection>({ type: 'overview' });
  useEffect(() => {
    if (panelOpen && selection.type !== 'add') panelRef.current?.focus({ preventScroll: true });
  }, [panelOpen, selection.type]);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const closePanel = () => {
    const focusTarget =
      document.activeElement === panelToggle.current ? panelToggle.current : restoreFocus.current;
    setPanelOpen(false);
    setSelection((current) =>
      current.type === 'device' ? { ...current, renaming: false } : current,
    );
    queueMicrotask(() => {
      if (focusTarget?.isConnected) focusTarget.focus();
      else panelToggle.current?.focus();
    });
  };
  const showPanel = (next: ClusterSelection) => {
    restoreFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelection(next);
    if (next.type === 'device') setSelectedDeviceId(next.device.id);
    setPanelOpen(true);
  };
  const dismissPicker = () => {
    setSelection({ type: 'overview' });
    queueMicrotask(
      () =>
        restoreFocus.current?.isConnected && restoreFocus.current.focus({ preventScroll: true }),
    );
  };
  const [modal, setModal] = useState<Modal | null>(null);
  const devices = demo || localRuntime ? availableDevices : [];
  const [removedDevices, setRemovedDevices] = useState<readonly string[]>([]);
  const [sessionArrangement, setSessionArrangement] = useState<{
    positions: Record<string, CanvasPosition>;
    links: readonly CanvasLink[];
  }>({ positions: {}, links: [] });
  const arrangement = configurations?.raw
    ? (configurations.raw.canvas ?? { positions: {}, links: [] })
    : sessionArrangement;
  const setArrangement = (next: typeof sessionArrangement) => {
    if (configurations?.raw) configurations.editCanvas(next);
    else setSessionArrangement(next);
  };
  useEffect(() => {
    if (
      configurations?.raw &&
      !configurations.saved &&
      !configurations.raw.canvas &&
      Object.keys(sessionArrangement.positions).length > 0
    )
      configurations.editCanvas(sessionArrangement);
  }, [configurations, sessionArrangement]);
  const [edgeDiscovered, setEdgeDiscovered] = useState(() => {
    try {
      return localStorage.getItem(edgeHintKey) === 'true';
    } catch {
      return false;
    }
  });
  const localDeviceId = localRuntime ? 'local' : availableDevices[0]?.id;
  const canvasDevices = devices.filter(
    (device) =>
      ((!demo || !removedDevices.includes(device.id)) &&
        (!device.id.startsWith('peer:') || Boolean(arrangement.positions[device.id]))) ||
      device.hardware.some(
        (hardware) =>
          configurations?.raw?.runs.some(
            (run) => run.uuid === hardware.assignmentId && (run.first.trim() || run.last.trim()),
          ) || localRuntime?.activeCluster?.runs.some((run) => run.uuid === hardware.assignmentId),
      ),
  );
  const navigate = useCallback(
    (next: ClusterView) => {
      setRoute(next);
      if (next === 'overview' && deviceDetailsTarget) {
        setPanelOpen(true);
        return;
      }
      setPanelOpen(false);
      setSelection({ type: 'overview' });
    },
    [deviceDetailsTarget, setRoute],
  );
  useEffect(() => {
    if (!connectionsRequest) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      navigate('add');
      onConnectionsOpened?.();
    });
    return () => {
      cancelled = true;
    };
  }, [connectionsRequest, navigate, onConnectionsOpened]);
  useEffect(() => {
    if (!speculativeRequest) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setRoute('overview');
      setSelection({ type: 'speculation' });
      setPanelOpen(true);
      onSpeculationOpened?.();
    });
    return () => {
      cancelled = true;
    };
  }, [speculativeRequest, onSpeculationOpened, setRoute]);
  const liveArrangement = demo ? arrangement : restoreCanvas(canvasDevices, arrangement);
  const positions = demo
    ? canvasPositions(canvasDevices, arrangement.positions)
    : liveArrangement.positions;
  const spatial = !demo || Object.keys(arrangement.positions).length > 0;
  const minColumn = Math.min(0, ...Object.values(positions).map((position) => position.column));
  const minRow = Math.min(0, ...Object.values(positions).map((position) => position.row));
  const columns =
    Math.max(0, ...Object.values(positions).map((position) => position.column)) - minColumn + 1;
  const placementLinks = liveArrangement.links.filter(
    (link) => positions[link.from] && positions[link.to],
  );
  const inspectDevice = (device: DemoDevice) => {
    setRoute('overview');
    if (canvasDevices.some((item) => item.id === device.id)) showPanel({ type: 'device', device });
    else {
      setSelectedDeviceId(device.id);
      showPanel({ type: 'add' });
    }
  };
  const pendingRequests = demo
    ? incomingExamples.filter((request) => !joining.decisions[request.id]).length
    : pendingPeerRequests;
  const currentSelection: ClusterSelection =
    selection.type === 'device'
      ? {
          ...selection,
          device: devices.find((device) => device.id === selection.device.id) ?? selection.device,
        }
      : selection;
  const links = demoLinks.filter(
    (link) =>
      !spatial &&
      canvasDevices.some((device) => device.id === link.from) &&
      canvasDevices.some((device) => device.id === link.to),
  );
  const selectedModel = models.find((model) =>
    configurations
      ? model.id.replace(/^model-/u, '') === configurations.selection?.modelId
      : model.id === placement.modelId,
  );
  const executableGpus = canvasDevices.flatMap((device) => [
    ...device.hardware.flatMap((hardware) =>
      hardware.assignmentId ? [{ hardwareId: hardware.id, uuid: hardware.assignmentId }] : [],
    ),
    ...(device.inventory?.gpus ?? []).flatMap((gpu) =>
      gpu.executionIdentity
        ? [{ hardwareId: `local-${gpu.id}`, uuid: gpu.executionIdentity.uuid }]
        : [],
    ),
  ]);
  const editorInputs = configurations
    ? executableGpus.map((gpu) => ({
        hardwareId: gpu.hardwareId,
        first: configurations.raw?.runs.find((run) => run.uuid === gpu.uuid)?.first ?? '',
        last: configurations.raw?.runs.find((run) => run.uuid === gpu.uuid)?.last ?? '',
      }))
    : placement.inputs;
  const layerCount = configurations
    ? (selectedModel?.blockCount ?? 0)
    : demoLayerCount(selectedModel?.id ?? 'qwen');
  const ranges = editorInputs
    .map((input) => ({
      hardwareId: input.hardwareId,
      first: Number(input.first),
      last: Number(input.last),
    }))
    .filter(
      (range, index) =>
        editorInputs[index]?.first.trim() &&
        editorInputs[index]?.last.trim() &&
        // Physical GPU identities are not in the demo's hardware allowlist.
        (configurations
          ? Number.isInteger(range.first) &&
            Number.isInteger(range.last) &&
            range.first >= 0 &&
            range.first <= range.last &&
            range.last < layerCount
          : validSampleRange(range, layerCount)),
    );
  const loading = localRuntime ? localRuntime.loading : Boolean(placement.launch);
  const canPlace =
    (demo || Boolean(configurations?.raw && layerCount > 0)) && Boolean(selectedModel);
  const changed = configurations
    ? configurations.dirty
    : !localRuntime && hasPlacementChanges(placement);
  const activeCluster = localRuntime?.activeCluster;
  const selectedIsActive = Boolean(
    activeModel &&
    selectedModel?.id === activeModel.id &&
    (activeCluster
      ? activeCluster.draftKey
        ? (configurations?.draft?.key === activeCluster.draftKey &&
            configurations.draft.revision === activeCluster.revision) ||
          Boolean(
            configurations?.selection &&
            !configurations.selection.configurationId &&
            !configurations.draft &&
            !changed &&
            activeCluster.draftKey === `model:${configurations.selection.modelId}`,
          )
        : configurations?.saved?.id === activeCluster.configurationId &&
          configurations.saved.revision === activeCluster.revision
      : !configurations?.selection?.configurationId),
  );
  const appliedRanges = activeCluster
    ? activeCluster.runs.flatMap((run) => {
        const gpu = executableGpus.find((gpu) => gpu.uuid === run.uuid);
        return gpu ? [{ hardwareId: gpu.hardwareId, first: run.first, last: run.last }] : [];
      })
    : activeModel
      ? placement.applied
      : [];
  const editableIds = canvasDevices.flatMap((device) =>
    device.hardware
      .filter(
        (hardware) =>
          hardware.kind !== 'cpu' &&
          (demo || executableGpus.some((gpu) => gpu.hardwareId === hardware.id)),
      )
      .map((hardware) => hardware.id),
  );
  const cardBaseRanges = selectedIsActive && !changed && activeCluster ? appliedRanges : ranges;
  const cardEditsDisabled =
    !canPlace || loading || Boolean(configurations?.pending || configurations?.planning);
  const cardContext = JSON.stringify([
    selectedModel?.id,
    configurations?.selection,
    configurations?.raw,
    editorInputs,
    appliedRanges,
    editableIds,
    layerCount,
  ]);
  const cardEditor = useCardAllocation({
    ranges: cardBaseRanges,
    ids: editableIds,
    total: layerCount,
    context: cardContext,
    disabled: cardEditsDisabled,
    commit: (next) => {
      if (!configurations) {
        dispatch({
          type: 'edit-all',
          inputs: editableIds.map((hardwareId) => {
            const range = next.find((range) => range.hardwareId === hardwareId);
            return {
              hardwareId,
              first: range ? String(range.first) : '',
              last: range ? String(range.last) : '',
            };
          }),
        });
        return;
      }
      const editable = executableGpus.filter((gpu) => editableIds.includes(gpu.hardwareId));
      configurations.edit([
        ...(configurations.raw?.runs ?? []).filter(
          (run) => !editable.some((gpu) => gpu.uuid === run.uuid),
        ),
        ...next.flatMap((range) => {
          const gpu = editable.find((gpu) => gpu.hardwareId === range.hardwareId);
          return gpu
            ? [{ uuid: gpu.uuid, first: String(range.first), last: String(range.last) }]
            : [];
        }),
      ]);
    },
  });
  const runCurrentAllocation = async () => {
    if (!configurations || !localRuntime) return;
    if (configurations.saved && !configurations.dirty) {
      localRuntime.onRunConfiguration?.(configurations.saved.id, configurations.saved.revision);
      return;
    }
    const target = await configurations.prepareRun();
    if (target) localRuntime.onRunDraft?.(target);
    else if (devices[0]) showPanel({ type: 'device', device: devices[0] });
  };
  const assignmentStates: Record<string, AssignmentStatus> = {};
  for (const device of devices) {
    const owns = (hardwareId: string) => device.hardware.some((item) => item.id === hardwareId);
    const hasInput =
      Boolean(selectedModel) &&
      editorInputs.some(
        (input) => owns(input.hardwareId) && Boolean(input.first.trim() || input.last.trim()),
      );
    const hasSaved = Boolean(
      configurations?.saved?.runs.some((run) =>
        executableGpus.some((gpu) => gpu.uuid === run.uuid && owns(gpu.hardwareId)),
      ),
    );
    const inUse = selectedIsActive && appliedRanges.some((range) => owns(range.hardwareId));
    assignmentStates[device.id] =
      changed && (hasInput || hasSaved || inUse)
        ? 'Draft'
        : inUse && !loading
          ? 'In use'
          : hasSaved && hasInput
            ? 'Saved'
            : hasInput
              ? 'Draft'
              : 'No assignment';
  }
  const canUnloadWithoutSelection = Boolean(localRuntime && activeModel && !selectedModel);
  const canUnload = selectedIsActive || canUnloadWithoutSelection;
  const runAction = loading
    ? 'Cancel loading'
    : selectedIsActive && changed && !configurations
      ? 'Apply and restart'
      : canUnload
        ? 'Unload model'
        : 'Load model';
  const close = () => {
    setModal(null);
  };
  const validate = () => {
    const proposal = parseLayerInputs(placement.inputs, layerCount);
    if (!proposal || !completeSamplePlacement(proposal, layerCount)) {
      reportError(
        `Ranges must cover all ${layerCount} sample layers exactly once, without gaps or overlaps.`,
      );
      return false;
    }
    return canPlace && !loading;
  };
  const run = () => {
    if (!validate()) return;
    dismissNotification();
    if (activeModel) setModal({ type: 'restart' });
    else dispatch({ type: 'run' });
  };
  const title =
    modal?.type === 'delete'
      ? 'Delete configuration?'
      : modal?.type === 'placement'
        ? 'Plan layer placement'
        : configurations
          ? 'Apply current allocation?'
          : selectedIsActive
            ? 'Restart demo model?'
            : 'Switch demo model?';

  return (
    <section
      className={styles.page}
      aria-labelledby="cluster-heading"
      onKeyDown={(event) => {
        if (
          !event.defaultPrevented &&
          !(event.target instanceof Element && event.target.closest('[role="menu"]')) &&
          event.key === 'Escape' &&
          panelOpen &&
          !modal &&
          !configurations?.leaveRequested
        ) {
          event.stopPropagation();
          closePanel();
        }
      }}
    >
      <ClusterSidebar
        view={view}
        onNavigate={navigate}
        devices={devices}
        selectedDeviceId={selectedDeviceId ?? undefined}
        onSelect={inspectDevice}
        pendingRequests={pendingRequests}
        local={Boolean(localRuntime)}
        configurations={configurations?.configurations}
        selectedConfigurationId={configurations?.saved?.id}
        onConfiguration={(id) => {
          const configuration = configurations?.configurations.find((item) => item.id === id);
          if (configuration) {
            void configurations?.selectConfiguration(configuration);
            setRoute('overview');
          }
        }}
        deletingDisabled={loading || Boolean(configurations?.pending || configurations?.planning)}
        onDeleteConfiguration={(id) => {
          const configuration = configurations?.configurations.find((item) => item.id === id);
          if (configuration) setModal({ type: 'delete', configuration });
        }}
      />
      <div
        ref={canvasBackground}
        className={`${styles.main} ${view !== 'overview' ? styles.detailsMain : ''}`}
      >
        {notification && (
          <Toast
            key={notification.id}
            notification={notification}
            fallbackRef={panelToggle}
            onDismiss={dismissNotification}
          />
        )}
        <div hidden={view !== 'overview'}>
          <header className={styles.header} data-cluster-sdk="" data-theme="dark">
            <div className={styles.heading}>
              <div className={styles.modelPickerSlot}>
                <ClusterModelPicker
                  local={Boolean(localRuntime)}
                  models={models}
                  selectedModel={selectedModel}
                  activeModelId={activeModel?.id}
                  disabled={
                    cardEditor.editing ||
                    (!demo && !localRuntime) ||
                    loading ||
                    Boolean(configurations?.planning || configurations?.pending)
                  }
                  {...(configurations
                    ? { onClear: () => void configurations.clearSelection() }
                    : {})}
                  onChoose={(model) =>
                    localRuntime
                      ? localRuntime.onChoose(model)
                      : setModal({ type: 'placement', model })
                  }
                />
              </div>
              <div className={styles.historyCapsule} role="group" aria-label="Assignment history">
                <SdkButton
                  type="button"
                  className={styles.sdkButton ?? ''}
                  size="md"
                  color="secondary"
                  variant="ghost"
                  pill
                  uniform
                  aria-label="Undo"
                  title="Undo"
                  disabled={
                    cardEditor.editing ||
                    loading ||
                    !canPlace ||
                    !(configurations ? configurations.canUndo : placement.past.length)
                  }
                  onClick={() =>
                    configurations ? configurations.undo() : dispatch({ type: 'undo' })
                  }
                >
                  <ArrowRotateCcw />
                </SdkButton>
                <SdkButton
                  type="button"
                  className={styles.sdkButton ?? ''}
                  size="md"
                  color="secondary"
                  variant="ghost"
                  pill
                  uniform
                  aria-label="Redo"
                  title="Redo"
                  disabled={
                    cardEditor.editing ||
                    loading ||
                    !canPlace ||
                    !(configurations ? configurations.canRedo : placement.future.length)
                  }
                  onClick={() =>
                    configurations ? configurations.redo() : dispatch({ type: 'redo' })
                  }
                >
                  <ArrowRotateCw />
                </SdkButton>
              </div>
              <Menu>
                <Menu.Trigger>
                  <SdkButton
                    className={styles.sdkButton ?? ''}
                    color="secondary"
                    variant="soft"
                    size="md"
                    pill
                    uniform
                    aria-label="Assignment options"
                    title="Assignment options"
                  >
                    <ChatNavIcon name="more" width="16" height="16" data-no-autosize />
                  </SdkButton>
                </Menu.Trigger>
                <Menu.Content align="start" minWidth={180}>
                  <Menu.Item
                    disabled={
                      cardEditor.editing ||
                      !canPlace ||
                      !changed ||
                      loading ||
                      Boolean(configurations?.planning || configurations?.pending)
                    }
                    onSelect={() => {
                      if (configurations)
                        void configurations.autoPlace([
                          ...new Set(executableGpus.map((gpu) => gpu.uuid)),
                        ]);
                      else dispatch({ type: 'auto-place' });
                    }}
                  >
                    <ChatGptHistoryIcon kind="reset" />
                    <span data-cluster-toolbar-option="">Reset to default</span>
                  </Menu.Item>
                </Menu.Content>
              </Menu>
            </div>
            <div className={styles.toolbarActions} role="group" aria-label="Cluster actions">
              {configurations?.planning && (
                <SdkButton
                  type="button"
                  className={styles.sdkButton ?? ''}
                  size="md"
                  color="secondary"
                  variant="soft"
                  pill
                  uniform
                  aria-label="Cancel planning"
                  title="Cancel planning"
                  onClick={() => {
                    void configurations.cancelPlanning();
                  }}
                >
                  <StopOutline />
                </SdkButton>
              )}
              {configurations && activeModel && !selectedIsActive && (
                <SdkButton
                  type="button"
                  className={styles.sdkButton ?? ''}
                  size="md"
                  color="secondary"
                  variant="soft"
                  pill
                  uniform
                  aria-label="Stop model"
                  title="Stop model"
                  onClick={onStop}
                >
                  <StopOutline />
                </SdkButton>
              )}
              <SdkButton
                type="button"
                className={styles.sdkButton ?? ''}
                size="md"
                color="secondary"
                variant="soft"
                pill
                aria-label="Save configuration"
                title={
                  cardEditor.editing
                    ? 'Finish the layer preview with Done or Cancel first.'
                    : 'Save configuration'
                }
                disabled={
                  cardEditor.editing ||
                  !configurations?.dirty ||
                  loading ||
                  configurations.planning ||
                  configurations.pending
                }
                onClick={() => {
                  if (!configurations) return;
                  if (configurations.saved)
                    void configurations.save(null).then((saved) => {
                      if (!saved && devices[0]) showPanel({ type: 'device', device: devices[0] });
                    });
                  else {
                    setConfigurationName('');
                    setModal({ type: 'name' });
                  }
                }}
              >
                Save
              </SdkButton>
              <SdkButton
                type="button"
                className={`${styles.sdkButton} ${styles.runtimeAction}`}
                size="md"
                color={loading || runAction === 'Unload model' ? 'secondary' : 'primary'}
                variant={loading || runAction === 'Unload model' ? 'soft' : 'solid'}
                pill
                aria-label={runAction}
                title={
                  loading && localRuntime
                    ? `Cancel loading · ${['Preparing allocation', 'Validating model', 'Memory check passed', 'Starting engine', 'Loading model'][Math.min(4, Math.max(0, localRuntime.loadingStage ?? 0))]}`
                    : `${runAction}${loading ? ' · simulated loading' : ''}`
                }
                disabled={
                  (cardEditor.editing && !loading && !selectedIsActive) ||
                  (!demo && !localRuntime) ||
                  (!loading &&
                    !canUnloadWithoutSelection &&
                    (!selectedModel ||
                      !devices.length ||
                      Boolean(
                        configurations &&
                        (!configurations.raw || configurations.pending || configurations.planning),
                      )))
                }
                onClick={() => {
                  if (configurations && localRuntime) {
                    if (loading || canUnload) {
                      onStop();
                      return;
                    }
                    if (!configurations.hasAssignments && selectedModel) {
                      setModal({ type: 'placement', model: selectedModel });
                      return;
                    }
                    if (activeModel) {
                      setModal({ type: 'restart' });
                      return;
                    }
                    void runCurrentAllocation();
                    return;
                  }
                  if (localRuntime) {
                    if (loading || canUnload) onStop();
                    else localRuntime.onRun();
                    return;
                  }
                  if (loading) {
                    dispatch({ type: 'cancel' });
                    notify('information', 'Demo loading cancelled · previous session unchanged');
                  } else if (selectedIsActive && !changed) {
                    onStop();
                    notify('information', 'Demo model stopped · no process was running');
                  } else run();
                }}
              >
                {loading ? (
                  <ModelLoadingIcon stage={localRuntime?.loadingStage ?? 0} />
                ) : runAction === 'Unload model' ? (
                  <StopOutline />
                ) : (
                  <ChatGptPlayIcon />
                )}
                {runAction}
              </SdkButton>
              <span className={styles.srOnly} aria-live="polite">
                {loading
                  ? localRuntime
                    ? 'Loading local model'
                    : 'Loading demo model · no engine is started'
                  : selectedIsActive
                    ? localRuntime
                      ? 'Local model ready'
                      : 'Demo model ready'
                    : 'Selected model not loaded'}
              </span>
              <SdkButton
                type="button"
                ref={panelToggle}
                className={styles.sdkButton ?? ''}
                color="secondary"
                variant="soft"
                size="md"
                pill
                uniform
                aria-label="Cluster panel"
                aria-expanded={panelOpen}
                aria-controls={panelId}
                title={panelOpen ? 'Hide details' : 'Show details'}
                onClick={() => {
                  if (panelOpen) closePanel();
                  else showPanel(selection);
                }}
              >
                <SidebarRight />
              </SdkButton>
            </div>
          </header>
        </div>
        <div className={styles.workspace}>
          <div className={styles.overview} hidden={view !== 'overview'}>
            {canvasDevices.length ? (
              <ClusterCanvas
                backgroundRef={canvasBackground}
                key={
                  configurations?.selection?.configurationId ??
                  configurations?.selection?.modelId ??
                  'session'
                }
                fitOnMount={!demo}
                singleDevice={canvasDevices.length === 1}
                panelId={panelOpen ? panelId : undefined}
                layoutStyle={
                  spatial
                    ? {
                        width: columns * 520 + (columns - 1) * 96,
                        gridTemplateColumns: `repeat(${columns}, minmax(0, 520px))`,
                        gap: 96,
                        minHeight: 0,
                      }
                    : undefined
                }
                onClear={() => {
                  setSelectedDeviceId(null);
                  setSelection({ type: 'overview' });
                }}
              >
                {placementLinks.length > 0 && (
                  <CanvasPlacementLinks
                    links={placementLinks}
                    devices={canvasDevices}
                    onSelect={(link) =>
                      showPanel({ type: 'connection', from: link.from, to: link.to })
                    }
                  />
                )}
                <svg
                  className={styles.connections}
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  {links.map((link) => (
                    <path key={`${link.from}-${link.to}`} d={link.path} />
                  ))}
                </svg>
                {links.map((link) => (
                  <button
                    type="button"
                    key={`${link.from}-${link.to}`}
                    className={styles.latency}
                    style={{ left: `${link.x}%`, top: `${link.y}%` }}
                    aria-label={`Sample connection ${link.from} to ${link.to}: ${link.latencyMs} ms`}
                    onClick={() => showPanel({ type: 'link', link })}
                  >
                    {link.latencyMs} ms
                  </button>
                ))}
                {canvasDevices.map((device) => (
                  <div
                    key={device.id}
                    className={styles.deviceSlot}
                    data-canvas-device={device.id}
                    style={{
                      gridColumn: spatial
                        ? String(positions[device.id]!.column - minColumn + 1)
                        : canvasDevices.length === 1
                          ? '1'
                          : device.role === 'Coordinator'
                            ? '1 / -1'
                            : device.id === 'workstation'
                              ? '1'
                              : device.id === 'mac'
                                ? '2'
                                : '3',
                      gridRow: spatial
                        ? String(positions[device.id]!.row - minRow + 1)
                        : canvasDevices.length === 1 || device.role === 'Coordinator'
                          ? '1'
                          : '2',
                    }}
                  >
                    <DeviceCard
                      device={device}
                      ranges={cardEditor.ranges}
                      allocation={cardEditor.allocation}
                      editableIds={editableIds}
                      appliedRanges={appliedRanges}
                      layerCount={layerCount}
                      modelSelected={Boolean(selectedModel)}
                      proposed={!selectedIsActive || changed || loading}
                      savedAssignment={Boolean(configurations?.saved && !changed)}
                      loading={cardEditsDisabled}
                      active={canPlace}
                      localReady={false}
                      onSelect={(device) => showPanel({ type: 'device', device })}
                      onDetails={(device) => {
                        setSelectedDeviceId(device.id);
                        setRoute('devices', device.id);
                        setPanelOpen(false);
                      }}
                      onRename={(device) => setModal({ type: 'rename-device', device })}
                      selected={selectedDeviceId === device.id}
                      showAddHint={canvasDevices.length === 1 && !edgeDiscovered}
                      addEdge={
                        panelOpen &&
                        selection.type === 'add' &&
                        selection.anchor?.deviceId === device.id
                          ? selection.anchor.edge
                          : undefined
                      }
                      onAdd={(edge) =>
                        showPanel({ type: 'add', anchor: { deviceId: device.id, edge } })
                      }
                      removeDisabled={
                        loading ||
                        Boolean(activeModel) ||
                        Boolean(configurations?.planning || configurations?.saving) ||
                        device.hardware.some(
                          (hardware) =>
                            editorInputs.some(
                              (input) =>
                                input.hardwareId === hardware.id &&
                                Boolean(input.first.trim() || input.last.trim()),
                            ) ||
                            appliedRanges.some((range) => range.hardwareId === hardware.id) ||
                            localRuntime?.activeCluster?.runs.some(
                              (run) => run.uuid === hardware.assignmentId,
                            ),
                        )
                      }
                      onRemove={
                        device.id === localDeviceId
                          ? undefined
                          : () => {
                              setArrangement({
                                positions: Object.fromEntries(
                                  Object.entries(arrangement.positions).filter(
                                    ([id]) => id !== device.id,
                                  ),
                                ),
                                links: arrangement.links.filter(
                                  (link) => link.from !== device.id && link.to !== device.id,
                                ),
                              });
                              setRemovedDevices((current) => [...current, device.id]);
                              if (
                                panelOpen &&
                                currentSelection.type === 'device' &&
                                currentSelection.device.id === device.id
                              ) {
                                queueMicrotask(() => panelRef.current?.focus());
                              } else {
                                closePanel();
                                queueMicrotask(() => panelToggle.current?.focus());
                              }
                            }
                      }
                      onEdit={(hardwareId) => showPanel({ type: 'device', device, hardwareId })}
                    />
                  </div>
                ))}
              </ClusterCanvas>
            ) : (
              <div className={styles.empty}>
                <Network size={34} />
                <h2>No devices connected</h2>
                <p>Device discovery becomes available with networking integration.</p>
              </div>
            )}
          </div>
          {view !== 'overview' && (
            <ClusterViews
              view={view}
              demo={demo}
              local={Boolean(localRuntime)}
              joining={joining}
              onJoining={onJoining}
              devices={devices}
              links={demo ? demoLinks : []}
              onLink={(link) => showPanel({ type: 'link', link })}
              onConnectionAction={navigate}
              targetDeviceId={deviceDetailsTarget ?? undefined}
            />
          )}
        </div>
        <div className={summaryStyles.viewport}>
          <AnimatePresence>
            {panelOpen && view === 'overview' && (
              <ClusterPanel
                id={panelId}
                local={Boolean(localRuntime)}
                onModelConfiguration={
                  selectedModel && onModelConfiguration
                    ? () => onModelConfiguration(selectedModel.id.replace(/^model-/u, ''))
                    : undefined
                }
                speculation={{
                  enabled: configurations?.raw?.load.speculation?.enabled ?? false,
                  method: configurations?.raw?.load.speculation?.proposer?.method.toUpperCase(),
                  retrieval: Boolean(configurations?.raw?.load.speculation?.retrieval),
                  pendingHint:
                    (configurations?.raw?.proposerDevice ?? 'auto') !==
                    (configurations?.saved?.proposerDevice ?? 'auto')
                      ? 'Save, then reload to apply.'
                      : configurations?.saved && !selectedIsActive
                        ? 'Saved · reload to apply.'
                        : undefined,
                  proposer: Boolean(
                    configurations?.raw?.load.speculation?.enabled &&
                    configurations.raw.load.speculation.proposer,
                  ),
                  device: configurations?.raw?.proposerDevice ?? 'auto',
                  devices: sharesPlacement
                    ? []
                    : [
                        { value: 'cpu', label: 'This PC CPU' },
                        ...executableGpus
                          .filter(
                            (gpu, index, all) =>
                              all.findIndex((item) => item.uuid === gpu.uuid) === index,
                          )
                          .map((gpu) => {
                            const device = canvasDevices.find(
                              (item) =>
                                item.hardware.some((hardware) => hardware.id === gpu.hardwareId) ||
                                item.inventory?.gpus?.some(
                                  (hardware) => `local-${hardware.id}` === gpu.hardwareId,
                                ),
                            );
                            const hardware = device?.hardware.find(
                              (item) => item.id === gpu.hardwareId,
                            );
                            return {
                              value: gpu.uuid,
                              label: `${device?.name ?? 'This PC'} · ${hardware?.label ?? 'GPU'}`,
                            };
                          }),
                      ],
                  ...(sharesPlacement
                    ? {
                        placementNote:
                          'This head follows the target output placement in this runtime.',
                      }
                    : {}),
                  onDevice: (value) => configurations?.setProposerDevice(value),
                }}
                selectedDeviceId={selectedDeviceId ?? undefined}
                selection={currentSelection}
                devices={canvasDevices}
                canvasCandidates={devices.filter(
                  (device) =>
                    device.id !== localDeviceId &&
                    !canvasDevices.some((placed) => placed.id === device.id),
                )}
                onAddDevice={() => navigate('add')}
                onAddToCanvas={(device) => {
                  if (loading || activeModel || configurations?.planning || configurations?.saving)
                    return;
                  const requested =
                    currentSelection.type === 'add' ? currentSelection.anchor : undefined;
                  const anchor =
                    requested && positions[requested.deviceId]
                      ? requested
                      : canvasDevices[0]
                        ? { deviceId: canvasDevices[0].id, edge: 'right' as const }
                        : undefined;
                  if (anchor) {
                    const next = placeBeside(positions, anchor.deviceId, anchor.edge);
                    const links = new Map(arrangement.links.map((link) => [link.to, link]));
                    for (const link of liveArrangement.links) links.set(link.to, link);
                    links.set(device.id, {
                      from: anchor.deviceId,
                      to: device.id,
                      edge: anchor.edge,
                    });
                    setArrangement({
                      positions: { ...arrangement.positions, ...positions, [device.id]: next },
                      links: [...links.values()],
                    });
                  }
                  setEdgeDiscovered(true);
                  try {
                    localStorage.setItem(edgeHintKey, 'true');
                  } catch {
                    /* Optional presentation preference; session state still dismisses the hint. */
                  }
                  setRemovedDevices((current) => current.filter((id) => id !== device.id));
                  dismissPicker();
                }}
                activeModel={activeModel}
                selectedModel={selectedModel}
                loading={loading}
                editingDisabled={
                  loading || Boolean(configurations?.planning || configurations?.saving)
                }
                canvasMutationDisabled={
                  loading ||
                  Boolean(activeModel || configurations?.planning || configurations?.saving)
                }
                ranges={canPlace ? cardEditor.ranges : []}
                contextLabel={
                  configurations?.raw
                    ? configurations.raw.load.defaults.automatic
                      ? 'Automatic'
                      : `${configurations.raw.load.defaults.contextLength.toLocaleString('en-US')} tokens`
                    : demo
                      ? '8,192 tokens'
                      : 'Unavailable'
                }
                assignmentStates={assignmentStates}
                panelRef={panelRef}
                onClose={closePanel}
                onOverview={dismissPicker}
              />
            )}
          </AnimatePresence>
        </div>
      </div>
      {configurations?.leaveRequested && (
        <UnsavedClusterChangesDialog
          modelName={selectedModel?.name ?? 'Configuration'}
          saved={Boolean(configurations.saved)}
          busy={configurations.leaving}
          onClose={configurations.cancelLeave}
          onSave={configurations.saveAndLeave}
          onDiscard={configurations.discardAndLeave}
        />
      )}
      {modal && (
        <Dialog
          title={
            modal.type === 'name'
              ? 'Save configuration'
              : modal.type === 'rename-device'
                ? 'Rename device'
                : title
          }
          onClose={close}
          {...(modal.type === 'delete' ? { initialFocus: 'cancel' as const } : {})}
        >
          {modal.type === 'rename-device' && (
            <DeviceNameEditor
              device={devices.find((device) => device.id === modal.device.id) ?? modal.device}
              onCancel={close}
              onSave={(name) => {
                if (onRenameDevice(modal.device.id, name) === false) {
                  notify('error', 'Could not save the device name. Try again.');
                  return;
                }
                close();
                notify('success', 'Device renamed');
              }}
            />
          )}
          {modal.type === 'delete' && (
            <>
              <p>
                Delete <strong>{modal.configuration.name}</strong>?
              </p>
              <p>
                This removes the saved configuration and its draft. Your model and model settings
                are kept.
              </p>
              <footer>
                <Button data-dialog-cancel onClick={close}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    const configuration = modal.configuration;
                    close();
                    void configurations?.remove(configuration).then((removed) => {
                      if (removed) notify('success', 'Configuration deleted.');
                    });
                  }}
                >
                  Delete
                </Button>
              </footer>
            </>
          )}
          {modal.type === 'name' && (
            <>
              <label className={styles.renameField}>
                Configuration name
                <input
                  autoFocus
                  aria-label="Configuration name"
                  value={configurationName}
                  onChange={(event) => setConfigurationName(event.target.value)}
                />
              </label>
              <footer>
                <Button onClick={close}>Cancel</Button>
                <Button
                  disabled={!configurationName.trim()}
                  onClick={() => {
                    void configurations?.save(configurationName).then((saved) => {
                      close();
                      if (!saved && devices[0]) showPanel({ type: 'device', device: devices[0] });
                    });
                  }}
                >
                  Save
                </Button>
              </footer>
            </>
          )}
          {modal.type === 'restart' && (
            <>
              <p>
                Load {selectedModel?.name} with the {configurations ? 'current' : 'proposed sample'}{' '}
                allocation
                {activeModel ? `, replacing the current session for ${activeModel.name}` : ''}?
              </p>
              <p>
                {configurations
                  ? 'Restarting interrupts active Chat and API requests. The current allocation is checked again before loading.'
                  : 'In the connected app, restarting interrupts active Chat and API requests. This demo runs no inference and restarts no process.'}
              </p>
              <footer>
                <Button onClick={close}>Cancel</Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    if (configurations && localRuntime) {
                      void runCurrentAllocation();
                      close();
                      return;
                    }
                    if (validate()) {
                      dismissNotification();
                      dispatch({ type: 'run' });
                      close();
                    }
                  }}
                >
                  {configurations
                    ? 'Apply and restart'
                    : selectedIsActive
                      ? 'Restart demo'
                      : 'Switch and run demo'}
                </Button>
              </footer>
            </>
          )}
          {modal.type === 'placement' && (
            <>
              <p>
                Choose how to assign layers for <strong>{modal.model.name}</strong>.
              </p>
              <p>
                {configurations
                  ? 'After assigning layers, click the Play button again to load. Save is optional.'
                  : 'Auto place uses a sample allocation in this demo; no optimizer or memory-fit check runs.'}
              </p>
              <div className={styles.placementChoices}>
                <Button
                  onClick={() => {
                    if (configurations) {
                      if (selectedModel?.id === modal.model.id)
                        void configurations.autoPlace([
                          ...new Set(executableGpus.map((gpu) => gpu.uuid)),
                        ]);
                      close();
                      return;
                    }
                    dispatch({ type: 'choose', modelId: modal.model.id, mode: 'auto' });
                    dismissNotification();
                    close();
                  }}
                >
                  Auto place
                </Button>
                <Button
                  onClick={() => {
                    if (configurations) {
                      if (selectedModel?.id === modal.model.id && devices[0])
                        showPanel({ type: 'device', device: devices[0] });
                      close();
                      return;
                    }
                    dispatch({ type: 'choose', modelId: modal.model.id, mode: 'manual' });
                    dismissNotification();
                    close();
                  }}
                >
                  Place manually
                </Button>
              </div>
            </>
          )}
        </Dialog>
      )}
    </section>
  );
}
