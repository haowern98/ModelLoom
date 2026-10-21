import { Monitor, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { DemoDevice } from '../../mocks/cluster';
import styles from './ClusterPage.module.css';

/** Measure each line separately so fitting text remains still as nearby text scrolls. */
function OverflowLine({ text }: { text: string }) {
  const viewport = useRef<HTMLSpanElement>(null);
  const content = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);
  useEffect(() => {
    const measure = () =>
      setOverflow(
        Math.max(0, (content.current?.scrollWidth ?? 0) - (viewport.current?.clientWidth ?? 0)),
      );
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    if (viewport.current) observer.observe(viewport.current);
    if (content.current) observer.observe(content.current);
    return () => observer.disconnect();
  }, [text]);
  return (
    <span
      ref={viewport}
      className={styles.canvasTextViewport}
      title={text}
      data-overflow={overflow > 0 ? 'true' : undefined}
      style={
        {
          '--line-scroll': `${-overflow}px`,
          '--line-duration': `${Math.max(4, overflow / 30)}s`,
        } as CSSProperties
      }
    >
      <span ref={content} className={styles.canvasTextContent}>
        {text}
      </span>
    </span>
  );
}

/** Approved inventory is separate from the user's choice to place a PC on the canvas. */
export function CanvasDevicePicker({
  devices,
  onChoose,
  onAdd,
}: {
  devices: readonly DemoDevice[];
  onChoose: (device: DemoDevice) => void;
  onAdd: () => void;
}) {
  return (
    <div className={styles.canvasDeviceChoices}>
      {devices.map((device) => (
        <button
          key={device.id}
          type="button"
          className={styles.canvasDeviceChoice}
          onClick={() => onChoose(device)}
          aria-label={`Add ${device.name} to canvas`}
        >
          <Monitor size={20} aria-hidden="true" />
          <span>
            <strong>
              <OverflowLine text={device.name} />
            </strong>
            {device.hardware
              .filter((hardware) => hardware.kind !== 'cpu')
              .map((hardware) => (
                <small key={hardware.id}>
                  <OverflowLine text={`${hardware.name} · ${hardware.memoryGb.toFixed(1)} GiB`} />
                </small>
              ))}
          </span>
        </button>
      ))}
      <button
        type="button"
        className={styles.canvasDeviceAdd}
        aria-label="Add device in Connections"
        onClick={onAdd}
      >
        <Plus size={24} aria-hidden="true" />
      </button>
    </div>
  );
}
