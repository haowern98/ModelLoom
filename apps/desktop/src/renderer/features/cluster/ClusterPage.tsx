import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Dispatch } from 'react';
import { Network } from '@phosphor-icons/react/dist/csr/Network';
import { SidebarSimple } from '@phosphor-icons/react/dist/csr/SidebarSimple';
import { PlayCircle as Play } from '@phosphor-icons/react/dist/csr/PlayCircle';
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
import type { DemoDevice, DemoPlacement, PlacementAction } from '../../mocks/cluster';
import { DeviceCard } from './DeviceCard';
import { ClusterCanvas } from './ClusterCanvas';
import { ClusterPanel } from './ClusterPanel';
import { ClusterModelPicker } from './ClusterModelPicker';
import { ClusterSidebar } from './ClusterSidebar';
import type { ClusterView } from './ClusterSidebar';
import { ClusterViews } from './ClusterViews';
import { incomingExamples } from '../../mocks/clusterJoining';
import type { JoiningProps } from './ClusterJoiningPanel';
import type { ClusterSelection } from './ClusterPanel';
import styles from './ClusterPage.module.css';

type Modal = { type: 'placement'; model: DemoModel } | { type: 'restart' };

interface ClusterPageProps extends JoiningProps {
  demo: boolean;
  devices: readonly DemoDevice[];
  onRenameDevice: (id: string, name: string) => void;
  activeModel: DemoModel | undefined;
  models: readonly DemoModel[];
  placement: DemoPlacement;
  dispatch: Dispatch<PlacementAction>;
  onStop: () => void;
  localRuntime?: { loading: boolean; onChoose(model: DemoModel): void; onRun(): void };
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
}: ClusterPageProps) {
  const [view, setView] = useState<ClusterView>('overview');
  const [panelOpen, setPanelOpen] = useState(false);
  const panelId = useId();
  const panelToggle = useRef<HTMLButtonElement>(null);
  const panelClose = useRef<HTMLButtonElement>(null);
  const [notification, setNotification] = useState<ToastMessage | null>(null);
  const notificationId = useRef(0);
  const dismissNotification = useCallback(() => setNotification(null), []);
  const notify = (kind: ToastMessage['kind'], message: string) => {
    setNotification({
      id: ++notificationId.current,
      kind,
      message,
      origin: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    });
  };
  const reportError = (message: string) => {
    if (message) notify('error', message);
  };
  useEffect(() => {
    if (panelOpen) panelClose.current?.focus();
  }, [panelOpen]);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const [selection, setSelection] = useState<ClusterSelection>({ type: 'overview' });
  const closePanel = () => {
    setPanelOpen(false);
    setSelection((current) =>
      current.type === 'device' ? { ...current, renaming: false } : current,
    );
    queueMicrotask(() => {
      if (restoreFocus.current?.isConnected) restoreFocus.current.focus();
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
  const navigate = (next: ClusterView) => {
    setView(next);
    setPanelOpen(false);
    setSelection({ type: 'overview' });
  };
  const inspectDevice = (device: DemoDevice) => {
    setView('overview');
    showPanel({ type: 'device', device });
  };
  const pendingRequests = demo
    ? incomingExamples.filter((request) => !joining.decisions[request.id]).length
    : 0;
  const currentSelection: ClusterSelection =
    selection.type === 'device'
      ? {
          ...selection,
          device: devices.find((device) => device.id === selection.device.id) ?? selection.device,
        }
      : selection;
  const links = demoLinks.filter(
    (link) =>
      devices.some((device) => device.id === link.from) &&
      devices.some((device) => device.id === link.to),
  );
  const selectedModel = models.find((model) => model.id === placement.modelId);
  const layerCount = demoLayerCount(selectedModel?.id ?? 'qwen');
  const ranges = placement.inputs
    .map((input) => ({
      hardwareId: input.hardwareId,
      first: Number(input.first),
      last: Number(input.last),
    }))
    .filter(
      (range, index) =>
        placement.inputs[index]?.first.trim() &&
        placement.inputs[index]?.last.trim() &&
        validSampleRange(range, layerCount),
    );
  const loading = localRuntime ? localRuntime.loading : Boolean(placement.launch);
  const canPlace = demo && Boolean(selectedModel);
  const changed = !localRuntime && hasPlacementChanges(placement);
  const selectedIsActive = selectedModel?.id === activeModel?.id && Boolean(activeModel);
  const runAction = loading
    ? 'Cancel loading'
    : selectedIsActive && changed
      ? 'Apply and restart'
      : selectedIsActive
        ? 'Stop model'
        : 'Run model';
  const RunIcon = loading
    ? LoaderCircle
    : selectedIsActive && changed
      ? RotateCw
      : selectedIsActive
        ? Square
        : Play;
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
    modal?.type === 'placement'
      ? 'Plan layer placement'
      : selectedIsActive
        ? 'Restart demo model?'
        : 'Switch demo model?';

  return (
    <section
      className={styles.page}
      aria-labelledby="cluster-heading"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && panelOpen && !modal) {
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
      />
      <div
        className={`${styles.main} ${['devices', 'connections', 'requests'].includes(view) ? styles.detailsMain : ''}`}
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
          <header className={styles.header}>
            <div className={styles.heading}>
              <ClusterModelPicker
                local={Boolean(localRuntime)}
                models={models}
                selectedModel={selectedModel}
                activeModelId={activeModel?.id}
                disabled={(!demo && !localRuntime) || loading}
                onChoose={(model) =>
                  localRuntime
                    ? localRuntime.onChoose(model)
                    : setModal({ type: 'placement', model })
                }
              />
              <div className={styles.actionCapsule} role="group" aria-label="Cluster actions">
                <button
                  type="button"
                  className={styles.runIcon}
                  aria-label={runAction}
                  title={`${runAction}${loading && !localRuntime ? ' · simulated loading' : ''}`}
                  disabled={(!demo && !localRuntime) || !selectedModel || !devices.length}
                  onClick={() => {
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
                  <RunIcon size={16} weight="regular" aria-hidden="true" />
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
            {devices.length ? (
              <ClusterCanvas
                singleDevice={devices.length === 1}
                panelId={devices.length === 1 && panelOpen ? panelId : undefined}
                onClear={() => {
                  setSelection({ type: 'overview' });
                }}
              >
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
                {devices.map((device) => (
                  <div
                    key={device.id}
                    className={styles.deviceSlot}
                    style={{
                      gridColumn:
                        devices.length === 1
                          ? '1'
                          : device.role === 'Coordinator'
                            ? '1 / -1'
                            : device.id === 'workstation'
                              ? '1'
                              : device.id === 'mac'
                                ? '2'
                                : '3',
                      gridRow: devices.length === 1 || device.role === 'Coordinator' ? '1' : '2',
                    }}
                  >
                    <DeviceCard
                      device={device}
                      ranges={ranges}
                      appliedRanges={activeModel ? placement.applied : []}
                      layerCount={layerCount}
                      proposed={!selectedIsActive || changed || loading}
                      loading={loading}
                      active={canPlace}
                      localReady={Boolean(localRuntime && activeModel)}
                      onDetails={(device) => showPanel({ type: 'device', device })}
                      onRename={(device) => showPanel({ type: 'device', device, renaming: true })}
                      selected={selection.type === 'device' && selection.device.id === device.id}
                      alwaysShowAdd={devices.length === 1}
                      onAdd={() => showPanel({ type: 'add' })}
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
              devices={devices}
              activeModel={activeModel}
              selectedModel={selectedModel}
              loading={loading}
              inputs={placement.inputs}
              layerCount={layerCount}
              ranges={ranges}
              canPlace={canPlace}
              closeRef={panelClose}
              onClose={closePanel}
              onOverview={() => setSelection({ type: 'overview' })}
              onSelect={(device) => showPanel({ type: 'device', device })}
              onEdit={(input) => dispatch({ type: 'edit', input })}
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
              hasChanges={canPlace && changed && !loading}
              onDiscard={() => {
                dispatch({ type: 'discard' });
                notify('information', 'Changes discarded');
              }}
            />
          )}
        </div>
      </div>
      {modal && (
        <Dialog title={title} onClose={close}>
          {modal.type === 'restart' && (
            <>
              <p>
                Load {selectedModel?.name} with the proposed sample allocation
                {activeModel ? `, replacing the current session for ${activeModel.name}` : ''}?
              </p>
              <p>
                In the connected app, restarting interrupts active Chat and API requests. This demo
                runs no inference and restarts no process.
              </p>
              <footer>
                <Button onClick={close}>Cancel</Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    if (validate()) {
                      dismissNotification();
                      dispatch({ type: 'run' });
                      close();
                    }
                  }}
                >
                  {selectedIsActive ? 'Restart demo' : 'Switch and run demo'}
                </Button>
              </footer>
            </>
          )}
          {modal.type === 'placement' && (
            <>
              <p>
                Choose how to assign layers for <strong>{modal.model.name}</strong>. The model loads
                only when you click Run.
              </p>
              <p>
                Auto place uses a sample allocation in this demo; no optimizer or memory-fit check
                runs.
              </p>
              <div className={styles.placementChoices}>
                <Button
                  onClick={() => {
                    dispatch({ type: 'choose', modelId: modal.model.id, mode: 'auto' });
                    dismissNotification();
                    close();
                  }}
                >
                  Auto place
                </Button>
                <Button
                  onClick={() => {
                    dispatch({ type: 'choose', modelId: modal.model.id, mode: 'manual' });
                    dismissNotification();
                    close();
                  }}
                >
                  Place manually
                </Button>
              </div>
              <footer className={styles.placementCancel}>
                <Button onClick={close}>Cancel</Button>
              </footer>
            </>
          )}
        </Dialog>
      )}
    </section>
  );
}
