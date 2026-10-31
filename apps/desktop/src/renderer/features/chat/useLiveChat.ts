import { useCallback, useEffect, useRef, useState } from 'react';
import type { DemoChat, ChatAction, ChatMessage } from '../../mocks/chat';
import { transitionDemoChat } from '../../mocks/chat';
import type { ChatBridge, ChatCommand, ChatReply } from '../../../shared/chat';
import { decodeChatReply } from '../../../shared/chat';

const active = ['queued', 'running', 'cancelling'];
const errors: Record<string, string> = {
  SETTINGS_UNAVAILABLE:
    'The original response settings are unavailable. Send a new message to use current settings.',
  CONFIGURATION_UNAVAILABLE: 'Model settings could not be read. Stop the model and try again.',
  NOT_READY: 'Load a model before sending.',
  CONTEXT_FULL: 'This conversation exceeds the selected context. Start a new chat.',
  QUEUE_FULL: 'The request queue is full. Try again after a response finishes.',
  CONVERSATION_BUSY: 'This conversation already has a response in progress.',
  HISTORY_FULL: 'Local history is full.',
  HISTORY_UNAVAILABLE: 'Local history is unavailable. Your draft is retained.',
  NEEDS_RESOURCE_EVIDENCE: 'The selected runtime needs a validated Chat memory budget.',
  TOKEN_COUNT_FAILED: 'The runtime could not check this conversation. Stop and reload the model.',
};
function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('INVALID_CONTROL');
  return input as Record<string, unknown>;
}
function text(input: unknown): string {
  if (typeof input !== 'string') throw new Error('INVALID_CONTROL');
  return input;
}
function flag(input: unknown): boolean {
  if (input === undefined) return false;
  if (typeof input !== 'boolean') throw new Error('INVALID_CONTROL');
  return input;
}
function thinkingDuration(input: unknown): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0)
    throw new Error('INVALID_CONTROL');
  return input;
}
function dateGroup(input: unknown): 'Today' | 'Yesterday' | 'Older' {
  const updated = thinkingDuration(input),
    now = new Date(Date.now());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
  return updated >= today ? 'Today' : updated >= yesterday ? 'Yesterday' : 'Older';
}
function speeds(input: unknown): NonNullable<ChatMessage['speeds']> {
  const value = object(input);
  const hasAcceptance = Object.hasOwn(value, 'acceptance');
  if (
    Object.keys(value).sort().join(',') !==
    (hasAcceptance ? 'acceptance,generation,prefill' : 'generation,prefill')
  )
    throw new Error('INVALID_CONTROL');
  if (
    hasAcceptance &&
    value.acceptance !== null &&
    (typeof value.acceptance !== 'number' ||
      !Number.isFinite(value.acceptance) ||
      value.acceptance < 0 ||
      value.acceptance > 1)
  )
    throw new Error('INVALID_CONTROL');
  const rate = (input: unknown): number | null => {
    if (input === null) return null;
    if (
      typeof input !== 'number' ||
      !Number.isFinite(input) ||
      input <= 0 ||
      input > Number.MAX_SAFE_INTEGER
    )
      throw new Error('INVALID_CONTROL');
    return input;
  };
  return {
    generation: rate(value.generation),
    prefill: rate(value.prefill),
    ...(hasAcceptance ? { acceptance: value.acceptance as number | null } : {}),
  };
}
function messages(input: unknown): ChatMessage[] {
  if (!Array.isArray(input)) throw new Error('INVALID_CONTROL');
  return input.flatMap((raw: unknown) => {
    const turn = object(raw);
    if (!Array.isArray(turn.attempts)) throw new Error('INVALID_CONTROL');
    const user: ChatMessage = { id: text(turn.id), role: 'user', text: text(turn.text) };
    return [
      user,
      ...turn.attempts.map((value: unknown): ChatMessage => {
        const attempt = object(value);
        const state = text(attempt.state);
        if (
          ![...active, 'completed', 'limit-reached', 'cancelled', 'interrupted', 'failed'].includes(
            state,
          )
        )
          throw new Error('INVALID_CONTROL');
        return {
          id: text(attempt.id),
          attemptId: text(attempt.id),
          requestId: text(attempt.requestId),
          role: 'assistant',
          text: text(attempt.text),
          reasoning: text(attempt.reasoning),
          ...(attempt.thinkingMs === undefined
            ? {}
            : { thinkingMs: thinkingDuration(attempt.thinkingMs) }),
          state,
          ...(attempt.speeds ? { speeds: speeds(attempt.speeds) } : {}),
        };
      }),
    ];
  });
}

