import { useEffect, useRef, useState } from 'react';
import { Cpu } from '@phosphor-icons/react/dist/csr/Cpu';
import { GraphicsCard as Gpu } from '@phosphor-icons/react/dist/csr/GraphicsCard';
import { AppleLogo as Apple } from '@phosphor-icons/react/dist/csr/AppleLogo';
import { Pencil } from '@phosphor-icons/react/dist/csr/Pencil';
import { DotsThreeVertical as EllipsisVertical } from '@phosphor-icons/react/dist/csr/DotsThreeVertical';
import { Plus } from '@phosphor-icons/react/dist/csr/Plus';
import type { DemoDevice, SampleRange } from '../../mocks/cluster';
import { Button } from '../../components/Button';
import styles from './ClusterPage.module.css';
import type { CanvasEdge } from './canvas-layout';

interface DeviceCardProps {
  device: DemoDevice;
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
      className={`${styles.device} ${device.role === 'Coordinator' ? styles.coordinator : ''}`}
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
        if (event.target instanceof Element && event.target.closest('button, input, a')) return;
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
        <Plus size={16} aria-hidden="true" />
      </button>
      {showAddHint && (
        <p
          className={styles.nodeAddHint}
          data-hidden={Boolean(addEdge) || pointerInside || focusInside}
        >
          Hover near an edge to add a device.
        </p>
      )}
      <header className={styles.deviceHeader}>
        <div className={styles.identity}>
          <h2 aria-label={device.name}>
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
        <div className={styles.headerControls}>
          <span className={styles.role}>{device.role}</span>
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
            <Button
              variant="icon"
              className={styles.menuButton}
              aria-label={`Actions for ${device.name}`}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <EllipsisVertical size={16} />
            </Button>
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
      <div className={styles.hardware}>
        {device.hardware.map((hardware) => {
          const range = ranges.find((entry) => entry.hardwareId === hardware.id);
          const activeRange = appliedRanges.find((entry) => entry.hardwareId === hardware.id);
          const Icon = hardware.kind === 'cpu' ? Cpu : hardware.kind === 'unified' ? Apple : Gpu;
          return (
            <section
              className={`${styles.tile} ${hardware.kind === 'cpu' ? styles.cpu : ''}`}
              key={hardware.id}
              aria-label={`${device.name} ${hardware.label}`}
            >
              <Icon
                size={26}
                strokeWidth={1.7}
                className={hardware.kind !== 'unified' ? styles.hardwareIcon : ''}
              />
              <div className={styles.hardwareText}>
                <h3>{hardware.label}</h3>
                <p>{hardware.name}</p>
                <p>{hardware.detail}</p>
                {activeRange && (
                  <span className={styles.hardwareStatus}>
                    <i />
                    In use
                  </span>
                )}
                {hardware.kind !== 'cpu' && (
                  <div className={styles.assignment}>
                    <div
                      className={styles.bar}
                      title={range ? 'Layer allocation share, not measured memory use' : undefined}
                    >
                      {range && (
                        <span
                          style={{
                            width: `${((range.last - range.first + 1) / layerCount) * 100}%`,
                          }}
                        />
                      )}
                    </div>
                    <div className={styles.rangeRow}>
                      <span>
                        {range
                          ? `${proposed && !savedAssignment ? 'Planned layers' : 'Layers'} ${range.first} – ${range.last}`
                          : 'Unassigned'}
                      </span>
                      <button
                        type="button"
                        aria-label={`Edit layers for ${device.name} ${hardware.label}`}
                        disabled={!active || loading}
                        onClick={() => onEdit(hardware.id)}
                      >
                        <Pencil size={14} />
                      </button>
                    </div>
                    {proposed && activeRange && (
                      <small className={styles.activeRange}>
                        Active layers {activeRange.first} – {activeRange.last}
                      </small>
                    )}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </article>
  );
}
