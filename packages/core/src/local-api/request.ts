import { decodeApiMessages } from '../generation/api-execution.js';
import type { ApiGenerationInput } from '../generation/api-execution.js';
import { decodeGenerationOverrides } from '../model-configuration/contracts.js';
import type { RuntimeSettingCapabilities } from '../model-configuration/contracts.js';
export class ApiFault extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
    readonly type = 'invalid_request_error',
    readonly param: string | null = null,
  ) {
    super(message);
  }
}
function invalidJson(): never {
  throw new ApiFault(400, 'invalid_json', 'Invalid JSON body.', 'invalid_request');
}
function invalid(): never {
  throw new ApiFault(
    400,
    'invalid_request',
    'The request is outside the supported text completion contract.',
  );
}
export const API_BODY_LIMIT = 256 * 1024;
/** Reject duplicate decoded object keys before JSON.parse can silently replace a requested value. */
export function parseApiJson(input: Buffer): unknown {
  if (input.length > API_BODY_LIMIT)
    throw new ApiFault(413, 'request_too_large', 'Request body exceeds 256 KiB.');
  try {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(input);
    let cursor = 0;
    const whitespace = () => {
      while (cursor < source.length && /[\x20\t\r\n]/u.test(source[cursor]!)) cursor++;
    };
    const string = (): string => {
      if (source[cursor] !== '"') return invalidJson();
      const start = cursor++;
      while (cursor < source.length) {
        const character = source[cursor++];
        if (character === '\\') {
          cursor++;
          continue;
        }
        if (character === '"') {
          const value: unknown = JSON.parse(source.slice(start, cursor));
          return typeof value === 'string' ? value : invalidJson();
        }
      }
      return invalidJson();
    };
    const value = (depth: number): void => {
      if (depth > 16) return invalidJson();
      whitespace();
      const character = source[cursor];
      if (character === '"') {
        string();
        return;
      }
      if (character === '{') {
        cursor++;
        whitespace();
        const seen = new Set<string>();
        if (source[cursor] === '}') {
          cursor++;
          return;
        }
        while (true) {
          whitespace();
          const key = string();
          if (seen.has(key)) return invalidJson();
          seen.add(key);
          whitespace();
          if (source[cursor++] !== ':') return invalidJson();
          value(depth + 1);
          whitespace();
          const separator = source[cursor++];
          if (separator === '}') return;
          if (separator !== ',') return invalidJson();
        }
      }
      if (character === '[') {
        cursor++;
        whitespace();
        if (source[cursor] === ']') {
          cursor++;
          return;
        }
        while (true) {
          value(depth + 1);
          whitespace();
          const separator = source[cursor++];
          if (separator === ']') return;
          if (separator !== ',') return invalidJson();
        }
      }
      for (const literal of ['true', 'false', 'null'])
        if (source.startsWith(literal, cursor)) {
          cursor += literal.length;
          return;
        }
      const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(source.slice(cursor));
      if (!number) return invalidJson();
      cursor += number[0].length;
    };
    value(0);
    whitespace();
    if (cursor !== source.length) return invalidJson();
    return JSON.parse(source) as unknown;
  } catch {
    return invalidJson();
  }
}
export interface ApiCompletion {
  readonly model: string;
  readonly stream: boolean;
  readonly includeUsage: boolean;
  readonly input: ApiGenerationInput;
}
/** Decode a declared subset; requested unsupported fields are never silently ignored. */
export function decodeApiCompletion(
  input: unknown,
  capabilities: RuntimeSettingCapabilities,
): ApiCompletion {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid();
    const value = input as Record<string, unknown>;
    const samplers = [
      'temperature',
      'top_p',
      'top_k',
      'min_p',
      'repeat_penalty',
      'presence_penalty',
      'seed',
      'stop',
      'max_tokens',
    ];
    const fields = [
      'model',
      'messages',
      'stream',
      'n',
      'stream_options',
      'response_format',
      ...samplers,
    ];
    if (Object.keys(value).some((key) => !fields.includes(key)))
      throw new ApiFault(
        400,
        'unsupported_parameter',
        'The request contains an unsupported parameter.',
      );
    if (
      typeof value.model !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/u.test(value.model) ||
      (Object.hasOwn(value, 'stream') && typeof value.stream !== 'boolean') ||
      (Object.hasOwn(value, 'n') && value.n !== 1)
    )
      return invalid();
    const stream = value.stream === true;
    let includeUsage = false;
    if (Object.hasOwn(value, 'stream_options')) {
      const options = object(value.stream_options);
      if (
        !stream ||
        Object.keys(options).join(',') !== 'include_usage' ||
        typeof options.include_usage !== 'boolean'
      )
        return invalid();
      includeUsage = options.include_usage;
    }
    if (Object.hasOwn(value, 'response_format')) {
      const format = object(value.response_format);
      if (Object.keys(format).join(',') !== 'type' || format.type !== 'text') return invalid();
    }
    const messages = decodeApiMessages(value.messages);
    const overrides = decodeGenerationOverrides(
      Object.fromEntries(
        samplers.filter((key) => Object.hasOwn(value, key)).map((key) => [key, value[key]]),
      ),
      capabilities,
    );
    return Object.freeze({
      model: value.model,
      stream,
      includeUsage,
      input: Object.freeze({ messages, overrides }),
    });
  } catch (error) {
    if (error instanceof ApiFault) throw error;
    return invalid();
  }
}
function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid();
  return input as Record<string, unknown>;
}
