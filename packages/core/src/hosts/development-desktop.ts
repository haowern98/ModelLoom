import path from 'node:path';
import { lstat } from 'node:fs/promises';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  DEVELOPMENT_BUILD,
  DEVELOPMENT_MEMORY_REPORTS,
} from '../runtime-package/development-policy.js';
import { createDevelopmentRuntimeVerifier } from '../runtime-package/verifier.js';
import { installExpanded } from '../runtime-package/install.js';
import { inspectGGUF } from '../runtime/gguf.js';
import { checkCudaResources } from '../runtime/gpu-resources.js';
import { discoverResources } from './resource-probe.js';
import { ownershipBinding } from './windows-ownership.js';
import { realEngineAdapter } from './real-engine.js';
import { createDesktopEngineHost } from './desktop.js';
import type { UtilityFork } from './desktop.js';
/** Explicit Windows development deployment. Trusted main selects this fixed workspace asset;
 * renderer commands cannot choose a repository, verifier, report, executable or arguments.
 * Ordinary builds keep the development verifier closed. Production packaging is separate.
 */
export function developmentDesktopDependencies(fork: UtilityFork, base: string) {
  const report = DEVELOPMENT_MEMORY_REPORTS[0];
  if (!DEVELOPMENT_BUILD || !report) throw new Error('DEVELOPMENT_BUILD_REQUIRED');
  const deploymentId = `desktop-development-${randomUUID()}`;
  return {
    enabled: true as const,
    expectedHash: report.modelSha256,
    packageId: 'llama-cuda-development',
    deploymentId,
    async inspect(file: string) {
      const native = ownershipBinding();
      const lock = native.sealFiles([path.resolve(file)]);
      try {
        const info = await inspectGGUF(file);
        if (
          info.sha256 !== report.modelSha256 ||
          info.contextLimit < report.configuration.contextPerSlot
        )
          throw new Error('UNSUPPORTED_MODEL');
        const size = (await lstat(file)).size;
        return { sha256: info.sha256, size: `${(size / 1e9).toFixed(2)} GB` };
      } finally {
        native.releaseFiles(lock);
      }
    },
    async device() {
      const snapshot = await discoverResources();
      const gpu =
        snapshot.gpus?.find((g) => g.uuid === report.configuration.gpuDevice) ??
        snapshot.gpus?.find((g) => g.total !== null);
      return {
        name: os.hostname(),
        os: 'Windows',
        cpuName: os.cpus()[0]?.model ?? 'CPU',
        threads: os.cpus().length,
        ...(gpu?.total != null
          ? { gpuMemoryGiB: gpu.total / 2 ** 30, ...(gpu.name ? { gpuName: gpu.name } : {}) }
          : {}),
      };
    },
    async preflight() {
      const result = checkCudaResources(
        report.configuration,
        report.artifact,
        report,
        await discoverResources(),
        '551.78',
      );
      if (result.code !== 'ADMITTED') throw new Error(result.code);
    },
    async createHost(file: string) {
      const capability = await createDevelopmentRuntimeVerifier().verify(
        path.join(base, 'repository'),
        path.join(base, 'desktop-verification'),
      );
      const installed = await installExpanded(
        capability,
        path.join(base, 'candidate'),
        path.join(base, 'installed'),
      );
      const adapter = realEngineAdapter(installed, file, report.configuration, 18478);
      return createDesktopEngineHost(
        fork,
        {
          adapter,
          children: () => adapter.children(),
          admitCore: (pid, image, time) => adapter.admitCore(pid, image, time),
          close: () => adapter.close(),
        },
        deploymentId,
        { deploymentId, packageId: installed.packageId, modelId: report.modelSha256 },
      );
    },
  };
}
