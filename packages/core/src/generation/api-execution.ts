import { randomUUID } from 'node:crypto';
import { fitContext } from './context-overflow.js';
import { requireApiCaller } from './api-authority.js';
import type { ApiCaller } from './api-authority.js';
import { decodeExecutionIdentity, decodeGenerationChunk, GENERATION_LIMITS } from './contracts.js';
import type {
  ApiRequestIdentity,
  ExecutionIdentity,
  GenerationChunk,
  GenerationUsage,
  TerminalOutcome,
} from './contracts.js';
import type { GenerationAdmission, GenerationExecution } from './admission.js';
import type { ChatMessage, ServiceDependencies } from './service.js';
import {
  decodeGenerationOverrides,
  decodeResolvedRequestSettings,
} from '../model-configuration/contracts.js';
import type {
  GenerationOverrides,
  ResolvedRequestSettings,
} from '../model-configuration/contracts.js';

export interface ApiGenerationInput {
  readonly messages: readonly ChatMessage[];
  readonly overrides: GenerationOverrides;
}
export interface ApiGenerationResult {
  readonly outcome: TerminalOutcome;
  readonly text: string;
  readonly reasoning: string;
  readonly usage?: GenerationUsage;
  readonly recoveryRequired?: true;
}
export interface ApiGenerationHandle {
  readonly admitted: Promise<void>;
  readonly done: Promise<ApiGenerationResult>;
  cancel(): void;
}
interface Entry {
  admit(): void;
  rejectAdmission(error: Error): void;
  readonly caller: ApiCaller;
  readonly identity: ApiRequestIdentity;
  readonly abort: AbortController;
  readonly publish: (chunk: GenerationChunk) => void | Promise<void>;
  done: Promise<ApiGenerationResult>;
  settings?: ResolvedRequestSettings;
  messages?: readonly ChatMessage[];
  terminal?: Extract<GenerationChunk, { type: 'terminal' }>;
  failure?: TerminalOutcome;
  text: string;
  reasoning: string;
  publishing: boolean;
}
/** Stateless preparation/execution over the service's one admission queue and captured transport. */
export class ApiGeneration {
  private readonly entries = new Map<string, Entry>();
  private closed = false;
  constructor(
    private readonly deps: ServiceDependencies,
    private readonly admission: GenerationAdmission<ExecutionIdentity>,
    private readonly available: () => 'NOT_READY' | 'QUEUE_FULL' | null,
    private readonly count: (
      messages: readonly ChatMessage[],
      signal: AbortSignal,
      settings: ResolvedRequestSettings,
    ) => Promise<number>,
    private readonly unsafe: () => Promise<void>,
  ) {}
  get pending(): number {
    return this.entries.size;
  }
  generate(
    caller: ApiCaller,
    input: ApiGenerationInput,
    publish: (chunk: GenerationChunk) => void | Promise<void>,
  ): ApiGenerationHandle {
    try {
      const callerId = requireApiCaller(caller);
      if (this.closed || !this.deps.configuration) throw new Error('NOT_READY');
      const unavailable = this.available();
      if (unavailable) throw new Error(unavailable);
      const decoded = decodeExecutionIdentity({
        ...this.deps.session,
        kind: 'api',
        callerId,
        requestId: randomUUID(),
      });
      if (!('kind' in decoded)) throw new Error('INVALID_CONTROL');
      let admit!: () => void, rejectAdmission!: (error: Error) => void;
      const admitted = new Promise<void>((yes, no) => {
        admit = yes;
        rejectAdmission = no;
      });
      void admitted.catch(() => undefined);
      const entry: Entry = {
        admit,
        rejectAdmission,
        caller,
        identity: decoded,
        abort: new AbortController(),
        publish,
        done: Promise.resolve({
          outcome: { status: 'failed', reason: 'START_FAILED' },
          text: '',
          reasoning: '',
        }),
        text: '',
        reasoning: '',
        publishing: false,
      };
      this.entries.set(decoded.requestId, entry);
      entry.done = Promise.resolve()
        .then(() => this.prepare(entry, input))
        .catch((error: unknown) => {
          const safe = error instanceof Error ? error : new Error('INVALID_CONTROL');
          entry.rejectAdmission(safe);
          throw safe;
        })
        .finally(() => this.entries.delete(decoded.requestId));
      void entry.done.catch(() => undefined);
      return { admitted, done: entry.done, cancel: () => this.cancel(entry) };
    } catch (error) {
      const done = Promise.reject<ApiGenerationResult>(
        error instanceof Error ? error : new Error('INVALID_CONTROL'),
      );
      void done.catch(() => undefined);
      const admitted = done.then(() => undefined);
      void admitted.catch(() => undefined);
      return { admitted, done, cancel: () => {} };
    }
  }
  private async prepare(entry: Entry, input: ApiGenerationInput): Promise<ApiGenerationResult> {
    const configuration = this.deps.configuration;
    if (!configuration) throw new Error('NOT_READY');
    if (!input || Object.keys(input).sort().join(',') !== 'messages,overrides')
      throw new Error('INVALID_CONTROL');
    const messages = decodeApiMessages(input.messages);
    const overrides = decodeGenerationOverrides(input.overrides, configuration.capabilities);
    const settings = decodeResolvedRequestSettings(
      await configuration.capture(overrides),
      configuration.capabilities,
    );
    if (
      settings.modelId !== this.deps.provenance.configuration.modelSha256 ||
      settings.contextLength !== this.deps.provenance.configuration.contextPerSlot
    )
      throw new Error('NOT_READY');
    entry.settings = settings;
    entry.messages = Object.freeze(
      settings.systemPrompt && messages[0]?.role !== 'system'
        ? [Object.freeze({ role: 'system' as const, content: settings.systemPrompt }), ...messages]
        : messages,
    );
    requireApiCaller(entry.caller);
    if (entry.abort.signal.aborted || this.closed) throw new Error('NOT_READY');
    const outputLimit = settings.parameters.max_tokens;
    const policy = settings.overflow ?? 'stop';
    entry.messages = await fitContext(
      entry.messages,
      policy,
      settings.contextLength,
      policy === 'stop' ? (outputLimit === -1 ? 1 : outputLimit) : 4,
      (candidate) => this.count(candidate, entry.abort.signal, settings),
      entry.abort.signal,
    );
    requireApiCaller(entry.caller);
    if (entry.abort.signal.aborted || this.closed) throw new Error('NOT_READY');
    const receipt = this.admission.submit(entry.identity);
    if (!receipt.accepted) throw new Error(receipt.code);
    entry.admit();
    const result = await receipt.done;
    if (this.admission.requiresCleanup) await this.unsafe();
    const outcome = result.reason === 'CANCEL_UNCONFIRMED' ? result : (entry.failure ?? result);
    return Object.freeze({
      outcome,
      text: entry.text,
      reasoning: entry.reasoning,
      ...(entry.terminal?.usage ? { usage: entry.terminal.usage } : {}),
      ...(this.admission.requiresCleanup ? { recoveryRequired: true as const } : {}),
    });
  }
  start(identity: ApiRequestIdentity): GenerationExecution {
    const entry = this.entries.get(identity.requestId);
    if (!entry || !entry.settings || !entry.messages || entry.abort.signal.aborted || this.closed)
      throw new Error('NOT_READY');
    requireApiCaller(entry.caller); // Revocation is rechecked immediately before native dispatch.
    const native = this.deps.transport.start(
      identity,
      entry.messages,
      async (input) => {
        try {
          const chunk = decodeGenerationChunk(input);
          if (entry.terminal || entry.publishing) throw new Error('INVALID_STREAM');
          if (chunk.type === 'terminal') {
            if (
              (chunk.outcome.status === 'completed' || chunk.outcome.status === 'limit-reached') &&
              (!chunk.usage ||
                (entry.settings!.parameters.max_tokens !== -1 &&
                  chunk.usage.completion_tokens > entry.settings!.parameters.max_tokens) ||
                ((entry.settings!.overflow ?? 'stop') === 'stop' &&
                  chunk.usage.total_tokens > entry.settings!.contextLength))
            )
              throw new Error('INVALID_STREAM');
            entry.terminal = chunk;
            return;
          }
          if (entry.abort.signal.aborted) return;
          if (chunk.type === 'metrics') return;
          if (
            Buffer.byteLength(entry.text) +
              Buffer.byteLength(entry.reasoning) +
              Buffer.byteLength(chunk.text) >
            GENERATION_LIMITS.maxResponseBytes
          )
            throw new Error('RESPONSE_TOO_LARGE');
          if (chunk.type === 'text') entry.text += chunk.text;
          else entry.reasoning += chunk.text;
          entry.publishing = true;
          try {
            await entry.publish(chunk);
          } catch {
            // A public writer failure must not close the private channel carrying native settlement.
            this.cancel(entry);
          } finally {
            entry.publishing = false;
          }
        } catch {
          entry.failure = { status: 'failed', reason: 'INVALID_STREAM' };
          this.cancel(entry);
          throw new Error('INVALID_STREAM');
        }
      },
      entry.settings,
    );
    return {
      cancel: () => native.cancel(),
      settled: native.settled.then((result) => {
        if (
          (result.status === 'completed' || result.status === 'limit-reached') &&
          (!entry.terminal ||
            entry.terminal.outcome.status !== result.status ||
            entry.terminal.outcome.reason !== result.reason)
        )
          entry.failure = { status: 'failed', reason: 'INVALID_STREAM' };
        return result;
      }),
    };
  }
  private cancel(entry: Entry): void {
    entry.abort.abort();
    this.admission.cancel(entry.identity.callerId, entry.identity.requestId);
  }
  close(): Promise<void> {
    this.closed = true;
    for (const entry of this.entries.values()) this.cancel(entry);
    return Promise.allSettled([...this.entries.values()].map((entry) => entry.done)).then(
      () => undefined,
    );
  }
}

/** Closed text-only public message contract; no tool, image, path or reasoning injection. */
export function decodeApiMessages(input: unknown): readonly ChatMessage[] {
  if (!Array.isArray(input) || !input.length || input.length > 256)
    throw new Error('INVALID_CONTROL');
  let size = 0;
  const messages = input.map((item: unknown, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new Error('INVALID_CONTROL');
    const value = item as Record<string, unknown>;
    if (
      Object.keys(value).sort().join(',') !== 'content,role' ||
      (value.role !== 'system' && value.role !== 'user' && value.role !== 'assistant') ||
      (value.role === 'system' && index !== 0) ||
      typeof value.content !== 'string' ||
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value.content)
    )
      throw new Error('INVALID_CONTROL');
    size += value.content.length;
    return Object.freeze({ role: value.role, content: value.content });
  });
  if (
    size > GENERATION_LIMITS.maxInputCodeUnits ||
    messages.at(-1)?.role !== 'user' ||
    !messages.at(-1)?.content.trim()
  )
    throw new Error('INVALID_CONTROL');
  return Object.freeze(messages);
}
