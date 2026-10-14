import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { API_BODY_LIMIT, ApiFault, decodeApiCompletion, parseApiJson } from './request.js';
import type { ApiCredentials } from './credentials.js';
import type { ApiCaller } from '../generation/api-authority.js';
import type {
  ApiGenerationHandle,
  ApiGenerationInput,
  ApiGenerationResult,
} from '../generation/api-execution.js';
import type { GenerationChunk } from '../generation/contracts.js';
import type { RuntimeSettingCapabilities } from '../model-configuration/contracts.js';
export interface PublicApiModel {
  readonly id: string;
  readonly created: number;
}
export interface ApiServerStatus {
  readonly phase: 'stopped' | 'starting' | 'running' | 'stopping' | 'failed';
  readonly configuredPort: number;
  readonly address: string | null;
  readonly model: PublicApiModel | null;
  readonly uptimeMs: number | null;
  readonly requests: number;
  readonly responseTimeMs: number | null;
  readonly logs: readonly string[];
  readonly error:
    'CREDENTIAL_UNAVAILABLE' | 'ADDRESS_UNAVAILABLE' | 'RUNTIME_RECOVERY_REQUIRED' | null;
}
interface Dependencies {
  readonly credentials: ApiCredentials;
  readonly capabilities: RuntimeSettingCapabilities;
  /** Trusted construction only. Zero requests an ephemeral port for automated fixtures. */
  readonly port?: number;
  readonly model: () => PublicApiModel | null;
  readonly generate: (
    caller: ApiCaller,
    input: ApiGenerationInput,
    progress: (chunk: GenerationChunk) => void | Promise<void>,
  ) => ApiGenerationHandle;
}
/** Bounded loopback-only public facade. It never owns an engine or bypasses core admission. */
export class ApiServer {
  private readonly port: number;
  private phase: ApiServerStatus['phase'] = 'stopped';
  private error: ApiServerStatus['error'] = null;
  private server: Server | undefined;
  private actualPort: number | undefined;
  private started: number | undefined;
  private requests = 0;
  private readonly durations: number[] = [];
  private readonly logs: string[] = [];
  private readonly sockets = new Set<Socket>();
  private readonly tasks = new Set<ApiGenerationHandle>();
  private readonly cancelled = new WeakSet<ApiGenerationHandle>();
  private operations: Promise<void> = Promise.resolve();
  private pending = 0;
  private tokens = 120;
  private refill = performance.now();
  constructor(private readonly deps: Dependencies) {
    this.port = deps.port ?? 8000;
    if (!Number.isInteger(this.port) || this.port < 0 || this.port > 65535)
      throw new Error('INVALID_CONTROL');
  }
  status(): ApiServerStatus {
    return Object.freeze({
      phase: this.phase,
      configuredPort: this.port,
      address: this.actualPort === undefined ? null : `http://127.0.0.1:${this.actualPort}/v1`,
      model: this.deps.model(),
      uptimeMs:
        this.started === undefined
          ? null
          : Math.max(0, Math.floor(performance.now() - this.started)),
      requests: this.requests,
      responseTimeMs: this.durations.length
        ? this.durations.reduce((a, b) => a + b, 0) / this.durations.length
        : null,
      logs: Object.freeze([...this.logs]),
      error: this.error,
    });
  }
  clearLogs(): void {
    this.logs.length = 0;
  }
  private log(
    category:
      | 'SERVER_STARTED'
      | 'SERVER_STOPPED'
      | 'SERVER_FAILED'
      | 'REQUEST_COMPLETED'
      | 'REQUEST_FAILED',
    id?: string,
  ): void {
    this.logs.push(`${new Date().toISOString()} ${category}${id ? ` ${id}` : ''}`);
    while (this.logs.length > 500 || Buffer.byteLength(this.logs.join('\n')) > 262144)
      this.logs.shift();
  }
  start(): Promise<void> {
    return this.lifecycle(async () => {
      if (this.phase === 'running') return;
      if (!this.deps.credentials.canServe()) {
        this.phase = 'failed';
        this.error = 'CREDENTIAL_UNAVAILABLE';
        throw new Error('CREDENTIAL_UNAVAILABLE');
      }
      this.phase = 'starting';
      this.error = null;
      const server = createServer(
        {
          maxHeaderSize: 16384,
          headersTimeout: 5000,
          requestTimeout: 15000,
          keepAliveTimeout: 5000,
          connectionsCheckingInterval: 1000,
          // Pause below the hard 64 KiB bound, leaving room for the next write and framing.
          highWaterMark: 32768,
        },
        (req, res) => {
          void this.receive(req, res).catch(() => res.destroy());
        },
      );
      this.server = server;
      server.on('connection', (socket) => {
        if (this.sockets.size >= 32 || this.phase === 'stopping') {
          socket.destroy();
          return;
        }
        this.sockets.add(socket);
        socket.on('close', () => this.sockets.delete(socket));
      });
      server.on('clientError', (_error, socket) => {
        const status =
          'code' in _error && _error.code === 'HPE_HEADER_OVERFLOW'
            ? '431 Request Header Fields Too Large'
            : '400 Bad Request';
        if (socket.writable)
          socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
        else socket.destroy();
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const failed = () => reject(new Error('ADDRESS_UNAVAILABLE'));
          server.once('error', failed);
          server.listen({ host: '127.0.0.1', port: this.port, exclusive: true }, () => {
            server.removeListener('error', failed);
            resolve();
          });
        });
        const address = server.address();
        if (!address || typeof address === 'string' || address.address !== '127.0.0.1')
          throw new Error('ADDRESS_UNAVAILABLE');
        this.actualPort = address.port;
        this.started = performance.now();
        this.requests = 0;
        this.durations.length = 0;
        this.tokens = 120;
        this.refill = performance.now();
        this.phase = 'running';
        this.log('SERVER_STARTED');
        server.on('error', () => {
          this.phase = 'failed';
          this.error = 'ADDRESS_UNAVAILABLE';
          this.log('SERVER_FAILED');
          void this.stop().catch(() => undefined);
        });
      } catch {
        server.close();
        this.server = undefined;
        this.actualPort = undefined;
        this.started = undefined;
        this.phase = 'failed';
        this.error = 'ADDRESS_UNAVAILABLE';
        this.log('SERVER_FAILED');
        throw new Error('ADDRESS_UNAVAILABLE');
      }
    });
  }
  stop(): Promise<void> {
    return this.lifecycle(async () => {
      if (!this.server) {
        if (this.phase !== 'failed') this.phase = 'stopped';
        return;
      }
      this.phase = 'stopping';
      const server = this.server;
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      try {
        await this.cancelRequests();
        await closed;
        this.phase = 'stopped';
        this.error = null;
        this.log('SERVER_STOPPED');
      } catch {
        this.phase = 'failed';
        this.error = 'RUNTIME_RECOVERY_REQUIRED';
        this.log('SERVER_FAILED');
        throw new Error('RUNTIME_RECOVERY_REQUIRED');
      } finally {
        this.server = undefined;
        this.actualPort = undefined;
        this.started = undefined;
      }
    });
  }
  /** Rotation/Stop affect only this listener's callers, sockets and captured API handles. */
  async cancelRequests(): Promise<void> {
    this.deps.credentials.revokeCallers();
    const tasks = [...this.tasks];
    for (const task of tasks) this.cancelTask(task);
    for (const socket of this.sockets) socket.destroy();
    const settled = await Promise.allSettled(tasks.map((task) => task.done));
    if (
      settled.some(
        (result) =>
          result.status === 'fulfilled' &&
          (result.value.recoveryRequired || result.value.outcome.reason === 'CANCEL_UNCONFIRMED'),
      )
    )
      throw new Error('RUNTIME_RECOVERY_REQUIRED');
  }
  private cancelTask(task: ApiGenerationHandle): void {
    if (this.cancelled.has(task)) return;
    this.cancelled.add(task);
    task.cancel();
  }
  private lifecycle(operation: () => Promise<void>): Promise<void> {
    if (this.pending >= 4) return Promise.reject(new Error('NOT_READY'));
    this.pending++;
    const result = this.operations.then(operation);
    this.operations = result
      .catch(() => undefined)
      .finally(() => {
        this.pending--;
      });
    return result;
  }
  private rate(): void {
    const now = performance.now();
    this.tokens = Math.min(120, this.tokens + (now - this.refill) / 500);
    this.refill = now;
    if (this.tokens < 1)
      throw new ApiFault(429, 'rate_limited', 'Request rate limit reached.', 'rate_limit_error');
    this.tokens--;
  }
  private async receive(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let handle: ApiGenerationHandle | undefined;
    const id = `chatcmpl_${randomUUID()}`,
      created = Math.floor(Date.now() / 1000);
    let streamed = false,
      ended = false,
      admittedAt: number | undefined;
    const disconnect = () => {
      if (!ended && handle) this.cancelTask(handle);
    };
    res.on('close', disconnect);
    const beginStream = () => {
      if (streamed) return;
      if (res.destroyed) throw new Error('CLIENT_DISCONNECTED');
      streamed = true;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
    };
    try {
      this.rate();
      const headerCount = (name: string) =>
        req.rawHeaders.filter(
          (_value, index) => index % 2 === 0 && req.rawHeaders[index]!.toLowerCase() === name,
        ).length;
      if (headerCount('origin'))
        throw new ApiFault(
          403,
          'origin_not_allowed',
          'Browser clients are not enabled.',
          'permission_error',
        );
      const host = req.headers.host?.toLowerCase();
      if (
        headerCount('host') !== 1 ||
        (host !== `127.0.0.1:${this.actualPort}` && host !== `localhost:${this.actualPort}`)
      )
        throw new ApiFault(403, 'host_not_allowed', 'Host is not allowed.', 'permission_error');
      const authorization = req.headers.authorization;
      const caller =
        headerCount('authorization') === 1 && authorization?.startsWith('Bearer ')
          ? this.deps.credentials.authenticate(authorization.slice(7))
          : null;
      if (!caller)
        throw new ApiFault(
          401,
          'invalid_api_key',
          'A valid API key is required.',
          'authentication_error',
        );
      if (this.phase !== 'running')
        throw new ApiFault(
          503,
          'server_stopping',
          'The server is not accepting requests.',
          'server_error',
        );
      if (req.url === '/v1/models') {
        const model = this.deps.model();
        if (req.method !== 'GET') {
          res.setHeader('Allow', 'GET');
          throw new ApiFault(405, 'method_not_allowed', 'Use GET for this route.');
        }
        if (req.headers['transfer-encoding'] || Number(req.headers['content-length'] ?? 0) !== 0)
          throw new ApiFault(400, 'invalid_request', 'This route accepts no body.');
        await json(res, 200, {
          object: 'list',
          data: model ? [{ ...model, object: 'model', owned_by: 'modelloom' }] : [],
        });
        ended = true;
        return;
      }
      if (req.url !== '/v1/chat/completions')
        throw new ApiFault(404, 'route_not_supported', 'This route is not supported.');
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        throw new ApiFault(405, 'method_not_allowed', 'Use POST for this route.');
      }
      if (
        headerCount('content-type') !== 1 ||
        !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(req.headers['content-type'] ?? '') ||
        (req.headers['content-encoding'] !== undefined &&
          req.headers['content-encoding'] !== 'identity')
      )
        throw new ApiFault(
          415,
          'unsupported_media_type',
          'Use application/json with UTF-8 and no content encoding.',
        );
      const completion = decodeApiCompletion(
        parseApiJson(await readBody(req)),
        this.deps.capabilities,
      );
      const model = this.deps.model();
      if (!model)
        throw new ApiFault(
          400,
          null,
          'No model is loaded. Load a model in the ModelLoom Cluster page first.',
          'invalid_request_error',
          'model',
        );
      if (completion.model !== model.id)
        throw new ApiFault(
          404,
          'model_not_found',
          'The requested model is not callable.',
          'invalid_request_error',
          'model',
        );
      const chunk = (extra: Record<string, unknown>) => ({
        id,
        object: 'chat.completion.chunk',
        created,
        model: model.id,
        ...extra,
      });
      const event = (extra: Record<string, unknown>) =>
        write(res, `data: ${JSON.stringify(chunk(extra))}\n\n`);
      let roleSent = false;
      const role = async () => {
        if (!roleSent) {
          beginStream();
          await event({
            choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
          });
          roleSent = true;
        }
      };
      handle = this.deps.generate(caller, completion.input, async (value) => {
        if (!completion.stream) return;
        if (value.type === 'terminal') throw new Error('INVALID_STREAM');
        await role();
        // Even fully escaped UTF-16 stays below the 64 KiB event limit at this size.
        // Keep a surrogate pair together so each independently parsed delta is well formed.
        for (let offset = 0; offset < value.text.length;) {
          let end = Math.min(offset + 4096, value.text.length);
          if (end < value.text.length && /[\uD800-\uDBFF]/u.test(value.text[end - 1]!)) end--;
          await event({
            choices: [
              {
                index: 0,
                delta: {
                  [value.type === 'reasoning' ? 'reasoning_content' : 'content']: value.text.slice(
                    offset,
                    end,
                  ),
                },
                finish_reason: null,
              },
            ],
          });
          offset = end;
        }
      });
      this.tasks.add(handle);
      void handle.admitted.then(
        () => {
          this.requests++;
          admittedAt = performance.now();
        },
        () => undefined,
      );
      if (res.destroyed) this.cancelTask(handle);
      const result = await handle.done;
      if (result.recoveryRequired || result.outcome.reason === 'CANCEL_UNCONFIRMED') {
        this.error = 'RUNTIME_RECOVERY_REQUIRED';
        throw new ApiFault(
          503,
          'runtime_unavailable',
          'Native cancellation could not be confirmed. Recovery of the shared model may interrupt Chat work.',
          'server_error',
        );
      }
      const finish = successful(result);
      if (completion.stream) {
        await role();
        await event({ choices: [{ index: 0, delta: {}, finish_reason: finish }] });
        if (completion.includeUsage) await event({ choices: [], usage: result.usage });
        await write(res, 'data: [DONE]\n\n');
        ended = true;
        res.end();
      } else {
        await json(res, 200, {
          id,
          object: 'chat.completion',
          created,
          model: model.id,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: result.text,
                ...(result.reasoning ? { reasoning_content: result.reasoning } : {}),
              },
              finish_reason: finish,
            },
          ],
          usage: result.usage,
        });
        ended = true;
      }
      if (admittedAt !== undefined) {
        this.durations.push(Math.max(0, performance.now() - admittedAt));
        if (this.durations.length > 100) this.durations.shift();
      }
      this.log('REQUEST_COMPLETED', id);
    } catch (error) {
      if (handle) this.cancelTask(handle);
      const fault = safeFault(error);
      this.log('REQUEST_FAILED', id);
      if (!res.destroyed) {
        const body = {
          error: { message: fault.message, type: fault.type, param: fault.param, code: fault.code },
        };
        if (streamed) {
          await write(res, `data: ${JSON.stringify(body)}\n\n`);
          ended = true;
          res.end();
        } else {
          res.shouldKeepAlive = false;
          res.setHeader('Connection', 'close');
          // Discard unread bytes while the bounded error reply flushes. Pausing an
          // in-flight body can reset the socket before the client receives its 413.
          req.resume();
          await json(res, fault.status, body);
          ended = true;
        }
      }
    } finally {
      res.removeListener('close', disconnect);
      if (handle) this.tasks.delete(handle);
    }
  }
}
function successful(result: ApiGenerationResult): 'stop' | 'length' {
  if (
    (result.outcome.status === 'completed' || result.outcome.status === 'limit-reached') &&
    result.usage
  )
    return result.outcome.status === 'completed' ? 'stop' : 'length';
  throw safeFault(new Error(result.outcome.reason));
}
function safeFault(error: unknown): ApiFault {
  if (error instanceof ApiFault) return error;
  const code = error instanceof Error ? error.message : '';
  if (code === 'QUEUE_FULL')
    return new ApiFault(429, 'queue_full', 'The shared request queue is full.', 'rate_limit_error');
  if (code === 'CONTEXT_FULL')
    return new ApiFault(
      400,
      'context_exceeded',
      'The messages and output budget exceed the active context.',
    );
  if (code === 'QUEUE_TIMEOUT' || code === 'GENERATION_TIMEOUT')
    return new ApiFault(504, code.toLowerCase(), 'The request timed out.', 'server_error');
  if (code === 'USER_CANCELLED' || code === 'DENIED')
    return new ApiFault(503, 'request_cancelled', 'The request was cancelled.', 'server_error');
  if (code === 'CONFIGURATION_UNAVAILABLE' || code === 'HISTORY_UNAVAILABLE')
    return new ApiFault(
      503,
      'storage_unavailable',
      'Required local storage is unavailable.',
      'server_error',
    );
  if (code === 'INVALID_CONFIGURATION' || code === 'INVALID_CONTROL')
    return new ApiFault(400, 'invalid_request', 'The requested settings are unsupported.');
  return new ApiFault(
    503,
    'runtime_unavailable',
    'The runtime is unavailable. Stop the model and retry explicitly.',
    'server_error',
  );
}
function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const oversized = () => new ApiFault(413, 'request_too_large', 'Request body exceeds 256 KiB.');
    const declaredTooLarge = Number(req.headers['content-length'] ?? 0) > API_BODY_LIMIT;
    let size = 0;
    const cleanup = () => {
      clearTimeout(timer);
      req.removeListener('data', data);
      req.removeListener('end', end);
      req.removeListener('aborted', aborted);
      req.removeListener('error', aborted);
    };
    const fail = (error: Error) => {
      cleanup();
      req.pause();
      reject(error);
    };
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > API_BODY_LIMIT) {
        // Discard a bounded final block before closing an ordinary oversized upload.
        // Closing with its last bytes in flight can erase the 413 with a TCP reset.
        chunks.length = 0;
        if (size > API_BODY_LIMIT + 65536) fail(oversized());
        return;
      }
      if (!declaredTooLarge) chunks.push(chunk);
    };
    const end = () => {
      cleanup();
      if (declaredTooLarge || size > API_BODY_LIMIT) reject(oversized());
      else resolve(Buffer.concat(chunks, size));
    };
    const aborted = () => fail(new Error('CLIENT_DISCONNECTED'));
    const timer = setTimeout(
      () => fail(new ApiFault(400, 'invalid_request', 'Request body timed out.')),
      15000,
    );
    req.on('data', data);
    req.once('end', end);
    req.once('aborted', aborted);
    req.once('error', aborted);
  });
}
async function json(res: ServerResponse, status: number, value: unknown): Promise<void> {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  });
  await write(res, JSON.stringify(value));
  res.end();
}
/** Split even non-streaming replies into bounded writes, awaiting each stalled-reader drain. */
async function write(res: ServerResponse, text: string): Promise<void> {
  const bytes = Buffer.from(text);
  for (let offset = 0; offset < bytes.length; offset += 16384) {
    const chunk = bytes.subarray(offset, offset + 16384);
    if (res.destroyed || res.writableLength + chunk.length > 65536)
      throw new Error('CLIENT_DISCONNECTED');
    if (res.write(chunk)) continue;
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        res.removeListener('drain', drain);
        res.removeListener('close', closed);
        res.removeListener('error', closed);
      };
      const drain = () => {
        cleanup();
        resolve();
      };
      const closed = () => {
        cleanup();
        reject(new Error('CLIENT_DISCONNECTED'));
      };
      const timer = setTimeout(() => {
        closed();
        res.destroy();
      }, 5000);
      res.once('drain', drain);
      res.once('close', closed);
      res.once('error', closed);
    });
  }
}