/** Renderer keeps drafts and views only. All Send/Stop authority stays in main/core.
 * One refresh at a time, revision-bound paging and coalesced change notifications
 * prevent event backlogs and mixed revisions. Navigation/reload never resubmits.
 */
class LiveChatClient {
  chat: DemoChat = { selectedId: '', conversations: [] };
  loaded = false;
  notice = 'Opening local history…';
  draft = '';
  matches: readonly string[] | undefined;
  private query = '';
  private searchVersion = '';
  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private initialConversationAttempted = false;
  private creating: Promise<void> | undefined;
  private closed = false;
  private refreshing = false;
  private requested = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private unsubscribe: (() => void) | undefined;
  private writes: Promise<void> = Promise.resolve();
  private writing = false;
  private readonly unsaved = new Map<string, string>();
  private readonly drafts = new Map<string, string>();
  private readonly pending = new Map<string, { requestId: string | null; stop: boolean }>();
  private readonly deleting = new Set<string>();
  private epoch = 0;
  constructor(
    private readonly bridge: ChatBridge,
    private readonly update: () => void,
  ) {}
  async open(): Promise<void> {
    this.unsubscribe = this.bridge.subscribe(() => {
      void this.refresh();
    });
    await this.refresh();
    const poll = () => {
      if (!this.closed) {
        void this.refresh();
        this.timer = setTimeout(poll, this.busy() ? 250 : 500);
      }
    };
    this.timer = setTimeout(poll, 500);
  }
  private async command(command: ChatCommand): Promise<ChatReply> {
    const reply = decodeChatReply(await this.bridge.command(command));
    if (!reply.ok) throw new Error(reply.error ?? 'HISTORY_UNAVAILABLE');
    return reply;
  }
  private async page(
    command: Extract<ChatCommand, { action: 'list' | 'read' | 'search' }>,
  ): Promise<unknown> {
    let cursor: string | undefined,
      payload = '',
      revision: number | undefined;
    const list: unknown[] = [];
    do {
      const reply = await this.command({ ...command, ...(cursor ? { cursor } : {}) });
      if (
        !reply.page ||
        typeof reply.page.payload !== 'string' ||
        (reply.page.next !== null && typeof reply.page.next !== 'string')
      )
        throw new Error('INVALID_CONTROL');
      if (revision !== undefined && revision !== reply.page.revision) throw new Error('STALE_VIEW');
      revision = reply.page.revision;
      if (command.action !== 'read') {
        const items: unknown = JSON.parse(reply.page.payload);
        if (!Array.isArray(items)) throw new Error('INVALID_CONTROL');
        for (const item of items as unknown[]) list.push(item);
      } else payload += reply.page.payload;
      cursor = reply.page.next ?? undefined;
    } while (cursor && !this.closed);
    return command.action !== 'read' ? list : (JSON.parse(payload) as unknown);
  }
  async refresh(): Promise<void> {
    if (this.closed) return;
    if (this.deleting.size) {
      this.requested = true;
      return;
    }
    if (this.refreshing) {
      this.requested = true;
      return;
    }
    this.refreshing = true;
    const epoch = this.epoch;
    try {
      const summaries = await this.page({ action: 'list' });
      if (epoch !== this.epoch || this.closed) return;
      if (!Array.isArray(summaries)) throw new Error('INVALID_CONTROL');
      if (!this.chat.selectedId && this.draft) {
        // An unassigned draft belongs to a new chat, never an older saved draft.
        if (!this.initialConversationAttempted) {
          this.initialConversationAttempted = true;
          await this.newConversation();
        }
        this.loaded = false;
        return;
      }
      const selectedId =
        this.chat.selectedId ||
        (() => {
          const first = (summaries as unknown[]).find((item) => !flag(object(item).archived));
          return first ? text(object(first).id) : '';
        })();
      const previous = this.chat;
      this.chat = {
        selectedId,
        conversations: summaries.map((value: unknown) => {
          const item = object(value),
            id = text(item.id),
            old = previous.conversations.find((chat) => chat.id === id);
          return {
            id,
            title: text(item.title),
            group: dateGroup(item.updated),
            pinned: flag(item.pinned),
            archived: flag(item.archived),
            generating:
              flag(item.generating) || (this.pending.has(id) && !this.pending.get(id)?.requestId),
            draft: this.drafts.get(id) ?? old?.draft ?? '',
            messages: old?.messages ?? [],
          };
        }),
      };
      for (const value of summaries) {
        const item = object(value),
          id = text(item.id);
        if (item.generating === false && this.pending.get(id)?.requestId) this.pending.delete(id);
      }
      if (selectedId) {
        const item = object(await this.page({ action: 'read', conversationId: selectedId }));
        if (epoch !== this.epoch || this.closed) return;
        if (!this.closed && selectedId === this.chat.selectedId) {
          const savedDraft = text(item.draft);
          const projected = messages(item.turns);
          this.chat = {
            ...this.chat,
            conversations: this.chat.conversations.map((conversation) =>
              conversation.id === selectedId
                ? {
                    ...conversation,
                    title: text(item.title),
                    draft: this.drafts.get(selectedId) ?? savedDraft,
                    messages: projected,
                  }
                : conversation,
            ),
          };
          if (!projected.some((message) => active.includes(message.state ?? ''))) {
            if (this.pending.get(selectedId)?.requestId) this.pending.delete(selectedId);
            if (!this.pending.has(selectedId) && this.notice === 'Stopping response…')
              this.notice = 'Saved on this device';
          }
        }
      }
      const searchVersion = JSON.stringify(summaries);
      if (this.query && (this.matches === undefined || searchVersion !== this.searchVersion)) {
        const matched = await this.page({ action: 'search', query: this.query });
        if (epoch !== this.epoch || this.closed) return;
        if (!Array.isArray(matched)) throw new Error('INVALID_CONTROL');
        this.matches = matched.map((item: unknown) => text(object(item).id));
        this.searchVersion = searchVersion;
      }
      this.loaded = true;
      if (!selectedId && !this.initialConversationAttempted) {
        this.initialConversationAttempted = true;
        await this.newConversation();
      }
      if (selectedId && previous.selectedId === selectedId && this.draft) this.draft = '';
      if (this.notice === 'Opening local history…' || this.notice === errors.NOT_READY)
        this.notice = 'Saved on this device';
    } catch (error) {
      if (epoch !== this.epoch) return;
      if (!(error instanceof Error && error.message === 'STALE_VIEW')) {
        this.loaded = false;
        this.notice =
          errors[error instanceof Error ? error.message : ''] ??
          'The app connection is unavailable. Your draft is retained.';
      }
    } finally {
      this.refreshing = false;
      if (!this.closed) this.update();
      if (this.requested && !this.closed) {
        this.requested = false;
        queueMicrotask(() => {
          void this.refresh();
        });
      }
    }
  }
  search(query: string): void {
    this.query = query.trim();
    this.matches = undefined;
    this.searchVersion = '';
    ++this.epoch;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.update();
    this.searchTimer = setTimeout(() => {
      void this.refresh();
    }, 150);
  }
  private save(id: string, content: string): void {
    // Keep only the newest draft per conversation while one durable write is pending.
    this.unsaved.set(id, content);
    if (this.writing) return;
    this.writing = true;
    this.writes = (async () => {
      try {
        while (this.unsaved.size) {
          const [conversationId, value] = this.unsaved.entries().next().value!;
          this.unsaved.delete(conversationId);
          await this.command({ action: 'saveDraft', conversationId, text: value });
        }
      } catch (error) {
        this.notice =
          errors[error instanceof Error ? error.message : ''] ?? 'Could not save the draft.';
        this.unsaved.clear();
        if (!this.closed) this.update();
      } finally {
        this.writing = false;
      }
    })();
  }
  dispatch(action: ChatAction): void {
    if (action.type === 'pin' || action.type === 'archive') {
      void this.sidebar(action);
      return;
    }
    if (action.type === 'delete') {
      void this.remove(action.id);
      return;
    }
    if (action.type === 'draft' && this.deleting.has(this.chat.selectedId)) return;
    if (action.type === 'new') {
      void this.newConversation();
      return;
    }
    if (
      action.type === 'draft' &&
      !this.chat.conversations.some((item) => item.id === this.chat.selectedId)
    ) {
      this.draft = action.text;
      if (this.chat.selectedId) {
        this.drafts.set(this.chat.selectedId, action.text);
        this.save(this.chat.selectedId, action.text);
      }
      this.update();
      return;
    }
    this.chat = transitionDemoChat(this.chat, action);
    if (action.type === 'draft' && this.chat.selectedId) {
      this.drafts.set(this.chat.selectedId, action.text);
      this.save(this.chat.selectedId, action.text);
    }
    this.update();
    if (action.type === 'select') void this.refresh();
  }
  private async sidebar(action: Extract<ChatAction, { type: 'pin' | 'archive' }>): Promise<void> {
    try {
      await this.command({
        action: action.type === 'pin' ? 'pinConversation' : 'archiveConversation',
        conversationId: action.id,
        value: action.value,
      });
      this.chat = transitionDemoChat(this.chat, action);
      this.notice =
        action.type === 'pin'
          ? action.value
            ? 'Chat pinned.'
            : 'Chat unpinned.'
          : action.value
            ? 'Chat archived.'
            : 'Chat restored.';
      void this.refresh();
    } catch {
      this.notice = 'Could not update the chat. Try again.';
    }
    if (!this.closed) this.update();
  }
  private newConversation(): Promise<void> {
    if (this.creating) return this.creating;
    this.creating = (async () => {
      try {
        // Durable drafts must be visible before core decides which empty chat can be reused.
        await this.writes;
        const reply = await this.command({ action: 'newConversation' });
        const id = text(reply.conversationId);
        this.chat = { ...this.chat, selectedId: id };
        if (this.draft) {
          this.drafts.set(id, this.draft);
          this.save(id, this.draft);
        }
        await this.refresh();
      } catch (error) {
        this.notice =
          errors[error instanceof Error ? error.message : ''] ??
          'Could not create a conversation. Your draft is retained.';
        if (!this.closed) this.update();
      } finally {
        this.creating = undefined;
      }
    })();
    return this.creating;
  }
  busy(): boolean {
    return (
      this.pending.has(this.chat.selectedId) ||
      Boolean(this.chat.conversations.find((chat) => chat.id === this.chat.selectedId)?.generating)
    );
  }
  async send(attemptId?: string): Promise<void> {
    const conversation = this.chat.conversations.find((item) => item.id === this.chat.selectedId);
    if (
      !conversation ||
      this.deleting.has(conversation.id) ||
      this.busy() ||
      (!attemptId && !conversation.draft.trim())
    )
      return;
    const pending = { requestId: null as string | null, stop: false };
    this.pending.set(conversation.id, pending);
    this.notice = 'Preparing response…';
    this.update();
    try {
      await this.writes;
      if (pending.stop) {
        this.pending.delete(conversation.id);
        this.notice = 'Stopped.';
        if (!this.closed) this.update();
        return;
      }
      const reply = await this.command(
        attemptId
          ? { action: 'retry', attemptId }
          : { action: 'send', conversationId: conversation.id, text: conversation.draft },
      );
      pending.requestId = text(reply.requestId);
      if (this.deleting.has(conversation.id)) return;
      if (!attemptId) {
        const latest = this.drafts.get(conversation.id) ?? conversation.draft;
        const retained = latest === conversation.draft ? '' : latest;
        if (!retained) this.drafts.delete(conversation.id);
        else {
          this.drafts.set(conversation.id, retained);
          this.save(conversation.id, retained);
        }
        this.chat = {
          ...this.chat,
          conversations: this.chat.conversations.map((item) =>
            item.id === conversation.id ? { ...item, draft: retained } : item,
          ),
        };
      }
      if (pending.stop)
        await this.command({ action: 'cancelConversation', conversationId: conversation.id });
      this.notice = 'Saved on this device';
      await this.refresh();
    } catch (error) {
      this.pending.delete(conversation.id);
      if (pending.stop && error instanceof Error && error.message === 'NOT_READY') {
        if (!attemptId)
          this.save(conversation.id, this.drafts.get(conversation.id) ?? conversation.draft);
        this.notice = 'Stopped.';
        await this.refresh();
      } else
        this.notice =
          errors[error instanceof Error ? error.message : ''] ??
          'The response could not start. Your draft is retained.';
    }
    if (!this.closed) this.update();
  }
  async stop(): Promise<void> {
    const conversationId = this.chat.selectedId;
    const pending = this.pending.get(this.chat.selectedId);
    if (pending) pending.stop = true;
    if (!conversationId || !this.busy()) return;
    try {
      this.notice = 'Stopping response…';
      this.update();
      await this.command({ action: 'cancelConversation', conversationId });
      await this.refresh();
    } catch {
      this.notice = 'Could not confirm Stop. Check the response status.';
    }
    if (!this.closed) this.update();
  }
  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.unsubscribe?.();
  }
  async remove(id: string): Promise<boolean> {
    if (this.deleting.has(id)) return false;
    this.deleting.add(id);
    ++this.epoch;
    this.notice = 'Deleting chat…';
    this.update();
    try {
      await this.writes;
      await this.command({ action: 'deleteConversation', conversationId: id });
      const selected = this.chat.selectedId === id;
      this.chat = {
        selectedId: selected ? '' : this.chat.selectedId,
        conversations: this.chat.conversations.filter((c) => c.id !== id),
      };
      this.drafts.delete(id);
      this.unsaved.delete(id);
      this.pending.delete(id);
      if (selected) this.draft = '';
      this.deleting.delete(id);
      this.notice = 'Chat deleted.';
      if (selected) await this.newConversation();
      else await this.refresh();
      return true;
    } catch (error) {
      this.notice =
        error instanceof Error && error.message === 'NOT_READY'
          ? 'Could not safely stop the response. Stop the model and try deleting again.'
          : 'Could not delete the chat. Your chat and draft are retained.';
      return false;
    } finally {
      this.deleting.delete(id);
      if (!this.closed) {
        this.update();
        void this.refresh();
      }
    }
  }
}

