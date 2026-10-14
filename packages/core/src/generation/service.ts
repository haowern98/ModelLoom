import { randomUUID } from 'node:crypto';
import { ApiGeneration } from './api-execution.js';
import type { ApiGenerationInput, ApiGenerationHandle } from './api-execution.js';
import type { ApiCaller } from './api-authority.js';
import { decodeResolvedRequestSettings } from '../model-configuration/contracts.js';
import type {
  ResolvedRequestSettings,
  RuntimeSettingCapabilities,
  GenerationOverrides,
} from '../model-configuration/contracts.js';
import type { Identity } from '../runtime/contracts.js';
import type { HistoryStore, Provenance, Conversation } from '../history/store.js';
import { GenerationAdmission } from './admission.js';
import type { GenerationExecution } from './admission.js';
import {
  decodeOutcome,
  decodeSpeeds,
  decodeUsage,
  decodeRequestIdentity,
  decodeSend,
  GENERATION_LIMITS,
} from './contracts.js';
import type {
  GenerationChunk,
  ExecutionIdentity,
  GenerationSpeeds,
  ProgressEvent,
  RequestIdentity,
  SendInput,
  TerminalOutcome,
} from './contracts.js';
export interface ChatMessage {
  readonly role: 'user' | 'assistant' | 'system';
  readonly content: string;
  readonly reasoning_content?: string;
}
/** Captured owner transport: token accounting includes the selected template; settlement confirms
 * native capacity release even on malformed output. Aborting its reader is never that receipt.
 */
export interface ChatTransport {
  tokenCount(
    messages: readonly ChatMessage[],
    signal: AbortSignal,
    settings?: ResolvedRequestSettings,
  ): Promise<number>;
  start(
    identity: ExecutionIdentity,
    messages: readonly ChatMessage[],
    progress: (chunk: GenerationChunk) => void | Promise<void>,
    settings?: ResolvedRequestSettings,
  ): GenerationExecution;
}
export interface ServiceDependencies {
  readonly session: Identity;
  readonly provenance: Provenance;
  readonly history: HistoryStore;
  readonly transport: ChatTransport;
  readonly cleanup: () => Promise<void>;
  readonly configuration?: {
    readonly capabilities: RuntimeSettingCapabilities;
    readonly capture: (overrides?: GenerationOverrides) => Promise<ResolvedRequestSettings>;
  };
}
interface Entry {
  settings?: ResolvedRequestSettings;
  identity: RequestIdentity;
  messages: readonly ChatMessage[];
  text: string;
  reasoning: string;
  checkpointBytes: number;
  writes: Promise<void>;
  finished: Promise<void>;
  sequence: number;
  cancelled: boolean;
  state: 'queued' | 'running' | 'cancelling';
  timer?: ReturnType<typeof setInterval>;
  native?: GenerationExecution;
  terminal?: TerminalOutcome;
  speeds?: GenerationSpeeds;
  thinkingStarted?: number;
  thinkingMs?: number;
  failure?: TerminalOutcome;
}
const stopped: TerminalOutcome = { status: 'interrupted', reason: 'SESSION_STOPPED' };
/** Utility-owned joining of durable attempts, one finite queue and caller-bound execution.
 * No URL, credential, SQL, model switch or caller authority arrives from renderer data.
 */
