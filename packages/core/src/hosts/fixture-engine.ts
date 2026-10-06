import type { EngineAdapter, OwnedEngine } from '../runtime/engine-adapter.js';
import { fileURLToPath } from 'node:url';
import type { Selection } from '../runtime/contracts.js';
import { decodeEvent } from '../runtime/contracts.js';
import { confirmExit, ownershipBinding } from './windows-ownership.js';

export type FixtureMode = 'ready' | 'hang' | 'descendant' | 'loading';
export interface FixtureDeployment {
  adapter(mode?: FixtureMode): EngineAdapter;
  children(): readonly number[];
  crash(): void;
  admitCore(pid: number, expectedImage: string, launchTime: number): void;
  close(): Promise<void>;
}
/**
 * Development-only native broker, fixed to the compiled harmless fixture asset.
 * @remarks This is not a verified-package capability or a production engine launcher.
 * Main/headless retain handles locally. Closing the deployment kills only its contained tree.
 */
export function createFixtureDeployment(): FixtureDeployment {
  const native = ownershipBinding();
  const root = native.createDeployment();
  const active = new Map<
    object,
    { exited: Promise<{ code: number; signal: null }>; pids: number[] }
  >();
  let closed = false;
  let closing: Promise<void> | undefined;
  const fixture = fileURLToPath(new URL('../../out/native/engine-fixture.exe', import.meta.url));
  return {
    adapter(mode = 'ready') {
      if (!['ready', 'hang', 'descendant', 'loading'].includes(mode))
        throw new Error('INVALID_CONTROL');
      return {
        async launch(input, signal) {
          // Yield before capture so cancellation queued by the host can prevent native creation.
          await Promise.resolve();
          const event = decodeEvent(JSON.stringify({ type: 'start', selection: input }));
          if (event.type !== 'start' || closed || signal.aborted) throw new Error('START_FAILED');
          const selection: Selection = event.selection;
          if (selection.packageId !== 'fixture' || selection.modelId !== 'fixture')
            throw new Error('START_FAILED');
          const child = native.launch(root, fixture, [mode]);
          let ready = false;
          let ended = false;
          let buffer = '';
          let readyResolve!: () => void;
          let readyReject!: (error: Error) => void;
          const readiness = new Promise<void>((resolve, reject) => {
            readyResolve = resolve;
            readyReject = reject;
          });
          // Observe failed readiness even if cancellation wins before the supervisor subscribes.
          void readiness.catch(() => undefined);
          let exitResolve!: (value: { code: number; signal: null }) => void;
          const exited = new Promise<{ code: number; signal: null }>((resolve) => {
            exitResolve = resolve;
          });
          const entry = { exited, pids: [] as number[] };
          active.set(child, entry);
          const tick = () => {
            try {
              const observation = native.observe(child);
              if (entry.pids.length === 0) entry.pids.push(observation.pid);
              buffer += observation.output;
              if (buffer.length > 65_536) throw new Error('INVALID_CONTROL');
              let newline: number;
              while ((newline = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, newline).trim();
                buffer = buffer.slice(newline + 1);
                if (line === 'READY') {
                  ready = true;
                  readyResolve();
                } else if (/^CHILD [1-9][0-9]*$/u.test(line))
                  entry.pids.push(Number(line.slice(6)));
                else throw new Error('INVALID_CONTROL');
              }
              if (observation.exitCode !== -1 && observation.activeProcesses === 0) {
                ended = true;
                clearInterval(timer);
                if (!ready) readyReject(new Error('ENGINE_EXITED'));
                native.release(child);
                active.delete(child);
                exitResolve({ code: observation.exitCode, signal: null });
              }
            } catch {
              readyReject(new Error('START_FAILED'));
              // An observation failure never fabricates exit. Keep the handle and force its job.
              try {
                native.forceStop(child);
              } catch {
                // Retain ownership and keep observing. Cleanup must time out rather than claim exit.
                readyReject(new Error('CLEANUP_FAILED'));
              }
            }
          };
          const timer = setInterval(tick, 10);
          tick();
          return {
            selection,
            exited,
            waitReady(abort) {
              if (abort.aborted) return Promise.reject(new Error('START_FAILED'));
              return new Promise<void>((resolve, reject) => {
                const cancel = () => reject(new Error('START_FAILED'));
                abort.addEventListener('abort', cancel, { once: true });
                void readiness
                  .then(resolve, reject)
                  .finally(() => abort.removeEventListener('abort', cancel));
              });
            },
            requestStop() {
              if (!ended) native.requestStop(child);
              return Promise.resolve();
            },
            forceStop() {
              if (!ended) native.forceStop(child);
              return Promise.resolve();
            },
          } satisfies OwnedEngine;
        },
      };
    },
    children() {
      return [...active.values()].flatMap((child) => child.pids);
    },
    crash() {
      for (const child of active.keys()) native.abortFixture(child);
    },
    admitCore(pid, image, began) {
      if (
        closed ||
        !Number.isInteger(pid) ||
        pid <= 0 ||
        pid > 4_294_967_295 ||
        !Number.isFinite(began)
      )
        throw new Error('INVALID_CONTROL');
      native.admitCore(root, pid, image, began);
    },
    close() {
      if (closing) return closing;
      closed = true;
      native.closeDeployment(root);
      closing = confirmExit(() => active.size === 0 && native.coresExited(root));
      return closing;
    },
  };
}
export type FixtureEngine = OwnedEngine;
