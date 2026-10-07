import { useEffect, useId, useRef } from 'react';
import type { RefObject } from 'react';
import { ArrowLeft, Pencil, X } from 'lucide-react';
import { validSampleRange } from '../../mocks/cluster';
import type { DemoDevice, DemoHardware, LayerInput, SampleRange } from '../../mocks/cluster';
import type { DemoModel } from '../../mocks/modelLibrary';
import type { demoLinks } from '../../mocks/cluster';
import styles from './ClusterPage.module.css';
import { DeviceNameEditor } from './DeviceNameEditor';
import { ClusterJoiningPanel, PendingRequests } from './ClusterJoiningPanel';
import type { JoiningProps } from './ClusterJoiningPanel';
import { connectionLabels } from '../../mocks/clusterJoining';

export type ClusterSelection =
  | { type: 'overview' | 'add' | 'join' | 'share' }
  | { type: 'device'; device: DemoDevice; hardwareId?: string; renaming?: boolean }
  | { type: 'link'; link: (typeof demoLinks)[number] };

interface ClusterPanelProps extends JoiningProps {
  id: string;
  selection: ClusterSelection;
  devices: readonly DemoDevice[];
  activeModel: DemoModel | undefined;
  selectedModel: DemoModel | undefined;
  loading: boolean;
  inputs: readonly LayerInput[];
  layerCount: number;
  ranges: readonly SampleRange[];
  canPlace: boolean;
  closeRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onOverview: () => void;
  onSelect: (device: DemoDevice) => void;
  onEdit: (input: LayerInput) => void;
  onStartRename: () => void;
  onCancelRename: () => void;
  onRename: (name: string) => void;
  hasChanges: boolean;
  local?: boolean;
  onDiscard: () => void;
}

