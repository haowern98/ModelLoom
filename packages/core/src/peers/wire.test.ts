import { expect, it } from 'vitest';
import { decodePeerCommand, decodePeerReply } from './wire.js';
import { emptyTelemetry } from './telemetry-view.js';

it('accepts only the bounded disconnect control and explicit stop confirmation', () => {
  expect(decodePeerCommand({ action: 'disconnect', id: 'request' })).toEqual({
    action: 'disconnect',
    id: 'request',
  });
  expect(decodePeerCommand({ action: 'disconnect', id: 'request', stopModel: true })).toEqual({
    action: 'disconnect',
    id: 'request',
    stopModel: true,
  });
  for (const stopModel of [false, 'true', 1, null])
    expect(() => decodePeerCommand({ action: 'disconnect', id: 'request', stopModel })).toThrow(
      'INVALID_CONTROL',
    );
  expect(() =>
    decodePeerCommand({ action: 'disconnect', id: 'request', address: '100.64.1.3' }),
  ).toThrow('INVALID_CONTROL');
});

it('accepts optional telemetry without granting renderer diagnostics controls', () => {
  const peer = {
    id: 'request',
    name: 'Worker',
    peerFingerprint: 'b'.repeat(64),
    phase: 'approved',
    localVerified: true,
    remoteVerified: true,
    gpus: [],
    telemetry: emptyTelemetry(),
  };
  const envelope = {
    ok: true,
    view: {
      fingerprint: 'a'.repeat(64),
      name: 'Local',
      sharing: false,
      addresses: [],
      gpus: [],
      sharedGpuIds: [],
      incoming: [],
      outgoing: [peer],
    },
  };
  expect(decodePeerReply(envelope)).toEqual(envelope);
  expect(decodePeerReply({ ...envelope, notice: 'ALREADY_CONNECTED' })).toEqual({
    ...envelope,
    notice: 'ALREADY_CONNECTED',
  });
  for (const notice of [true, 'CONNECTED', {}, null])
    expect(() => decodePeerReply({ ...envelope, notice })).toThrow('INVALID_CONTROL');
  for (const bad of [NaN, Infinity, -1, '4']) {
    expect(() =>
      decodePeerReply({
        ...envelope,
        view: {
          ...envelope.view,
          outgoing: [
            {
              ...peer,
              telemetry: { ...emptyTelemetry(), latencyMs: bad },
            },
          ],
        },
      }),
    ).toThrow('INVALID_CONTROL');
  }
  expect(() => decodePeerCommand({ action: 'diagnostics', bytes: 1024 })).toThrow();
  expect(() => decodePeerCommand({ action: 'runtime-activity', busy: false })).toThrow();
});

it('accepts only six-digit code verification and core-owned approval identities', () => {
  expect(decodePeerCommand({ action: 'verify-code', id: 'request', code: '000123' })).toEqual({
    action: 'verify-code',
    id: 'request',
    code: '000123',
  });
  expect(decodePeerCommand({ action: 'approve', id: 'request' })).toEqual({
    action: 'approve',
    id: 'request',
  });
  for (const code of ['12345', '1234567', 'abcdef', 123456])
    expect(() => decodePeerCommand({ action: 'verify-code', id: 'request', code })).toThrow();
  expect(() =>
    decodePeerCommand({ action: 'confirm', id: 'request', fingerprint: 'a'.repeat(64) }),
  ).toThrow();
});

it('keeps paths, scripts, native ports and secret material out of renderer commands', () => {
  expect(
    decodePeerCommand({ action: 'share', address: '100.64.1.2', gpuIds: ['GPU-one'] }),
  ).toEqual({ action: 'share', address: '100.64.1.2', gpuIds: ['GPU-one'] });
  for (const value of [
    { action: 'share', address: '100.64.1.2', gpuIds: ['one'], executable: 'worker.exe' },
    { action: 'approve', id: 'request', fingerprint: 'bad' },
    { action: 'launch', port: 50052 },
    { action: 'invite', address: 'http://example.com/' },
  ])
    expect(() => decodePeerCommand(value)).toThrow('INVALID_CONTROL');
});
it('rejects extra fields and leaked private identity data in a reply', () => {
  expect(decodePeerReply({ ok: false, error: 'PEER_UNAVAILABLE' })).toEqual({
    ok: false,
    error: 'PEER_UNAVAILABLE',
  });
  expect(() => decodePeerReply({ ok: false, error: 'PEER_UNAVAILABLE', pfx: 'secret' })).toThrow(
    'INVALID_CONTROL',
  );
});
