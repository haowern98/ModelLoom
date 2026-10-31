import { request } from 'node:http';
import { GENERATION_POLICY } from '../generation/contracts.js';
import { emitRuntimeDiagnostic } from './runtime-diagnostics.js';
import type { RuntimeDiagnostic } from './runtime-diagnostics.js';

/** Owner-private projection; native prompt/settings fields are discarded. */
export interface SlotStatus {
  readonly id: number;
  readonly processing: boolean;
  readonly task: number | null;
}

/**
 * Reads only authenticated GET /slots on a captured loopback listener.
 * Rechecks ownership after the response, bounds raw bytes to 1 MiB and the
 * projection to 64 KiB, and enforces the owner's absolute observation deadline.
 * Local reads default to five seconds; WAN reads may use the generation bound
 * because native state transfers can block the server's status task queue.
 * Rejects with STATUS_UNCONFIRMED, without retaining raw engine diagnostics.
 * This is an owner capability dependency, never a renderer/utility command.
 */
export async function readOwnedSlots(
  port: number,
  key: string,
  slots: number,
  owns: () => boolean,
  signal: AbortSignal,
  observationMs = 5000,
  diagnostic: RuntimeDiagnostic = emitRuntimeDiagnostic,
  monitorId?: string,
): Promise<readonly SlotStatus[]> {
  const started = performance.now();
  let phase = 'preflight',
    receivedBytes = 0;
  let httpStatus: number | undefined, owned: boolean | undefined, originalError: unknown;
  let observedSlots: number | undefined, slotIndex: number | undefined;
  const checkOwnership = () => {
    owned = owns();
    return owned;
  };
  try {
    if (
      !Number.isInteger(port) ||
      port < 1024 ||
      port > 65535 ||
      !/^[a-zA-Z0-9_-]{1,128}$/u.test(key) ||
      !Number.isInteger(slots) ||
      slots < 1 ||
      slots > 1024 ||
      !Number.isSafeInteger(observationMs) ||
      observationMs < 5000 ||
      observationMs > GENERATION_POLICY.generationMs ||
      signal.aborted ||
      !checkOwnership()
    )
      throw new Error('STATUS_UNCONFIRMED');
    const value: unknown = await new Promise((resolve, reject) => {
      let rejected = false;
      const failed = (where: string, error: unknown) => {
        if (!rejected) {
          phase = ['http-status', 'response-limit', 'deadline'].includes(phase) ? phase : where;
          originalError = error;
          rejected = true;
        }
        reject(error instanceof Error ? error : new Error('STATUS_UNCONFIRMED'));
      };
      phase = 'request';
      const req = request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/slots',
          method: 'GET',
          signal,
          headers: { authorization: `Bearer ${key}` },
        },
        (response) => {
          httpStatus = response.statusCode;
          if (response.statusCode !== 200) {
            phase = 'http-status';
            req.destroy(new Error('STATUS_UNCONFIRMED'));
            return;
          }
          let count = 0;
          phase = 'response-body';
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => {
            count += chunk.length;
            receivedBytes = count;
            if (count > 1048576) {
              phase = 'response-limit';
              req.destroy(new Error('STATUS_UNCONFIRMED'));
              return;
            }
            chunks.push(chunk);
          });
          response.on('error', (error) => failed('response-error', error));
          response.on('end', () => {
            try {
              phase = 'json';
              const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
              resolve(JSON.parse(text) as unknown);
            } catch (error) {
              failed('json', error);
            }
          });
        },
      );
      const timer = setTimeout(() => {
        phase = 'deadline';
        req.destroy(new Error('STATUS_UNCONFIRMED'));
      }, observationMs);
      req.on('close', () => clearTimeout(timer));
      req.on('error', (error) =>
        failed(
          ['http-status', 'response-limit', 'deadline'].includes(phase) ? phase : 'request-error',
          error,
        ),
      );
      req.end();
    });
    phase = 'response-shape';
    observedSlots = Array.isArray(value) ? value.length : undefined;
    if (signal.aborted || !checkOwnership() || !Array.isArray(value) || value.length !== slots)
      throw new Error('STATUS_UNCONFIRMED');
    const ids = new Set<number>();
    const tasks = new Set<number>();
    const result = value.map((entry: unknown, index): SlotStatus => {
      slotIndex = index;
      phase = 'slot-fields';
      if (
        !entry ||
        typeof entry !== 'object' ||
        Array.isArray(entry) ||
        !('id' in entry) ||
        !('is_processing' in entry)
      )
        throw new Error('STATUS_UNCONFIRMED');
      const id = entry.id,
        processing = entry.is_processing;
      const task = 'id_task' in entry ? entry.id_task : null;
      phase = 'slot-id';
      if (typeof id !== 'number' || !Number.isInteger(id) || id < 0 || id >= slots || ids.has(id))
        throw new Error('STATUS_UNCONFIRMED');
      phase = 'slot-processing';
      if (typeof processing !== 'boolean') throw new Error('STATUS_UNCONFIRMED');
      phase = 'slot-task';
      if (
        task !== null &&
        (typeof task !== 'number' || !Number.isSafeInteger(task) || task < 0 || tasks.has(task))
      )
        throw new Error('STATUS_UNCONFIRMED');
      phase = 'processing-task-missing';
      if (processing && task === null) throw new Error('STATUS_UNCONFIRMED');
      ids.add(id);
      if (task !== null) tasks.add(task);
      return Object.freeze({ id, processing, task });
    });
    phase = 'projection-limit';
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 65536)
      throw new Error('STATUS_UNCONFIRMED');
    return Object.freeze(result);
  } catch {
    try {
      const codes = [
        'ECONNRESET',
        'ECONNREFUSED',
        'EPIPE',
        'ETIMEDOUT',
        'ABORT_ERR',
        'ERR_STREAM_PREMATURE_CLOSE',
        'ERR_STREAM_DESTROYED',
        'ERR_HTTP_HEADERS_TIMEOUT',
        'ERR_ENCODING_INVALID_ENCODED_DATA',
      ];
      const failure = originalError;
      const code: unknown = failure instanceof Error ? Reflect.get(failure, 'code') : undefined;
      diagnostic(
        'runtime',
        `slots.read-failed ${JSON.stringify({
          ...(monitorId && /^[a-f0-9-]{36}$/u.test(monitorId) ? { monitor: monitorId } : {}),
          phase,
          code: typeof code === 'string' && codes.includes(code) ? code : 'UNKNOWN',
          httpStatus,
          receivedBytes,
          expectedSlots: slots,
          observedSlots,
          slotIndex,
          elapsedMs: Math.round(performance.now() - started),
          deadlineMs: observationMs,
          aborted: signal.aborted,
          owned,
        })}`,
      );
    } catch {
      /* Diagnostics cannot alter status failure or cleanup. */
    }
    throw new Error('STATUS_UNCONFIRMED');
  }
}
