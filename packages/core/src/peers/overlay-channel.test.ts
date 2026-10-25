import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import type { Duplex } from 'node:stream';
import { expect, it, vi } from 'vitest';
import { overlayChannel } from './overlay-channel.js';
import type { PeerOverlay } from './overlay.js';

function pair(dial: PeerOverlay['dial']) {
  let changed = () => {};
  let arrive!: (port: number, stream: PassThrough) => void;
  let addresses = ['100.64.0.2'];
  const left = overlayChannel((message) =>
    queueMicrotask(() => right.receive(message as Record<string, unknown>)),
  );
  const right = overlayChannel((message) =>
    queueMicrotask(() => left.receive(message as Record<string, unknown>)),
  );
  left.attach({
    addresses: () => addresses,
    dial,
    subscribe: (listener) => {
      changed = listener;
      return vi.fn();
    },
    incoming: (listener) => {
      arrive = listener;
      return vi.fn();
    },
  });
  return {
    left,
    right,
    arrive: (stream: PassThrough) => arrive(49302, stream),
    change(next: string[] = []) {
      addresses = next;
      changed();
    },
  };
}

it('rejects arbitrary routes, public addresses and non-peer ports', async () => {
  const endpoint = overlayChannel(vi.fn());
  expect(() => endpoint.receive({ type: 'overlay-routes', addresses: ['8.8.8.8'] })).toThrow(
    'INVALID_CONTROL',
  );
  expect(() =>
    endpoint.receive({ type: 'overlay-routes', addresses: ['100.64.0.2', '100.64.0.2'] }),
  ).toThrow();
  endpoint.receive({ type: 'overlay-routes', addresses: ['100.64.0.2'] });
  await expect(endpoint.transport.dial('100.64.0.3', 49301)).rejects.toThrow();
  await expect(endpoint.transport.dial('100.64.0.2', 22)).rejects.toThrow();
  const parent = overlayChannel(vi.fn());
  parent.attach({
    addresses: () => ['100.64.0.2'],
    dial: vi.fn(),
    incoming: () => () => {},
    subscribe: () => () => {},
  });
  expect(() =>
    parent.receive({ type: 'overlay-dial', id: randomUUID(), address: '100.64.0.3', port: 49301 }),
  ).toThrow();
  expect(() =>
    parent.receive({ type: 'overlay-dial', id: randomUUID(), address: '100.64.0.2', port: 22 }),
  ).toThrow();
  endpoint.close();
  parent.close();
});

it('cancels a pending parent dial and destroys its late result', async () => {
  let signal!: AbortSignal, finish!: (stream: PassThrough) => void;
  const endpoints = pair(async (_address, _port, abort) => {
    signal = abort!;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  await new Promise((resolve) => setImmediate(resolve));
  const controller = new AbortController();
  const pending = endpoints.right.transport.dial('100.64.0.2', 49302, controller.signal);
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await expect(pending).rejects.toThrow('OVERLAY_DISCONNECTED');
  await new Promise((resolve) => setImmediate(resolve));
  expect(signal.aborted).toBe(true);
  const late = new PassThrough();
  finish(late);
  await new Promise((resolve) => setImmediate(resolve));
  expect(late.destroyed).toBe(true);
  endpoints.left.close();
  endpoints.right.close();
});

it('tracks incoming streams and closes both ends when routes change', async () => {
  const endpoints = pair(vi.fn());
  let accepted: Duplex | undefined;
  endpoints.right.incoming((_port, stream) => {
    accepted = stream;
  });
  const remote = new PassThrough();
  endpoints.arrive(remote);
  await new Promise((resolve) => setImmediate(resolve));
  expect(accepted?.destroyed).toBe(false);
  endpoints.change();
  await new Promise((resolve) => setImmediate(resolve));
  expect(accepted?.destroyed).toBe(true);
  expect(remote.destroyed).toBe(true);
  endpoints.left.close();
  endpoints.right.close();
});

it('retains active streams when unrelated peers are discovered or removed', async () => {
  const remote = new PassThrough();
  const endpoints = pair(() => Promise.resolve(remote));
  await new Promise((resolve) => setImmediate(resolve));
  const stream = await endpoints.right.transport.dial('100.64.0.2', 49302);
  endpoints.change(['100.64.0.2', '100.64.0.3']);
  await new Promise((resolve) => setImmediate(resolve));
  expect(stream.destroyed).toBe(false);
  endpoints.change(['100.64.0.2']);
  await new Promise((resolve) => setImmediate(resolve));
  expect(stream.destroyed).toBe(false);
  endpoints.change(['100.64.0.3']);
  await new Promise((resolve) => setImmediate(resolve));
  expect(stream.destroyed).toBe(true);
  expect(remote.destroyed).toBe(true);
  expect(endpoints.right.transport.has('100.64.0.2')).toBe(true);
  await expect(endpoints.right.transport.dial('100.64.0.2', 49302)).rejects.toThrow(
    'OVERLAY_UNAVAILABLE',
  );
  expect(endpoints.right.transport.has('100.64.0.99')).toBe(false);
  endpoints.left.close();
  endpoints.right.close();
});

it('fragments coalesced writes without changing any bytes or weakening IPC frame bounds', async () => {
  const endpoints = pair(() => Promise.resolve(new PassThrough()));
  await new Promise((resolve) => setImmediate(resolve));
  const stream = await endpoints.right.transport.dial('100.64.0.2', 49302);
  const expected = Buffer.alloc(256 * 1024, 173),
    parts: Buffer[] = [];
  let received = 0;
  const complete = new Promise<Buffer>((resolve, reject) => {
    stream.once('error', reject);
    stream.on('data', (part: Buffer) => {
      parts.push(part);
      received += part.length;
      if (received === expected.length) resolve(Buffer.concat(parts));
    });
  });
  try {
    await new Promise<void>((resolve, reject) =>
      stream.write(expected, (error) => (error ? reject(error) : resolve())),
    );
    expect(await complete).toEqual(expected);
  } finally {
    stream.destroy();
    await new Promise((resolve) => setImmediate(resolve));
    endpoints.left.close();
    endpoints.right.close();
  }
});
