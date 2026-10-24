import { expect, it, vi } from 'vitest';
import { PeerNode } from './node.js';
import { openWindowsPeerIdentity } from './windows-identity.js';
import { measureDiagnostic } from './diagnostics.js';
import { createServer } from 'node:https';
import { X509Certificate } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';

it('measures only approved idle TLS peers and aborts immediately for runtime activity', async () => {
  const local = await openWindowsPeerIdentity(),
    remote = await openWindowsPeerIdentity();
  const start = vi.fn(() => {
    const stream = new PassThrough();
    return Promise.resolve({
      stream,
      close: () => {
        stream.destroy();
        return Promise.resolve();
      },
    });
  });
  const worker = new PeerNode(
    remote,
    'Worker',
    [{ id: 'GPU-11111111-1111-1111-1111-111111111111', name: 'GPU', memoryBytes: 4096 }],
    { start },
  );
  const coordinator = new PeerNode(local, 'Coordinator', []);
  try {
    const address = await worker.share('127.0.0.1', 0, 0, [
      'GPU-11111111-1111-1111-1111-111111111111',
    ]);
    const { id } = await coordinator.invite(address);
    const introduction = await fetch(new URL('/v1/pair', address), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Coordinator',
        certificate: local.certificate.toString('base64'),
        authority: local.authority.toString('base64'),
        rememberedFingerprint: null,
      }),
    });
    const payload = (await introduction.json()) as { securePort: number };
    const target = {
      id,
      address: '127.0.0.1',
      securePort: payload.securePort,
      certificate: remote.certificate,
      authority: remote.authority,
    };
    await expect(
      measureDiagnostic(local, target, 'download', new AbortController().signal),
    ).rejects.toThrow();
    await expect(coordinator.pingTelemetry(id, new AbortController().signal)).rejects.toThrow(
      'PEER_NOT_APPROVED',
    );
    await coordinator.verifyCode(id, worker.snapshot().incoming[0]!.pairingCode!);
    await worker.approve(id, local.fingerprint);
    expect(await coordinator.pingTelemetry(id, new AbortController().signal)).toBeGreaterThan(0);
    const measured = await coordinator.measureTelemetry(id, new AbortController().signal);
    expect(measured.uploadMbps).toBeGreaterThan(0);
    expect(measured.downloadMbps).toBeGreaterThan(0);
    expect(start).not.toHaveBeenCalled();
    await expect(coordinator.measureTelemetry(id, new AbortController().signal)).rejects.toThrow(
      'DIAGNOSTICS_BUSY',
    );
    worker.setRuntimeBusy(true);
    await coordinator.pingTelemetry(id, new AbortController().signal);
    expect(coordinator.telemetryBusy(id)).toBe(true);
    await expect(coordinator.measureTelemetry(id, new AbortController().signal)).rejects.toThrow(
      'DIAGNOSTICS_BUSY',
    );
    worker.setRuntimeBusy(false);
    const stream = await coordinator.openRpc(id, 'GPU-11111111-1111-1111-1111-111111111111');
    expect(worker.telemetryBusy()).toBe(true);
    await coordinator.notifyRuntimeActivity(false);
    expect(worker.telemetryBusy()).toBe(false);
    coordinator.setRuntimeBusy(true);
    await coordinator.notifyRuntimeActivity(true);
    expect(worker.telemetryBusy()).toBe(true);
    const echoed = once(stream, 'data');
    stream.write(Buffer.from('sample runtime bytes'));
    await echoed;
    expect(coordinator.trafficTotals(id).sent).toBeGreaterThanOrEqual(20);
    expect(coordinator.trafficTotals(id).received).toBeGreaterThanOrEqual(20);
    coordinator.setRuntimeBusy(false);
    await coordinator.notifyRuntimeActivity(false);
    expect(worker.telemetryBusy()).toBe(false);
    stream.destroy();
  } finally {
    await coordinator.close();
    await worker.close();
    local.close();
    remote.close();
  }
}, 20000);

it('cancels an in-flight bandwidth request before acknowledging local runtime activity', async () => {
  const a = await openWindowsPeerIdentity(),
    b = await openWindowsPeerIdentity();
  const gpu = 'GPU-11111111-1111-1111-1111-111111111111';
  const worker = new PeerNode(b, 'Worker', [{ id: gpu, name: 'GPU', memoryBytes: 4096 }]),
    coordinator = new PeerNode(a, 'Coordinator', []);
  try {
    const { id } = await coordinator.invite(await worker.share('127.0.0.1', 0, 0, [gpu]));
    await coordinator.verifyCode(id, worker.snapshot().incoming[0]!.pairingCode!);
    await worker.approve(id, a.fingerprint);
    await coordinator.pingTelemetry(id, new AbortController().signal);
    const pending = coordinator.measureTelemetry(id, new AbortController().signal);
    coordinator.setRuntimeBusy(true);
    await expect(pending).rejects.toThrow();
    expect(coordinator.telemetryBusy()).toBe(true);
  } finally {
    await coordinator.close();
    await worker.close();
    a.close();
    b.close();
  }
}, 20000);

it('returns a bounded partial measurement for a slow TLS link', async () => {
  const a = await openWindowsPeerIdentity(),
    b = await openWindowsPeerIdentity();
  const server = createServer(
    {
      pfx: b.pfx,
      ca: new X509Certificate(a.authority).toString(),
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.3',
    },
    (_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      const interval = setInterval(() => response.write(Buffer.alloc(4096)), 80);
      response.once('close', () => clearInterval(interval));
    },
  );
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('No test listener');
    const started = performance.now();
    const result = await measureDiagnostic(
      a,
      {
        id: '00000000-0000-0000-0000-000000000001',
        address: '127.0.0.1',
        securePort: address.port,
        certificate: b.certificate,
        authority: b.authority,
      },
      'download',
      new AbortController().signal,
    );
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(2);
    expect(performance.now() - started).toBeLessThan(1500);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    a.close();
    b.close();
  }
}, 20000);
