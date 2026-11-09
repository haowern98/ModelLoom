import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import { stageHost } from './stage-development.mjs';

const core = fileURLToPath(new URL('../../../packages/core/', import.meta.url));

/** Stage only reviewed release inputs. Development bootstrap runtimes stay out of this build. */
export async function stageRelease(output) {
  const { releaseRuntimePolicy } = await import(
    pathToFileURL(path.join(core, 'out/hosts/release-desktop.js')).href
  );
  const { APPROVED_RUNTIME_ROOTS } = await import(
    pathToFileURL(path.join(core, 'out/runtime-package/trust-policy.js')).href
  );
  releaseRuntimePolicy();
  await mkdir(output);
  const stagedCore = path.join(output, 'core');
  for (const name of [
    `assets/${APPROVED_RUNTIME_ROOTS[0].asset}`,
    'out/native/ownership.node',
    'out/native/history.node',
    'out/native/peer-identity.node',
    'out/native/tensor-cache.node',
    'scripts/utility-entry.cjs',
    'scripts/peer-entry.cjs',
    'scripts/relay-rpc-worker.ps1',
  ]) {
    const target = path.join(stagedCore, name);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(core, name), target);
  }
  return stageHost(output, 'release-desktop');
}
