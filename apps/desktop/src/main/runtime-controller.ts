import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { decodeRuntimeCommand } from '../shared/runtime';
import type { RuntimeView, RuntimeDevice } from '../shared/runtime';
import { decodeChatCommand } from '../shared/chat';
import type { ChatReply } from '../shared/chat';
import {
  decodeConfigurationCommand,
  decodeConfigurationReply,
} from '../shared/model-configuration';
import type { ConfigurationReply } from '../shared/model-configuration';
import { decodeApiManagementCommand, decodeApiManagementReply } from '../shared/local-api';
import type { ApiManagementReply } from '../shared/local-api';
import type { ApiOwnerReply } from '../../../../packages/core/src/local-api/wire';
import { decodeModelSource } from '../../../../packages/core/src/model-configuration/model-source';
import type { ModelSource } from '../../../../packages/core/src/model-configuration/model-source';
import type { RuntimeModel } from '../shared/runtime';
interface Host {
  command(text: string): Promise<Record<string, unknown>>;
  close(): Promise<void>;
  chat?(caller: string, input: unknown): Promise<ChatReply>;
  configuration?(caller: string, input: unknown): Promise<ConfigurationReply>;
  api?(caller: string, input: unknown): Promise<ApiOwnerReply>;
  changed?(listener: () => void): () => void;
  /** Trusted main prepares a verified engine only after model/resource admission. */
  prepare?(file: string): Promise<void>;
}
/** Trusted main dependencies; none of these capabilities are renderer inputs. */
interface ActivationDependencies {
  enabled: true;
  expectedHash: string;
  packageId: string;
  deploymentId?: string;
  pick(): Promise<string | null>;
  inspect(
    file: string,
  ): Promise<
    { sha256: string; size: string } & Partial<Omit<ModelSource, 'modelId' | 'file' | 'size'>>
  >;
  available?(source: ModelSource): Promise<boolean>;
  preflight(): Promise<void>;
  createHost(file: string): Promise<Host>;
  /** Model-independent utility/history startup; retains the same owner across model loads. */
  createHistoryHost?(): Promise<Host>;
  device?(): Promise<RuntimeDevice>;
}
export type RuntimeDependencies =
  | ActivationDependencies
  | {
      enabled: false;
      device?(): Promise<RuntimeDevice>;
    };
const messages: Record<string, string> = {
  INSUFFICIENT_RESOURCES:
    'Not enough available RAM or GPU memory for the selected settings. Free memory and try again.',
  INCOMPATIBLE_DRIVER: 'The GPU driver is incompatible with this runtime.',
  NEEDS_RESOURCE_EVIDENCE: 'This device or configuration does not have a validated memory budget.',
  PACKAGE_VERIFICATION_FAILED:
    'Runtime verification failed. Check the signed development package and its expiry.',
  UNSUPPORTED_MODEL: 'This first connection supports only the tested Bonsai 27B Q1_0 GGUF.',
  INVALID_MODEL_ID: 'Select the imported Bonsai model.',
  BUSY: 'Stop the current model before importing or loading another model.',
  CLEANUP_FAILED: 'Owned runtime exit could not be confirmed. Loading is blocked.',
  CONFIGURATION_UNAVAILABLE:
    'Saved model settings could not be confirmed. Reopen configuration and try again.',
  MODEL_FILE_UNAVAILABLE:
    'This model file could not be safely opened. Choose a standalone copy of the GGUF, not a hard link or shortcut, and try again.',
  LIBRARY_UNAVAILABLE:
    'The saved model library could not be opened. Restart the app and try again.',
  INVALID_GGUF: 'This file could not be indexed as a supported GGUF model.',
};
/** Saved library and session-only loading bridge. Fresh verification precedes each load.
 * Quit closes admission immediately and waits for in-flight preparation and owned exit.
 * Returned data never contains paths, native handles, ports or raw exception text.
 */
