import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
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
  inspect(file: string): Promise<{ sha256: string; size: string }>;
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
};
/** Session-only import/load bridge. Fresh preflight precedes each load; host owns runtime cleanup.
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
  let historyFailed = false;
  let deviceProbe: Promise<void> | undefined;
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
    preparation = Promise.resolve()
      .then(() => deps.createHistoryHost!())
      .then((created) => {
        host = observeChat(created);
        return created;
      });
    void preparation.catch(() => {
      historyFailed = true;
    });
  }
  const observeDevice = async () => {
    if (!deps.device || view.device || quitting) return;
    deviceProbe ??= deps
      .device()
      .then((device) => {
        if (!quitting) view = { ...view, device };
      })
      .catch(() => {
        // Hardware visibility is independent of model admission; retry a failed observation.
        deviceProbe = undefined;
      });
    await deviceProbe;
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
      if (command.action === 'snapshot') await observeDevice();
      if (!deps.enabled || quitting) return result();
      try {
        if (command.action === 'snapshot') {
          // Keep a rejected admission visible until an explicit stop/retry. A stopped core
          // has no knowledge of main's preflight failure and must not erase that evidence.
          if (host && view.phase !== 'failed') await send('snapshot');
        } else if (command.action === 'import') {
          if (importing || !['stopped', 'failed'].includes(view.phase)) throw new Error('BUSY');
          importing = true;
          try {
            const selected = await deps.pick();
            if (selected === null || quitting) return result();
            const info = await deps.inspect(selected).catch((error: unknown) => {
              if (error instanceof Error && error.message === 'OWNERSHIP_FAILED')
                throw new Error('MODEL_FILE_UNAVAILABLE');
              throw error;
            });
            const importedAt = Math.floor(Date.now() / 1000);
            if (info.sha256 !== deps.expectedHash) throw new Error('UNSUPPORTED_MODEL');
            if (quitting) return result();
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
              });
              if (!registered.ok || !('registered' in registered))
                throw new Error('CONFIGURATION_UNAVAILABLE');
            }
            file = selected;
            view = {
              ...view,
              model: { id: `model-${info.sha256}`, name: 'Bonsai 27B', size: info.size },
              phase: 'stopped',
              error: null,
            };
          } finally {
            importing = false;
          }
        } else if (command.action === 'stop') {
          ++epoch;
          if (host) await send('stop');
          else view = { ...view, phase: 'stopped', error: null };
        } else if (command.action === 'load') {
          if (!file || !view.model || command.modelId !== view.model.id)
            throw new Error('INVALID_MODEL_ID');
          if (!['stopped', 'failed'].includes(view.phase)) throw new Error('BUSY');
          const operation = ++epoch;
          view = { ...view, phase: 'starting', error: null };
          if (deps.createHistoryHost && preparation) await preparation;
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
      view = { ...view, phase: 'stopped' };
    },
  };
}
