import { expect, it } from 'vitest';
import { decodePeerCommand, decodePeerReply } from './wire.js';

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
