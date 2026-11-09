// Bundled test entry only. Package inspection creates no CUDA context. The
// explicit startup scope uses the authorized Malaysia GPU, with no model load.
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { Buffer } from 'node:buffer';
import { desktopPeerBackend } from '../out/peers/development-runtime.js';
import { ownershipBinding } from '../out/hosts/windows-ownership.js';
import { deadline } from './diagnostic-lifecycle.mjs';

const startup = process.argv.length === 3 && process.argv[2] === '--start-verified';
if (!startup && !(process.argv.length === 3 && process.argv[2] === '--inspect-package'))
  throw Error('Explicit inspection or startup scope required');
const root = fileURLToPath(new URL('../../', import.meta.url));
const native = ownershipBinding();
const state = path.join(root, 'out/peer-verified');
native.privateDirectory(state);
const backend = desktopPeerBackend({
  bootstrap: path.join(root, 'out/activation/b11306/peers'),
  state: path.join(state, 'state'),
});
const resources = await backend.resources([]);
console.log(JSON.stringify({ phase: 'verified-worker-package', runtimeId: resources.runtimeId }));
if (startup) {
  const owned = await backend.start(['GPU-d42a520b-020b-2673-9923-6906e674e243']);
  try {
    const response = new Promise((resolve, reject) => {
      let bytes = Buffer.alloc(0);
      owned.stream.on('data', (chunk) => {
        bytes = Buffer.concat([bytes, chunk]);
        if (bytes.length > 36) reject(Error('Unexpected startup protocol bytes'));
        if (bytes.length === 36) resolve(bytes);
      });
      owned.stream.once('error', reject);
    });
    const hello = Buffer.alloc(33);
    hello[0] = 14;
    hello.writeBigUInt64LE(24n, 1);
    owned.stream.write(hello);
    const bytes = await deadline(response, 8000, 'STARTUP_HELLO_TIMEOUT');
    if (bytes.readBigUInt64LE() !== 28n || bytes[8] !== 7 || bytes[9] || bytes[10])
      throw Error('Unexpected verified runtime version');
    console.log(JSON.stringify({ phase: 'verified-restricted-cuda-ready', modelLoaded: false }));
  } finally {
    await owned.close();
  }
  console.log(JSON.stringify({ phase: 'verified-restricted-cuda-stopped' }));
}
