import { expect, it } from 'vitest';
import { decodeCommand } from './control.js';
import { PassThrough } from 'node:stream';
import { commandLines } from './pipes.js';
import { decodeBroker, decodeEngine, decodeReply } from './broker-protocol.js';
import { fixtureSession } from './session.js';
import { fakeEngine } from '../../tests/fake-engine.js';
it('decodes a closed fixture command without a privileged pathname', () => {
  expect(decodeCommand('{"id":1,"action":"snapshot"}')).toEqual({ id: 1, action: 'snapshot' });
});
it.each([
  '{"id":1,"action":"snapshot","path":"C:/untrusted.exe"}',
  '{"id":1,"action":"exec"}',
  '{"id":0,"action":"quit"}',
  '{"id":1,"action":"load","selection":{}}',
  '{"id":1,"action":"record","event":{"type":"ready"}}',
  '[1,2]',
  'null',
  'x'.repeat(1_048_577),
])('rejects malformed or excessive fixture control without reflecting it', (text) => {
  expect(() => decodeCommand(text)).toThrow('INVALID_CONTROL');
});
const selection = {
  deploymentId: 'fixture-host',
  sessionId: 's1',
  operationId: 'op1',
  packageId: 'fixture',
  modelId: 'fixture',
};
it('admits a bounded context readback only on an owned ready receipt', () => {
  const receipt = { type: 'engine', phase: 'ready', selection, code: 0, contextLength: 30464 };
  expect(decodeEngine(JSON.stringify(receipt))).toMatchObject({ contextLength: 30464 });
  for (const contextLength of [0, -1, 1.5, 2147483648, '30464', null])
    expect(() => decodeEngine(JSON.stringify({ ...receipt, contextLength }))).toThrow(
      'INVALID_CONTROL',
    );
  expect(() => decodeEngine(JSON.stringify({ ...receipt, phase: 'captured' }))).toThrow(
    'INVALID_CONTROL',
  );
});
it('strictly decodes inherited broker and owned-exit receipt variants', () => {
  expect(decodeBroker(JSON.stringify({ type: 'broker', action: 'launch', selection }))).toEqual({
    action: 'launch',
    selection,
  });
  expect(
    decodeEngine(JSON.stringify({ type: 'engine', phase: 'exited', selection, code: 0 })),
  ).toEqual({ phase: 'exited', selection, code: 0 });
  expect(() =>
    decodeBroker(JSON.stringify({ type: 'broker', action: 'force', selection, pid: 123 })),
  ).toThrow('INVALID_CONTROL');
  expect(() =>
    decodeBroker(
      JSON.stringify({
        type: 'broker',
        action: 'launch',
        selection: { ...selection, deploymentId: 'other' },
      }),
    ),
  ).toThrow('INVALID_CONTROL');
  expect(() =>
    decodeEngine(JSON.stringify({ type: 'engine', phase: 'exited', selection, code: -1 })),
  ).toThrow('INVALID_CONTROL');
});
it('an overlong local pipe frame closes admission before dispatch', () => {
  const input = new PassThrough();
  let closed = 0;
  const received: string[] = [];
  commandLines(
    input,
    (text) => received.push(text),
    () => {
      closed++;
    },
  );
  input.write(Buffer.alloc(1_048_577, 120));
  expect(received).toEqual([]);
  expect(closed).toBe(1);
  input.end('{"id":1,"action":"snapshot"}\n');
  expect(received).toEqual([]);
});
it('malformed UTF-8 is rejected before a local pipe command reaches the core', () => {
  const input = new PassThrough();
  let closed = false;
  const received: string[] = [];
  commandLines(
    input,
    (text) => received.push(text),
    () => {
      closed = true;
    },
  );
  input.write(Buffer.from([0xff, 10]));
  expect(received).toEqual([]);
  expect(closed).toBe(true);
  input.end();
});
it('utility replies reject extra fields and malformed lifecycle snapshots', () => {
  const snapshot = {
    deploymentId: 'fixture-host',
    phase: 'stopped',
    selection: null,
    fault: null,
    requests: {},
  };
  expect(decodeReply({ id: 1, snapshot })).toEqual({ id: 1, snapshot });
  expect(() => decodeReply({ id: 1, snapshot, executable: 'other.exe' })).toThrow(
    'INVALID_CONTROL',
  );
  expect(() => decodeReply({ id: 1, snapshot: { ...snapshot, deploymentId: 'other' } })).toThrow(
    'INVALID_CONTROL',
  );
  expect(() => decodeReply({ id: 1, snapshot: { ...snapshot, phase: 'invented' } })).toThrow(
    'INVALID_CONTROL',
  );
  expect(() =>
    decodeReply({
      id: 1,
      snapshot: {
        ...snapshot,
        requests: { r1: { requestId: 'r2', text: '', status: 'completed' } },
      },
    }),
  ).toThrow('INVALID_CONTROL');
  expect(() => decodeReply({ id: 1, error: 'untrusted detail' })).toThrow('INVALID_CONTROL');
});
it('shared host admission rejects replay and any command after full Quit', async () => {
  const session = fixtureSession(fakeEngine().adapter, () => undefined);
  expect((await session.handle('{"id":1,"action":"snapshot"}')).reply.error).toBeUndefined();
  expect((await session.handle('{"id":1,"action":"snapshot"}')).reply.error).toBe(
    'INVALID_CONTROL',
  );
  expect((await session.handle('{"id":2,"action":"quit"}')).quit).toBe(true);
  expect((await session.handle('{"id":3,"action":"snapshot"}')).reply.error).toBe(
    'INVALID_CONTROL',
  );
});
