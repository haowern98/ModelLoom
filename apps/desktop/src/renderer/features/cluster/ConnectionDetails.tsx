import type { DemoDevice } from '../../mocks/cluster';
import { useEffect, useState } from 'react';
import type { NetworkView } from '../../../shared/network';
import styles from './ConnectionDetails.module.css';
import { connectionTelemetry } from './connection-telemetry';
import { connectionRoute } from './connection-route';
function rate(value: number) {
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MiB/s`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KiB/s`;
  return `${value.toFixed(0)} B/s`;
}
export function ConnectionDetails({
  from,
  to,
}: {
  from: DemoDevice | undefined;
  to: DemoDevice | undefined;
}) {
  const telemetry = connectionTelemetry(from, to);
  const direct = from && to && from.role !== to.role;
  const [network, setNetwork] = useState<NetworkView>();
  const bridge = window.modelLoomNetwork;
  useEffect(() => {
    let active = true,
      pending = false,
      dirty = false;
    const read = async () => {
      if (!bridge) return;
      if (pending) {
        dirty = true;
        return;
      }
      pending = true;
      try {
        const reply = await bridge.command({ action: 'read' });
        if (active) setNetwork(reply.ok ? reply.view : undefined);
      } catch {
        if (active) setNetwork(undefined);
      } finally {
        pending = false;
        if (active && dirty) {
          dirty = false;
          void read();
        }
      }
    };
    const unsubscribe = bridge?.subscribe(() => {
      void read();
    });
    void read();
    // Expire route evidence without generating network probes.
    const timer = setInterval(() => {
      void read();
    }, 5000);
    return () => {
      active = false;
      clearInterval(timer);
      unsubscribe?.();
    };
  }, [bridge]);
  const worker = direct ? (from.role === 'Worker' ? from : to) : undefined;
  const route = connectionRoute(
    worker?.address,
    network
      ? network.state === 'connected'
        ? (network.paths ?? [])
        : []
      : bridge
        ? undefined
        : [],
  );
  return (
    <div className={styles.details}>
      <section>
        <h3>Devices</h3>
        <p>{from?.name ?? 'Device unavailable'}</p>
        <p>{to?.name ?? 'Device unavailable'}</p>
      </section>
      <section>
        <h3>Connection</h3>
        <dl>
          <div>
            <dt>Network</dt>
            <dd>{route.network}</dd>
          </div>
          {route.network === 'Tailscale' && (
            <div>
              <dt>Path</dt>
              <dd>{route.path}</dd>
            </div>
          )}
          <div>
            <dt>Status</dt>
            <dd>
              {!from || !to
                ? 'Disconnected'
                : !direct
                  ? 'Canvas placement only'
                  : !telemetry || telemetry.state === 'unavailable'
                    ? 'Unavailable'
                    : telemetry.state === 'unsupported'
                      ? 'Monitoring unsupported'
                      : 'Connected'}
            </dd>
          </div>
          <div>
            <dt>
              {telemetry?.state === 'unavailable' && telemetry.latencyMs != null
                ? 'Last latency'
                : 'Latency'}
            </dt>
            <dd>
              {telemetry?.latencyMs != null
                ? `${telemetry.latencyMs.toFixed(1)} ms`
                : 'Unavailable'}
            </dd>
          </div>
        </dl>
        {direct && (
          <p className={styles.note}>Control connection round-trip, including connection setup.</p>
        )}
      </section>
      <section>
        <h3>{telemetry?.state === 'active' ? 'Live transfer rate' : 'Bandwidth'}</h3>
        <p className={styles.note}>
          {!direct
            ? 'This line shows canvas placement, not a direct device connection.'
            : telemetry?.state === 'active'
              ? 'Application traffic during loading and inference.'
              : telemetry?.state === 'testing'
                ? 'Testing connection while idle...'
                : telemetry?.state === 'unsupported'
                  ? 'This device does not support connection measurements.'
                  : telemetry?.state === 'unavailable' || !telemetry
                    ? 'Connection measurements are unavailable.'
                    : telemetry?.bandwidthMeasuredAt != null
                      ? 'Last measured bandwidth'
                      : 'Waiting for an idle connection test.'}
        </p>
        <dl>
          <div>
            <dt>Sending from this PC</dt>
            <dd>
              {telemetry?.state === 'active'
                ? rate(telemetry.sendingBytesPerSecond)
                : telemetry?.uploadMbps != null
                  ? rate((telemetry.uploadMbps * 1000000) / 8)
                  : 'Unavailable'}
            </dd>
          </div>
          <div>
            <dt>Receiving on this PC</dt>
            <dd>
              {telemetry?.state === 'active'
                ? rate(telemetry.receivingBytesPerSecond)
                : telemetry?.downloadMbps != null
                  ? rate((telemetry.downloadMbps * 1000000) / 8)
                  : 'Unavailable'}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
