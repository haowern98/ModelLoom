import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { Duplex } from 'node:stream';
import { expect, it } from 'vitest';
import { TailscaleHelper } from './helper.js';

function child() {
  const value = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: () => true,
  });
  return value;
}
it('handles fragmented frames and never returns login URLs as public status', async () => {
  const process = child();
  const statuses: unknown[] = [];
  const urls: string[] = [];
  const helper = new TailscaleHelper(
    process,
    { read: () => Promise.resolve(undefined), write: () => Promise.resolve(undefined) },
    {
      status: (value) => statuses.push(value),
      login: (value) => urls.push(value),
      incoming: () => undefined,
      lost: () => undefined,
    },
  );
  process.stdout.write('{"type":"login","url":"https://login.tailscale.com/a/123"');
  process.stdout.write('}\n');
  expect(urls).toEqual(['https://login.tailscale.com/a/123']);
  expect(statuses).toEqual([]);
  await helper.close();
});
it('fails pending commands on malformed helper output and bounds frame memory', async () => {
  const process = child();
  let lost = 0;
  const helper = new TailscaleHelper(
    process,
    { read: () => Promise.resolve(undefined), write: () => Promise.resolve(undefined) },
    {
      status: () => undefined,
      login: () => undefined,
      incoming: () => undefined,
      lost: () => {
        lost++;
      },
    },
  );
  const pending = helper.command('status');
  process.stdout.write('x'.repeat(131073));
  await expect(pending).rejects.toThrow('NETWORK_COMPONENT_FAILED');
  expect(lost).toBe(1);
  await helper.close();
});
it('rejects mixed fields but tolerates one in-flight packet after a locally owned stream closes', async () => {
  const process = child();
  let lost = 0;
  let incoming!: Duplex;
  const helper = new TailscaleHelper(
    process,
    { read: () => Promise.resolve(undefined), write: () => Promise.resolve(undefined) },
    {
      status: () => undefined,
      login: () => undefined,
      incoming: (_port, stream) => {
        incoming = stream;
      },
      lost: () => {
        lost++;
      },
    },
  );
  process.stdout.write('{"type":"incoming","stream":"g-1","port":49301}\n');
  incoming.destroy();
  await new Promise((resolve) => setTimeout(resolve, 0));
  process.stdout.write('{"type":"data","stream":"g-1","seq":1,"data":"YQ=="}\n');
  expect(lost).toBe(0);
  process.stdout.write('{"type":"ready","url":"secret"}\n');
  expect(lost).toBe(1);
  await helper.close();
});
it('assembles large peer snapshots without dropping peers and rejects duplicate frame keys', async () => {
  const process = child();
  let peers: readonly unknown[] = [];
  let lost = 0;
  const helper = new TailscaleHelper(
    process,
    { read: () => Promise.resolve(undefined), write: () => Promise.resolve(undefined) },
    {
      status: (_view, value) => {
        peers = value;
      },
      login: () => undefined,
      incoming: () => undefined,
      lost: () => {
        lost++;
      },
    },
  );
  process.stdout.write(JSON.stringify({ type: 'peer-batch', id: 1, action: 'begin' }) + '\n');
  for (let n = 0; n < 3; n++)
    process.stdout.write(
      JSON.stringify({
        type: 'peer-batch',
        id: 1,
        action: 'append',
        peers: Array.from({ length: 256 }, (_, k) => ({
          id: String(n * 256 + k),
          address: '100.100.1.1',
          name: 'PC',
          online: true,
        })),
      }) + '\n',
    );
  process.stdout.write('{"type":"status","id":1,"state":"connected"}\n');
  expect(peers).toHaveLength(768);
  process.stdout.write('{"type":"ready","type":"ready"}\n');
  expect(lost).toBe(1);
  await helper.close();
});
