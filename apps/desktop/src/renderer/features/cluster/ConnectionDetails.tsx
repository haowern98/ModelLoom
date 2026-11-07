import { useAppearance } from '../../app/appearance';
import type { DemoDevice } from '../../mocks/cluster';
import { useEffect, useState } from 'react';
import { InfoCircle } from '@openai/apps-sdk-ui/components/Icon';
import { Tooltip } from '@openai/apps-sdk-ui/components/Tooltip';
import type { NetworkView } from '../../../shared/network';
import styles from './ConnectionDetails.module.css';
import { connectionTelemetry } from './connection-telemetry';
import { connectionRoute } from './connection-route';
import './cluster-sdk-tokens.css';

function Information({ label, content }: { label: string; content: string }) {
  const { resolvedTheme } = useAppearance();
  const [open, setOpen] = useState(false);
  return (
    <Tooltip.Root open={open} onOpenChange={setOpen} delayDuration={150} disableHoverableContent>
      <Tooltip.Trigger>
        <button
          type="button"
          className={styles.infoButton}
          aria-label={label}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || !open) return;
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }}
        >
          <InfoCircle width={14} height={14} aria-hidden="true" />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Content
        data-cluster-sdk=""
        data-theme={resolvedTheme}
        className={styles.tooltip}
        maxWidth={260}
        gutterSize="sm"
      >
        {content}
      </Tooltip.Content>
    </Tooltip.Root>
  );
}
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
        <dl>
          <div>
            <dt>From</dt>
            <dd>{from?.name ?? 'Device unavailable'}</dd>
          </div>
          <div>
            <dt>To</dt>
            <dd>{to?.name ?? 'Device unavailable'}</dd>
          </div>
        </dl>
      </section>
      <section>
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
            <dt className={styles.infoLabel}>
              {telemetry?.state === 'unavailable' && telemetry.latencyMs != null
                ? 'Last latency'
                : 'Latency'}
              {direct && (
                <Information
                  label="About latency"
                  content="Control connection round-trip, including connection setup."
                />
              )}
            </dt>
            <dd>
              {telemetry?.latencyMs != null
                ? `${telemetry.latencyMs.toFixed(1)} ms`
                : 'Unavailable'}
            </dd>
          </div>
        </dl>
      </section>
      <section>
        <h3 className={styles.infoLabel}>
          {telemetry?.state === 'active' ? 'Live transfer rate' : 'Bandwidth'}
          <Information
            label={telemetry?.state === 'active' ? 'About live transfer rate' : 'About bandwidth'}
            content={
              !direct
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
                          : 'Waiting for an idle connection test.'
            }
          />
        </h3>
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
