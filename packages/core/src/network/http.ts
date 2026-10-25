import { request } from 'node:http';
import type { Duplex } from 'node:stream';

/** Public capability response only. This operation cannot create a pairing request. */
export async function probeNetworkPeer(
  dial: (address: string, port: number, signal: AbortSignal) => Promise<Duplex>,
  address: string,
  signal: AbortSignal,
): Promise<unknown> {
  const socket = await dial(address, 49301, signal);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: address,
        port: 49301,
        path: '/v1/discover',
        method: 'GET',
        signal,
        createConnection: () => socket,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let length = 0;
        response.on('data', (bytes: Buffer) => {
          length += bytes.length;
          if (length > 2048) req.destroy(Error('INVALID_DISCOVERY'));
          else chunks.push(bytes);
        });
        response.on('error', reject);
        response.on('end', () => {
          try {
            if (response.statusCode !== 200) throw Error('NETWORK_ROUTE_UNAVAILABLE');
            resolve(JSON.parse(Buffer.concat(chunks).toString()) as unknown);
          } catch (error) {
            reject(error instanceof Error ? error : Error('INVALID_DISCOVERY'));
          }
        });
      },
    );
    req.on('error', reject);
    req.once('close', () => socket.destroy());
    req.end();
  });
}
