import { Fragment } from 'react';
import { supportedDeviceGpus } from '../../../shared/runtime';
import type { DemoDevice, DemoHardware } from '../../mocks/cluster';
import settings from '../settings/SettingsPage.module.css';
import styles from './ClusterViews.module.css';

function Property({ label, value = 'Unavailable' }: { label: string; value?: string | undefined }) {
  return (
    <div className={`${settings.row} ${styles.inventoryRow}`}>
      <dt className={settings.label}>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function memory(bytes: number | undefined): string | undefined {
  return bytes !== undefined && Number.isFinite(bytes) && bytes >= 0
    ? `${(bytes / 2 ** 30).toFixed(1)} GiB`
    : undefined;
}

function HardwareProperties({ hardware }: { hardware: DemoHardware }) {
  if (hardware.kind === 'cpu') {
    return (
      <>
        <Property label="CPU model" value={hardware.name} />
        <Property label="CPU cores / threads" value={hardware.detail} />
      </>
    );
  }
  if (hardware.kind === 'unified') {
    return (
      <>
        <Property label="Apple Silicon" value={hardware.label} />
        <Property label="CPU / GPU cores" value={hardware.name} />
      </>
    );
  }
  return (
    <>
      <Property label={`${hardware.label} model`} value={hardware.name} />
      <Property label={`${hardware.label} VRAM`} value={hardware.detail} />
    </>
  );
}

/** Lists supplied inventory only; unavailable specifications and backend support stay unknown. */
export function DeviceInventory({
  devices,
  demo,
  local,
}: {
  devices: readonly DemoDevice[];
  demo: boolean;
  local: boolean;
}) {
  return (
    <>
      {devices.map((device) => {
        const unifiedMemory = device.hardware.find((hardware) => hardware.kind === 'unified');
        const facts = device.inventory;
        const gpus = facts?.gpus !== undefined ? supportedDeviceGpus(facts.gpus) : undefined;
        return (
          <article className={settings.section} key={device.id} aria-label={device.name}>
            <div className={styles.identity}>
              <h2>{device.name}</h2>
              <span className={styles.badge}>{device.role}</span>
            </div>
            <dl className={`${settings.group} ${styles.inventory}`}>
              <Property label="Architecture" value={facts?.architecture} />
              {device.hardware
                .filter((hardware) => hardware.kind === 'cpu')
                .map((hardware) => (
                  <HardwareProperties key={hardware.id} hardware={hardware} />
                ))}
              {unifiedMemory && <Property label="Unified memory" value={unifiedMemory.detail} />}
              {!unifiedMemory && (
                <Property label="Installed RAM" value={memory(facts?.installedRamBytes)} />
              )}
              <Property label="Usable system memory" value={memory(facts?.usableRamBytes)} />
              <Property label="Available system memory" value={memory(facts?.availableRamBytes)} />
              {gpus !== undefined
                ? gpus.map((gpu, index, gpus) => {
                    const label = gpus.length > 1 ? `GPU ${index}` : 'GPU';
                    return (
                      <Fragment key={gpu.id}>
                        <Property label={`${label} model`} value={gpu.name} />
                        <Property
                          label={`${label} dedicated memory`}
                          value={memory(gpu.totalMemoryBytes)}
                        />
                        <Property
                          label={`${label} available dedicated memory`}
                          value={memory(gpu.availableMemoryBytes)}
                        />
                        <Property label={`${label} driver version`} value={gpu.driverVersion} />
                      </Fragment>
                    );
                  })
                : device.hardware
                    .filter((hardware) => hardware.kind !== 'cpu')
                    .map((hardware) => (
                      <Fragment key={hardware.id}>
                        <HardwareProperties hardware={hardware} />
                        {hardware.kind === 'gpu' && (
                          <>
                            <Property label={`${hardware.label} available dedicated memory`} />
                            <Property label={`${hardware.label} driver version`} />
                          </>
                        )}
                      </Fragment>
                    ))}
              {gpus?.length === 0 && (
                <Property label="GPU" value="No enabled AMD or NVIDIA GPU detected" />
              )}
              <Property label="Operating system" value={device.os} />
              <Property
                label="Verified runtime backends"
                value={
                  facts?.runtimeBackends
                    ? facts.runtimeBackends.join(', ') || 'None verified'
                    : 'Not verified yet'
                }
              />
              <Property
                label="Device status"
                value={
                  local ? 'This device' : demo ? 'Sample · connection not verified' : 'Unavailable'
                }
              />
            </dl>
            {facts && (
              <p className={`${settings.description} ${styles.inventoryNote}`}>
                Last checked: {new Date(facts.sampledAt).toLocaleTimeString()}
              </p>
            )}
          </article>
        );
      })}
      {!devices.length && (
        <div className={settings.group}>
          <div className={settings.row}>
            <p className={settings.description}>No devices connected.</p>
          </div>
        </div>
      )}
    </>
  );
}
