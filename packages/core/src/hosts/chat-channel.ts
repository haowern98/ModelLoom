import type { ChatTransport } from '../generation/service.js';
import { decodeResolvedRequestSettings } from '../model-configuration/contracts.js';
import type { Selection } from '../runtime/contracts.js';
import type { GenerationExecution } from '../generation/admission.js';
import type { GenerationChunk, TerminalOutcome } from '../generation/contracts.js';
import {
  decodeOutcome,
  decodeExecutionIdentity,
  decodeGenerationChunk,
  GENERATION_POLICY,
} from '../generation/contracts.js';
import { decodeObject, exact } from './control.js';
import { selectionKey, selectionFrom } from './broker-protocol.js';
function object(input: unknown): Record<string, unknown> {
  return decodeObject(JSON.stringify(input));
}
function operation(value: Record<string, unknown>): number {
  if (typeof value.id !== 'number' || !Number.isSafeInteger(value.id) || value.id < 1)
    throw new Error('INVALID_CONTROL');
  return value.id;
}
function checkedMessages(input: unknown): Parameters<ChatTransport['tokenCount']>[0] {
  if (!Array.isArray(input) || !input.length) throw new Error('INVALID_CONTROL');
  return input.map((item: unknown) => {
    const value = object(item);
    exact(value, [
      'role',
      'content',
      ...(value.reasoning_content === undefined ? [] : ['reasoning_content']),
    ]);
    if (
      (value.role !== 'user' && value.role !== 'assistant' && value.role !== 'system') ||
      typeof value.content !== 'string' ||
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
        value.content,
      ) ||
      (value.reasoning_content !== undefined &&
        (value.role !== 'assistant' ||
          typeof value.reasoning_content !== 'string' ||
          /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
            value.reasoning_content,
          )))
    )
      throw new Error('INVALID_CONTROL');
    return {
      role: value.role,
      content: value.content,
      ...(value.reasoning_content === undefined
        ? {}
        : { reasoning_content: value.reasoning_content }),
    };
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}
interface OwnerEntry {
  abort: AbortController;
  execution?: GenerationExecution;
  sequence: number;
  ack?: {
    sequence: number;
    done: ReturnType<typeof deferred<void>>;
    timer: ReturnType<typeof setTimeout>;
  };
}
/** Owner-private inherited channel. One acknowledged chunk per execution provides backpressure;
 * only captured transport settlement can emit a native completion receipt.
 */
