import { useEffect, useId, useRef } from 'react';
import type { RefObject } from 'react';
import { CaretRight } from '@phosphor-icons/react/dist/csr/CaretRight';
import { Pencil } from '@phosphor-icons/react/dist/csr/Pencil';
import { ChatGptHistoryIcon } from '../../components/ChatGptHistoryIcon';
import type { DemoDevice, DemoHardware, LayerInput } from '../../mocks/cluster';
import type { DemoModel } from '../../mocks/modelLibrary';
import type { demoLinks } from '../../mocks/cluster';
import styles from './ClusterPage.module.css';
import { DeviceNameEditor } from './DeviceNameEditor';
import { LayerNumberInput } from './LayerNumberInput';
import { ClusterJoiningPanel, PendingRequests } from './ClusterJoiningPanel';
import type { JoiningProps } from './ClusterJoiningPanel';
import { connectionLabels } from '../../mocks/clusterJoining';

export type ClusterSelection =
  | { type: 'overview' | 'add' | 'join' | 'share' }
  | { type: 'device'; device: DemoDevice; hardwareId?: string; renaming?: boolean }
  | { type: 'link'; link: (typeof demoLinks)[number] };

export type AssignmentStatus = 'No assignment' | 'Draft' | 'Saved' | 'In use';

interface ClusterPanelProps extends JoiningProps {
  id: string;
  selection: ClusterSelection;
  devices: readonly DemoDevice[];
  activeModel: DemoModel | undefined;
  selectedModel: DemoModel | undefined;
  loading: boolean;
  editingDisabled: boolean;
  inputs: readonly LayerInput[];
  layerCount: number;
  assignmentStates: Readonly<Record<string, AssignmentStatus>>;
  canPlace: boolean;
  panelRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onOverview: () => void;
  onSelect: (device: DemoDevice) => void;
  onEdit: (input: LayerInput) => void;
  onStartRename: () => void;
  onCancelRename: () => void;
  onRename: (name: string) => void;
  local?: boolean;
  saveIssues?: readonly { hardwareId?: string | undefined; field: string }[];
}

function LayerEditor({
  hardware,
  input,
  layerCount,
  focused,
  disabled,
  onEdit,
  issue,
  placeholder,
}: {
  issue?: string | undefined;
  placeholder?: string | undefined;
  hardware: DemoHardware;
  input: LayerInput;
  layerCount: number;
  focused: boolean;
  disabled: boolean;
  onEdit: (input: LayerInput) => void;
}) {
  const firstInput = useRef<HTMLInputElement>(null);
  const lastInput = useRef<HTMLInputElement>(null);
  const id = useId();
  const invalid = Boolean(issue);
  useEffect(() => {
    if (issue === 'last') lastInput.current?.focus();
    else if (focused || issue) firstInput.current?.focus();
  }, [focused, issue]);
  return (
    <div>
      <div className={styles.rangeInputs}>
        <div>
          <label htmlFor={`${id}-first`}>First layer</label>
          <LayerNumberInput
            inputRef={firstInput}
            id={`${id}-first`}
            label={`First layer for ${hardware.label}`}
            disabled={disabled}
            maximum={layerCount - 1}
            invalid={invalid}
            describedBy={invalid ? `${id}-error` : undefined}
            value={input.first}
            placeholder={placeholder}
            onChange={(value) => onEdit({ ...input, first: value })}
          />
        </div>
        <div>
          <label htmlFor={`${id}-last`}>Last layer</label>
          <LayerNumberInput
            inputRef={lastInput}
            id={`${id}-last`}
            label={`Last layer for ${hardware.label}`}
            disabled={disabled}
            maximum={layerCount - 1}
            invalid={invalid}
            describedBy={invalid ? `${id}-error` : undefined}
            value={input.last}
            placeholder={placeholder}
            onChange={(value) => onEdit({ ...input, last: value })}
          />
        </div>
      </div>
      {invalid && (
        <p id={`${id}-error`} className={styles.error}>
          Use whole numbers from 0 to {layerCount - 1}; enter both limits and keep first layer at or
          below last layer.
        </p>
      )}
    </div>
  );
}

