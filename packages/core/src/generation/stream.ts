import { GENERATION_LIMITS } from './contracts.js';
import type { GenerationChunk, GenerationSpeeds, TerminalOutcome } from './contracts.js';

type StreamFault = 'INVALID_STREAM' | 'RESPONSE_TOO_LARGE' | 'GENERATION_CANCELLED';
class StreamError extends Error {
  constructor(readonly code: StreamFault) {
    super(code);
  }
}
interface StreamState {
  terminal?: TerminalOutcome;
  done: boolean;
  responseId?: string;
  model?: string;
  responseBytes: number;
  usageSeen: boolean;
  speeds?: GenerationSpeeds | undefined;
}

/** Parses the pinned single-choice internal chat SSE response.
 * Requires a finish reason, [DONE] and valid EOF before reporting completion.
 * Thinking and answer text remain separate; unsupported tool deltas are rejected.
 * The caller owns/cancels the underlying transport; parser abort is not native settlement.
 * @throws Safe stream category without native error/prompt content.
 */
export async function* parseGenerationStream(
  source: AsyncIterable<Uint8Array>,
  signal: AbortSignal,
): AsyncIterable<GenerationChunk> {
  const state: StreamState = { done: false, responseBytes: 0, usageSeen: false };
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffered = '';
  let frameBytes = 0;
  let data: string[] = [];
  function* feed(text: string): Generator<GenerationChunk> {
    buffered += text;
    let newline: number;
    while ((newline = buffered.indexOf('\n')) !== -1) {
      let line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      frameBytes += Buffer.byteLength(line, 'utf8') + 1;
      if (frameBytes > GENERATION_LIMITS.maxEventBytes) fault('INVALID_STREAM');
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (!line) {
        if (data.length) yield* parseFrame(data.join('\n'), state);
        data = [];
        frameBytes = 0;
      } else if (line.startsWith('data:')) {
        const value = line.slice(5);
        data.push(value.startsWith(' ') ? value.slice(1) : value);
      } else if (!line.startsWith(':')) fault('INVALID_STREAM');
    }
    if (frameBytes + Buffer.byteLength(buffered, 'utf8') > GENERATION_LIMITS.maxEventBytes)
      fault('INVALID_STREAM');
  }
  try {
    const iterator = source[Symbol.asyncIterator]();
    while (true) {
      const item = await nextOrAbort(iterator, signal);
      if (item.done) break;
      if (!(item.value instanceof Uint8Array)) fault('INVALID_STREAM');
      // Avoid copying an arbitrarily large transport chunk into one decoded string.
      for (let offset = 0; offset < item.value.length; offset += 8192) {
        if (signal.aborted) fault('GENERATION_CANCELLED');
        yield* feed(decoder.decode(item.value.subarray(offset, offset + 8192), { stream: true }));
      }
    }
    yield* feed(decoder.decode());
    if (signal.aborted) fault('GENERATION_CANCELLED');
    if (buffered || frameBytes || data.length || !state.done || !state.terminal)
      fault('INVALID_STREAM');
    yield Object.freeze({
      type: 'terminal',
      outcome: state.terminal,
      ...(state.speeds ? { speeds: state.speeds } : {}),
    });
  } catch (error: unknown) {
    if (signal.aborted) fault('GENERATION_CANCELLED');
    if (error instanceof StreamError) throw error;
    fault('INVALID_STREAM');
  }
}

