import type { ModelConfigurationStore } from '../model-configuration/store.js';
import { decodeClusterCommand, decodeClusterReply } from './wire.js';
import type { ClusterReply } from './wire.js';
import type { CapturedClusterLoad } from './contracts.js';
/** Caller-bound management. Estimates and saved intent cannot grant native launch authority. */
export class ClusterController {
  private closed = false;
  private readonly pending = new Set<Promise<ClusterReply>>();
  constructor(
    private readonly store: ModelConfigurationStore,
    private readonly caller: string,
    private readonly caches: Pick<CapturedClusterLoad, 'cacheK' | 'cacheV'>,
  ) {}
  command(caller: string, input: unknown): Promise<ClusterReply> {
    if (this.closed || caller !== this.caller || this.pending.size >= 16)
      return Promise.resolve({ ok: false, error: 'NOT_READY' });
    const operation = this.handle(input);
    this.pending.add(operation);
    void operation.finally(() => this.pending.delete(operation));
    return operation;
  }
  private async handle(input: unknown): Promise<ClusterReply> {
    try {
      const command = decodeClusterCommand(input);
      const cluster = this.store.cluster;
      let draft = null,
        configuration = null,
        load = null;
      if (command.action === 'read') {
        const defaults = await this.store.read(command.modelId);
        configuration = command.configurationId ? cluster.read(command.configurationId) : null;
        if (
          command.configurationId &&
          (!configuration || configuration.modelId !== command.modelId)
        )
          throw Error('UNKNOWN_CONFIGURATION');
        draft = cluster.readDraft(
          configuration ? `config:${configuration.id}` : `model:${command.modelId}`,
        );
        load = draft?.load ??
          configuration?.load ?? {
            defaults: defaults.load,
            preferences: defaults.preferences,
            ...this.caches,
            cacheV: defaults.load.flashAttention ? this.caches.cacheV : ('f16' as const),
          };
      } else if (command.action === 'edit')
        draft = cluster.writeDraft(command.key, command.expectedRevision, command.edit);
      else if (command.action === 'save') {
        const result = cluster.saveDraft(command.key, command.revision, command.name ?? undefined);
        if (!result.ok)
          return decodeClusterReply({
            ok: true,
            configurations: cluster.list(),
            configuration: null,
            draft: cluster.readDraft(command.key),
            load: null,
            issues: result.issues,
          });
        draft = result.draft;
        configuration = result.configuration;
      } else if (command.action === 'delete') cluster.remove(command.id, command.revision);
      else if (command.action === 'discard')
        draft = cluster.discardDraft(command.key, command.revision);
      else if (command.action === 'auto-place') {
        const current = cluster.readDraft(command.key);
        if (!current || current.revision !== command.revision) throw Error('STALE_CONFIGURATION');
        // Exact native estimate support is required; never invent an equal split or a fit result.
        throw Error('NEEDS_RESOURCE_EVIDENCE');
      }
      return decodeClusterReply({
        ok: true,
        configurations: cluster.list(),
        configuration,
        draft,
        load,
        issues: [],
      });
    } catch (error) {
      try {
        return decodeClusterReply({
          ok: false,
          error: error instanceof Error ? error.message : '',
        });
      } catch {
        return { ok: false, error: 'CONFIGURATION_UNAVAILABLE' };
      }
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([...this.pending]);
  }
}
