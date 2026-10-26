import { expect, it } from 'vitest';
import { isTransientPeerFailure } from './deadline.js';

it.each(['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ERR_STREAM_PREMATURE_CLOSE'])(
  'allows confirmation of the transport failure %s',
  (code) => {
    const cause = Object.assign(Error('transport'), { code });
    expect(isTransientPeerFailure(new Error('PEER_UNAVAILABLE', { cause }))).toBe(true);
  },
);
it.each(['CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'ABORT_ERR', 'UNKNOWN'])(
  'does not grant retry grace to %s',
  (code) => {
    const cause = Object.assign(Error('failure'), { code });
    expect(isTransientPeerFailure(new Error('PEER_UNAVAILABLE', { cause }))).toBe(false);
  },
);
it.each(['PEER_NOT_APPROVED', 'GPU_NOT_SHARED', 'INVALID_PEER_MESSAGE', 'PEER_UNAVAILABLE'])(
  'does not treat an unclassified %s response as transient',
  (message) => {
    expect(isTransientPeerFailure(Error(message))).toBe(false);
  },
);