export function useLiveChat(enabled: boolean, ready: boolean) {
  const [view, setView] = useState<{
    chat: DemoChat;
    loaded: boolean;
    busy: boolean;
    notice: string;
    draft: string;
    matches: readonly string[] | undefined;
  }>({
    chat: { selectedId: '', conversations: [] },
    loaded: false,
    busy: false,
    notice: 'Opening local history…',
    draft: '',
    matches: undefined,
  });
  const client = useRef<LiveChatClient | null>(null);
  const search = useCallback((query: string) => client.current?.search(query), []);
  useEffect(() => {
    const bridge = window.modelLoomChat;
    if (!enabled || !bridge) return;
    const instance = new LiveChatClient(bridge, () =>
      setView({
        chat: instance.chat,
        loaded: instance.loaded,
        busy: instance.busy(),
        notice: instance.notice,
        draft: instance.draft,
        matches: instance.matches,
      }),
    );
    client.current = instance;
    void instance.open();
    return () => {
      instance.close();
      client.current = null;
    };
  }, [enabled]);
  return {
    chat: view.chat,
    dispatch: (action: ChatAction) => client.current?.dispatch(action),
    controls: {
      ready: enabled && ready && view.loaded,
      busy: enabled && view.busy,
      notice: view.notice,
      draft: view.draft,
      matches: view.matches,
      search,
      send: () => {
        if (ready) void client.current?.send();
      },
      stop: () => {
        void client.current?.stop();
      },
      retry: (id: string) => {
        if (ready) void client.current?.send(id);
      },
      remove: (id: string) => client.current?.remove(id) ?? Promise.resolve(false),
    },
  };
}
