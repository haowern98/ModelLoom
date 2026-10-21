import { Monitor, Plus } from 'lucide-react';
import type { DemoDevice } from '../../mocks/cluster';
import styles from './ClusterPage.module.css';

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
            <strong>{device.name}</strong>
            {device.hardware
              .filter((hardware) => hardware.kind !== 'cpu')
              .map((hardware) => (
                <small key={hardware.id}>
                  {hardware.name} · {hardware.memoryGb.toFixed(1)} GiB
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
