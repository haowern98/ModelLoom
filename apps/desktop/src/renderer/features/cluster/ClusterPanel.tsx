import { useAppearance } from '../../app/appearance';
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { motion, useIsPresent, useReducedMotion } from 'motion/react';
import { Button } from '@openai/apps-sdk-ui/components/Button';
import { Select } from '@openai/apps-sdk-ui/components/Select';
import type { Option } from '@openai/apps-sdk-ui/components/Select';
import { ChevronRight, CloseBold, Cube, Stack, Storage } from '@openai/apps-sdk-ui/components/Icon';
import { ChatNavIcon } from '../../components/ChatNavIcon';
import type { DemoDevice, DemoHardware, SampleRange } from '../../mocks/cluster';
import type { DemoModel } from '../../mocks/modelLibrary';
import type { demoLinks } from '../../mocks/cluster';
import type { CanvasEdge } from './canvas-layout';
import { ConnectionDetails } from './ConnectionDetails';
import { clusterPanelSpring, clusterPanelVariants } from './cluster-motion';
import styles from './ClusterPanel.module.css';
import './cluster-sdk-tokens.css';

export type ClusterSelection =
  | { type: 'overview' | 'share' | 'speculation' }
  | { type: 'add'; anchor?: { deviceId: string; edge: CanvasEdge } }
  | { type: 'device'; device: DemoDevice; hardwareId?: string; renaming?: boolean }
  | { type: 'connection'; from: string; to: string }
  | { type: 'link'; link: (typeof demoLinks)[number] };
export type AssignmentStatus = 'No assignment' | 'Draft' | 'Saved' | 'In use';

