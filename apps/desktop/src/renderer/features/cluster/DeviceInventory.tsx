import { Fragment, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { supportedDeviceGpus } from '../../../shared/runtime';
import type { DemoDevice } from '../../mocks/cluster';
import { OverflowLine } from '../../components/OverflowLine';
import settings from '../settings/SettingsPage.module.css';
import styles from './ClusterViews.module.css';

function Property({ label, value = 'Unavailable' }: { label: string; value?: string | undefined }) {
  return (
    <div className={`${settings.row} ${styles.inventoryRow}`}>
      <dt>{label}</dt>
      <dd>
        <OverflowLine text={value} focusable />
      </dd>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.hardwareGroup} aria-label={title}>
      <h3>{title}</h3>
      <dl className={`${settings.group} ${styles.inventory}`}>{children}</dl>
    </section>
  );
}

function memory(bytes: number | undefined): string | undefined {
  return bytes !== undefined && Number.isFinite(bytes) && bytes >= 0
    ? `${(bytes / 2 ** 30).toFixed(1)} GiB`
    : undefined;
}

/** Groups reported hardware under each PC; targeted navigation never changes canvas membership. */
export function DeviceInventory({
  devices,
  demo,
  local,
  targetDeviceId,
}: {
  devices: readonly DemoDevice[];
  demo: boolean;
  local: boolean;
  targetDeviceId?: string | undefined;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!targetDeviceId) return;
    const heading = Array.from(
      root.current?.querySelectorAll<HTMLElement>('h2[data-device-id]') ?? [],
    ).find((element) => element.dataset.deviceId === targetDeviceId);
    heading?.focus({ preventScroll: true });
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    heading?.scrollIntoView?.({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [targetDeviceId]);
  return (
    <div ref={root}>
      {devices.map((device) => {
        const unified = device.hardware.find((hardware) => hardware.kind === 'unified');
        const cpus = device.hardware.filter((hardware) => hardware.kind === 'cpu');
        const facts = device.inventory;
        const gpus = facts?.gpus !== undefined ? supportedDeviceGpus(facts.gpus) : undefined;
        const fallbackGpus = device.hardware.filter((hardware) => hardware.kind === 'gpu');
        const status = local
          ? device.id === 'local'
            ? 'This device'
            : 'Approved remote device'
          : demo
            ? 'Sample · connection not verified'
            : 'Unavailable';
        return (
          <article
            className={styles.deviceArticle}
            key={device.id}
            aria-label={device.name}
            data-targeted={targetDeviceId === device.id ? 'true' : undefined}
          >
            <header className={styles.deviceHeader}>
              <div className={styles.identity}>
                <h2 data-device-id={device.id} tabIndex={-1}>
                  <OverflowLine text={device.name} />
                </h2>
                <span className={styles.badge}>{device.role}</span>
              </div>
              <p className={styles.deviceStatus}>{status}</p>
            </header>
            <Group title="System">
              <Property label="Operating system" value={device.os} />
              <Property label="Architecture" value={facts?.architecture} />
              <Property label="Address" value={device.address} />
              <Property
                label="Verified runtime backends"
                value={
                  facts?.runtimeBackends
                    ? facts.runtimeBackends.join(', ') || 'None verified'
                    : 'Not verified yet'
                }
              />
            </Group>
            <Group title="CPU">
              {cpus.length ? (
                cpus.map((cpu) => (
                  <Fragment key={cpu.id}>
                    <Property label="Model" value={cpu.name} />
                    <Property label="Cores / threads" value={cpu.detail} />
                  </Fragment>
                ))
              ) : (
                <Property label="Model" />
              )}
            </Group>
            <Group title="Memory">
              {unified ? (
                <Property label="Unified memory" value={unified.detail} />
              ) : (
                <Property label="Installed" value={memory(facts?.installedRamBytes)} />
              )}
              <Property label="Usable" value={memory(facts?.usableRamBytes)} />
              <Property label="Available" value={memory(facts?.availableRamBytes)} />
            </Group>
            {unified && (
              <Group title="Apple Silicon">
                <Property label="Model" value={unified.label} />
                <Property label="CPU / GPU cores" value={unified.name} />
              </Group>
            )}
            {gpus !== undefined
              ? gpus.map((gpu, index) => (
                  <Group key={gpu.id} title={gpus.length > 1 ? `GPU ${index}` : 'GPU'}>
                    <Property label="Model" value={gpu.name} />
                    <Property label="Dedicated memory" value={memory(gpu.totalMemoryBytes)} />
                    <Property
                      label="Available dedicated memory"
                      value={memory(gpu.availableMemoryBytes)}
                    />
                    <Property label="Driver version" value={gpu.driverVersion} />
                  </Group>
                ))
              : fallbackGpus.map((gpu, index) => (
                  <Group key={gpu.id} title={fallbackGpus.length > 1 ? `GPU ${index}` : 'GPU'}>
                    <Property label="Model" value={gpu.name} />
                    <Property label="Dedicated memory" value={gpu.detail} />
                    <Property label="Available dedicated memory" />
                    <Property label="Driver version" />
                  </Group>
                ))}
            {gpus?.length === 0 && (
              <Group title="GPU">
                <Property label="GPU" value="No enabled AMD or NVIDIA GPU detected" />
              </Group>
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
    </div>
  );
}