export class GenerationService {
  private readonly deps: ServiceDependencies;
  private readonly admission: GenerationAdmission<ExecutionIdentity>;
  private readonly api: ApiGeneration;
  private readonly entries = new Map<string, Entry>();
  private readonly preparing = new Map<
    string,
    { caller: string; abort: AbortController; done: Promise<void> }
  >();
  private readonly deleting = new Set<string>();
  private readonly deletions = new Set<Promise<void>>();
  private readonly preparations = new Set<Promise<RequestIdentity>>();
  private readonly observers = new Set<(event: ProgressEvent) => boolean>();
  private readonly shutdown = new AbortController();
  private closing: Promise<void> | undefined;
  private cleanup: Promise<void> | undefined;
  constructor(deps: ServiceDependencies) {
    decodeRequestIdentity({
      ...deps.session,
      requestId: 'check',
      attemptId: 'check',
      callerId: 'check',
      conversationId: 'check',
    });
    if (deps.provenance.configuration.slots !== 4) throw new Error('NEEDS_RESOURCE_EVIDENCE');
    this.deps = {
      ...deps,
      session: Object.freeze({ ...deps.session }),
      provenance: structuredClone(deps.provenance),
    };
    this.admission = new GenerationAdmission<ExecutionIdentity>(this.deps.session, {
      start: (identity) => this.start(identity),
    });
    this.api = new ApiGeneration(
      this.deps,
      this.admission,
      () =>
        this.shutdown.signal.aborted
          ? 'NOT_READY'
          : this.preparing.size + this.entries.size + this.api.pending >= 12
            ? 'QUEUE_FULL'
            : null,
      (messages, signal, settings) =>
        this.count(messages, AbortSignal.any([signal, this.shutdown.signal]), settings),
      () => {
        this.shutdown.abort();
        return this.cleanupOwned();
      },
    );
  }
  generateApi(
    caller: ApiCaller,
    input: ApiGenerationInput,
    progress: (chunk: GenerationChunk) => void | Promise<void>,
  ): ApiGenerationHandle {
    return this.api.generate(caller, input, progress);
  }
  send(caller: string, input: SendInput): Promise<RequestIdentity> {
    return this.track(this.prepare(caller, input));
  }
  retry(caller: string, attemptId: string): Promise<RequestIdentity> {
    return this.track(
      Promise.resolve().then(async () => {
        // Resolve solely through owned local history. The renderer cannot supply original text or session.
        if (this.shutdown.signal.aborted) throw new Error('NOT_READY');
        const source = await this.deps.history.retrySource(attemptId);
        return this.prepare(
          caller,
          { conversationId: source.conversationId, text: source.text },
          { attemptId, turnId: source.turnId, settings: source.settings },
        );
      }),
    );
  }
  private track(pending: Promise<RequestIdentity>): Promise<RequestIdentity> {
    this.preparations.add(pending);
    void pending.then(
      () => this.preparations.delete(pending),
      () => this.preparations.delete(pending),
    );
    return pending;
  }
  private async prepare(
    caller: string,
    input: SendInput,
    retry?: { attemptId: string; turnId: string; settings: ResolvedRequestSettings | null },
  ): Promise<RequestIdentity> {
    if (this.shutdown.signal.aborted) throw new Error('NOT_READY');
    const decoded = decodeSend(input),
      identity = decodeRequestIdentity({
        ...this.deps.session,
        callerId: caller,
        conversationId: decoded.conversationId,
        requestId: randomUUID(),
        attemptId: randomUUID(),
      });
    if (
      this.deleting.has(identity.conversationId) ||
      this.preparing.has(identity.conversationId) ||
      [...this.entries.values()].some(
        (entry) => entry.identity.conversationId === identity.conversationId,
      )
    )
      throw new Error('CONVERSATION_BUSY');
    if (this.preparing.size + this.entries.size + this.api.pending >= 12)
      throw new Error('QUEUE_FULL');
    const abort = new AbortController();
    const signal = AbortSignal.any([this.shutdown.signal, abort.signal]);
    let prepared!: () => void;
    const done = new Promise<void>((resolve) => {
      prepared = resolve;
    });
    this.preparing.set(identity.conversationId, { caller, abort, done });
    let persisted = false;
    try {
      const conversation = await this.deps.history.readConversation(identity.conversationId);
      let settings: ResolvedRequestSettings | undefined;
      if (this.deps.configuration) {
        const current = decodeResolvedRequestSettings(
          await this.deps.configuration.capture(),
          this.deps.configuration.capabilities,
        );
        if (retry && !retry.settings) throw new Error('SETTINGS_UNAVAILABLE');
        settings = retry
          ? decodeResolvedRequestSettings(retry.settings, this.deps.configuration.capabilities)
          : current;
        if (
          settings.modelId !== current.modelId ||
          settings.profileId !== current.profileId ||
          settings.contextLength !== current.contextLength ||
          settings.modelId !== this.deps.provenance.configuration.modelSha256
        )
          throw new Error('SETTINGS_UNAVAILABLE');
      }
      const context = this.context(conversation, decoded.text, retry?.turnId);
      const messages = settings?.systemPrompt
        ? Object.freeze([
            Object.freeze({ role: 'system' as const, content: settings.systemPrompt }),
            ...context,
          ])
        : context;
      const tokens = await this.count(messages, signal, settings);
      if (!Number.isSafeInteger(tokens) || tokens < 0) throw new Error('INVALID_TOKEN_COUNT');
      if (
        tokens + (settings?.parameters.max_tokens ?? GENERATION_LIMITS.maxOutputTokens) >
        this.deps.provenance.configuration.contextPerSlot
      )
        throw new Error('CONTEXT_FULL');
      if (signal.aborted) throw new Error('NOT_READY');
      if (retry)
        await this.deps.history.retry(
          retry.attemptId,
          identity.attemptId,
          identity.requestId,
          this.deps.provenance,
          settings,
        );
      else
        await this.deps.history.beginTurn({
          conversationId: identity.conversationId,
          turnId: randomUUID(),
          attemptId: identity.attemptId,
          requestId: identity.requestId,
          text: decoded.text,
          provenance: this.deps.provenance,
          ...(settings ? { settings } : {}),
        });
      persisted = true;
      if (signal.aborted) {
        await this.deps.history.finish(
          identity.attemptId,
          '',
          abort.signal.aborted && !this.shutdown.signal.aborted
            ? { status: 'cancelled', reason: 'USER_CANCELLED' }
            : stopped,
        );
        throw new Error('NOT_READY');
      }
      const entry: Entry = {
        identity,
        ...(settings ? { settings } : {}),
        messages,
        text: '',
        reasoning: '',
        checkpointBytes: 0,
        writes: Promise.resolve(),
        finished: Promise.resolve(),
        sequence: 0,
        cancelled: false,
        state: 'queued',
      };
      this.entries.set(identity.requestId, entry);
      const receipt = this.admission.submit(identity);
      if (!receipt.accepted) {
        this.entries.delete(identity.requestId);
        await this.deps.history.finish(identity.attemptId, '', {
          status: 'failed',
          reason: 'START_FAILED',
        });
        throw new Error(receipt.code);
      }
      entry.finished = receipt.done.then((result) => this.finish(entry, result));
      // The captured finalizer owns failures; no detached rejection can leak native/store details.
      void entry.finished.catch(() => undefined);
      entry.timer = setInterval(() => this.checkpoint(entry), 250);
      return identity;
    } catch (error) {
      if (persisted && this.entries.has(identity.requestId)) this.admission.close('CHANNEL_LOST');
      throw error;
    } finally {
      this.preparing.delete(identity.conversationId);
      prepared();
    }
  }
  private context(
    conversation: Conversation,
    content: string,
    retryTurn?: string,
  ): readonly ChatMessage[] {
    const messages: ChatMessage[] = [];
    for (const turn of conversation.turns) {
      if (turn.id === retryTurn) break;
      const completed = [...turn.attempts]
        .reverse()
        .find((attempt) => attempt.state === 'completed');
      if (completed) {
        messages.push(
          { role: 'user', content: turn.text },
          {
            role: 'assistant',
            content: completed.text,
            ...(completed.reasoning ? { reasoning_content: completed.reasoning } : {}),
          },
        );
      }
    }
    messages.push({ role: 'user', content });
    return Object.freeze(messages.map((message) => Object.freeze(message)));
  }
  private count(
    messages: readonly ChatMessage[],
    signal: AbortSignal,
    settings?: ResolvedRequestSettings,
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        detach();
        reject(new Error('TOKEN_COUNT_TIMEOUT'));
      }, 120000);
      const aborted = () => {
        detach();
        reject(new Error('NOT_READY'));
      };
      const detach = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', aborted);
      };
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) {
        aborted();
        return;
      }
      void Promise.resolve()
        .then(() => this.deps.transport.tokenCount(messages, signal, settings))
        .then(
          (value) => {
            detach();
            resolve(value);
          },
          () => {
            detach();
            reject(new Error('TOKEN_COUNT_FAILED'));
          },
        );
    });
  }
  private start(identity: ExecutionIdentity): GenerationExecution {
    if ('kind' in identity) return this.api.start(identity);
    const entry = this.entries.get(identity.requestId);
    if (!entry) throw new Error('INVALID_CONTROL');
    entry.state = 'running';
    const settled = (async (): Promise<TerminalOutcome> => {
      try {
        await this.deps.history.checkpoint(identity.attemptId, entry.text, 'running');
        if (entry.cancelled || this.shutdown.signal.aborted)
          return entry.cancelled ? { status: 'cancelled', reason: 'USER_CANCELLED' } : stopped;
        entry.native = this.deps.transport.start(
          identity,
          entry.messages,
          (chunk) => this.progress(entry, chunk),
          entry.settings,
        );
        const result = decodeOutcome(await entry.native.settled);
        if (result.status === 'completed' || result.status === 'limit-reached') {
          if (
            !entry.terminal ||
            entry.terminal.status !== result.status ||
            entry.terminal.reason !== result.reason
          )
            entry.failure = { status: 'failed', reason: 'INVALID_STREAM' };
        }
        return result;
      } catch {
        if (entry.native) throw new Error('EXECUTION_FAILED');
        entry.failure = { status: 'failed', reason: 'HISTORY_UNAVAILABLE' };
        return entry.failure;
      }
    })();
    return {
      settled,
      cancel: () => {
        entry.cancelled = true;
        entry.state = 'cancelling';
        this.finishThinking(entry);
        this.checkpoint(entry);
        return entry.native?.cancel();
      },
    };
  }
  private progress(entry: Entry, chunk: GenerationChunk): void {
    if (this.entries.get(entry.identity.requestId) !== entry || entry.failure) return;
    try {
      if (chunk.type === 'terminal') {
        if (
          entry.terminal ||
          Object.keys(chunk).sort().join(',') !==
            [
              'outcome',
              'type',
              ...(Object.hasOwn(chunk, 'speeds') ? ['speeds'] : []),
              ...(Object.hasOwn(chunk, 'usage') ? ['usage'] : []),
            ]
              .sort()
              .join(',')
        )
          throw new Error('INVALID_STREAM');
        if (Object.hasOwn(chunk, 'speeds')) entry.speeds = decodeSpeeds(chunk.speeds);
        if (Object.hasOwn(chunk, 'usage')) decodeUsage(chunk.usage);
        entry.terminal = decodeOutcome(chunk.outcome);
        this.finishThinking(entry);
        return;
      }
      if (
        (chunk.type !== 'text' && chunk.type !== 'reasoning') ||
        Object.keys(chunk).sort().join(',') !== 'text,type' ||
        typeof chunk.text !== 'string' ||
        entry.terminal ||
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(chunk.text)
      )
        throw new Error('INVALID_STREAM');
      if (
        Buffer.byteLength(entry.text) +
          Buffer.byteLength(entry.reasoning) +
          Buffer.byteLength(chunk.text) >
        GENERATION_LIMITS.maxResponseBytes
      ) {
        entry.failure = { status: 'failed', reason: 'RESPONSE_TOO_LARGE' };
        throw new Error('RESPONSE_TOO_LARGE');
      }
      let thinkingFinished = false;
      if (chunk.type === 'reasoning') {
        if (chunk.text && entry.thinkingStarted === undefined)
          entry.thinkingStarted = performance.now();
        entry.reasoning += chunk.text;
      } else {
        if (chunk.text) thinkingFinished = this.finishThinking(entry);
        entry.text += chunk.text;
      }
      this.publishText(entry, chunk.type, chunk.text);
      if (
        thinkingFinished ||
        Buffer.byteLength(entry.text) +
          Buffer.byteLength(entry.reasoning) -
          entry.checkpointBytes >=
          32768
      )
        this.checkpoint(entry);
    } catch {
      entry.failure ??= { status: 'failed', reason: 'INVALID_STREAM' };
      this.admission.cancel(entry.identity.callerId, entry.identity.requestId);
    }
  }
  /** Observe only the thinking phase: exclude queue/prefill, later answer output and cleanup. */
  private finishThinking(entry: Entry): boolean {
    if (entry.thinkingStarted === undefined || entry.thinkingMs !== undefined) return false;
    entry.thinkingMs = Math.max(0, Math.floor(performance.now() - entry.thinkingStarted));
    return true;
  }
  private checkpoint(entry: Entry): void {
    if (
      entry.checkpointBytes ===
        Buffer.byteLength(entry.text) + Buffer.byteLength(entry.reasoning) &&
      entry.state === 'running'
    )
      return;
    const content = entry.text,
      reasoning = entry.reasoning,
      thinkingMs = entry.thinkingMs,
      state = entry.state;
    entry.checkpointBytes = Buffer.byteLength(content) + Buffer.byteLength(reasoning);
    entry.writes = entry.writes
      .then(() =>
        this.deps.history.checkpoint(
          entry.identity.attemptId,
          content,
          state,
          reasoning,
          thinkingMs,
        ),
      )
      .catch(() => {
        entry.failure = { status: 'failed', reason: 'HISTORY_UNAVAILABLE' };
        this.shutdown.abort();
        this.admission.close('CHANNEL_LOST');
      });
  }
  private async finish(entry: Entry, result: TerminalOutcome): Promise<void> {
    this.finishThinking(entry);
    if (this.admission.requiresCleanup) this.shutdown.abort();
    if (entry.timer) clearInterval(entry.timer);
    try {
      await entry.writes;
      const terminal =
        result.status === 'failed' && result.reason === 'CANCEL_UNCONFIRMED'
          ? result
          : (entry.failure ?? result);
      const speeds =
        terminal.status === 'completed' || terminal.status === 'limit-reached'
          ? entry.speeds
          : undefined;
      await this.deps.history.finish(
        entry.identity.attemptId,
        entry.text,
        terminal,
        entry.reasoning,
        speeds,
        entry.thinkingMs,
      );
      this.publish({
        ...entry.identity,
        sequence: ++entry.sequence,
        type: 'terminal',
        outcome: terminal,
        ...(speeds ? { speeds } : {}),
      });
    } catch {
      this.shutdown.abort();
      this.admission.close('CHANNEL_LOST');
      await this.cleanupOwned();
    } finally {
      this.entries.delete(entry.identity.requestId);
      if (this.admission.requiresCleanup) await this.cleanupOwned();
    }
  }
  cancel(caller: string, requestId: string): Promise<void> {
    return Promise.resolve().then(() => {
      const entry = this.entries.get(requestId);
      if (!entry || entry.identity.callerId !== caller) throw new Error('DENIED');
      if (this.admission.cancel(caller, requestId) === 'denied') throw new Error('DENIED');
    });
  }
  /** Stop also owns preparation before a request ID is returned; idle Stop is harmless. */
  async cancelConversation(caller: string, conversationId: string): Promise<void> {
    const preparing = this.preparing.get(conversationId);
    const entries = [...this.entries.values()].filter(
      (entry) => entry.identity.conversationId === conversationId,
    );
    if (
      (preparing && preparing.caller !== caller) ||
      entries.some((entry) => entry.identity.callerId !== caller)
    )
      throw new Error('DENIED');
    preparing?.abort.abort();
    for (const entry of entries) this.admission.cancel(caller, entry.identity.requestId);
    await preparing?.done;
  }
  /** Close this chat's admission before cancellation; delete only after durable native settlement. */
  deleteConversation(caller: string, conversationId: string): Promise<void> {
    const deletion = this.removeConversation(caller, conversationId);
    this.deletions.add(deletion);
    void deletion.then(
      () => this.deletions.delete(deletion),
      () => this.deletions.delete(deletion),
    );
    return deletion;
  }
  private async removeConversation(caller: string, conversationId: string): Promise<void> {
    if (this.deleting.has(conversationId)) throw new Error('CONVERSATION_BUSY');
    const preparing = this.preparing.get(conversationId);
    const entries = [...this.entries.values()].filter(
      (entry) => entry.identity.conversationId === conversationId,
    );
    if (
      (preparing && preparing.caller !== caller) ||
      entries.some((entry) => entry.identity.callerId !== caller)
    )
      throw new Error('DENIED');
    this.deleting.add(conversationId);
    try {
      preparing?.abort.abort();
      await preparing?.done;
      for (const entry of entries) this.admission.cancel(caller, entry.identity.requestId);
      await Promise.all(entries.map((entry) => entry.finished));
      if (this.admission.requiresCleanup) throw new Error('NOT_READY');
      await this.deps.history.deleteConversation(conversationId);
    } finally {
      this.deleting.delete(conversationId);
    }
  }
  /** Return false on observer loss/backpressure: subscription is removed, no buffer/replay. */
  subscribe(listener: (event: ProgressEvent) => boolean): () => void {
    if (this.observers.size >= 4 || this.shutdown.signal.aborted)
      throw new Error('OBSERVER_UNAVAILABLE');
    this.observers.add(listener);
    return () => this.observers.delete(listener);
  }
  private publish(event: ProgressEvent): void {
    for (const observer of this.observers) {
      try {
        if (!observer(structuredClone(event))) this.observers.delete(observer);
      } catch {
        this.observers.delete(observer);
      }
    }
  }
  private publishText(entry: Entry, type: 'text' | 'reasoning', content: string): void {
    // JSON escaping can expand a control character sixfold; 4,000 code units reserve envelope room.
    for (let offset = 0; offset < content.length;) {
      let end = Math.min(offset + 4000, content.length);
      if (end < content.length && /[\uD800-\uDBFF]/u.test(content.charAt(end - 1))) end--;
      const event: ProgressEvent = {
        ...entry.identity,
        sequence: ++entry.sequence,
        type,
        text: content.slice(offset, end),
      };
      if (Buffer.byteLength(JSON.stringify(event)) > GENERATION_LIMITS.maxEventBytes)
        throw new Error('INVALID_STREAM');
      this.publish(event);
      offset = end;
    }
  }
  private cleanupOwned(): Promise<void> {
    this.cleanup ??= this.deps.cleanup();
    return this.cleanup;
  }
  close(): Promise<void> {
    if (!this.closing) {
      this.shutdown.abort();
      this.admission.close('SESSION_STOPPED');
      const apiClosed = this.api.close();
      this.closing = Promise.allSettled([...this.preparations]).then(async () => {
        await Promise.all([...this.entries.values()].map((entry) => entry.finished));
        await Promise.allSettled([...this.deletions]);
        await apiClosed;
      });
      this.observers.clear();
    }
    return this.closing;
  }
}
