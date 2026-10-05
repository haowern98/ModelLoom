import { useRef, useState } from 'react';
import { Monitor, Cpu, CircuitBoard, Apple, Pencil, EllipsisVertical, Plus } from 'lucide-react';
import type { DemoDevice, SampleRange } from '../../mocks/cluster';
import { Button } from '../../components/Button';
import styles from './ClusterPage.module.css';

interface DeviceCardProps {
  device: DemoDevice;
  ranges: readonly SampleRange[];
  appliedRanges: readonly SampleRange[];
  layerCount: number;
  loading: boolean;
  proposed: boolean;
  active: boolean;
  onEdit: (hardwareId: string) => void;
  onDetails: (device: DemoDevice) => void;
  onRename: (device: DemoDevice) => void;
  selected: boolean;
  alwaysShowAdd: boolean;
  onAdd: () => void;
}

export function DeviceCard({
  device,
  ranges,
  appliedRanges,
  layerCount,
  loading,
  proposed,
  active,
  onEdit,
  onDetails,
  onRename,
  selected,
  alwaysShowAdd,
  onAdd,
}: DeviceCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchor = useRef<HTMLDivElement>(null);
  return (
    <article
      aria-label={device.name}
      className={`${styles.device} ${device.role === 'Coordinator' ? styles.coordinator : ''}`}
      data-selected={selected}
      onClick={(event) => {
        if (event.target instanceof Element && event.target.closest('button, input, a')) return;
        onDetails(device);
      }}
    >
      <button
        type="button"
        className={`${styles.nodeAdd} ${alwaysShowAdd ? styles.nodeAddAlways : ''}`}
        aria-label={`Add device near ${device.name}`}
        title="Add device to cluster"
        onClick={onAdd}
      >
        <Plus size={16} aria-hidden="true" />
      </button>
      <header className={styles.deviceHeader}>
        <Monitor className={styles.monitor} size={30} strokeWidth={1.7} />
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
          <p>
            {device.os} · {device.address}
          </p>
        </div>
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
            </div>
          )}
        </div>
      </header>
      <div className={styles.hardware}>
        {device.hardware.map((hardware) => {
          const range = ranges.find((entry) => entry.hardwareId === hardware.id);
          const activeRange = appliedRanges.find((entry) => entry.hardwareId === hardware.id);
          const Icon =
            hardware.kind === 'cpu' ? Cpu : hardware.kind === 'unified' ? Apple : CircuitBoard;
          return (
            <section
              className={`${styles.tile} ${hardware.kind === 'cpu' ? styles.cpu : ''}`}
              key={hardware.id}
              aria-label={`${device.name} ${hardware.label}`}
            >
              <Icon
                size={26}
                strokeWidth={1.7}
                className={hardware.kind === 'gpu' ? styles.gpuIcon : ''}
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
                    {range && (
                      <div
                        className={styles.bar}
                        title="Sample allocation share, not measured memory use"
                      >
                        <span
                          style={{
                            width: `${((range.last - range.first + 1) / layerCount) * 100}%`,
                          }}
                        />
                      </div>
                    )}
                    <div className={styles.rangeRow}>
                      <span>
                        {range
                          ? `${proposed ? 'Planned layers' : 'Layers'} ${range.first} – ${range.last}`
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
