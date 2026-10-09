import type { HistoryStore } from '../history/store.js';
import type { ChatReply } from './chat-wire.js';
import { decodeChatCommand } from './chat-wire.js';
import { GenerationService } from './service.js';
import type { ServiceDependencies } from './service.js';
import { randomUUID } from 'node:crypto';
interface Cursor {
  readonly target: string;
  readonly version: string;
  readonly offset: number;
}
/** Utility-owned single-window history and generation actions, with finite revision-bound cursors.
 * Main supplies the captured caller, not renderer data. Replies contain no provenance/settings.
 */
export class ChatController {
  private readonly cursors = new Map<string, Cursor>();
  private readonly deleting = new Set<string>();
  private readonly deletions = new Set<Promise<void>>();
  private service: GenerationService | undefined;
  private unavailable = 'NOT_READY';
  private closed = false;
  private operations = 0;
  private binding: Promise<void> = Promise.resolve();
  constructor(
    private readonly history: HistoryStore,
    private readonly caller: string,
    private readonly changed: () => void = () => undefined,
  ) {}
  /** Rebinding never replays stored work; previous admission is closed first. */
  bind(dependencies: Omit<ServiceDependencies, 'history'> | null): Promise<void> {
    const replace = async () => {
      const previous = this.service;
      this.service = undefined;
      this.unavailable = 'NOT_READY';
      await previous?.close();
      if (dependencies && !this.closed) {
        try {
          this.service = new GenerationService({ ...dependencies, history: this.history });
        } catch (error) {
          if (error instanceof Error && error.message === 'NEEDS_RESOURCE_EVIDENCE')
            this.unavailable = error.message;
          throw error;
        }
        this.service.subscribe(() => {
          this.changed();
          return true;
        });
      }
    };
    this.binding = this.binding.then(replace, replace);
    return this.binding;
  }
  private issue(cursor: Cursor): string {
    if (this.cursors.size >= 64) this.cursors.delete(this.cursors.keys().next().value!);
    const key = randomUUID();
    this.cursors.set(key, cursor);
    return key;
  }
  async command(caller: string, input: unknown): Promise<ChatReply> {
    if (this.closed || caller !== this.caller || this.operations >= 16)
      return { ok: false, error: 'NOT_READY' };
    this.operations++;
    try {
      const command = decodeChatCommand(input);
      if ('conversationId' in command && this.deleting.has(command.conversationId))
        throw new Error('CONVERSATION_BUSY');
      if (
        command.action === 'retry' &&
        this.deleting.has((await this.history.retrySource(command.attemptId)).conversationId)
      )
        throw new Error('CONVERSATION_BUSY');
      if (command.action === 'deleteConversation') {
        this.deleting.add(command.conversationId);
        try {
          const deletion = this.service
            ? this.service.deleteConversation(caller, command.conversationId)
            : this.history.deleteConversation(command.conversationId);
          this.deletions.add(deletion);
          try {
            await deletion;
          } finally {
            this.deletions.delete(deletion);
          }
          this.cursors.clear();
          this.changed();
          return { ok: true };
        } finally {
          this.deleting.delete(command.conversationId);
        }
      }
      if (command.action === 'newConversation') {
        const conversation = await this.history.newConversation(true);
        this.changed();
        return { ok: true, conversationId: conversation.id };
      }
      if (command.action === 'list' || command.action === 'read' || command.action === 'search') {
        const target =
          command.action === 'read'
            ? command.conversationId
            : command.action === 'search'
              ? `search:${command.query}`
              : 'list';
        const conversation =
          command.action === 'read'
            ? await this.history.readConversation(command.conversationId)
            : null;
        const version = conversation
          ? String(conversation.revision)
          : await this.history.listRevision();
        const saved = command.cursor ? this.cursors.get(command.cursor) : undefined;
        if (command.cursor) this.cursors.delete(command.cursor);
        if (command.cursor && (!saved || saved.target !== target || saved.version !== version))
          throw new Error('STALE_VIEW');
        const offset = saved?.offset ?? 0;
        if (!conversation) {
          const summaries = await this.history.listConversations(
            offset,
            command.action === 'search' ? command.query : undefined,
          );
          const payload = JSON.stringify(
            summaries.map(({ id, title, revision, updated }) => ({ id, title, revision, updated })),
          );
          const next =
            summaries.length === 32 ? this.issue({ target, version, offset: offset + 32 }) : null;
          return { ok: true, page: { payload, next, revision: 0 } };
        }
        const text = JSON.stringify({
          id: conversation.id,
          title: conversation.title,
          draft: conversation.draft,
          revision: conversation.revision,
          turns: conversation.turns.map((turn) => ({
            id: turn.id,
            text: turn.text,
            attempts: turn.attempts.map(
              ({ id, requestId, text, reasoning, state, outcome, speeds, thinkingMs }) => ({
                id,
                requestId,
                text,
                reasoning,
                state,
                outcome,
                ...(speeds ? { speeds } : {}),
                ...(thinkingMs === undefined ? {} : { thinkingMs }),
              }),
            ),
          })),
        });
        let end = Math.min(offset + 4000, text.length);
        if (end < text.length && /[\uD800-\uDBFF]/u.test(text.charAt(end - 1))) end--;
        return {
          ok: true,
          page: {
            payload: text.slice(offset, end),
            next: end < text.length ? this.issue({ target, version, offset: end }) : null,
            revision: conversation.revision,
          },
        };
      }
      if (command.action === 'saveDraft') {
        await this.history.saveDraft(command.conversationId, command.text);
        return { ok: true };
      }
      if (!this.service) throw new Error(this.unavailable);
      if (command.action === 'cancelConversation') {
        await this.service.cancelConversation(caller, command.conversationId);
        return { ok: true };
      }
      if (command.action === 'cancel') {
        await this.service.cancel(caller, command.requestId);
        return { ok: true };
      }
      const identity =
        command.action === 'retry'
          ? await this.service.retry(caller, command.attemptId)
          : await this.service.send(caller, {
              conversationId: command.conversationId,
              text: command.text,
            });
      this.changed();
      return { ok: true, requestId: identity.requestId, conversationId: identity.conversationId };
    } catch (error) {
      const safe =
        error instanceof Error &&
        [
          'STALE_VIEW',
          'NOT_READY',
          'DENIED',
          'QUEUE_FULL',
          'CONVERSATION_BUSY',
          'CONTEXT_FULL',
          'INVALID_CONTROL',
          'HISTORY_FULL',
          'HISTORY_UNAVAILABLE',
          'NEEDS_RESOURCE_EVIDENCE',
          'TOKEN_COUNT_FAILED',
        ].includes(error.message)
          ? error.message
          : 'HISTORY_UNAVAILABLE';
      return { ok: false, error: safe };
    } finally {
      this.operations--;
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    this.cursors.clear();
    await this.bind(null);
    await Promise.allSettled([...this.deletions]);
  }
}
