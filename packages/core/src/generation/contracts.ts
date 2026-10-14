import type { Identity } from '../runtime/contracts.js';
import { MAX_CONTROL_BYTES } from '../runtime/contracts.js';

/** ADR-0005 development bounds; none establishes actual native slot capacity. */
export const GENERATION_LIMITS = Object.freeze({
  maxInputCodeUnits: 12_000,
  maxEventBytes: 64 * 1024,
  maxResponseBytes: 1024 * 1024,
  maxOutputTokens: 512,
  maxConversationBytes: 8 * 1024 * 1024,
  maxHistoryBytes: 256 * 1024 * 1024,
});
export const GENERATION_POLICY = Object.freeze({
  activeLimit: 4,
  pendingLimit: 8,
  queueMs: 120_000,
  generationMs: 300_000,
  cancellationMs: 5_000,
});
export type GenerationPolicy = typeof GENERATION_POLICY;

/** Constructed by trusted core/host code, never supplied as renderer authority. */
export interface RequestIdentity extends Identity {
  readonly requestId: string;
  readonly callerId: string;
  readonly conversationId: string;
  readonly attemptId: string;
}
/** Stateless native execution. No conversation or durable attempt is invented for HTTP. */
export interface ApiRequestIdentity extends Identity {
  readonly kind: 'api';
  readonly requestId: string;
  readonly callerId: string;
}
export type ExecutionIdentity = RequestIdentity | ApiRequestIdentity;

/** Internal data hygiene only; caller authority is separately captured by the service. */
export function decodeExecutionIdentity(input: unknown): ExecutionIdentity {
  return safely(() => {
    const value = object(input);
    if (value.kind !== 'api') return decodeRequestIdentity(input);
    exact(value, ['kind', 'deploymentId', 'sessionId', 'operationId', 'requestId', 'callerId']);
    return Object.freeze({
      kind: 'api',
      deploymentId: identifier(value.deploymentId),
      sessionId: identifier(value.sessionId),
      operationId: identifier(value.operationId),
      requestId: identifier(value.requestId),
      callerId: identifier(value.callerId),
    });
  });
}

/** Validate a private chunk without projecting a stateless identity into Chat events. */
export function decodeGenerationChunk(input: unknown): GenerationChunk {
  return safely(() => {
    const value = object(input);
    if (value.type === 'text' || value.type === 'reasoning') {
      exact(value, ['type', 'text']);
      return Object.freeze({ type: value.type, text: unicode(value.text) });
    }
    if (value.type !== 'terminal') return invalid();
    exact(value, [
      'type',
      'outcome',
      ...(Object.hasOwn(value, 'speeds') ? ['speeds'] : []),
      ...(Object.hasOwn(value, 'usage') ? ['usage'] : []),
    ]);
    return Object.freeze({
      type: 'terminal',
      outcome: decodeOutcome(value.outcome),
      ...(Object.hasOwn(value, 'speeds') ? { speeds: decodeSpeeds(value.speeds) } : {}),
      ...(Object.hasOwn(value, 'usage') ? { usage: decodeUsage(value.usage) } : {}),
    });
  });
}
export interface SendInput {
  readonly conversationId: string;
  readonly text: string;
}
export type InterruptionReason = 'SESSION_STOPPED' | 'ENGINE_EXITED' | 'CHANNEL_LOST';
export type FailureReason =
  | 'QUEUE_TIMEOUT'
  | 'GENERATION_TIMEOUT'
  | 'CANCEL_UNCONFIRMED'
  | 'START_FAILED'
  | 'EXECUTION_FAILED'
  | 'INVALID_STREAM'
  | 'RESPONSE_TOO_LARGE'
  | 'HISTORY_UNAVAILABLE';
export type TerminalOutcome =
  | { readonly status: 'completed'; readonly reason: 'STOP' }
  | { readonly status: 'limit-reached'; readonly reason: 'OUTPUT_LIMIT' }
  | { readonly status: 'cancelled'; readonly reason: 'USER_CANCELLED' }
  | { readonly status: 'interrupted'; readonly reason: InterruptionReason }
  | { readonly status: 'failed'; readonly reason: FailureReason };
