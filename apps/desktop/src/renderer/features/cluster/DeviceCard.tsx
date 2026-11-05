import { useEffect, useRef, useState } from 'react';
import { DropdownMenu } from 'radix-ui';
import { Button as SdkButton } from '@openai/apps-sdk-ui/components/Button';
import { Badge } from '@openai/apps-sdk-ui/components/Badge';
import { Input } from '@openai/apps-sdk-ui/components/Input';
import { Animate } from '@openai/apps-sdk-ui/components/Transition';
import {
  DotsHorizontal,
  Plus,
  EditPencil,
  Speed,
  Storage,
} from '@openai/apps-sdk-ui/components/Icon';
import type { DemoDevice, SampleRange } from '../../mocks/cluster';
import styles from './ClusterPage.module.css';
import card from './DeviceCard.module.css';
import './cluster-sdk-tokens.css';
import type { CanvasEdge } from './canvas-layout';
import { LayerRangeSlider } from './LayerRangeSlider';
import type { CardAllocation } from './useCardAllocation';

interface DeviceCardProps {
  device: DemoDevice;
  allocation?: CardAllocation;
  editableIds?: readonly string[];
  ranges: readonly SampleRange[];
  appliedRanges: readonly SampleRange[];
  layerCount: number;
  modelSelected?: boolean;
  loading: boolean;
  proposed: boolean;
  savedAssignment?: boolean;
  active: boolean;
  localReady?: boolean;
  onEdit: (hardwareId: string) => void;
  onDetails: (device: DemoDevice) => void;
  onSelect?: ((device: DemoDevice) => void) | undefined;
  onRename: (device: DemoDevice) => void;
  selected: boolean;
  showAddHint?: boolean;
  addEdge?: CanvasEdge | undefined;
  onAdd: (edge: CanvasEdge) => void;
  onRemove?: (() => void) | undefined;
  removeDisabled?: boolean;
}