interface ClusterPanelProps {
  id: string;
  local: boolean;
  selection: ClusterSelection;
  selectedDeviceId?: string | undefined;
  devices: readonly DemoDevice[];
  activeModel: DemoModel | undefined;
  selectedModel: DemoModel | undefined;
  contextLabel: string;
  loading: boolean;
  editingDisabled: boolean;
  canvasMutationDisabled: boolean;
  ranges: readonly SampleRange[];
  assignmentStates: Readonly<Record<string, AssignmentStatus>>;
  panelRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onOverview: () => void;
  onModelConfiguration?: (() => void) | undefined;
  canvasCandidates: readonly DemoDevice[];
  onAddToCanvas: (device: DemoDevice) => void;
  onAddDevice: () => void;
  speculation: {
    enabled: boolean;
    method?: string | undefined;
    proposer: boolean;
    retrieval: boolean;
    device: string;
    devices: readonly { value: string; label: string }[];
    placementNote?: string;
    pendingHint?: string | undefined;
    onDevice: (value: string) => void;
  };
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionLabel}>{title}</h2>
      <div className={styles.rows}>{children}</div>
    </section>
  );
}
function CollapsibleSection({ title, children }: { title: string; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionLabel}>
        <button
          type="button"
          className={styles.sectionToggle}
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded(!expanded)}
        >
          <span>{title}</span>
          <ChatNavIcon name="chevron" className={styles.sectionChevron} />
        </button>
      </h2>
      <div id={contentId} className={styles.rows} hidden={!expanded}>
        {children}
      </div>
    </section>
  );
}
function Row({ label, meta, icon }: { label: string; meta?: ReactNode; icon?: ReactNode }) {
  return (
    <div className={styles.row}>
      {icon && <span className={styles.icon}>{icon}</span>}
      <span className={styles.rowLabel} title={label}>
        {label}
      </span>
      {meta && <span className={styles.rowMeta}>{meta}</span>}
    </div>
  );
}
function PlacementOption({ label }: Option) {
  return <span data-cluster-summary-option="">{label}</span>;
}
function deviceRange(device: DemoDevice, ranges: readonly SampleRange[]): string {
  const own = ranges
    .filter((range) => device.hardware.some((hardware) => hardware.id === range.hardwareId))
    .sort((left, right) => left.first - right.first);
  const merged: { first: number; last: number }[] = [];
  for (const range of own) {
    const last = merged.at(-1);
    if (last && range.first === last.last + 1) last.last = range.last;
    else merged.push({ first: range.first, last: range.last });
  }
  return merged.length
    ? merged.map((range) => `${range.first}–${range.last}`).join(', ')
    : 'No assignment';
}
/** Persistent cluster summary. Selection is read-only; edits stay on GPU cards. */
export function ClusterPanel({
  id,
  local,
  selection,
  selectedDeviceId,
  devices,
  activeModel,
  selectedModel,
  contextLabel,
  loading,
  editingDisabled,
  canvasMutationDisabled,
  ranges,
  assignmentStates,
  panelRef,
  onClose,
  onOverview,
  onModelConfiguration,
  canvasCandidates,
  onAddToCanvas,
  onAddDevice,
  speculation,
}: ClusterPanelProps) {
  const { resolvedTheme, reducedMotion: appearanceReducedMotion } = useAppearance();
  const isPresent = useIsPresent();
  const systemReducedMotion = useReducedMotion();
  const reducedMotion = appearanceReducedMotion || systemReducedMotion;
  const picker = useRef<HTMLElement>(null);
  const pickerClose = useRef<HTMLButtonElement>(null);
  const deviceId = useId();
  const pickerId = useId();
  const adding = selection.type === 'add';
  useEffect(() => {
    if (!adding) return;
    const panel = picker.current?.parentElement;
    if (panel) panel.scrollTop = panel.scrollHeight;
    pickerClose.current?.focus({ preventScroll: true });
  }, [adding]);
  const accelerators = devices
    .flatMap((device) => device.hardware)
    .filter((item) => item.kind !== 'cpu');
  const discrete = accelerators.filter((item) => item.kind === 'gpu');
  const unified = accelerators.filter((item) => item.kind === 'unified');
  const memory = (items: readonly DemoHardware[]) =>
    items.every((item) => Number.isFinite(item.memoryGb) && item.memoryGb > 0)
      ? `${items.reduce((total, item) => total + item.memoryGb, 0).toFixed(1)} ${local ? 'GiB' : 'GB'}`
      : 'Unknown';
  const selectedIsLoaded = Boolean(selectedModel && activeModel?.id === selectedModel.id);
  const unavailable =
    speculation.device !== 'auto' &&
    !speculation.devices.some((item) => item.value === speculation.device);
  return (
    <motion.aside
      ref={panelRef}
      tabIndex={-1}
      id={id}
      data-cluster-sdk=""
      data-theme={resolvedTheme}
      className={styles.panel}
      aria-label="Cluster panel"
      aria-hidden={!isPresent || undefined}
      inert={!isPresent}
      style={{ pointerEvents: isPresent ? 'auto' : 'none' }}
      initial={reducedMotion ? false : 'hidden'}
      animate="visible"
      exit="hidden"
      variants={clusterPanelVariants}
      transition={reducedMotion ? { duration: 0 } : clusterPanelSpring}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        // Select is portaled but its React events still bubble through this panel.
        // Let Escape dismiss that popup before dismissing the summary itself.
        if (
          event.defaultPrevented ||
          (event.target instanceof Element &&
            event.target.closest('[data-radix-popper-content-wrapper]'))
        ) {
          event.stopPropagation();
          return;
        }
        event.stopPropagation();
        if (adding) onOverview();
        else onClose();
      }}
    >
      <div className={styles.heading}>
        <h2>Cluster overview</h2>
      </div>
      <Section title="Model">
        <Row
          label={selectedModel?.name ?? 'No model selected'}
          icon={<Cube aria-hidden="true" focusable="false" />}
          meta={
            selectedModel && (
              <span className={styles.modelState} role="status">
                {loading && <span className={styles.spinner} aria-hidden="true" />}
                {!loading && selectedIsLoaded && (
                  <span className={styles.statusDot} aria-hidden="true" />
                )}
                {loading ? 'Loading…' : selectedIsLoaded ? 'Loaded' : 'Not loaded'}
              </span>
            )
          }
        />
        <Row label="Model file size" meta={selectedModel?.size ?? 'Unavailable'} />
        <Row label="Configured context" meta={selectedModel ? contextLabel : 'Unavailable'} />
        {activeModel && activeModel.id !== selectedModel?.id && (
          <div className={styles.runningModel}>
            <Row label="Currently running" meta={activeModel.name} />
          </div>
        )}
      </Section>
      <Section title="Hardware">
        <Row
          icon={<Stack />}
          label={`${devices.length} ${devices.length === 1 ? 'device' : 'devices'} · ${accelerators.length} ${accelerators.length === 1 ? 'GPU' : 'GPUs'}`}
        />
        <Row
          icon={<Storage />}
          label="GPU memory"
          meta={discrete.length ? memory(discrete) : 'Unavailable'}
        />
        {unified.length > 0 && <Row label="Unified memory" meta={memory(unified)} />}
      </Section>
      <CollapsibleSection title="Speculative workload">
        {speculation.enabled && speculation.proposer && (
          <div className={`${styles.row} ${styles.placement}`}>
            <label
              className={styles.rowLabel}
              htmlFor={speculation.placementNote ? undefined : deviceId}
            >
              {speculation.method ?? 'MTP'}
            </label>
            {speculation.placementNote ? (
              <span className={styles.rowMeta}>Follows target</span>
            ) : (
              <Select<Option>
                multiple={false}
                id={deviceId}
                size="sm"
                variant="ghost"
                pill
                block={false}
                value={speculation.device}
                disabled={editingDisabled}
                onChange={(option) => speculation.onDevice(option.value)}
                options={[
                  { value: 'auto', label: 'Automatic' },
                  ...speculation.devices,
                  ...(unavailable
                    ? [
                        {
                          value: speculation.device,
                          label: 'Selected device unavailable',
                          disabled: true,
                        },
                      ]
                    : []),
                ]}
                triggerClassName={styles.placementSelect ?? ''}
                optionClassName={styles.placementOption ?? ''}
                OptionView={PlacementOption}
                listMinWidth={220}
                align="end"
              />
            )}
          </div>
        )}
        {speculation.enabled && speculation.proposer && speculation.placementNote && (
          <p className={styles.note}>This head follows the target output placement.</p>
        )}
        {speculation.enabled &&
          speculation.proposer &&
          !speculation.placementNote &&
          unavailable && (
            <p className={styles.warning} role="alert">
              Selected device unavailable. Choose an available device.
            </p>
          )}
        {speculation.enabled && speculation.retrieval && (
          <Row label="CPU retrieval" meta="This PC · CPU" />
        )}
        {!speculation.enabled && <p className={styles.note}>Off in model configuration.</p>}
        {speculation.enabled && speculation.pendingHint && (
          <p className={styles.note} role="status">
            {speculation.pendingHint}
          </p>
        )}
        {onModelConfiguration && (
          <button
            type="button"
            className={`${styles.row} ${styles.action}`}
            onClick={onModelConfiguration}
          >
            <span className={styles.rowLabel}>Model configuration</span>
            <ChevronRight className={styles.rowChevron} aria-hidden="true" />
          </button>
        )}
      </CollapsibleSection>
      <Section title="Layer assignment">
        {devices.map((device) => (
          <div
            key={device.id}
            role="group"
            aria-label={`Layer assignment for ${device.name}`}
            aria-current={selectedDeviceId === device.id ? 'true' : undefined}
            className={`${styles.row} ${styles.assignment}`}
            title={assignmentStates[device.id] ?? 'No assignment'}
          >
            <span className={styles.rowLabel} title={device.name}>
              {device.name}
            </span>
            <span className={styles.rowMeta}>
              {selectedModel ? deviceRange(device, ranges) : 'No assignment'}
            </span>
          </div>
        ))}
      </Section>
      {adding && (
        <section ref={picker} className={styles.section} aria-labelledby={pickerId}>
          <div className={styles.pickerHeading}>
            <h2 id={pickerId} className={styles.sectionLabel}>
              Add device
            </h2>
            <Button
              ref={pickerClose}
              uniform
              size="sm"
              color="secondary"
              variant="ghost"
              className={styles.sdkButton ?? ''}
              aria-label="Close add device"
              onClick={onOverview}
            >
              <CloseBold />
            </Button>
          </div>
          {canvasCandidates.length ? (
            canvasCandidates.map((device) => {
              const count = device.hardware.filter((hardware) => hardware.kind !== 'cpu').length;
              return (
                <div className={`${styles.row} ${styles.pickerDevice}`} key={device.id}>
                  <div className={styles.pickerDetails}>
                    <span>{device.name}</span>
                    <span className={styles.pickerMeta}>
                      Available · {count} {count === 1 ? 'GPU' : 'GPUs'}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    color="secondary"
                    variant="outline"
                    className={styles.sdkButton ?? ''}
                    disabled={canvasMutationDisabled}
                    aria-label={`Add ${device.name} to canvas`}
                    onClick={() => onAddToCanvas(device)}
                  >
                    Add
                  </Button>
                </div>
              );
            })
          ) : (
            <p className={styles.note}>No other available devices.</p>
          )}
          <button type="button" className={`${styles.row} ${styles.action}`} onClick={onAddDevice}>
            <span className={styles.rowLabel}>Add device in Connections</span>
            <ChevronRight className={styles.rowChevron} aria-hidden="true" />
          </button>
        </section>
      )}
      {selection.type === 'connection' && (
        <CollapsibleSection title="Connection details">
          <ConnectionDetails
            from={devices.find((device) => device.id === selection.from)}
            to={devices.find((device) => device.id === selection.to)}
          />
        </CollapsibleSection>
      )}
      {selection.type === 'link' && (
        <Section title="Connection">
          <Row
            label="From"
            meta={devices.find((device) => device.id === selection.link.from)?.name}
          />
          <Row label="To" meta={devices.find((device) => device.id === selection.link.to)?.name} />
          <Row label="Sample latency" meta={`${selection.link.latencyMs} ms`} />
          <p className={styles.note}>Connection status and direct/relay path are not verified.</p>
        </Section>
      )}
    </motion.aside>
  );
}