/** Native token rates, including thinking in generation; null means no measured rate. */
export interface GenerationSpeeds {
  readonly generation: number | null;
  readonly prefill: number | null;
}
/** Actual native accounting. Reasoning is included in completion tokens. */
export interface GenerationUsage {
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
  readonly total_tokens: number;
  readonly completion_tokens_details?: { readonly reasoning_tokens: number };
}
export type GenerationChunk =
  | { readonly type: 'text' | 'reasoning'; readonly text: string }
  | {
      readonly type: 'terminal';
      readonly outcome: TerminalOutcome;
      readonly speeds?: GenerationSpeeds;
      readonly usage?: GenerationUsage;
    };
export type ProgressEvent = (RequestIdentity & { readonly sequence: number }) & GenerationChunk;

const identityFields = [
  'deploymentId',
  'sessionId',
  'operationId',
  'requestId',
  'callerId',
  'conversationId',
  'attemptId',
] as const;

/** Decode a renderer send payload, rejecting fields that try to assign caller authority. */
export function decodeSend(input: unknown): SendInput {
  return safely(() => {
    const value = object(input);
    exact(value, ['conversationId', 'text']);
    const encoded = JSON.stringify(value);
    if (Buffer.byteLength(encoded, 'utf8') > MAX_CONTROL_BYTES) invalid();
    const text = unicode(value.text);
    if (!text.trim() || text.length > GENERATION_LIMITS.maxInputCodeUnits) invalid();
    return Object.freeze({ conversationId: identifier(value.conversationId), text });
  });
}

/** Validation is data hygiene, not proof that the caller owns this internal identity. */
export function decodeRequestIdentity(input: unknown): RequestIdentity {
  return safely(() => {
    const value = object(input);
    exact(value, identityFields);
    return identity(value);
  });
}

/** Reject oversized UTF-8 envelopes before parsing; errors never echo private content. */
export function decodeProgress(input: string): ProgressEvent {
  return safely(() => {
    if (
      typeof input !== 'string' ||
      Buffer.byteLength(input, 'utf8') > GENERATION_LIMITS.maxEventBytes
    )
      invalid();
    const parsed: unknown = JSON.parse(input);
    const value = object(parsed);
    if (
      !Number.isSafeInteger(value.sequence) ||
      typeof value.sequence !== 'number' ||
      value.sequence < 1
    )
      invalid();
    const sequence = value.sequence;
    if (value.type === 'text' || value.type === 'reasoning') {
      exact(value, [...identityFields, 'type', 'sequence', 'text']);
      return Object.freeze({
        ...identity(value),
        sequence,
        type: value.type,
        text: unicode(value.text),
      });
    }
    if (value.type === 'terminal') {
      exact(value, [
        ...identityFields,
        'type',
        'sequence',
        'outcome',
        ...(Object.hasOwn(value, 'speeds') ? ['speeds'] : []),
        ...(Object.hasOwn(value, 'usage') ? ['usage'] : []),
      ]);
      return Object.freeze({
        ...identity(value),
        sequence,
        type: 'terminal',
        outcome: decodeOutcome(value.outcome),
        ...(Object.hasOwn(value, 'speeds') ? { speeds: decodeSpeeds(value.speeds) } : {}),
        ...(Object.hasOwn(value, 'usage') ? { usage: decodeUsage(value.usage) } : {}),
      });
    }
    return invalid();
  });
}

