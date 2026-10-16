import { isDeepStrictEqual } from 'node:util';
import { createModelConfiguration } from './contracts.js';
import type {
  ActiveLoadSnapshot,
  LoadDefaults,
  ResolvedRequestSettings,
  RuntimeSettingCapabilities,
  GenerationOverrides,
} from './contracts.js';
import { decodeModelConfiguration } from './contracts.js';
import type { ModelConfigurationStore } from './store.js';
import { resolveRequestSettings } from './resolve.js';
import { decodeConfigurationCommand, decodeConfigurationReply } from './wire.js';
import type { ConfigurationReply } from './wire.js';

/** Caller-bound management and trusted capture of settings for one deployment. */
export class ConfigurationController {
  private closed = false;
  private readonly pending = new Set<Promise<ConfigurationReply>>();
  constructor(
    private readonly store: ModelConfigurationStore,
    private readonly caller: string,
    private readonly capabilities: RuntimeSettingCapabilities,
    private readonly initialLoad: LoadDefaults,
    private readonly active: () => ActiveLoadSnapshot | null,
    private readonly modelCapabilities?: (modelId: string) => Promise<RuntimeSettingCapabilities>,
  ) {}
  command(caller: string, input: unknown): Promise<ConfigurationReply> {
    if (this.closed || caller !== this.caller || this.pending.size >= 16)
      return Promise.resolve({ ok: false, error: 'NOT_READY' });
    const operation = this.handle(input);
    this.pending.add(operation);
    void operation.then(
      () => this.pending.delete(operation),
      () => this.pending.delete(operation),
    );
    return operation;
  }
  private async handle(input: unknown): Promise<ConfigurationReply> {
    try {
      const command = decodeConfigurationCommand(input);
      const capabilities = await this.caps(command.modelId);
      if (command.action === 'save') {
        decodeModelConfiguration(command.record, capabilities);
        if (
          command.record.load.automatic ||
          command.record.preferences.argumentsEnabled ||
          command.record.preferences.overflow !== 'stop'
        )
          throw Error('UNSUPPORTED_SETTING');
        if (command.record.generation.thinking !== null && !capabilities.thinking)
          throw Error('UNSUPPORTED_SETTING');
      }
      const record =
        command.action === 'save'
          ? await this.store.save(command.modelId, command.expectedRevision, command.record)
          : await this.store.read(command.modelId);
      const active = this.active();
      return decodeConfigurationReply({
        ok: true,
        record,
        defaults: createModelConfiguration(
          record.modelId,
          {
            ...this.initialLoad,
            contextLength: Math.min(this.initialLoad.contextLength, capabilities.contextLimit),
          },
          capabilities,
        ),
        pendingReload:
          active !== null &&
          active.modelId === record.modelId &&
          (!isDeepStrictEqual(record.load, active.load) ||
            !isDeepStrictEqual(
              record.preferences,
              active.preferences ??
                createModelConfiguration(record.modelId, this.initialLoad, this.capabilities)
                  .preferences,
            )),
        maxOutputTokens: capabilities.maxOutputTokens,
        thinkingSupported: capabilities.thinking,
      });
    } catch (error) {
      try {
        return decodeConfigurationReply({
          ok: false,
          error: error instanceof Error ? error.message : '',
        });
      } catch {
        return { ok: false, error: 'CONFIGURATION_UNAVAILABLE' };
      }
    }
  }
  private caps(modelId: string): Promise<RuntimeSettingCapabilities> {
    return this.modelCapabilities?.(modelId) ?? Promise.resolve(this.capabilities);
  }
  /** Capture saved next-load settings; native preflight remains the activation authority. */
  async captureLoad(modelId: string): Promise<ActiveLoadSnapshot> {
    if (this.closed) throw Error('NOT_READY');
    const record = decodeModelConfiguration(
      await this.store.read(modelId),
      await this.caps(modelId),
    );
    return Object.freeze({
      modelId,
      revision: record.revision,
      profileId: this.capabilities.profileId,
      load: Object.freeze({ ...record.load }),
      preferences: record.preferences,
    });
  }
  /** New requests capture defaults once; pending load changes do not alter active context. */
  async resolve(
    active: ActiveLoadSnapshot,
    overrides: GenerationOverrides = {},
  ): Promise<ResolvedRequestSettings> {
    if (this.closed) throw Error('NOT_READY');
    return resolveRequestSettings(
      await this.store.read(active.modelId),
      active,
      overrides,
      await this.caps(active.modelId),
    );
  }
  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([...this.pending]);
  }
}
