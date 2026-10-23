import type { DemoDevice } from '../../mocks/cluster';
import styles from './ConnectionDetails.module.css';
import { connectionTelemetry } from './connection-telemetry';
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
              ? 'Application traffic during inference.'
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
                  ? `${telemetry.uploadMbps.toFixed(1)} Mbps`
                  : 'Unavailable'}
            </dd>
          </div>
          <div>
            <dt>Receiving on this PC</dt>
            <dd>
              {telemetry?.state === 'active'
                ? rate(telemetry.receivingBytesPerSecond)
                : telemetry?.downloadMbps != null
                  ? `${telemetry.downloadMbps.toFixed(1)} Mbps`
                  : 'Unavailable'}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