/** Contextual fixture information and edits; no displayed peer or measurement is live. */
export function ClusterPanel({
  id,
  demo,
  local = false,
  joining,
  onJoining,
  selection,
  devices,
  activeModel,
  selectedModel,
  loading,
  editingDisabled,
  inputs,
  layerCount,
  assignmentStates,
  canPlace,
  panelRef,
  onClose,
  onOverview,
  onSelect,
  onEdit,
  onStartRename,
  onCancelRename,
  onRename,
  saveIssues = [],
}: ClusterPanelProps) {
  const renameTrigger = useRef<HTMLButtonElement>(null);
  const finishRename = () => {
    onCancelRename();
    queueMicrotask(() => renameTrigger.current?.focus());
  };
  const title =
    selection.type === 'device'
      ? selection.device.name
      : selection.type === 'link'
        ? 'Connection'
        : selection.type === 'overview'
          ? 'Cluster overview'
          : connectionLabels[selection.type];
  const hardware = devices.flatMap((device) => device.hardware);
  const gpus = hardware.filter((item) => item.kind === 'gpu');
  const unified = hardware.filter((item) => item.kind === 'unified');
  const memoryUnit = local ? 'GiB' : 'GB';
  const memory = (items: readonly DemoHardware[]) =>
    items.every((item) => Number.isFinite(item.memoryGb) && item.memoryGb > 0)
      ? `${items.reduce((sum, item) => sum + item.memoryGb, 0).toFixed(1)} ${memoryUnit}`
      : 'Unknown';
  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      id={id}
      className={styles.panel}
      aria-label="Cluster panel"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className={styles.panelContent} role="region" aria-label="Cluster panel content">
        <header className={styles.panelHeader}>
          {selection.type !== 'overview' && (
            <button
              type="button"
              className={styles.panelBack}
              aria-label="Back to cluster overview"
              title="Back to cluster overview"
              onClick={() => {
                onOverview();
                queueMicrotask(() => panelRef.current?.focus());
              }}
            >
              <ChatGptHistoryIcon kind="undo" />
            </button>
          )}
          <div className={styles.panelHeading}>
            {selection.type === 'device' ? (
              selection.renaming ? (
                <DeviceNameEditor
                  key={selection.device.id}
                  device={selection.device}
                  onCancel={finishRename}
                  onSave={(name) => {
                    onRename(name);
                    queueMicrotask(() => renameTrigger.current?.focus());
                  }}
                />
              ) : (
                <div className={styles.panelIdentity}>
                  <h2>{title}</h2>
                  <button
                    ref={renameTrigger}
                    type="button"
                    className={styles.renameTrigger}
                    aria-label="Edit device name"
                    onClick={onStartRename}
                  >
                    <Pencil size={14} aria-hidden="true" />
                  </button>
                </div>
              )
            ) : (
              <h2>{title}</h2>
            )}
            {selection.type === 'device' && (
              <p className={styles.deviceSubtitle}>
                {local ? 'This device' : 'Sample device'} · {selection.device.role}
              </p>
            )}
          </div>
        </header>
        {selection.type === 'overview' && (
          <div className={styles.overviewSummary}>
            <div className={styles.overviewModel}>
              <p className={styles.overviewModelName}>
                {selectedModel?.name ?? 'No model selected'}
              </p>
              {selectedModel && (
                <p className={styles.overviewStatus}>
                  {loading
                    ? local
                      ? 'Model loading in progress'
                      : 'Loading demo model'
                    : selectedModel?.id === activeModel?.id && activeModel
                      ? local
                        ? 'Ready'
                        : 'Ready · simulated'
                      : 'Not loaded'}
                </p>
              )}
              {activeModel && activeModel.id !== selectedModel?.id && (
                <dl className={styles.overviewMemory}>
                  <div>
                    <dt>Running model</dt>
                    <dd>{activeModel.name}</dd>
                  </div>
                </dl>
              )}
            </div>
            <section className={styles.hardwareSummary} aria-label="Hardware summary">
              <h3>Hardware</h3>
              <p className={styles.overviewStatus}>
                {devices.length} {devices.length === 1 ? 'device' : 'devices'} ·{' '}
                {gpus.length + unified.length} {gpus.length + unified.length === 1 ? 'GPU' : 'GPUs'}
              </p>
              <dl className={styles.overviewMemory}>
                {gpus.length > 0 && (
                  <div>
                    <dt>GPU memory</dt>
                    <dd>{memory(gpus)}</dd>
                  </div>
                )}
                {unified.length > 0 && (
                  <div>
                    <dt>Unified memory</dt>
                    <dd>{memory(unified)}</dd>
                  </div>
                )}
              </dl>
            </section>
            <PendingRequests demo={demo} joining={joining} onJoining={onJoining} />
            <section className={styles.panelSection}>
              <h3>Layer assignment</h3>
              {devices.map((device) => (
                <button
                  key={device.id}
                  type="button"
                  className={styles.allocationRow}
                  onClick={() => onSelect(device)}
                >
                  <span>{device.name}</span>
                  <small>{assignmentStates[device.id] ?? 'No assignment'}</small>
                  <CaretRight size={14} aria-hidden="true" />
                </button>
              ))}
            </section>
          </div>
        )}
        {selection.type === 'device' && (
          <>
            <details key={selection.device.id} className={styles.deviceDetails}>
              <summary>
                <span>Device details</span>
                <CaretRight size={16} aria-hidden="true" />
              </summary>
              <dl>
                <div>
                  <dt>OS</dt>
                  <dd>{selection.device.os}</dd>
                </div>
                <div>
                  <dt>Address</dt>
                  <dd>{selection.device.address}</dd>
                </div>
                <div>
                  <dt>Connection</dt>
                  <dd>{local ? 'This device' : 'Not verified'}</dd>
                </div>
              </dl>
            </details>
            <section className={styles.panelSection}>
              <h3>Layer assignment</h3>
              <p className={styles.panelDescription}>
                {selectedModel
                  ? layerCount > 0
                    ? `${layerCount} layers · 0–${layerCount - 1}`
                    : 'Layer metadata is unavailable. Re-import the model to assign layers.'
                  : 'Choose a model to assign layers.'}
              </p>
              <div className={styles.layerEditorGroup}>
                {selection.device.hardware
                  .filter((hardware) => hardware.kind !== 'cpu')
                  .map((hardware) => {
                    const input = inputs.find((entry) => entry.hardwareId === hardware.id);
                    const editable = canPlace && Boolean(input);
                    return (
                      <section
                        key={hardware.id}
                        className={styles.hardwareEditor}
                        aria-label={`Details for ${hardware.label}`}
                      >
                        <h4>{hardware.label}</h4>
                        <LayerEditor
                          key={`${selectedModel?.id}-${hardware.id}`}
                          hardware={hardware}
                          input={
                            canPlace && input
                              ? input
                              : { hardwareId: hardware.id, first: '', last: '' }
                          }
                          layerCount={selectedModel ? layerCount : 0}
                          disabled={editingDisabled || !editable}
                          placeholder={editable ? undefined : '\u2014'}
                          focused={editable && selection.hardwareId === hardware.id}
                          onEdit={onEdit}
                          issue={
                            editable
                              ? saveIssues.find((issue) => issue.hardwareId === hardware.id)?.field
                              : undefined
                          }
                        />
                      </section>
                    );
                  })}
              </div>
            </section>
          </>
        )}
        {selection.type === 'link' && (
          <>
            <dl className={styles.details}>
              <div>
                <dt>From</dt>
                <dd>{devices.find((device) => device.id === selection.link.from)?.name}</dd>
              </div>
              <div>
                <dt>To</dt>
                <dd>{devices.find((device) => device.id === selection.link.to)?.name}</dd>
              </div>
              <div>
                <dt>Sample latency</dt>
                <dd>{selection.link.latencyMs} ms</dd>
              </div>
              <div>
                <dt>Connection status</dt>
                <dd>Not verified</dd>
              </div>
              <div>
                <dt>Direct or relay</dt>
                <dd>Unknown</dd>
              </div>
            </dl>
            <p className={styles.panelDescription}>
              No latency measurement, direct/relay detection, or connection verification has run.
            </p>
          </>
        )}
        {(selection.type === 'add' || selection.type === 'join' || selection.type === 'share') && (
          <ClusterJoiningPanel
            key={selection.type}
            kind={selection.type}
            demo={demo}
            joining={joining}
            onJoining={onJoining}
          />
        )}
      </div>
    </aside>
  );
}
