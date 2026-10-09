import type { ChatTransport, ChatMessage } from '../generation/service.js';
import type { Identity } from '../runtime/contracts.js';
import type { OwnedSlotMonitor } from './slot-monitor.js';
import { request } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { decodeRequestIdentity } from '../generation/contracts.js';
import type { TerminalOutcome } from '../generation/contracts.js';
import { parseGenerationStream } from '../generation/stream.js';
export interface OwnedChatOptions {
  readonly port: number;
  readonly key: string;
  readonly alias: string;
  readonly session: Identity;
  readonly owns: () => boolean;
  readonly monitor: OwnedSlotMonitor;
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
  function body(messages: Parameters<ChatTransport['tokenCount']>[0], slot?: number): string {
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
          (m.role !== 'user' && m.role !== 'assistant') ||
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
      ...(slot === undefined ? {} : { stream: true, max_tokens: 512, n: 1, id_slot: slot }),
    });
    if (Buffer.byteLength(value) > 1048576) throw new Error('INVALID_CONTROL');
    return value;
  }
  function post(
    route: '/v1/chat/completions' | '/v1/chat/completions/input_tokens',
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
  return {
    async tokenCount(messages, signal) {
      try {
        const abort = new AbortController();
        const cancel = () => abort.abort();
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) abort.abort();
        const timer = setTimeout(cancel, 120000);
        try {
          const response = await post(
            '/v1/chat/completions/input_tokens',
            body(messages),
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
    },
    start(input, messages, progress) {
      const identity = decodeRequestIdentity(input);
      if (
        !owns() ||
        identity.deploymentId !== session.deploymentId ||
        identity.sessionId !== session.sessionId ||
        identity.operationId !== session.operationId
      )
        throw new Error('NOT_READY');
      body(messages, 0); // Validate before any native reservation or request exists.
      const abort = new AbortController();
      let outcome: TerminalOutcome = { status: 'failed', reason: 'EXECUTION_FAILED' };
      const release = monitor.start(async (slot) => {
        let response: IncomingMessage | undefined;
        try {
          response = await post('/v1/chat/completions', body(messages, slot), abort.signal);
          for await (const chunk of parseGenerationStream(response, abort.signal)) {
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
      return {
        settled: release.then((receipt) =>
          receipt === 'engine-exited'
            ? { status: 'interrupted', reason: 'ENGINE_EXITED' }
            : outcome,
        ),
        cancel() {
          abort.abort();
        },
      };
    },
  };
}