function LayerEditor({
  hardware,
  input,
  layerCount,
  focused,
  disabled,
  onEdit,
}: {
  hardware: DemoHardware;
  input: LayerInput;
  layerCount: number;
  focused: boolean;
  disabled: boolean;
  onEdit: (input: LayerInput) => void;
}) {
  const firstInput = useRef<HTMLInputElement>(null);
  const id = useId();
  const blank = !input.first.trim() && !input.last.trim();
  const invalid =
    !blank &&
    (!input.first.trim() ||
      !input.last.trim() ||
      !validSampleRange(
        { hardwareId: input.hardwareId, first: Number(input.first), last: Number(input.last) },
        layerCount,
      ));
  useEffect(() => {
    if (focused) firstInput.current?.focus();
  }, [focused]);
  return (
    <div>
      <div className={styles.rangeInputs}>
        <label htmlFor={`${id}-first`}>
          First layer
          <input
            ref={firstInput}
            id={`${id}-first`}
            aria-label={`First layer for ${hardware.label}`}
            disabled={disabled}
            type="number"
            min="0"
            max={layerCount - 1}
            step="1"
            aria-invalid={invalid}
            aria-describedby={invalid ? `${id}-error` : undefined}
            value={input.first}
            onChange={(event) => onEdit({ ...input, first: event.target.value })}
          />
        </label>
        <label htmlFor={`${id}-last`}>
          Last layer
          <input
            id={`${id}-last`}
            aria-label={`Last layer for ${hardware.label}`}
            disabled={disabled}
            type="number"
            min="0"
            max={layerCount - 1}
            step="1"
            aria-invalid={invalid}
            aria-describedby={invalid ? `${id}-error` : undefined}
            value={input.last}
            onChange={(event) => onEdit({ ...input, last: event.target.value })}
          />
        </label>
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
  inputs,
  layerCount,
  ranges,
  canPlace,
  closeRef,
  onClose,
  onOverview,
  onSelect,
  onEdit,
  onStartRename,
  onCancelRename,
  onRename,
  hasChanges,
  onDiscard,
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
  return (
    <aside
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
          <button
            ref={closeRef}
            type="button"
            className={styles.panelClose}
            aria-label="Close cluster panel"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        {selection.type !== 'overview' && (
          <button type="button" className={styles.backToOverview} onClick={onOverview}>
            <ArrowLeft size={14} />
            Cluster overview
          </button>
        )}
        {selection.type === 'overview' && (
          <>
            <dl className={styles.details}>
              <div>
                <dt>Model</dt>
                <dd>{selectedModel?.name ?? 'No model selected'}</dd>
              </div>
              <div>
                <dt>State</dt>
                <dd>
                  {loading
                    ? local
                      ? 'Loading local model'
                      : 'Loading demo model'
                    : selectedModel?.id === activeModel?.id && activeModel
                      ? local
                        ? 'Ready'
                        : 'Ready · simulated'
                      : 'Not loaded'}
                </dd>
              </div>
              <div>
                <dt>Running model</dt>
                <dd>{activeModel?.name ?? 'None'}</dd>
              </div>
              <div>
                <dt>Devices</dt>
                <dd>
                  {devices.length} {local ? 'local device' : 'sample devices'}
                </dd>
              </div>
              <div>
                <dt>Discrete VRAM</dt>
                <dd>
                  {devices
                    .flatMap((device) => device.hardware)
                    .filter((hardware) => hardware.kind === 'gpu')
                    .reduce((sum, hardware) => sum + hardware.memoryGb, 0)}{' '}
                  GB
                </dd>
              </div>
              <div>
                <dt>Unified memory</dt>
                <dd>
                  {devices
                    .flatMap((device) => device.hardware)
                    .filter((hardware) => hardware.kind === 'unified')
                    .reduce((sum, hardware) => sum + hardware.memoryGb, 0)}{' '}
                  GB
                </dd>
              </div>
            </dl>
            <PendingRequests demo={demo} joining={joining} onJoining={onJoining} />
            <section className={styles.panelSection}>
              <h3>Layer allocation</h3>
              <p className={styles.panelDescription}>
                {local
                  ? 'This local configuration uses full GPU offload. Custom placement is unavailable.'
                  : 'Sample allocation, not measured memory use.'}
              </p>
              {devices.map((device) => (
                <button
                  key={device.id}
                  type="button"
                  className={styles.allocationRow}
                  onClick={() => onSelect(device)}
                >
                  <span>{device.name}</span>
                  <small>
                    {local
                      ? activeModel
                        ? 'Full GPU offload'
                        : 'Not loaded'
                      : canPlace
                        ? ranges
                            .filter((range) =>
                              device.hardware.some((hardware) => hardware.id === range.hardwareId),
                            )
                            .map((range) => `${range.first}–${range.last}`)
                            .join(', ') || 'Unassigned'
                        : 'Not assigned'}
                  </small>
                </button>
              ))}
            </section>
          </>
        )}
        {selection.type === 'device' && (
          <>
            <p className={styles.panelDescription}>
              {local ? 'Local device' : 'Sample device'} · {selection.device.role}
            </p>
            <dl className={styles.details}>
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
            <section className={styles.panelSection}>
              <h3>Hardware and layers</h3>
              <p className={styles.panelDescription}>
                {local
                  ? loading
                    ? 'Loading the local model. Cancel stops the owned engine.'
                    : 'The tested local configuration uses full GPU offload. Custom layer editing is unavailable.'
                  : loading
                    ? 'Simulated loading. Editing resumes when loading finishes or is cancelled.'
                    : activeModel
                      ? 'Edit sample ranges below. Run requires confirmation before replacing the active session.'
                      : 'Assign sample layers below, then click Run to load the model.'}
              </p>
              {selection.device.hardware.map((hardware) => {
                const input = inputs.find((entry) => entry.hardwareId === hardware.id);
                return (
                  <section
                    key={hardware.id}
                    className={styles.hardwareEditor}
                    aria-label={`Details for ${hardware.label}`}
                  >
                    <h4>{hardware.label}</h4>
                    <p>{hardware.name}</p>
                    <p>{hardware.detail}</p>
                    {canPlace && hardware.kind !== 'cpu' && input ? (
                      <LayerEditor
                        key={`${selectedModel?.id}-${hardware.id}`}
                        hardware={hardware}
                        input={input}
                        layerCount={layerCount}
                        disabled={loading}
                        focused={selection.hardwareId === hardware.id}
                        onEdit={onEdit}
                      />
                    ) : hardware.kind !== 'cpu' ? (
                      <p className={styles.unassigned}>Not used for model layers</p>
                    ) : null}
                  </section>
                );
              })}
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
        {hasChanges && (
          <button type="button" className={styles.discardChanges} onClick={onDiscard}>
            Discard changes
          </button>
        )}
      </div>
    </aside>
  );
}