function parseFrame(data: string, state: StreamState): readonly GenerationChunk[] {
  if (state.done) fault('INVALID_STREAM');
  if (data === '[DONE]') {
    if (!state.terminal) fault('INVALID_STREAM');
    state.done = true;
    return [];
  }
  const parsed: unknown = JSON.parse(data);
  const envelope = record(parsed);
  const allowed = [
    'id',
    'object',
    'created',
    'model',
    'system_fingerprint',
    'choices',
    'usage',
    'timings',
  ];
  if (
    Object.keys(envelope).some((key) => !allowed.includes(key)) ||
    envelope.object !== 'chat.completion.chunk' ||
    !Number.isSafeInteger(envelope.created) ||
    typeof envelope.id !== 'string' ||
    !envelope.id ||
    envelope.id.length > 128 ||
    typeof envelope.model !== 'string' ||
    !envelope.model ||
    envelope.model.length > 128 ||
    !Array.isArray(envelope.choices)
  )
    fault('INVALID_STREAM');
  if (state.responseId && (envelope.id !== state.responseId || envelope.model !== state.model))
    fault('INVALID_STREAM');
  state.responseId = envelope.id;
  state.model = envelope.model;
  const choices: unknown[] = envelope.choices;
  if (!choices.length) {
    if (!state.terminal || state.usageSeen || !envelope.usage) fault('INVALID_STREAM');
    record(envelope.usage);
    state.usageSeen = true;
    if (Object.hasOwn(envelope, 'timings')) state.speeds = nativeSpeeds(envelope.timings);
    return [];
  }
  if (choices.length !== 1 || state.terminal) fault('INVALID_STREAM');
  const choice = record(choices[0]);
  if (
    choice.index !== 0 ||
    Object.keys(choice).some(
      (key) => !['index', 'delta', 'finish_reason', 'logprobs'].includes(key),
    )
  )
    fault('INVALID_STREAM');
  const delta = record(choice.delta);
  if (
    Object.keys(delta).some((key) => !['role', 'content', 'reasoning_content'].includes(key)) ||
    (delta.role !== undefined && delta.role !== 'assistant')
  )
    fault('INVALID_STREAM');
  const result: GenerationChunk[] = [];
  for (const [field, type] of [
    ['reasoning_content', 'reasoning'],
    ['content', 'text'],
  ] as const) {
    const content = delta[field];
    if (content === undefined || content === null) continue;
    if (typeof content !== 'string' || Buffer.from(content, 'utf8').toString('utf8') !== content)
      fault('INVALID_STREAM');
    state.responseBytes += Buffer.byteLength(content, 'utf8');
    if (state.responseBytes > GENERATION_LIMITS.maxResponseBytes) fault('RESPONSE_TOO_LARGE');
    if (content) result.push(Object.freeze({ type, text: content }));
  }
  if (choice.finish_reason === 'stop')
    state.terminal = Object.freeze({ status: 'completed', reason: 'STOP' });
  else if (choice.finish_reason === 'length')
    state.terminal = Object.freeze({ status: 'limit-reached', reason: 'OUTPUT_LIMIT' });
  else if (choice.finish_reason !== null) fault('INVALID_STREAM');
  if (state.terminal && Object.hasOwn(envelope, 'timings'))
    state.speeds = nativeSpeeds(envelope.timings);
  return result;
}

// Optional diagnostics must not turn an otherwise valid answer into a stream failure.
function nativeSpeeds(input: unknown): GenerationSpeeds | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const value = input as Record<string, unknown>;
  const rate = (value: unknown) =>
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= Number.MAX_SAFE_INTEGER
      ? value
      : null;
  const generation = rate(value.predicted_per_second),
    prefill = rate(value.prompt_per_second);
  return generation === null && prefill === null
    ? undefined
    : Object.freeze({ generation, prefill });
}

/** Racing abort removes its listener even if a source read never settles.
 * The transport owner must cancel that read and obtain native settlement separately.
 */
async function nextOrAbort(
  iterator: AsyncIterator<Uint8Array>,
  signal: AbortSignal,
): Promise<IteratorResult<Uint8Array>> {
  if (signal.aborted) fault('GENERATION_CANCELLED');
  let onAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(new StreamError('GENERATION_CANCELLED'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([iterator.next(), aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fault('INVALID_STREAM');
  return Object.fromEntries(Object.entries(value));
}
function fault(code: StreamFault): never {
  throw new StreamError(code);
}