export function DeviceCard({
  device,
  allocation,
  editableIds,
  ranges,
  appliedRanges,
  layerCount,
  modelSelected = layerCount > 0,
  loading,
  proposed,
  savedAssignment = false,
  active,

  onEdit,
  onDetails,
  onSelect = onDetails,
  onRename,
  selected,
  showAddHint = false,
  addEdge,
  onAdd,
  onRemove,
  removeDisabled = false,
}: DeviceCardProps) {
  const [observedAt, setObservedAt] = useState(() => Date.now());
  const hasInventory = device.inventory !== undefined;
  useEffect(() => {
    if (!hasInventory) return;
    const timer = setInterval(() => setObservedAt(Date.now()), 2000);
    return () => clearInterval(timer);
  }, [hasInventory]);
  const inventory =
    device.inventory &&
    observedAt - device.inventory.sampledAt < 15000 &&
    observedAt - device.inventory.sampledAt >= -5000
      ? device.inventory
      : undefined;
  const cpuName = device.hardware.find((hardware) => hardware.kind === 'cpu')?.name;
  const totalRam = device.inventory?.usableRamBytes ?? device.inventory?.installedRamBytes;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const menuActionSelected = useRef(false);
  const selectMenuAction = (action: () => void) => {
    menuActionSelected.current = true;
    menuTrigger.current?.focus({ preventScroll: true });
    action();
  };
  const [hoverEdge, setHoverEdge] = useState<CanvasEdge>('right');
  const [pointerInside, setPointerInside] = useState(false);
  const [focusInside, setFocusInside] = useState(false);
  const [fading, setFading] = useState(false);
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const firstInput = useRef<HTMLInputElement>(null);
  const editorId = allocation?.editor?.hardwareId;
  const focusEditor = allocation?.editor?.focusInput;
  useEffect(() => {
    if (!focusEditor) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      firstInput.current?.focus({ preventScroll: true });
      firstInput.current?.select();
    });
    return () => {
      cancelled = true;
    };
  }, [editorId, focusEditor]);
  const finishEditing = (element: HTMLElement, apply: boolean) => {
    const trigger = element
      .closest('section')
      ?.querySelector<HTMLButtonElement>('button[aria-expanded]');
    if (apply && !allocation?.done()) return;
    if (!apply) allocation?.cancel();
    queueMicrotask(() => trigger?.focus({ preventScroll: true }));
  };
  const desiredEdge = useRef<CanvasEdge>('right');
  const edgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelEdgeTimer = () => {
    if (edgeTimer.current !== null) clearTimeout(edgeTimer.current);
    edgeTimer.current = null;
  };
  useEffect(() => {
    // Pinning is externally controlled. Clear an in-flight hover transition so it cannot
    // move the control after the picker closes, without introducing effect state updates.
    if (addEdge && edgeTimer.current !== null) {
      clearTimeout(edgeTimer.current);
      edgeTimer.current = null;
    }
    return () => {
      if (edgeTimer.current !== null) clearTimeout(edgeTimer.current);
    };
  }, [addEdge]);
  const edge = addEdge ?? hoverEdge;
  const visible = Boolean(addEdge) || ((pointerInside || focusInside) && !fading);
  return (
    <article
      aria-label={device.name}
      data-cluster-sdk=""
      data-theme="dark"
      className={`${styles.device} ${card.card} ${device.role === 'Coordinator' ? styles.coordinator : ''}`}
      data-selected={selected}
      onPointerMove={(event) => {
        setPointerInside(true);
        if (addEdge || (event.target instanceof Element && event.target.closest('[data-edge]')))
          return;
        const rect = event.currentTarget.getBoundingClientRect();
        const distances: [CanvasEdge, number][] = [
          ['top', Math.abs(event.clientY - rect.top)],
          ['right', Math.abs(rect.right - event.clientX)],
          ['bottom', Math.abs(rect.bottom - event.clientY)],
          ['left', Math.abs(event.clientX - rect.left)],
        ];
        distances.sort((first, second) => first[1] - second[1]);
        const next = distances[0]![0];
        if (desiredEdge.current === next && edgeTimer.current !== null) return;
        desiredEdge.current = next;
        cancelEdgeTimer();
        if (
          !pointerInside ||
          next === hoverEdge ||
          window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        ) {
          setHoverEdge(next);
          setFading(false);
          return;
        }
        setFading(true);
        edgeTimer.current = setTimeout(() => {
          edgeTimer.current = null;
          setHoverEdge(desiredEdge.current);
          setFading(false);
        }, 75);
      }}
      onPointerLeave={(event) => {
        if (!(
          event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)
        )) {
          cancelEdgeTimer();
          setFading(false);
          setPointerInside(false);
        }
      }}
      onFocus={() => setFocusInside(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocusInside(false);
      }}
      onClick={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest('button, input, a, form, [role=slider], [role=menu]')
        )
          return;
        onSelect(device);
      }}
    >
      <button
        type="button"
        className={styles.nodeAdd}
        data-edge={edge}
        data-visible={visible}
        aria-label={`Add device near ${device.name}`}
        aria-description="Use arrow keys to choose an edge, then press Enter to add a device."
        title="Add device to canvas"
        onKeyDown={(event) => {
          const edges: Record<string, CanvasEdge> = {
            ArrowUp: 'top',
            ArrowRight: 'right',
            ArrowDown: 'bottom',
            ArrowLeft: 'left',
          };
          const next = edges[event.key];
          if (!next) return;
          event.preventDefault();
          event.stopPropagation();
          if (!addEdge) {
            cancelEdgeTimer();
            desiredEdge.current = next;
            setHoverEdge(next);
            setFading(false);
          }
        }}
        onClick={() => {
          cancelEdgeTimer();
          desiredEdge.current = edge;
          setHoverEdge(edge);
          setFading(false);
          onAdd(edge);
        }}
      >
        <Plus width={16} height={16} aria-hidden="true" />
      </button>
      {showAddHint && (
        <p
          className={styles.nodeAddHint}
          data-hidden={Boolean(addEdge) || pointerInside || focusInside}
        >
          Hover near an edge to add a device.
        </p>
      )}
      <header className={`${styles.deviceHeader} ${card.header}`}>
        <div className={styles.identity}>
          <h2 className={card.deviceName} aria-label={device.name}>
            <button
              type="button"
              className={styles.selectDevice}
              aria-label={`Select ${device.name}`}
              aria-pressed={selected}
              title={device.name}
              onClick={() => onSelect(device)}
            >
              {device.name}
            </button>
          </h2>
        </div>
        <div className={`${styles.headerControls} ${card.headerControls}`}>
          <Badge color="secondary" size="md" pill>
            {device.role}
          </Badge>
          <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
            <DropdownMenu.Trigger asChild>
              <SdkButton
                ref={menuTrigger}
                color="secondary"
                variant="ghost"
                uniform
                size="md"
                className={card.sdkButton ?? ''}
                aria-label={`Actions for ${device.name}`}
              >
                <DotsHorizontal />
              </SdkButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content
              aria-label={`Actions for ${device.name}`}
              data-cluster-sdk=""
              data-theme="dark"
              className={card.actionMenu}
              align="end"
              sideOffset={5}
              collisionPadding={6}
              updatePositionStrategy="always"
              onPointerMove={(event) => event.stopPropagation()}
              onCloseAutoFocus={(event) => {
                // A selected action may open a dialog; restore focus before that action instead.
                if (menuActionSelected.current) {
                  event.preventDefault();
                  menuActionSelected.current = false;
                }
              }}
            >
              <DropdownMenu.Item
                className={card.actionMenuItem}
                onSelect={() => selectMenuAction(() => onDetails(device))}
              >
                Device details
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={card.actionMenuItem}
                onSelect={() => selectMenuAction(() => onRename(device))}
              >
                Rename device
              </DropdownMenu.Item>
              {onRemove && (
                <DropdownMenu.Item
                  className={card.actionMenuItem}
                  disabled={removeDisabled}
                  title={
                    removeDisabled
                      ? 'Stop the model and finish assigning layers before removing this PC.'
                      : undefined
                  }
                  onSelect={() => selectMenuAction(onRemove)}
                >
                  Remove from canvas
                </DropdownMenu.Item>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>
      </header>
      <div className={`${styles.hardware} ${card.hardware}`}>
        <section className={card.hardwareTile} aria-label={`${device.name} CPU`}>
          <div className={card.meta}>
            <span>CPU</span>
            <span>
              {totalRam === undefined
                ? 'Memory unavailable'
                : `${(totalRam / 2 ** 30).toFixed(1)} GiB`}
            </span>
          </div>
          <h3>{cpuName ?? 'Processor unavailable'}</h3>
          <div className={card.metrics}>
            <span title="Host CPU utilization between recent samples. A dash means unavailable or stale.">
              <span className={card.cpuMetricIcon} aria-hidden="true">
                <span>CPU</span>
                <Speed width={18} height={18} />
              </span>
              <b aria-label={`CPU utilization: ${percentage(inventory?.cpuUsagePercent)}`}>
                {percentage(inventory?.cpuUsagePercent)}
              </b>
            </span>
            <span title="System memory from the latest sample. A dash means unavailable or stale.">
              RAM{' '}
              <b>{memoryReading(inventory ? totalRam : undefined, inventory?.availableRamBytes)}</b>
            </span>
            <span title="Read/write activity across physical disks, in bytes per second.">
              <Storage width={18} height={18} aria-hidden="true" />
              {`R ${byteRate(inventory?.diskReadBytesPerSecond)} · W ${byteRate(inventory?.diskWriteBytesPerSecond)}`}
            </span>
          </div>
        </section>
        {device.hardware
          .filter((hardware) => hardware.kind !== 'cpu')
          .map((hardware) => {
            const range = modelSelected
              ? ranges.find((entry) => entry.hardwareId === hardware.id)
              : undefined;
            const activeRange = appliedRanges.find((entry) => entry.hardwareId === hardware.id);
            const gpuInfo = device.inventory?.gpus?.find(
              (gpu) =>
                (hardware.assignmentId !== undefined &&
                  hardware.assignmentId === gpu.executionIdentity?.uuid) ||
                hardware.id === gpu.id ||
                hardware.id === `local-${gpu.id}`,
            );
            const gpu = inventory ? gpuInfo : undefined;
            const unified = gpuInfo?.memoryKind === 'unified';
            const editing = modelSelected && allocation?.editor?.hardwareId === hardware.id;
            const editor = editing ? allocation.editor! : null;
            const unavailable =
              !modelSelected ||
              !active ||
              loading ||
              (editableIds !== undefined && !editableIds.includes(hardware.id));
            return (
              <section
                className={card.hardwareTile}
                key={hardware.id}
                aria-label={`${device.name} ${hardware.label}`}
              >
                <div className={card.meta}>
                  <span>{hardware.label}</span>
                  <span>
                    {unified
                      ? 'Shared RAM'
                      : hardware.memoryGb > 0
                        ? `${hardware.memoryGb.toFixed(1)} GiB`
                        : 'Memory unavailable'}
                  </span>
                </div>
                <h3>
                  {hardware.name}
                  {activeRange && (
                    <span
                      className={card.activeDot}
                      role="img"
                      aria-label="GPU in use"
                      title="Model loaded on this GPU"
                    />
                  )}
                </h3>
                <div className={card.metrics}>
                  <span title="GPU utilization from its driver. A dash means unavailable or stale.">
                    <Speed width={18} height={18} aria-hidden="true" />
                    {percentage(gpu?.utilizationPercent)}
                  </span>
                  <span
                    title={
                      unified
                        ? 'GPU allocation within shared system memory; not additional dedicated VRAM.'
                        : 'Dedicated GPU memory used versus total from the latest sample.'
                    }
                  >
                    {unified ? 'Unified memory' : 'VRAM'}{' '}
                    <b>
                      {unified
                        ? gpu?.usedMemoryBytes !== undefined
                          ? `${(gpu.usedMemoryBytes / 2 ** 30).toFixed(1)} GiB`
                          : '—'
                        : memoryReading(
                            gpu?.totalMemoryBytes,
                            gpu?.availableMemoryBytes,
                            gpu?.usedMemoryBytes,
                          )}
                    </b>
                  </span>
                </div>
                <div className={card.assignment} data-model-missing={!modelSelected}>
                  <LayerRangeSlider
                    label={`${device.name} ${hardware.label}`}
                    range={{
                      first: range?.first ?? 0,
                      count: range ? range.last - range.first + 1 : 0,
                    }}
                    total={modelSelected ? Math.max(1, layerCount) : 1}
                    disabled={unavailable || !allocation || layerCount < 1}
                    onChange={(last) => allocation?.resize(hardware.id, last)}
                  />
                  <div className={card.rangeRow}>
                    <span>{proposed && !savedAssignment ? 'Planned layers' : 'Layer range'}</span>
                    <SdkButton
                      className={card.sdkButton ?? ''}
                      color="secondary"
                      variant="outline"
                      size="sm"
                      title={modelSelected ? 'Edit layer range' : 'Load a model to assign layers'}
                      aria-label={
                        modelSelected
                          ? `Edit layers for ${device.name} ${hardware.label}`
                          : 'Load a model to assign layers'
                      }
                      aria-expanded={editing ?? false}
                      disabled={unavailable}
                      onClick={() =>
                        allocation ? allocation.open(hardware.id) : onEdit(hardware.id)
                      }
                    >
                      <EditPencil aria-hidden="true" />
                      {!modelSelected
                        ? 'Load a model to assign layers'
                        : range
                          ? `${range.first}–${range.last}`
                          : 'Unassigned'}
                    </SdkButton>
                  </div>
                  {!allocation && range && (
                    <span
                      className={card.legacyRange}
                    >{`${proposed && !savedAssignment ? 'Planned layers' : 'Layers'} ${range.first} – ${range.last}`}</span>
                  )}
                  <div
                    data-layer-editor-motion
                    data-open={Boolean(editor && allocation)}
                    className={card.editorMotion}
                    inert={!editing}
                  >
                    <Animate
                      as="div"
                      className={card.editorTransition ?? ''}
                      transitionPosition="static"
                      enter={{ opacity: 1, duration: reduceMotion ? 0 : 160, delay: 0 }}
                      exit={{ opacity: 0, duration: reduceMotion ? 0 : 160 }}
                    >
                      {editor && allocation && (
                        <div key={hardware.id} className={card.editorContent}>
                          <form
                            className={card.editor}
                            onSubmit={(event) => {
                              event.preventDefault();
                              finishEditing(event.currentTarget, true);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Escape') {
                                event.preventDefault();
                                event.stopPropagation();
                                finishEditing(event.currentTarget, false);
                              }
                            }}
                          >
                            <div className={card.fields}>
                              <label>
                                First
                                <Input
                                  className={card.sdkInput ?? ''}
                                  ref={firstInput}
                                  size="sm"
                                  inputMode="numeric"
                                  value={editor.first}
                                  aria-label={`First layer for ${device.name} ${hardware.label}`}
                                  invalid={Boolean(editor.error)}
                                  disabled={unavailable}
                                  onChange={(event) =>
                                    allocation.fields(event.target.value, editor.last)
                                  }
                                />
                              </label>
                              <label>
                                Last
                                <Input
                                  className={card.sdkInput ?? ''}
                                  size="sm"
                                  inputMode="numeric"
                                  value={editor.last}
                                  aria-label={`Last layer for ${device.name} ${hardware.label}`}
                                  invalid={Boolean(editor.error)}
                                  disabled={unavailable}
                                  onChange={(event) =>
                                    allocation.fields(editor.first, event.target.value)
                                  }
                                />
                              </label>
                            </div>
                            <div className={card.editActions}>
                              <SdkButton
                                className={card.sdkButton ?? ''}
                                color="secondary"
                                variant="ghost"
                                size="sm"
                                onClick={(event) => finishEditing(event.currentTarget, false)}
                              >
                                Cancel
                              </SdkButton>
                              <SdkButton
                                className={card.sdkButton ?? ''}
                                type="submit"
                                color="primary"
                                size="sm"
                                disabled={unavailable}
                              >
                                Done
                              </SdkButton>
                            </div>
                            {editor.error && (
                              <p role="alert" className={card.error}>
                                {editor.error}
                              </p>
                            )}
                            <p
                              role="status"
                              className={
                                allocation.message.includes('multiple GPUs') ||
                                allocation.message.includes('outside')
                                  ? card.error
                                  : card.preview
                              }
                            >
                              Preview · {allocation.message}
                            </p>
                            <p className={card.preview}>
                              Done updates the configuration draft for all devices. Use Save to keep
                              it.
                            </p>
                          </form>
                        </div>
                      )}
                    </Animate>
                  </div>
                </div>
              </section>
            );
          })}
      </div>
    </article>
  );
}

function memoryReading(
  total: number | undefined,
  available: number | undefined,
  used?: number,
): string {
  const allocated =
    used ?? (total !== undefined && available !== undefined ? total - available : undefined);
  if (
    total === undefined &&
    allocated !== undefined &&
    allocated >= 0 &&
    Number.isFinite(allocated)
  )
    return `${(allocated / 2 ** 30).toFixed(1)} GiB`;
  if (!total || allocated === undefined || allocated < 0 || allocated > total) return '—';
  return `${(allocated / 2 ** 30).toFixed(1)} / ${(total / 2 ** 30).toFixed(1)} GiB`;
}

function percentage(value: number | undefined): string {
  return value !== undefined && Number.isFinite(value) && value >= 0 && value <= 100
    ? `${Math.round(value)}%`
    : '—';
}
function byteRate(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value < 0) return '—';
  const unit = value >= 2 ** 30 ? 3 : value >= 2 ** 20 ? 2 : value >= 1024 ? 1 : 0;
  return `${(value / 1024 ** unit).toFixed(unit ? 1 : 0)} ${['B', 'KiB', 'MiB', 'GiB'][unit]}/s`;
}
