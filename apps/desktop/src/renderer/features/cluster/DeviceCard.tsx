import { useEffect, useRef, useState } from 'react';
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
  loading: boolean;
  proposed: boolean;
  savedAssignment?: boolean;
  active: boolean;
  localReady?: boolean;
  onEdit: (hardwareId: string) => void;
  onDetails: (device: DemoDevice) => void;
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
  loading,
  proposed,
  savedAssignment = false,
  active,

  onEdit,
  onDetails,
  onRename,
  selected,
  showAddHint = false,
  addEdge,
  onAdd,
  onRemove,
  removeDisabled = false,
}: DeviceCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchor = useRef<HTMLDivElement>(null);
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
          event.target.closest('button, input, a, form, [role=slider]')
        )
          return;
        onDetails(device);
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
              onClick={() => onDetails(device)}
            >
              {device.name}
            </button>
          </h2>
        </div>
        <div className={`${styles.headerControls} ${card.headerControls}`}>
          <Badge color="secondary" size="md" pill>
            {device.role}
          </Badge>
          <div
            ref={menuAnchor}
            className={styles.menuAnchor}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setMenuOpen(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setMenuOpen(false);
            }}
          >
            <SdkButton
              color="secondary"
              variant="ghost"
              uniform
              size="md"
              className={card.sdkButton ?? ''}
              aria-label={`Actions for ${device.name}`}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <DotsHorizontal />
            </SdkButton>
            {menuOpen && (
              <div className={styles.menu}>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onDetails(device);
                  }}
                >
                  Device details
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    // The menu item disappears; use its persistent trigger when the panel closes.
                    menuAnchor.current?.querySelector('button')?.focus();
                    onRename(device);
                  }}
                >
                  Rename device
                </button>
                {onRemove && (
                  <button
                    type="button"
                    disabled={removeDisabled}
                    title={
                      removeDisabled
                        ? 'Stop the model and finish assigning layers before removing this PC.'
                        : undefined
                    }
                    onClick={() => {
                      setMenuOpen(false);
                      onRemove();
                    }}
                  >
                    Remove from canvas
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>
      <div className={card.deviceMetrics}>
        <span title="CPU utilization is not reported by this device.">
          CPU <b>—</b>
        </span>
        <span title="Memory from the most recent inventory sample, not a live usage reading.">
          RAM{' '}
          <b>
            {memoryReading(
              device.inventory?.usableRamBytes ?? device.inventory?.installedRamBytes,
              device.inventory?.availableRamBytes,
            )}
          </b>
        </span>
        <span title="Disk read/write activity is not reported by this device.">
          <Storage width={18} height={18} aria-hidden="true" />R — · W —
        </span>
      </div>
      <div className={styles.hardware}>
        {device.hardware
          .filter((hardware) => hardware.kind !== 'cpu')
          .map((hardware) => {
            const range = ranges.find((entry) => entry.hardwareId === hardware.id);
            const activeRange = appliedRanges.find((entry) => entry.hardwareId === hardware.id);
            const gpu = device.inventory?.gpus?.find(
              (gpu) =>
                hardware.assignmentId === gpu.executionIdentity?.uuid ||
                hardware.id === gpu.id ||
                hardware.id === `local-${gpu.id}`,
            );
            const editing = allocation?.editor?.hardwareId === hardware.id;
            const editor = editing ? allocation.editor! : null;
            const unavailable =
              !active ||
              loading ||
              (editableIds !== undefined && !editableIds.includes(hardware.id));
            return (
              <section
                className={card.gpu}
                key={hardware.id}
                aria-label={`${device.name} ${hardware.label}`}
              >
                <div className={card.meta}>
                  <span>{hardware.label}</span>
                  <span>
                    {hardware.memoryGb > 0
                      ? `${hardware.memoryGb.toFixed(1)} GiB`
                      : 'Memory unavailable'}
                  </span>
                </div>
                <h3>{hardware.name}</h3>
                <div className={card.gpuMetrics}>
                  <span title="GPU utilization is not reported by this device.">
                    <Speed width={18} height={18} aria-hidden="true" />—
                  </span>
                  <span title="Memory from the most recent inventory sample, not a live usage reading.">
                    VRAM <b>{memoryReading(gpu?.totalMemoryBytes, gpu?.availableMemoryBytes)}</b>
                  </span>
                </div>
                {activeRange && (
                  <span className={styles.hardwareStatus}>
                    <i />
                    <span>In use</span> ·{' '}
                    <span>
                      Active layers {activeRange.first} – {activeRange.last}
                    </span>
                  </span>
                )}
                <div className={card.assignment}>
                  {layerCount > 0 && (
                    <LayerRangeSlider
                      label={`${device.name} ${hardware.label}`}
                      range={{
                        first: range?.first ?? 0,
                        count: range ? range.last - range.first + 1 : 0,
                      }}
                      total={Math.max(1, layerCount)}
                      disabled={unavailable || !allocation || layerCount < 1}
                      onChange={(last) => allocation?.resize(hardware.id, last)}
                    />
                  )}
                  <div className={card.rangeRow}>
                    <span>{proposed && !savedAssignment ? 'Planned layers' : 'Layer range'}</span>
                    <SdkButton
                      className={card.sdkButton ?? ''}
                      color="secondary"
                      variant="outline"
                      size="sm"
                      title="Edit layer range"
                      aria-label={`Edit layers for ${device.name} ${hardware.label}`}
                      aria-expanded={editing ?? false}
                      disabled={unavailable}
                      onClick={() =>
                        allocation ? allocation.open(hardware.id) : onEdit(hardware.id)
                      }
                    >
                      <EditPencil aria-hidden="true" />
                      {range ? `${range.first}–${range.last}` : 'Unassigned'}
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
      {layerCount < 1 && <p className={card.preview}>Choose a model to assign layers.</p>}
    </article>
  );
}

function memoryReading(total: number | undefined, available: number | undefined): string {
  if (!total || available === undefined || available < 0 || available > total) return '—';
  return `${((total - available) / 2 ** 30).toFixed(1)} / ${(total / 2 ** 30).toFixed(1)} GiB`;
}
