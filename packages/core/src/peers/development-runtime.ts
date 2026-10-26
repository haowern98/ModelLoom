import path from 'node:path';
import { DEVELOPMENT_BUILD } from '../runtime-package/development-policy.js';
import { createDevelopmentRuntimeVerifier } from '../runtime-package/verifier.js';
import { installExpanded } from '../runtime-package/install.js';
import type { InstalledPackage } from '../runtime-package/install.js';
import { VerifiedRpcBackend } from './verified-rpc.js';
import { exact } from '../hosts/control.js';
import { ownershipBinding } from '../hosts/windows-ownership.js';
import { createTensorCacheSettings } from '../tensor-cache/settings.js';

export interface PeerRuntimeBootstrap {
  readonly bootstrap: string;
  readonly state: string;
}
/** Retained parent configuration only. Signed package verification still applies
 * to every executable and dependency; a supplied path is never launch authority. */
export function decodePeerRuntimeBootstrap(value: unknown): PeerRuntimeBootstrap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('INVALID_CONTROL');
  const v = value as Record<string, unknown>;
  exact(v, ['bootstrap', 'state']);
  for (const name of ['bootstrap', 'state']) {
    if (
      typeof v[name] !== 'string' ||
      v[name].length > 1024 ||
      !path.isAbsolute(v[name]) ||
      v[name].includes('\0')
    )
      throw Error('INVALID_CONTROL');
  }
  return { bootstrap: v.bootstrap as string, state: v.state as string };
}

export function developmentPeerBackend(input: PeerRuntimeBootstrap): VerifiedRpcBackend {
  if (!DEVELOPMENT_BUILD) throw Error('DEVELOPMENT_BUILD_REQUIRED');
  const { bootstrap, state } = decodePeerRuntimeBootstrap(input);
  let installation: Promise<InstalledPackage> | undefined;
  const cache = createTensorCacheSettings(
    path.join(path.dirname(state), 'tensor-cache-settings.json'),
    path.join(path.dirname(state), 'tensor-cache-data'),
  );
  return new VerifiedRpcBackend(
    async () => {
      installation ??= (async () => {
        ownershipBinding().privateDirectory(path.resolve(state));
        const verified = await createDevelopmentRuntimeVerifier().verify(
          path.join(bootstrap, 'repository'),
          path.join(state, 'peer-verification'),
        );
        return installExpanded(
          verified,
          path.join(bootstrap, 'candidate'),
          path.join(state, 'peer-installed'),
        );
      })();
      try {
        return await installation;
      } catch (error) {
        installation = undefined;
        throw error;
      }
    },
    cache.capture,
    cache.reportAvailability,
  );
}