export class OwnerChatChannel {
  private readonly entries = new Map<number, OwnerEntry>();
  private last = 0;
  private closed = false;
  constructor(
    private readonly send: (value: unknown) => void,
    private readonly capture: () => { selection: Selection; transport: ChatTransport },
    private readonly cleanup: () => void,
  ) {}
  async receive(input: unknown): Promise<void> {
    try {
      const value = object(input),
        id = operation(value);
      if (this.closed || value.type !== 'generation') throw new Error('INVALID_CONTROL');
      if (value.action === 'cancel' || value.action === 'ack') {
        exact(
          value,
          value.action === 'ack' ? ['type', 'action', 'id', 'sequence'] : ['type', 'action', 'id'],
        );
        const entry = this.entries.get(id);
        if (!entry) return; // Late cancellation cannot address a reused monotonic operation.
        if (value.action === 'cancel') {
          entry.abort.abort();
          await entry.execution?.cancel();
        } else {
          if (!entry.ack || value.sequence !== entry.ack.sequence)
            throw new Error('INVALID_CONTROL');
          clearTimeout(entry.ack.timer);
          entry.ack.done.resolve();
          delete entry.ack;
        }
        return;
      }
      if (value.action !== 'count' && value.action !== 'start') throw new Error('INVALID_CONTROL');
      exact(value, [
        'type',
        'action',
        'id',
        'selection',
        'messages',
        ...(Object.hasOwn(value, 'settings') ? ['settings'] : []),
        ...(value.action === 'start' ? ['identity'] : []),
      ]);
      if (id <= this.last || this.entries.size >= 12) throw new Error('INVALID_CONTROL');
      this.last = id;
      const captured = this.capture();
      const selected = selectionFrom(value.selection, captured.selection);
      if (selectionKey(selected) !== selectionKey(captured.selection))
        throw new Error('INVALID_CONTROL');
      const messages = checkedMessages(value.messages);
      const settings = Object.hasOwn(value, 'settings')
        ? decodeResolvedRequestSettings(value.settings)
        : undefined;
      const entry: OwnerEntry = { abort: new AbortController(), sequence: 0 };
      this.entries.set(id, entry);
      const result = (extra: Record<string, unknown>) => {
        if (!this.closed) this.send({ type: 'generation-result', id, ...extra });
      };
      if (value.action === 'count') {
        void captured.transport
          .tokenCount(messages, entry.abort.signal, settings)
          .then(
            (tokens) => result({ result: 'count', tokens }),
            () => result({ result: 'failed' }),
          )
          .finally(() => this.entries.delete(id))
          .catch(() => this.cleanup());
      } else {
        const identity = decodeExecutionIdentity(value.identity);
        if (
          identity.deploymentId !== selected.deploymentId ||
          identity.sessionId !== selected.sessionId ||
          identity.operationId !== selected.operationId
        )
          throw new Error('INVALID_CONTROL');
        const publish = (chunk: GenerationChunk) => {
          if (this.closed || entry.ack) throw new Error('CHANNEL_LOST');
          const sequence = ++entry.sequence,
            done = deferred<void>();
          const timer = setTimeout(() => {
            done.reject(new Error('CHANNEL_LOST'));
            this.cleanup();
          }, 5000);
          entry.ack = { sequence, done, timer };
          result({ result: 'chunk', sequence, chunk });
          return done.promise;
        };
        entry.execution = captured.transport.start(
          identity,
          messages,
          async (chunk) => {
            if (chunk.type === 'terminal') {
              await publish(chunk);
              return;
            }
            // Reserve envelope space for JSON escaping and captured identities in the utility.
            for (let offset = 0; offset < chunk.text.length;) {
              let end = Math.min(offset + 4000, chunk.text.length);
              if (end < chunk.text.length && /[\uD800-\uDBFF]/u.test(chunk.text.charAt(end - 1)))
                end--;
              await publish({ type: chunk.type, text: chunk.text.slice(offset, end) });
              offset = end;
            }
          },
          settings,
        );
        void entry.execution.settled
          .then(
            (outcome) => result({ result: 'settled', outcome: decodeOutcome(outcome) }),
            () => result({ result: 'failed' }),
          )
          .finally(() => {
            if (entry.ack) {
              clearTimeout(entry.ack.timer);
              entry.ack.done.reject(new Error('CHANNEL_LOST'));
            }
            this.entries.delete(id);
          })
          .catch(() => this.cleanup());
      }
    } catch {
      this.close();
      this.cleanup();
      throw new Error('INVALID_CONTROL');
    }
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.entries.values()) {
      entry.abort.abort();
      if (entry.ack) {
        clearTimeout(entry.ack.timer);
        entry.ack.done.reject(new Error('CHANNEL_LOST'));
      }
      try {
        const cancelled = entry.execution?.cancel();
        if (cancelled) void cancelled.catch(() => this.cleanup());
      } catch {
        this.cleanup();
      }
    }
    this.entries.clear();
  }
}
interface RemoteEntry {
  kind: 'count' | 'start';
  count?: ReturnType<typeof deferred<number>>;
  settled?: ReturnType<typeof deferred<TerminalOutcome>>;
  progress?: Parameters<ChatTransport['start']>[2];
  identity?: Parameters<ChatTransport['start']>[0];
  sequence: number;
  dispose?: () => void;
}
/** Utility capability has no native settings/endpoint; responses are correlated and acknowledged. */
export class UtilityChatTransport implements ChatTransport {
  private next = 0;
  private closed = false;
  private readonly entries = new Map<number, RemoteEntry>();
  constructor(
    private readonly selection: Selection,
    private readonly send: (value: unknown) => void,
    private readonly allocate: () => number = () => ++this.next,
  ) {}
  tokenCount: ChatTransport['tokenCount'] = (messages, signal, settings) => {
    if (this.closed || signal.aborted || this.entries.size >= 12)
      return Promise.reject(new Error('TOKEN_COUNT_FAILED'));
    const id = this.allocate(),
      count = deferred<number>();
    const abort = () => {
      this.send({ type: 'generation', action: 'cancel', id });
      count.reject(new Error('TOKEN_COUNT_FAILED'));
      this.entries.delete(id);
    };
    const timer = setTimeout(abort, GENERATION_POLICY.generationMs + 1000);
    signal.addEventListener('abort', abort, { once: true });
    this.entries.set(id, {
      kind: 'count',
      count,
      sequence: 0,
      dispose: () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      },
    });
    this.send({
      type: 'generation',
      action: 'count',
      id,
      selection: this.selection,
      messages,
      ...(settings ? { settings: decodeResolvedRequestSettings(settings) } : {}),
    });
    return count.promise.finally(() => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    });
  };
  start: ChatTransport['start'] = (identity, messages, progress, settings) => {
    if (this.closed || this.entries.size >= 12) throw new Error('NOT_READY');
    const id = this.allocate(),
      settled = deferred<TerminalOutcome>();
    this.entries.set(id, {
      kind: 'start',
      identity: decodeExecutionIdentity(identity),
      progress,
      settled,
      sequence: 0,
    });
    this.send({
      type: 'generation',
      action: 'start',
      id,
      selection: this.selection,
      identity,
      messages,
      ...(settings ? { settings: decodeResolvedRequestSettings(settings) } : {}),
    });
    return {
      settled: settled.promise,
      cancel: () => {
        this.send({ type: 'generation', action: 'cancel', id });
      },
    };
  };
  receive(input: unknown): void {
    try {
      const value = object(input),
        id = operation(value);
      if (value.type !== 'generation-result') throw new Error('INVALID_CONTROL');
      const entry = this.entries.get(id);
      if (!entry) return;
      if (value.result === 'chunk') {
        exact(value, ['type', 'id', 'result', 'sequence', 'chunk']);
        if (entry.kind !== 'start' || !entry.identity || value.sequence !== entry.sequence + 1)
          throw new Error('INVALID_CONTROL');
        const projected = object(value.chunk);
        exact(
          projected,
          projected.type === 'terminal'
            ? [
                'type',
                'outcome',
                ...(Object.hasOwn(projected, 'speeds') ? ['speeds'] : []),
                ...(Object.hasOwn(projected, 'usage') ? ['usage'] : []),
              ]
            : ['type', 'text'],
        );
        const chunk = decodeGenerationChunk(projected);
        entry.sequence++;
        void Promise.resolve(entry.progress?.(chunk)).then(
          () => this.send({ type: 'generation', action: 'ack', id, sequence: value.sequence }),
          () => this.close(),
        );
        return;
      }
      if (value.result === 'count') {
        exact(value, ['type', 'id', 'result', 'tokens']);
        if (
          entry.kind !== 'count' ||
          typeof value.tokens !== 'number' ||
          !Number.isSafeInteger(value.tokens) ||
          value.tokens < 0
        )
          throw new Error('INVALID_CONTROL');
        entry.count?.resolve(value.tokens);
      } else if (value.result === 'settled') {
        exact(value, ['type', 'id', 'result', 'outcome']);
        if (entry.kind !== 'start') throw new Error('INVALID_CONTROL');
        entry.settled?.resolve(decodeOutcome(value.outcome));
      } else if (value.result === 'failed') {
        exact(value, ['type', 'id', 'result']);
        entry.count?.reject(new Error('TOKEN_COUNT_FAILED'));
        entry.settled?.reject(new Error('EXECUTION_FAILED'));
      } else throw new Error('INVALID_CONTROL');
      entry.dispose?.();
      this.entries.delete(id);
    } catch {
      this.close();
    }
  }
  close(): void {
    this.dispose(false);
  }
  /** Only the validated main-owned exit event may settle this captured engine's pending work. */
  engineExited(selection: Selection): void {
    if (selectionKey(selection) !== selectionKey(this.selection)) return;
    this.dispose(true);
  }
  private dispose(engineExited: boolean): void {
    this.closed = true;
    for (const entry of this.entries.values()) {
      entry.dispose?.();
      entry.count?.reject(new Error('TOKEN_COUNT_FAILED'));
      if (engineExited) entry.settled?.resolve({ status: 'interrupted', reason: 'ENGINE_EXITED' });
      else entry.settled?.reject(new Error('EXECUTION_FAILED'));
    }
    this.entries.clear();
  }
}
