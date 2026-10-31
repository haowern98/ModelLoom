import type { ChatTransport, ChatMessage } from '../generation/service.js';
import type { Identity } from '../runtime/contracts.js';
import type { OwnedSlotMonitor } from './slot-monitor.js';
import { decodeResolvedRequestSettings } from '../model-configuration/contracts.js';
import type {
  ResolvedRequestSettings,
  RuntimeSettingCapabilities,
  AdvancedPreferences,
} from '../model-configuration/contracts.js';
import { request } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { decodeExecutionIdentity, GENERATION_POLICY } from '../generation/contracts.js';
import type { TerminalOutcome } from '../generation/contracts.js';
import { parseGenerationStream } from '../generation/stream.js';
export interface OwnedChatOptions {
  readonly speculativeProposer?: boolean;
  readonly port: number;
  readonly key: string;
  readonly alias: string;
  readonly session: Identity;
  readonly owns: () => boolean;
  readonly monitor: OwnedSlotMonitor;
  /** Captured owner exit, including job and credential cleanup; listener loss alone is insufficient. */
  readonly exited: Promise<void>;
  readonly configuration?: {
    readonly capabilities: RuntimeSettingCapabilities;
    readonly modelId: string;
    readonly contextLength: number;
    readonly overflow?: AdvancedPreferences['overflow'];
  };
}
/** Only trusted owner construction supplies endpoint, credential and slot monitor. */
export function createOwnedChatTransport(options: OwnedChatOptions): ChatTransport {
  const { port, key, alias, owns, monitor } = options;
  const session = Object.freeze({
    deploymentId: options.session.deploymentId,
    sessionId: options.session.sessionId,
    operationId: options.session.operationId,
  });
  if (
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    !/^[a-zA-Z0-9_-]{1,128}$/u.test(key) ||
    !/^[a-zA-Z0-9_-]{1,128}$/u.test(alias)
  )
    throw new Error('INVALID_CONTROL');
  function body(
    messages: Parameters<ChatTransport['tokenCount']>[0],
    slot?: number,
    input?: ResolvedRequestSettings,
    keep?: number,
    addGenerationPrompt = true,
  ): string {
    let settings: ResolvedRequestSettings | undefined;
    if (input !== undefined) {
      if (!options.configuration) throw new Error('INVALID_CONTROL');
      settings = decodeResolvedRequestSettings(input, options.configuration.capabilities);
      if (
        settings.modelId !== options.configuration.modelId ||
        settings.contextLength !== options.configuration.contextLength ||
        (settings.overflow ?? 'stop') !== (options.configuration.overflow ?? 'stop')
      )
        throw new Error('INVALID_CONTROL');
    }
    if (
      !Array.isArray(messages) ||
      !messages.length ||
      messages.some(
        (m: ChatMessage) =>
          !m ||
          Object.keys(m).sort().join(',') !==
            (m.reasoning_content === undefined
              ? 'content,role'
              : 'content,reasoning_content,role') ||
          (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'system') ||
          typeof m.content !== 'string' ||
          /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
            m.content,
          ) ||
          (m.reasoning_content !== undefined &&
            (m.role !== 'assistant' ||
              typeof m.reasoning_content !== 'string' ||
              /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
                m.reasoning_content,
              ))),
      )
    )
      throw new Error('INVALID_CONTROL');
    const value = JSON.stringify({
      model: alias,
      messages,
      ...(addGenerationPrompt ? {} : { add_generation_prompt: false }),
      ...(settings ? settings.parameters : {}),
      ...(settings?.thinking === null || settings === undefined
        ? {}
        : { chat_template_kwargs: { enable_thinking: settings.thinking } }),
      ...(slot === undefined
        ? {}
        : {
            stream: true,
            timings_per_token: true,
            return_progress: true,
            ...(settings ? { stream_options: { include_usage: true } } : { max_tokens: 512 }),
            n: 1,
            id_slot: slot,
            ...(keep === undefined ? {} : { n_keep: keep, n_discard: 0 }),
          }),
    });
    if (Buffer.byteLength(value) > 1048576) throw new Error('INVALID_CONTROL');
    return value;
  }
  function post(
    route:
      | '/v1/chat/completions'
      | '/v1/chat/completions/input_tokens'
      | '/apply-template'
      | '/tokenize',
    data: string,
    signal: AbortSignal,
  ): Promise<IncomingMessage> {
    if (signal.aborted || !owns()) return Promise.reject(new Error('NOT_READY'));
    return new Promise((resolve, reject) => {
      const req = request(
        {
          hostname: '127.0.0.1',
          port,
          path: route,
          method: 'POST',
          signal,
          headers: {
            authorization: `Bearer ${key}`,
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(data),
          },
        },
        (response) => {
          if (response.statusCode !== 200 || signal.aborted || !owns()) {
            response.destroy();
            reject(new Error('EXECUTION_FAILED'));
            return;
          }
          resolve(response);
        },
      );
      req.on('error', () => reject(new Error('EXECUTION_FAILED')));
      req.end(data);
    });
  }
  /** Check the native rendered/tokenized prefix before acquiring any generation slot. */
  async function protectedPrefix(
    messages: readonly ChatMessage[],
    settings: ResolvedRequestSettings,
    signal: AbortSignal,
  ): Promise<number> {
    let end = messages[0]?.role === 'system' ? 1 : 0;
    if (settings.overflow === 'truncate-middle') {
      while (end < messages.length && messages[end]?.role !== 'user') end++;
      end++;
      while (end < messages.length && messages[end]?.role !== 'user') end++;
    }
    if (!end) return 0;
    const abort = new AbortController();
    const cancel = () => abort.abort();
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) abort.abort();
    const timer = setTimeout(cancel, GENERATION_POLICY.generationMs);
    const read = async (route: '/apply-template' | '/tokenize', data: string): Promise<unknown> => {
      const response = await post(route, data, abort.signal);
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const raw of response) {
        const chunk = raw as Buffer;
        size += chunk.length;
        if (size > 4194304) {
          response.destroy();
          throw Error('INVALID_STREAM');
        }
        chunks.push(chunk);
      }
      if (abort.signal.aborted || !owns()) throw Error('NOT_READY');
      return JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
      ) as unknown;
    };
    const render = async (context: readonly ChatMessage[], generationPrompt: boolean) => {
      const value = await read(
        '/apply-template',
        body(context, undefined, settings, undefined, generationPrompt),
      );
      if (
        !value ||
        typeof value !== 'object' ||
        !('prompt' in value) ||
        typeof value.prompt !== 'string' ||
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value.prompt)
      )
        throw Error('INVALID_STREAM');
      return value.prompt;
    };
    const tokenize = async (content: string): Promise<readonly number[]> => {
      const value = await read(
        '/tokenize',
        JSON.stringify({ content, add_special: false, parse_special: true }),
      );
      if (
        !value ||
        typeof value !== 'object' ||
        !('tokens' in value) ||
        !Array.isArray(value.tokens) ||
        value.tokens.some(
          (token: unknown) =>
            typeof token !== 'number' || !Number.isSafeInteger(token) || token < 0,
        )
      )
        throw Error('INVALID_STREAM');
      return value.tokens as number[];
    };
    try {
      const full = await render(messages, true);
      const prefix = await render(messages.slice(0, end), false);
      if (!prefix || !full.startsWith(prefix)) throw Error('INVALID_STREAM');
      const fullTokens = await tokenize(full);
      const prefixTokens = await tokenize(prefix);
      if (
        !prefixTokens.length ||
        prefixTokens.some((token, index) => token !== fullTokens[index]) ||
        prefixTokens.length > settings.contextLength - 4
      )
        throw Error('INVALID_STREAM');
      return prefixTokens.length;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
    }
  }
  async function countTokens(
    messages: readonly ChatMessage[],
    signal: AbortSignal,
    settings?: ResolvedRequestSettings,
    addGenerationPrompt = true,
  ): Promise<number> {
    try {
      const abort = new AbortController();
      const cancel = () => abort.abort();
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) abort.abort();
      const timer = setTimeout(cancel, GENERATION_POLICY.generationMs);
      try {
        const response = await post(
          '/v1/chat/completions/input_tokens',
          body(messages, undefined, settings, undefined, addGenerationPrompt),
          abort.signal,
        );
        let size = 0;
        const chunks: Buffer[] = [];
        for await (const raw of response) {
          const chunk = raw as Buffer;
          size += chunk.length;
          if (size > 65536) {
            response.destroy();
            throw new Error('TOKEN_COUNT_FAILED');
          }
          chunks.push(chunk);
        }
        const value: unknown = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
        );
        if (
          !owns() ||
          abort.signal.aborted ||
          !value ||
          typeof value !== 'object' ||
          !('input_tokens' in value) ||
          typeof value.input_tokens !== 'number' ||
          !Number.isSafeInteger(value.input_tokens) ||
          value.input_tokens < 0
        )
          throw new Error('TOKEN_COUNT_FAILED');
        return value.input_tokens;
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
      }
    } catch {
      throw new Error('TOKEN_COUNT_FAILED');
    }
  }
  const transport: ChatTransport = {
    tokenCount: (messages, signal, settings) => countTokens(messages, signal, settings),
    start(input, messages, progress, settings) {
      const identity = decodeExecutionIdentity(input);
      if (
        !owns() ||
        identity.deploymentId !== session.deploymentId ||
        identity.sessionId !== session.sessionId ||
        identity.operationId !== session.operationId
      )
        throw new Error('NOT_READY');
      body(messages, 0, settings); // Validate before any native reservation or request exists.
      const abort = new AbortController();
      let outcome: TerminalOutcome = { status: 'failed', reason: 'EXECUTION_FAILED' };
      const execute = (keep?: number): Promise<TerminalOutcome> => {
        const release = monitor.start(async (slot) => {
          let response: IncomingMessage | undefined;
          try {
            response = await post(
              '/v1/chat/completions',
              body(messages, slot, settings, keep),
              abort.signal,
            );
            for await (const chunk of parseGenerationStream(
              response,
              abort.signal,
              options.speculativeProposer,
            )) {
              if (chunk.type === 'terminal') outcome = chunk.outcome;
              await progress(chunk);
            }
            if (!owns()) throw new Error('NOT_READY');
            return 'terminal';
          } catch {
            outcome = abort.signal.aborted
              ? { status: 'cancelled', reason: 'USER_CANCELLED' }
              : { status: 'failed', reason: 'INVALID_STREAM' };
            response?.destroy();
            abort.abort();
            return 'aborted';
          }
        });
        return release.then(
          (receipt) =>
            receipt === 'engine-exited'
              ? { status: 'interrupted', reason: 'ENGINE_EXITED' }
              : outcome,
          async (error: unknown) => {
            if (owns()) throw error;
            // A dead listener can precede the broker's exit receipt. Keep capacity held until proof.
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
              await Promise.race([
                options.exited,
                new Promise<never>((_resolve, reject) => {
                  timer = setTimeout(
                    () => reject(error instanceof Error ? error : new Error('STATUS_UNCONFIRMED')),
                    5000,
                  );
                }),
              ]);
              return { status: 'interrupted', reason: 'ENGINE_EXITED' } as const;
            } finally {
              if (timer) clearTimeout(timer);
            }
          },
        );
      };
      const prepare = async (): Promise<{ keep: number } | { failed: TerminalOutcome }> => {
        try {
          const keep = await protectedPrefix(messages, settings!, abort.signal);
          if (abort.signal.aborted || !owns()) throw Error('NOT_READY');
          return { keep };
        } catch {
          return {
            failed: abort.signal.aborted
              ? { status: 'cancelled', reason: 'USER_CANCELLED' }
              : { status: 'failed', reason: 'INVALID_STREAM' },
          };
        }
      };
      return {
        settled:
          settings && (settings.overflow ?? 'stop') !== 'stop'
            ? prepare().then((result): TerminalOutcome | Promise<TerminalOutcome> => {
                if ('failed' in result) return result.failed;
                if (abort.signal.aborted) return { status: 'cancelled', reason: 'USER_CANCELLED' };
                if (!owns()) return { status: 'failed', reason: 'INVALID_STREAM' };
                return execute(result.keep);
              })
            : execute(),
        cancel() {
          abort.abort();
        },
      };
    },
  };
  return transport;
}
