import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Dispatch } from 'react';
import type { ClusterConfigurations } from './useClusterConfigurations';
import type { SavedClusterConfiguration } from '../../../shared/cluster-configuration';
import type { RuntimeView } from '../../../shared/runtime';
import { FloppyDisk } from '@phosphor-icons/react/dist/csr/FloppyDisk';
import { Network } from '@phosphor-icons/react/dist/csr/Network';
import { SidebarSimple } from '@phosphor-icons/react/dist/csr/SidebarSimple';
import { ChatGptPlayIcon } from '../../components/ChatGptPlayIcon';
import { ChatGptHistoryIcon } from '../../components/ChatGptHistoryIcon';
import { Stop as Square } from '@phosphor-icons/react/dist/csr/Stop';
import { ArrowClockwise as RotateCw } from '@phosphor-icons/react/dist/csr/ArrowClockwise';
import { Spinner as LoaderCircle } from '@phosphor-icons/react/dist/csr/Spinner';
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
import type { DemoDevice, DemoPlacement, LayerInput, PlacementAction } from '../../mocks/cluster';
import { DeviceCard } from './DeviceCard';
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
import { canvasPositions, placeBeside } from './canvas-layout';
import type { CanvasLink, CanvasPosition } from './canvas-layout';
import { CanvasPlacementLinks } from './CanvasPlacementLinks';

const edgeHintKey = 'modelloom.canvas-edge-add-discovered';

type Modal =
  | { type: 'placement'; model: DemoModel }
  | { type: 'restart' }
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
  connectionsRequest?: number;
  onConnectionsOpened?: () => void;
  demo: boolean;
  pendingPeerRequests?: number;
  configurations?: ClusterConfigurations;
  devices: readonly DemoDevice[];
  onRenameDevice: (id: string, name: string) => void;
  activeModel: DemoModel | undefined;
  models: readonly DemoModel[];
  placement: DemoPlacement;
  dispatch: Dispatch<PlacementAction>;
  onStop: () => void;
  localRuntime?: {
    loading: boolean;
    activeCluster?: RuntimeView['activeCluster'];
    onChoose(model: DemoModel): void;
    onRun(): void;
    onRunConfiguration?(id: string, revision: number): void;
    onRunDraft?(target: { key: string; revision: number; modelId: string }): void;
  };
}