/** Closed scalar projection for a terminal result; unavailable counts are never invented. */
export function decodeUsage(input: unknown): GenerationUsage {
  return safely(() => {
    const value = object(input);
    exact(value, [
      'prompt_tokens',
      'completion_tokens',
      'total_tokens',
      ...(Object.hasOwn(value, 'completion_tokens_details') ? ['completion_tokens_details'] : []),
    ]);
    const count = (input: unknown): number => {
      if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) return invalid();
      return input;
    };
    const prompt_tokens = count(value.prompt_tokens),
      completion_tokens = count(value.completion_tokens),
      total_tokens = count(value.total_tokens);
    if (
      !Number.isSafeInteger(prompt_tokens + completion_tokens) ||
      total_tokens !== prompt_tokens + completion_tokens
    )
      return invalid();
    let details: { readonly reasoning_tokens: number } | undefined;
    if (Object.hasOwn(value, 'completion_tokens_details')) {
      const nested = object(value.completion_tokens_details);
      exact(nested, ['reasoning_tokens']);
      const reasoning_tokens = count(nested.reasoning_tokens);
      if (reasoning_tokens > completion_tokens) return invalid();
      details = Object.freeze({ reasoning_tokens });
    }
    return Object.freeze({
      prompt_tokens,
      completion_tokens,
      total_tokens,
      ...(details ? { completion_tokens_details: details } : {}),
    });
  });
}

/** Project only validated scalar diagnostics across the private channel and history boundary. */
export function decodeSpeeds(input: unknown): GenerationSpeeds {
  return safely(() => {
    const value = object(input);
    exact(value, ['generation', 'prefill']);
    const rate = (input: unknown): number | null => {
      if (input === null) return null;
      if (
        typeof input !== 'number' ||
        !Number.isFinite(input) ||
        input <= 0 ||
        input > Number.MAX_SAFE_INTEGER
      )
        return invalid();
      return input;
    };
    return Object.freeze({ generation: rate(value.generation), prefill: rate(value.prefill) });
  });
}

/** Closed terminal categories allow safe diagnostics without arbitrary native error text. */
export function decodeOutcome(input: unknown): TerminalOutcome {
  return safely(() => {
    const value = object(input);
    exact(value, ['status', 'reason']);
    if (value.status === 'completed' && value.reason === 'STOP')
      return Object.freeze({ status: 'completed', reason: 'STOP' });
    if (value.status === 'limit-reached' && value.reason === 'OUTPUT_LIMIT')
      return Object.freeze({ status: 'limit-reached', reason: 'OUTPUT_LIMIT' });
    if (value.status === 'cancelled' && value.reason === 'USER_CANCELLED')
      return Object.freeze({ status: 'cancelled', reason: 'USER_CANCELLED' });
    if (
      value.status === 'interrupted' &&
      (value.reason === 'SESSION_STOPPED' ||
        value.reason === 'ENGINE_EXITED' ||
        value.reason === 'CHANNEL_LOST')
    )
      return Object.freeze({ status: 'interrupted', reason: value.reason });
    if (
      value.status === 'failed' &&
      (value.reason === 'QUEUE_TIMEOUT' ||
        value.reason === 'GENERATION_TIMEOUT' ||
        value.reason === 'CANCEL_UNCONFIRMED' ||
        value.reason === 'START_FAILED' ||
        value.reason === 'EXECUTION_FAILED' ||
        value.reason === 'INVALID_STREAM' ||
        value.reason === 'RESPONSE_TOO_LARGE' ||
        value.reason === 'HISTORY_UNAVAILABLE')
    )
      return Object.freeze({ status: 'failed', reason: value.reason });
    return invalid();
  });
}

function identity(value: Record<string, unknown>): RequestIdentity {
  return Object.freeze({
    deploymentId: identifier(value.deploymentId),
    sessionId: identifier(value.sessionId),
    operationId: identifier(value.operationId),
    requestId: identifier(value.requestId),
    callerId: identifier(value.callerId),
    conversationId: identifier(value.conversationId),
    attemptId: identifier(value.attemptId),
  });
}
function identifier(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,128}$/u.test(value) ||
    ['__proto__', 'prototype', 'constructor'].includes(value)
  )
    return invalid();
  return value;
}
function unicode(value: unknown): string {
  if (
    typeof value !== 'string' ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
  )
    return invalid();
  return value;
}
function object(value: unknown): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return invalid();
  return Object.fromEntries(Object.entries(value));
}
function exact(value: Record<string, unknown>, fields: readonly string[]): void {
  if (
    Object.keys(value).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(value, field))
  )
    invalid();
}
function invalid(): never {
  throw new Error('INVALID_CONTROL');
}
function safely<T>(operation: () => T): T {
  try {
    return operation();
  } catch {
    return invalid();
  }
}
