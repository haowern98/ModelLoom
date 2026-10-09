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
import { confirmExit, ownershipBinding } from './windows-ownership.js';
import { realEngineAdapter } from './real-engine.js';
import { createDesktopEngineHost } from './desktop.js';
import type { UtilityFork } from './desktop.js';
/** Explicit Windows development deployment. Trusted main selects this fixed workspace asset;
 * renderer commands cannot choose a repository, verifier, report, executable or arguments.
 * Ordinary builds keep the development verifier closed. Production packaging is separate.
 */
export function developmentDesktopDependencies(
  fork: UtilityFork,
  base: string,
  applicationData?: string,
  caller?: string,
) {
  const report = DEVELOPMENT_MEMORY_REPORTS.find((entry) => entry.configuration.slots === 4);
  if (!DEVELOPMENT_BUILD || !report) throw new Error('DEVELOPMENT_BUILD_REQUIRED');
  const configuration = report.configuration,
    modelSha256 = report.modelSha256;
  const deploymentId = `desktop-development-${randomUUID()}`;
  /** History has its own retained core containment, independent of verified engine assets.
   * The engine adapter is prepared only by trusted main after import/resource admission.
   * Both owners close on core failure or Quit; no synthetic engine is supplied at startup.
   */
  async function createHistoryHost() {
    const native = ownershipBinding(),
      root = native.createDeployment();
    let adapter: ReturnType<typeof realEngineAdapter> | undefined;
    let preparedFile: string | undefined;
    let preparation: Promise<void> | undefined;
    let closed = false,
      closing: Promise<void> | undefined;
    const close = () => {
      if (closing) return closing;
      closed = true;
      native.closeDeployment(root);
      closing = (async () => {
        try {
          await preparation;
        } catch {
          /* Failed preparation cannot authorize launch. */
        }
        await Promise.all([adapter?.close(), confirmExit(() => native.coresExited(root))]);
      })();
      return closing;
    };
    const prepare = (file: string) => {
      const previous = preparation ?? Promise.resolve();
      preparation = previous
        .catch(() => undefined)
        .then(async () => {
          if (closed) throw new Error('CORE_EXITED');
          if (adapter && preparedFile === file) return;
          await adapter?.close();
          adapter = undefined;
          preparedFile = undefined;
          const capability = await createDevelopmentRuntimeVerifier().verify(
            path.join(base, 'repository'),
            path.join(base, 'desktop-verification'),
          );
          const installed = await installExpanded(
            capability,
            path.join(base, 'candidate'),
            path.join(base, 'installed'),
          );
          if (closed) throw new Error('CORE_EXITED');
          adapter = realEngineAdapter(installed, file, configuration, 18478);
          preparedFile = file;
        });
      return preparation;
    };
    try {
      const host = await createDesktopEngineHost(
        fork,
        {
          adapter: {
            async launch(selection, signal) {
              if (closed || !adapter) throw new Error('NOT_READY');
              return adapter.launch(selection, signal);
            },
          },
          children: () => adapter?.children() ?? [],
          admitCore: (pid, image, time) => {
            if (closed) throw new Error('OWNERSHIP_FAILED');
            native.admitCore(root, pid, image, time);
          },
          close,
          ...(applicationData && caller
            ? {
                chat: (engine: Parameters<ReturnType<typeof realEngineAdapter>['chat']>[0]) => {
                  if (closed || !adapter) throw new Error('NOT_READY');
                  return adapter.chat(engine);
                },
                chatSetup: {
                  applicationData,
                  caller,
                  provenance: {
                    packageId: 'llama-cuda-development',
                    upstreamCommit: '4f31296a907d73f3409f720429bcf31111615d77',
                    configuration,
                  },
                },
              }
            : {}),
        },
        deploymentId,
        { deploymentId, packageId: 'llama-cuda-development', modelId: modelSha256 },
      );
      return { ...host, prepare };
    } catch (error) {
      await close();
      throw error;
    }
  }
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
    createHistoryHost,
    async createHost(file: string) {
      const host = await createHistoryHost();
      try {
        await host.prepare(file);
        return host;
      } catch (error) {
        await host.command(JSON.stringify({ id: 1, action: 'quit' }));
        await host.close();
        throw error;
      }
    },
  };
}