/** Cluster presentation delegates local runtime actions; networking previews remain session-only. */
export function ClusterPage({
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
}: ClusterPageProps) {
  const [configurationName, setConfigurationName] = useState('');
  const [validatedDemoInputs, setValidatedDemoInputs] = useState<readonly LayerInput[] | null>(
    null,
  );
  const [view, setView] = useState<ClusterView>('overview');
  const [deviceDetailsTarget, setDeviceDetailsTarget] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const panelId = useId();
  const panelToggle = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
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
  useEffect(() => {
    if (configurationError)
      notify('error', configurationErrors[configurationError] ?? configurationError);
  }, [configurationError, notify]);
  const reportError = (message: string) => {
    if (message) notify('error', message);
  };
  useEffect(() => {
    if (panelOpen) panelRef.current?.focus();
  }, [panelOpen]);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const [selection, setSelection] = useState<ClusterSelection>({ type: 'overview' });
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
    setPanelOpen(true);
  };
  const [modal, setModal] = useState<Modal | null>(null);
  const devices = demo || localRuntime ? availableDevices : [];
  const [placedPeers, setPlacedPeers] = useState<readonly string[]>([]);
  const [removedDevices, setRemovedDevices] = useState<readonly string[]>([]);
  const [arrangement, setArrangement] = useState<{
    positions: Record<string, CanvasPosition>;
    links: readonly CanvasLink[];
  }>({ positions: {}, links: [] });
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
      (!removedDevices.includes(device.id) &&
        (!device.id.startsWith('peer:') || placedPeers.includes(device.id))) ||
      device.hardware.some(
        (hardware) =>
          configurations?.raw?.runs.some(
            (run) => run.uuid === hardware.assignmentId && (run.first.trim() || run.last.trim()),
          ) || localRuntime?.activeCluster?.runs.some((run) => run.uuid === hardware.assignmentId),
      ),
  );
  const navigate = useCallback(
    (next: ClusterView) => {
      setView(next);
      if (next === 'overview' && deviceDetailsTarget) {
        setDeviceDetailsTarget(null);
        setPanelOpen(true);
        return;
      }
      setDeviceDetailsTarget(null);
      setPanelOpen(false);
      setSelection({ type: 'overview' });
    },
    [deviceDetailsTarget],
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
  const positions = canvasPositions(canvasDevices, arrangement.positions);
  const spatial = Object.keys(arrangement.positions).length > 0;
  const minColumn = Math.min(0, ...Object.values(positions).map((position) => position.column));
  const minRow = Math.min(0, ...Object.values(positions).map((position) => position.row));
  const columns =
    Math.max(0, ...Object.values(positions).map((position) => position.column)) - minColumn + 1;
  const placementLinks = arrangement.links.filter(
    (link) => positions[link.from] && positions[link.to],
  );
  const inspectDevice = (device: DemoDevice) => {
    setDeviceDetailsTarget(null);
    setView('overview');
    showPanel({ type: 'device', device });
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
    configurations?.selection
      ? model.id.replace(/^model-/u, '') === configurations.selection.modelId
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
        ? configurations?.draft?.key === activeCluster.draftKey &&
          configurations.draft.revision === activeCluster.revision
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
  const runAction = loading
    ? 'Cancel loading'
    : selectedIsActive && changed && !configurations
      ? 'Apply and restart'
      : selectedIsActive
        ? 'Stop model'
        : 'Run model';
  const RunIcon = loading
    ? LoaderCircle
    : selectedIsActive && changed && !configurations
      ? RotateCw
      : selectedIsActive
        ? Square
        : null;
  const close = () => {
    setModal(null);
  };
  const validate = () => {
    setValidatedDemoInputs(placement.inputs);
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
        if (event.key === 'Escape' && panelOpen && !modal && !configurations?.leaveRequested) {
          event.stopPropagation();
          closePanel();
        }
      }}
    >
      <ClusterSidebar
        view={view}
        onNavigate={navigate}
        devices={devices}
        selectedDeviceId={selection.type === 'device' ? selection.device.id : undefined}
        onSelect={inspectDevice}
        pendingRequests={pendingRequests}
        local={Boolean(localRuntime)}
        configurations={configurations?.configurations}
        selectedConfigurationId={configurations?.saved?.id}
        onConfiguration={(id) => {
          const configuration = configurations?.configurations.find((item) => item.id === id);
          if (configuration) {
            void configurations?.selectConfiguration(configuration);
            setView('overview');
          }
        }}
        deletingDisabled={loading || Boolean(configurations?.pending || configurations?.planning)}
        onDeleteConfiguration={(id) => {
          const configuration = configurations?.configurations.find((item) => item.id === id);
          if (configuration) setModal({ type: 'delete', configuration });
        }}
      />
      <div className={`${styles.main} ${view !== 'overview' ? styles.detailsMain : ''}`}>
        {notification && (
          <Toast
            key={notification.id}
            notification={notification}
            fallbackRef={panelToggle}
            onDismiss={dismissNotification}
          />
        )}
        <div hidden={view !== 'overview'}>
          <header className={styles.header}>
            <div className={styles.heading}>
              <div
                className={`${styles.actionCapsule} ${styles.historyCapsule}`}
                role="group"
                aria-label="Assignment history"
              >
                <button
                  type="button"
                  className={styles.runIcon}
                  aria-label="Undo"
                  title="Undo"
                  disabled={
                    loading ||
                    !canPlace ||
                    !(configurations ? configurations.canUndo : placement.past.length)
                  }
                  onClick={() =>
                    configurations ? configurations.undo() : dispatch({ type: 'undo' })
                  }
                >
                  <ChatGptHistoryIcon kind="undo" />
                </button>
                <button
                  type="button"
                  className={styles.runIcon}
                  aria-label="Redo"
                  title="Redo"
                  disabled={
                    loading ||
                    !canPlace ||
                    !(configurations ? configurations.canRedo : placement.future.length)
                  }
                  onClick={() =>
                    configurations ? configurations.redo() : dispatch({ type: 'redo' })
                  }
                >
                  <ChatGptHistoryIcon kind="redo" />
                </button>
                <span className={styles.historyDivider} aria-hidden="true" />
                <button
                  type="button"
                  className={styles.runIcon}
                  aria-label="Reset to default"
                  title="Reset to default"
                  disabled={
                    !canPlace ||
                    !changed ||
                    loading ||
                    Boolean(configurations?.planning || configurations?.pending)
                  }
                  onClick={() => {
                    if (configurations)
                      void configurations.autoPlace([
                        ...new Set(executableGpus.map((gpu) => gpu.uuid)),
                      ]);
                    else dispatch({ type: 'auto-place' });
                  }}
                >
                  <ChatGptHistoryIcon kind="reset" />
                </button>
              </div>
              <ClusterModelPicker
                local={Boolean(localRuntime)}
                models={models}
                selectedModel={selectedModel}
                activeModelId={activeModel?.id}
                disabled={
                  (!demo && !localRuntime) ||
                  loading ||
                  Boolean(configurations?.planning || configurations?.pending)
                }
                onChoose={(model) =>
                  localRuntime
                    ? localRuntime.onChoose(model)
                    : setModal({ type: 'placement', model })
                }
              />
              <div className={styles.actionCapsule} role="group" aria-label="Cluster actions">
                {configurations?.planning && (
                  <button
                    type="button"
                    className={styles.runIcon}
                    aria-label="Cancel planning"
                    title="Cancel planning"
                    onClick={() => {
                      void configurations.cancelPlanning();
                    }}
                  >
                    <Square size={16} aria-hidden="true" />
                  </button>
                )}
                {configurations && activeModel && !selectedIsActive && (
                  <button
                    type="button"
                    className={styles.runIcon}
                    aria-label="Stop model"
                    title="Stop model"
                    onClick={onStop}
                  >
                    <Square size={16} aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  className={styles.runIcon}
                  aria-label="Save configuration"
                  title="Save configuration"
                  disabled={
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
                  <FloppyDisk size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={styles.runIcon}
                  aria-label={runAction}
                  title={`${runAction}${loading && !localRuntime ? ' · simulated loading' : ''}`}
                  disabled={
                    (!demo && !localRuntime) ||
                    (!loading &&
                      (!selectedModel ||
                        !devices.length ||
                        Boolean(
                          configurations &&
                          (!configurations.raw ||
                            configurations.pending ||
                            configurations.planning),
                        )))
                  }
                  onClick={() => {
                    if (configurations && localRuntime) {
                      if (loading || selectedIsActive) {
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
                      if (loading || selectedIsActive) onStop();
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
                  {RunIcon ? (
                    <RunIcon size={16} weight="regular" aria-hidden="true" />
                  ) : (
                    <ChatGptPlayIcon />
                  )}
                </button>
              </div>
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
            </div>
            <button
              type="button"
              ref={panelToggle}
              className={styles.panelToggle}
              aria-label="Cluster panel"
              aria-expanded={panelOpen}
              aria-controls={panelId}
              title={panelOpen ? 'Hide details' : 'Show details'}
              onClick={() => {
                if (panelOpen) closePanel();
                else showPanel(selection);
              }}
            >
              <SidebarSimple size={16} aria-hidden="true" />
            </button>
          </header>
        </div>
        <div className={styles.workspace}>
          <div className={styles.overview} hidden={view !== 'overview'}>
            {canvasDevices.length ? (
              <ClusterCanvas
                singleDevice={canvasDevices.length === 1}
                panelId={canvasDevices.length === 1 && panelOpen ? panelId : undefined}
                layoutStyle={
                  spatial
                    ? {
                        width: columns * 498 + (columns - 1) * 96,
                        gridTemplateColumns: `repeat(${columns}, minmax(0, 498px))`,
                        gap: 96,
                        minHeight: 0,
                      }
                    : undefined
                }
                onClear={() => {
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
                      ranges={
                        selectedIsActive && !changed && activeCluster ? appliedRanges : ranges
                      }
                      appliedRanges={appliedRanges}
                      layerCount={layerCount}
                      proposed={!selectedIsActive || changed || loading}
                      savedAssignment={Boolean(configurations?.saved && !changed)}
                      loading={loading}
                      active={canPlace}
                      localReady={false}
                      onDetails={(device) => showPanel({ type: 'device', device })}
                      onRename={(device) => showPanel({ type: 'device', device, renaming: true })}
                      selected={selection.type === 'device' && selection.device.id === device.id}
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
                              setPlacedPeers((current) => current.filter((id) => id !== device.id));
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
          {panelOpen && (
            <ClusterPanel
              id={panelId}
              demo={demo}
              local={Boolean(localRuntime)}
              joining={joining}
              onJoining={onJoining}
              selection={currentSelection}
              devices={canvasDevices}
              canvasCandidates={devices.filter(
                (device) =>
                  device.id !== localDeviceId &&
                  !canvasDevices.some((placed) => placed.id === device.id),
              )}
              onAddDevice={() => navigate('add')}
              onDeviceDetails={(device) => {
                setDeviceDetailsTarget(device.id);
                setView('devices');
                setPanelOpen(false);
              }}
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
                  setArrangement({
                    positions: { ...positions, [device.id]: next },
                    links: [
                      ...arrangement.links.filter((link) => link.to !== device.id),
                      {
                        from: anchor.deviceId,
                        to: device.id,
                        edge: anchor.edge,
                      },
                    ],
                  });
                }
                setEdgeDiscovered(true);
                try {
                  localStorage.setItem(edgeHintKey, 'true');
                } catch {
                  /* Optional presentation preference; session state still dismisses the hint. */
                }
                setRemovedDevices((current) => current.filter((id) => id !== device.id));
                setPlacedPeers((current) =>
                  current.includes(device.id) ? current : [...current, device.id],
                );
                if (currentSelection.type !== 'device') closePanel();
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
              inputs={editorInputs}
              layerCount={layerCount}
              assignmentStates={assignmentStates}
              canPlace={canPlace}
              saveIssues={
                configurations?.issues.map((issue) => ({
                  ...issue,
                  hardwareId: executableGpus.find((gpu) => gpu.uuid === issue.uuid)?.hardwareId,
                })) ??
                (validatedDemoInputs === placement.inputs
                  ? placement.inputs
                      .filter((input) => parseLayerInputs([input], layerCount) === null)
                      .map((input) => ({ hardwareId: input.hardwareId, field: 'first' }))
                  : [])
              }
              panelRef={panelRef}
              onClose={closePanel}
              onOverview={() => setSelection({ type: 'overview' })}
              onSelect={(device) => showPanel({ type: 'device', device })}
              onEdit={(input) => {
                if (
                  currentSelection.type !== 'device' ||
                  !canvasDevices.some((device) => device.id === currentSelection.device.id)
                )
                  return;
                if (!configurations) {
                  dispatch({ type: 'edit', input });
                  return;
                }
                const gpu = executableGpus.find((item) => item.hardwareId === input.hardwareId);
                if (!gpu) return;
                const runs = configurations.raw?.runs ?? [];
                const next = { uuid: gpu.uuid, first: input.first, last: input.last };
                configurations.edit(
                  input.first || input.last
                    ? runs.some((run) => run.uuid === gpu.uuid)
                      ? runs.map((run) => (run.uuid === gpu.uuid ? next : run))
                      : [...runs, next]
                    : runs.filter((run) => run.uuid !== gpu.uuid),
                );
              }}
              onStartRename={() => {
                if (currentSelection.type === 'device')
                  setSelection({ type: 'device', device: currentSelection.device, renaming: true });
              }}
              onCancelRename={() => {
                if (currentSelection.type === 'device')
                  setSelection({ ...currentSelection, renaming: false });
              }}
              onRename={(name) => {
                if (currentSelection.type !== 'device') return;
                onRenameDevice(currentSelection.device.id, name);
                setSelection({ ...currentSelection, renaming: false });
                notify('success', 'Device renamed');
              }}
            />
          )}
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
          title={modal.type === 'name' ? 'Save configuration' : title}
          onClose={close}
          {...(modal.type === 'delete' ? { initialFocus: 'cancel' as const } : {})}
        >
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
