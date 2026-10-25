import { describe, expect, it, vi } from 'vitest';
import { PeerTelemetryMonitor } from './telemetry-monitor.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(bandwidthCooldownMs = 60000) {
  let time = 0;
  let busy = false;
  let bytes = { sent: 0, received: 0 };
  const ping = vi.fn<(signal: AbortSignal) => Promise<number>>(() => Promise.resolve(12));
  const bandwidth = vi.fn<
    (signal: AbortSignal) => Promise<{ uploadMbps: number; downloadMbps: number }>
  >(() => Promise.resolve({ uploadMbps: 80, downloadMbps: 90 }));
  const changed = vi.fn();
  const monitor = new PeerTelemetryMonitor({
    bandwidthCooldownMs,
    ping,
    bandwidth,
    changed,
    totals: () => bytes,
    active: () => busy,
    now: () => time,
    wallNow: () => time + 1000,
  });
  return {
    monitor,
    ping,
    bandwidth,
    changed,
    time: (value: number) => {
      time = value;
    },
    busy: (value: boolean) => {
      busy = value;
    },
    bytes: (sent: number, received: number) => {
      bytes = { sent, received };
    },
  };
}

describe('PeerTelemetryMonitor', () => {
  it('honors an owner-supplied staggered bandwidth cooldown', async () => {
    const s = setup(75000);
    await s.monitor.tick();
    s.time(60000);
    await s.monitor.tick();
    expect(s.bandwidth).toHaveBeenCalledTimes(1);
    s.time(74999);
    await s.monitor.tick();
    expect(s.bandwidth).toHaveBeenCalledTimes(1);
    s.time(75000);
    await s.monitor.tick();
    expect(s.bandwidth).toHaveBeenCalledTimes(2);
  });
  it('marks failed ping unavailable, retains measurements, and recovers without bypassing cooldown', async () => {
    const s = setup();
    await s.monitor.tick();
    s.ping.mockRejectedValueOnce(Error('NETWORK'));
    s.time(3000);
    await s.monitor.tick();
    expect(s.monitor.view()).toMatchObject({
      state: 'unavailable',
      latencyMs: 12,
      latencyMeasuredAt: 1000,
    });
    expect(s.bandwidth).toHaveBeenCalledTimes(1);
    s.time(6000);
    await s.monitor.tick();
    expect(s.monitor.view().state).toBe('idle');
    expect(s.bandwidth).toHaveBeenCalledTimes(1);
  });
  it('does not begin bandwidth on a failed initial ping', async () => {
    const s = setup();
    s.ping.mockRejectedValue(Error('NETWORK'));
    await s.monitor.tick();
    expect(s.monitor.view().state).toBe('unavailable');
    expect(s.bandwidth).not.toHaveBeenCalled();
  });
  it('samples latency and tests idle bandwidth at most once per minute', async () => {
    const s = setup();
    await s.monitor.tick();
    expect(s.monitor.view()).toMatchObject({
      state: 'idle',
      latencyMs: 12,
      bandwidthMeasuredAt: 1000,
      uploadMbps: 80,
    });
    s.time(59000);
    await s.monitor.tick();
    expect(s.bandwidth).toHaveBeenCalledTimes(1);
    s.time(60000);
    await s.monitor.tick();
    expect(s.bandwidth).toHaveBeenCalledTimes(2);
  });
  it('does not overlap ticks', async () => {
    const s = setup();
    const wait = deferred<number>();
    s.ping.mockImplementation(() => wait.promise);
    const first = s.monitor.tick();
    await s.monitor.tick();
    expect(s.ping).toHaveBeenCalledTimes(1);
    wait.resolve(10);
    await first;
  });
  it('aborts a bandwidth test immediately on activity and ignores late completion', async () => {
    const s = setup();
    const wait = deferred<{ uploadMbps: number; downloadMbps: number }>();
    s.bandwidth.mockImplementation(() => wait.promise);
    const first = s.monitor.tick();
    await vi.waitFor(() => expect(s.bandwidth).toHaveBeenCalledTimes(1));
    expect(s.monitor.view().state).toBe('testing');
    s.monitor.setActive(true);
    expect(s.bandwidth.mock.calls[0]?.[0].aborted).toBe(true);
    wait.resolve({ uploadMbps: 999, downloadMbps: 999 });
    await first;
    expect(s.monitor.view()).toMatchObject({ state: 'active', uploadMbps: null });
    s.monitor.setActive(false);
    s.time(3000);
    await s.monitor.tick();
    expect(s.bandwidth).toHaveBeenCalledTimes(1);
    s.time(60000);
    await s.monitor.tick();
    expect(s.bandwidth).toHaveBeenCalledTimes(2);
  });
  it('uses passive counter deltas while active and safely handles counter resets', async () => {
    const s = setup();
    s.busy(true);
    await s.monitor.tick();
    s.time(3000);
    s.bytes(6000, 9000);
    await s.monitor.tick();
    expect(s.monitor.view()).toMatchObject({
      state: 'active',
      sendingBytesPerSecond: 2000,
      receivingBytesPerSecond: 3000,
    });
    s.time(6000);
    s.bytes(10, 20);
    await s.monitor.tick();
    expect(s.monitor.view().sendingBytesPerSecond).toBe(0);
    expect(s.bandwidth).not.toHaveBeenCalled();
  });
  it('retains successful bandwidth and cools down failed attempts', async () => {
    const s = setup();
    await s.monitor.tick();
    s.bandwidth.mockRejectedValue(Error('NETWORK'));
    s.time(60000);
    await s.monitor.tick();
    expect(s.monitor.view()).toMatchObject({ state: 'unavailable', uploadMbps: 80 });
    s.time(63000);
    await s.monitor.tick();
    expect(s.monitor.view().state).toBe('unavailable');
    expect(s.bandwidth).toHaveBeenCalledTimes(2);
  });
  it('keeps a healthy control connection idle when the bandwidth endpoint is temporarily busy', async () => {
    const s = setup();
    s.bandwidth.mockRejectedValueOnce(Error('DIAGNOSTICS_BUSY'));
    await s.monitor.tick();
    expect(s.monitor.view()).toMatchObject({ state: 'idle', latencyMs: 12, uploadMbps: null });
  });
  it('retains a successful direction when the other bandwidth sample is unavailable', async () => {
    const monitor = new PeerTelemetryMonitor({
      ping: () => Promise.resolve(12),
      bandwidth: () => Promise.resolve({ downloadMbps: 42, uploadMbps: null }),
      totals: () => ({ sent: 0, received: 0 }),
      active: () => false,
      changed: () => {},
    });
    await monitor.tick();
    expect(monitor.view()).toMatchObject({ state: 'idle', downloadMbps: 42, uploadMbps: null });
    monitor.close();
  });
  it.each(['UNKNOWN_PEER_OPERATION', 'DIAGNOSTICS_UNSUPPORTED'])(
    'stops unsupported bandwidth attempts: %s',
    async (error) => {
      const s = setup();
      s.bandwidth.mockRejectedValue(Error(error));
      await s.monitor.tick();
      s.time(120000);
      await s.monitor.tick();
      expect(s.monitor.view()).toMatchObject({ state: 'unsupported', latencyMs: 12 });
      expect(s.bandwidth).toHaveBeenCalledTimes(1);
    },
  );
  it('checks activity after ping before beginning a test', async () => {
    const s = setup();
    s.ping.mockImplementation(() => {
      s.busy(true);
      return Promise.resolve(10);
    });
    await s.monitor.tick();
    expect(s.bandwidth).not.toHaveBeenCalled();
    expect(s.monitor.view().state).toBe('active');
  });
  it('closes pending work without later mutations or notifications', async () => {
    const s = setup();
    const wait = deferred<number>();
    s.ping.mockImplementation(() => wait.promise);
    const pending = s.monitor.tick();
    s.monitor.close();
    const snapshot = s.monitor.view();
    const calls = s.changed.mock.calls.length;
    wait.resolve(1);
    await pending;
    await s.monitor.tick();
    s.monitor.setActive(true);
    expect(s.ping.mock.calls[0]?.[0].aborted).toBe(true);
    expect(s.monitor.view()).toEqual(snapshot);
    expect(s.changed).toHaveBeenCalledTimes(calls);
  });
  it('does not notify for unchanged observations', async () => {
    const s = setup();
    await s.monitor.tick();
    s.changed.mockClear();
    await s.monitor.tick();
    expect(s.changed).not.toHaveBeenCalled();
  });
});
