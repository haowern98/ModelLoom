import { randomUUID, X509Certificate } from 'node:crypto';
import { createServer } from 'node:https';
import { duplexPair } from 'node:stream';
import { expect, it, vi } from 'vitest';
import { measureDiagnostic } from './diagnostics.js';
import { overlaySocket } from './overlay-socket.js';
import { overlayChannel } from './overlay-channel.js';
import * as ipc from './ipc-rpc.js';
import { openWindowsPeerIdentity } from './windows-identity.js';

it('carries bandwidth probes over the owned overlay with client-authenticated TLS', async () => {
  const client = await openWindowsPeerIdentity(),
    serverIdentity = await openWindowsPeerIdentity();
  let authenticated = false;
  const server = createServer(
    {
      pfx: serverIdentity.pfx,
      ca: new X509Certificate(client.authority).toString(),
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.3',
      maxVersion: 'TLSv1.3',
    },
    (request, response) => {
      authenticated = Reflect.get(request.socket, 'authorized') === true;
      request.resume();
      if (request.url?.endsWith('/download')) response.end(Buffer.alloc(4096));
      else request.once('end', () => response.end(JSON.stringify({ mbps: 12 })));
    },
  );
  const dial = vi.fn(() => {
    const [local, remote] = duplexPair();
    server.emit('connection', overlaySocket(remote));
    return Promise.resolve(local);
  });
  const target = {
    id: randomUUID(),
    address: '100.100.100.100',
    securePort: 49302,
    certificate: serverIdentity.certificate,
    authority: serverIdentity.authority,
  };
  try {
    expect(
      await measureDiagnostic(client, target, 'download', AbortSignal.timeout(3000), {
        has: () => true,
        dial,
      }),
    ).toBeGreaterThan(0);
    expect(authenticated).toBe(true);
    expect(dial).toHaveBeenCalledWith(target.address, target.securePort, expect.any(AbortSignal));
    expect(
      await measureDiagnostic(client, target, 'upload', AbortSignal.timeout(3000), {
        has: () => true,
        dial,
      }),
    ).toBe(12);
  } finally {
    server.closeAllConnections();
    server.close();
  }
}, 30000);

it('carries a bulk TLS response through the actual parent/core overlay channel', async () => {
  const failures: string[] = [];
  const original = ipc.rpcIpcStream;
  const instrument = vi.spyOn(ipc, 'rpcIpcStream').mockImplementation((id, send) => {
    const pipe = original(id, send);
    pipe.stream.on('error', (error) => failures.push(error.message));
    return pipe;
  });
  const client = await openWindowsPeerIdentity(),
    serverIdentity = await openWindowsPeerIdentity();
  const server = createServer(
    {
      pfx: serverIdentity.pfx,
      ca: new X509Certificate(client.authority).toString(),
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.3',
      maxVersion: 'TLSv1.3',
    },
    (_request, response) => response.end(Buffer.alloc(256 * 1024, 173)),
  );
  let connected = true;
  const parent = overlayChannel((message) =>
    queueMicrotask(() => {
      if (connected) core.receive(message as Record<string, unknown>);
    }),
  );
  const core = overlayChannel((message) =>
    queueMicrotask(() => {
      if (connected) parent.receive(message as Record<string, unknown>);
    }),
  );
  parent.attach({
    addresses: () => ['100.100.100.100'],
    subscribe: () => () => {},
    incoming: () => () => {},
    dial: () => {
      const [local, remote] = duplexPair();
      server.emit('connection', overlaySocket(remote));
      return Promise.resolve(local);
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  try {
    expect(
      await measureDiagnostic(
        client,
        {
          id: randomUUID(),
          address: '100.100.100.100',
          securePort: 49302,
          certificate: serverIdentity.certificate,
          authority: serverIdentity.authority,
        },
        'download',
        AbortSignal.timeout(6000),
        core.transport,
      ),
    ).toBeGreaterThan(0);
  } catch (error) {
    throw Error(`${String(error)}; channel errors: ${failures.join(', ')}`, { cause: error });
  } finally {
    // Closing the fixture also closes its simulated IPC connection.
    connected = false;
    parent.close();
    core.close();
    server.closeAllConnections();
    server.close();
    client.close();
    serverIdentity.close();
    instrument.mockRestore();
  }
}, 30000);
