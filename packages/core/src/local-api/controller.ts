import { ApiServer } from './server.js';
import { ApiCredentials } from './credentials.js';
import { decodeApiOwnerCommand, decodeApiManagementReply } from './wire.js';
import type { ApiOwnerReply } from './wire.js';
import type { ModelConfigurationStore } from '../model-configuration/store.js';
import type { ApiKeyProtection } from '../model-configuration/windows-protection.js';
import type { RuntimeSettingCapabilities } from '../model-configuration/contracts.js';
import type { ChatController } from '../generation/chat-controller.js';
/** Caller-bound local management. Public HTTP has no route to this object or its credentials. */
export class ApiController {
  private imported: number | null = null;
  private closed = false;
  private readonly pending = new Set<Promise<ApiOwnerReply>>();
  private credentials: ApiCredentials | undefined;
  private server: ApiServer | undefined;
  private readonly preparing: Promise<void>;
  constructor(
    private readonly store: ModelConfigurationStore,
    private readonly caller: string,
    private readonly modelId: string,
    capabilities: RuntimeSettingCapabilities,
    protection: () => ApiKeyProtection,
    ready: () => boolean,
    chat: () => ChatController | undefined,
    port?: number,
  ) {
    this.preparing = (async () => {
      this.imported ??= await store.readImport(modelId);
      this.credentials = await ApiCredentials.open(
        store,
        protection(),
        () => this.server?.cancelRequests() ?? Promise.resolve(),
      );
      this.server = new ApiServer({
        credentials: this.credentials,
        capabilities,
        ...(port === undefined ? {} : { port }),
        model: () =>
          ready() && this.imported !== null
            ? { id: `model-${modelId}`, created: this.imported }
            : null,
        generate: (caller, input, progress) => {
          const controller = chat();
          if (!controller) throw new Error('NOT_READY');
          return controller.generateApi(caller, input, progress);
        },
      });
    })();
    void this.preparing.catch(() => undefined);
  }
  command(caller: string, input: unknown): Promise<ApiOwnerReply> {
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
  private async handle(input: unknown): Promise<ApiOwnerReply> {
    try {
      const command = decodeApiOwnerCommand(input);
      if (command.action === 'registerImport') {
        if (command.modelId !== this.modelId) throw new Error('INVALID_CONTROL');
        this.imported = await this.store.recordImport(command.modelId, command.created);
        // Import registration remains available even when Windows key protection cannot open.
        return { ok: true, registered: true };
      }
      await this.preparing;
      if (this.closed || !this.server || !this.credentials) throw new Error('API_UNAVAILABLE');
      if (command.action === 'start') await this.server.start();
      if (command.action === 'stop') await this.server.stop();
      if (command.action === 'generateKey') await this.credentials.generate();
      if (command.action === 'clearLogs') this.server.clearLogs();
      const key = this.credentials.status();
      return decodeApiManagementReply(
        {
          ok: true,
          status: {
            ...this.server.status(),
            keyPresent: key.present,
            keyGeneration: key.generation,
          },
          ...(command.action === 'revealKey' || command.action === 'copyKey'
            ? { secret: this.credentials.reveal() }
            : {}),
        },
        command.action === 'revealKey' || command.action === 'copyKey',
      );
    } catch (error) {
      try {
        return decodeApiManagementReply({
          ok: false,
          error: error instanceof Error ? error.message : '',
        });
      } catch {
        return { ok: false, error: 'API_UNAVAILABLE' };
      }
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    await this.preparing.catch(() => undefined);
    this.credentials?.close();
    try {
      await this.server?.stop();
    } finally {
      await Promise.allSettled([...this.pending]);
      await this.credentials?.join();
    }
  }
}