export function createRuntimeController(deps: RuntimeDependencies, caller: string = randomUUID()) {
  let view: RuntimeView = { enabled: deps.enabled, model: null, phase: 'stopped', error: null };
  let file: string | null = null,
    host: Host | undefined;
  let id = 0,
    epoch = 0,
    quitting = false,
    importing = false;
  let preparation: Promise<Host> | undefined;
  let enginePreparation: Promise<void> | undefined;
  let restoration: Promise<void> | undefined;
  let importPreparation: Promise<void> | undefined;
  let historyFailed = false;
  let deviceProbe: Promise<void> | undefined;
  let deviceObservedAt = 0;
  let deviceCleanupFailed = false;
  let deviceGeneration = 0;
  let unsubscribe: (() => void) | undefined;
  const chatListeners = new Set<() => void>();
  const observeChat = (created: Host) => {
    if (!quitting)
      unsubscribe = created.changed?.(() => {
        for (const listener of chatListeners) listener();
      });
    return created;
  };
  if (deps.enabled && deps.createHistoryHost) {
    view = { ...view, restoring: true, models: [] };
    preparation = Promise.resolve()
      .then(() => deps.createHistoryHost!())
      .then((created) => {
        host = observeChat(created);
        return created;
      });
    void preparation.catch(() => {
      historyFailed = true;
    });
    const expectedHash = deps.expectedHash;
    restoration = preparation
      .then(async () => {
        if (quitting || !host?.api) return;
        const reply = await host.api(caller, { action: 'readImportSource' });
        if (!reply.ok || !('source' in reply)) throw new Error('LIBRARY_UNAVAILABLE');
        if (reply.source === null) return;
        const source = decodeModelSource(reply.source);
        if (source.modelId !== expectedHash) throw new Error('LIBRARY_UNAVAILABLE');
        const unavailable = deps.available ? !(await deps.available(source)) : true;
        if (quitting) return;
        file = source.file;
        const model = modelView(source, unavailable);
        view = { ...view, model, models: [model] };
      })
      .catch(() => {
        if (!quitting) view = { ...view, error: messages.LIBRARY_UNAVAILABLE! };
      })
      .finally(() => {
        view = { ...view, restoring: false };
      });
  }
  function modelView(source: ModelSource, unavailable = false): RuntimeModel {
    return {
      id: `model-${source.modelId}`,
      name: source.name,
      filename: path.win32.basename(source.file),
      size: source.size,
      architecture: source.architecture,
      contextLimit: source.contextLimit,
      quantization: source.quantization,
      parameters: source.parameters,
      unavailable,
    };
  }
  const observeDevice = async () => {
    if (deviceCleanupFailed) throw new Error('QUERY_CLEANUP_FAILED');
    if (!deps.device || quitting || (view.device && Date.now() - deviceObservedAt < 10000)) return;
    const generation = deviceGeneration;
    deviceProbe ??= Promise.resolve()
      .then(() => (quitting ? undefined : deps.device!()))
      .then((device) => {
        if (!quitting && device && generation === deviceGeneration) {
          view = { ...view, device };
          deviceObservedAt = Date.now();
        }
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.message === 'QUERY_CLEANUP_FAILED') {
          deviceCleanupFailed = true;
          throw error;
        }
        // Hardware visibility is independent of model admission; retry a failed observation.
        if (generation === deviceGeneration) deviceObservedAt = Date.now();
      });
    const pending = deviceProbe;
    try {
      await pending;
    } finally {
      if (deviceProbe === pending) deviceProbe = undefined;
    }
    // A notification during the scan invalidates its result, without overlapping native queries.
    if (!quitting && generation !== deviceGeneration) await observeDevice();
  };
  const result = () => structuredClone(view);
  const send = async (action: string, selection?: Record<string, string>) => {
    if (!host) return;
    const reply = await host.command(
      JSON.stringify({ id: ++id, action, ...(selection ? { selection } : {}) }),
    );
    if (reply.error) throw new Error('START_FAILED');
    const snapshot = reply.snapshot;
    if (!snapshot || typeof snapshot !== 'object' || !('phase' in snapshot))
      throw new Error('INVALID_CONTROL');
    const phase = snapshot.phase;
    if (!['stopped', 'starting', 'loading', 'ready', 'stopping', 'failed'].includes(String(phase)))
      throw new Error('INVALID_CONTROL');
    // The host is trusted, but only this closed phase field crosses into renderer state.
    view = {
      ...view,
      phase: phase as RuntimeView['phase'],
      error:
        phase === 'failed'
          ? 'Runtime stopped unexpectedly or failed to load. Stop and retry explicitly.'
          : null,
    };
    if (
      phase === 'failed' &&
      'fault' in snapshot &&
      snapshot.fault &&
      typeof snapshot.fault === 'object' &&
      'code' in snapshot.fault &&
      snapshot.fault.code === 'CLEANUP_FAILED'
    )
      view.error = messages.CLEANUP_FAILED!;
  };
  return {
    /** Trusted native device-change notification; bypasses the telemetry cache, never admission. */
    async deviceChanged(): Promise<void> {
      if (quitting) return;
      ++deviceGeneration;
      deviceObservedAt = Number.NEGATIVE_INFINITY;
      await observeDevice();
    },
    async api(input: unknown): Promise<ApiManagementReply> {
      const command = decodeApiManagementCommand(input);
      if (quitting || !deps.enabled) return { ok: false, error: 'NOT_READY' };
      try {
        if (preparation) await preparation;
        if (quitting || !host?.api) return { ok: false, error: 'API_UNAVAILABLE' };
        return decodeApiManagementReply(
          await host.api(caller, command),
          command.action === 'copyKey' || command.action === 'revealKey',
        );
      } catch {
        return { ok: false, error: 'API_UNAVAILABLE' };
      }
    },
    async configuration(input: unknown): Promise<ConfigurationReply> {
      const command = decodeConfigurationCommand(input);
      if (quitting || !deps.enabled || !file || !view.model)
        return { ok: false, error: 'NOT_READY' };
      if (command.modelId !== deps.expectedHash) return { ok: false, error: 'UNKNOWN_MODEL' };
      try {
        if (preparation) await preparation;
        if (quitting || !host?.configuration)
          return { ok: false, error: 'CONFIGURATION_UNAVAILABLE' };
        return decodeConfigurationReply(await host.configuration(caller, command));
      } catch {
        return { ok: false, error: 'CONFIGURATION_UNAVAILABLE' };
      }
    },
    async chat(input: unknown): Promise<ChatReply> {
      const command = decodeChatCommand(input);
      if (quitting || !deps.enabled) return { ok: false, error: 'NOT_READY' };
      try {
        if (deps.createHistoryHost && preparation) await preparation;
        if (quitting) return { ok: false, error: 'NOT_READY' };
        if (!host?.chat)
          return { ok: false, error: historyFailed ? 'HISTORY_UNAVAILABLE' : 'NOT_READY' };
        if (['send', 'retry'].includes(command.action) && view.phase !== 'ready')
          return { ok: false, error: 'NOT_READY' };
        return await host.chat(caller, command);
      } catch {
        return { ok: false, error: 'HISTORY_UNAVAILABLE' };
      }
    },
    subscribeChat(listener: () => void): () => void {
      chatListeners.add(listener);
      return () => chatListeners.delete(listener);
    },
    async command(input: unknown): Promise<RuntimeView> {
      const command = decodeRuntimeCommand(input);
      if (quitting) return result();
      if (command.action === 'snapshot' && (importing || view.restoring)) return result();
      if (command.action === 'snapshot') await observeDevice();
      if (!deps.enabled || quitting) return result();
      let loadingEpoch: number | undefined;
      try {
        if (command.action === 'snapshot') {
          // Keep a rejected admission visible until an explicit stop/retry. A stopped core
          // has no knowledge of main's preflight failure and must not erase that evidence.
          if (host && view.phase !== 'failed') await send('snapshot');
        } else if (command.action === 'import') {
          if (importing || !['stopped', 'failed'].includes(view.phase)) throw new Error('BUSY');
          importing = true;
          ++epoch;
          const work = (async () => {
            if (restoration) await restoration;
            if (quitting) return;
            const selected = await deps.pick();
            if (selected === null || quitting) return result();
            view = { ...view, indexing: path.win32.basename(selected), error: null };
            const info = await deps.inspect(selected).catch((error: unknown) => {
              if (error instanceof Error && error.message === 'OWNERSHIP_FAILED')
                throw new Error('MODEL_FILE_UNAVAILABLE');
              throw error;
            });
            const importedAt = Math.floor(Date.now() / 1000);
            if (info.sha256 !== deps.expectedHash) throw new Error('UNSUPPORTED_MODEL');
            if (quitting) return result();
            const source: ModelSource = {
              modelId: info.sha256,
              file: path.resolve(selected),
              name: info.name ?? path.win32.basename(selected),
              size: info.size,
              sizeBytes: info.sizeBytes ?? 0,
              modifiedMs: info.modifiedMs ?? 0,
              architecture: info.architecture ?? 'Unknown',
              contextLimit: info.contextLimit ?? 0,
              quantization: info.quantization ?? 'Unknown',
              parameters: info.parameters ?? 'Unknown',
            };
            if (deps.createHistoryHost && preparation) await preparation;
            await observeDevice();
            if (host && deps.createHistoryHost) {
              await send('stop');
            } else if (host) {
              unsubscribe?.();
              await send('quit');
              await host.close();
              host = undefined;
            }
            if (host?.api) {
              const registered = await host.api(caller, {
                action: 'registerImport',
                modelId: info.sha256,
                created: importedAt,
                source,
              });
              if (!registered.ok || !('registered' in registered))
                throw new Error('CONFIGURATION_UNAVAILABLE');
            }
            if (quitting) return;
            file = selected;
            const model = modelView(source);
            view = {
              ...view,
              model,
              models: [model],
              phase: 'stopped',
              error: null,
            };
          })();
          importPreparation = work.then(() => undefined);
          try {
            await importPreparation;
          } finally {
            importPreparation = undefined;
            importing = false;
            view = { ...view, indexing: null };
          }
        } else if (command.action === 'stop') {
          ++epoch;
          if (host) await send('stop');
          else view = { ...view, phase: 'stopped', error: null };
        } else if (command.action === 'load') {
          if (importing || view.restoring) throw new Error('BUSY');
          if (!file || !view.model || command.modelId !== view.model.id)
            throw new Error('INVALID_MODEL_ID');
          if (!['stopped', 'failed'].includes(view.phase)) throw new Error('BUSY');
          if (view.model.unavailable) throw new Error('MODEL_FILE_UNAVAILABLE');
          const operation = ++epoch;
          loadingEpoch = operation;
          view = { ...view, phase: 'starting', error: null };
          if (deps.createHistoryHost && preparation) await preparation;
          if (operation !== epoch || quitting) return result();
          await deps
            .inspect(file)
            .then((inspected) => {
              if (inspected.sha256 !== deps.expectedHash) throw new Error('UNSUPPORTED_MODEL');
            })
            .catch(() => {
              if (operation !== epoch || quitting) return;
              const model = view.model ? { ...view.model, unavailable: true } : null;
              view = { ...view, model, models: model ? [model] : [] };
              throw new Error('MODEL_FILE_UNAVAILABLE');
            });
          if (operation !== epoch || quitting) return result();
          if (host?.configuration) {
            const settings = await host.configuration(caller, {
              action: 'read',
              modelId: deps.expectedHash,
            });
            if (!settings.ok) throw new Error('CONFIGURATION_UNAVAILABLE');
            if (!isDeepStrictEqual(settings.record.load, settings.defaults.load))
              throw new Error('NEEDS_RESOURCE_EVIDENCE');
          }
          await deps.preflight();
          if (operation !== epoch || quitting) return result();
          if (!host) {
            preparation = deps.createHost(file);
            host = observeChat(await preparation);
          }
          if (operation !== epoch || quitting) return result();
          if (host.prepare) {
            enginePreparation = host.prepare(file);
            await enginePreparation;
          }
          if (operation !== epoch || quitting) return result();
          await send('load', {
            deploymentId: deps.deploymentId ?? 'desktop-development',
            sessionId: randomUUID(),
            operationId: randomUUID(),
            packageId: deps.packageId,
            modelId: deps.expectedHash,
          });
        }
      } catch (error: unknown) {
        if (loadingEpoch !== undefined && (loadingEpoch !== epoch || quitting)) return result();
        const rejected =
          error instanceof Error && ['BUSY', 'INVALID_MODEL_ID'].includes(error.message);
        view = {
          ...view,
          phase: command.action === 'snapshot' || rejected ? view.phase : 'failed',
          error:
            error instanceof Error
              ? (messages[error.message] ??
                'The runtime operation failed. Stop and retry explicitly.')
              : 'The runtime operation failed.',
        };
      }
      return result();
    },
    async quit(): Promise<void> {
      quitting = true;
      unsubscribe?.();
      chatListeners.clear();
      ++epoch;
      const pendingDevice = deviceProbe;
      // A pending picker owns no model handles; only selected-file indexing must settle.
      await Promise.allSettled([restoration, view.indexing ? importPreparation : undefined]);
      if (preparation) {
        try {
          host = await preparation;
        } catch {
          /* No host was created. */
        }
      }
      if (enginePreparation) {
        try {
          await enginePreparation;
        } catch {
          /* Failed preparation grants no engine authority. */
        }
      }
      if (host) {
        try {
          await send('quit');
        } catch (error: unknown) {
          if (!(error instanceof Error) || error.message !== 'CORE_EXITED') throw error;
          // A dead core cannot acknowledge Quit; retained main ownership still confirms every exit.
        }
        await host.close();
      }
      // Do not delay engine shutdown; diagnostic children still settle before main exits.
      if (pendingDevice)
        await pendingDevice.catch(() => {
          deviceCleanupFailed = true;
        });
      view = { ...view, phase: 'stopped' };
      if (deviceCleanupFailed) throw new Error('QUERY_CLEANUP_FAILED');
    },
  };
}
