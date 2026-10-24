import { request } from 'node:http';
import { GENERATION_POLICY } from '../generation/contracts.js';

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
): Promise<readonly SlotStatus[]> {
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
      !owns()
    )
      throw new Error('STATUS_UNCONFIRMED');
    const value: unknown = await new Promise((resolve, reject) => {
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
          if (response.statusCode !== 200) {
            req.destroy(new Error('STATUS_UNCONFIRMED'));
            return;
          }
          let count = 0;
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => {
            count += chunk.length;
            if (count > 1048576) {
              req.destroy(new Error('STATUS_UNCONFIRMED'));
              return;
            }
            chunks.push(chunk);
          });
          response.on('error', reject);
          response.on('end', () => {
            try {
              const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
              resolve(JSON.parse(text) as unknown);
            } catch {
              reject(new Error('STATUS_UNCONFIRMED'));
            }
          });
        },
      );
      const timer = setTimeout(() => req.destroy(new Error('STATUS_UNCONFIRMED')), observationMs);
      req.on('close', () => clearTimeout(timer));
      req.on('error', reject);
      req.end();
    });
    if (signal.aborted || !owns() || !Array.isArray(value) || value.length !== slots)
      throw new Error('STATUS_UNCONFIRMED');
    const ids = new Set<number>();
    const tasks = new Set<number>();
    const result = value.map((entry: unknown): SlotStatus => {
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
      if (
        typeof id !== 'number' ||
        !Number.isInteger(id) ||
        id < 0 ||
        id >= slots ||
        ids.has(id) ||
        typeof processing !== 'boolean' ||
        (task !== null &&
          (typeof task !== 'number' ||
            !Number.isSafeInteger(task) ||
            task < 0 ||
            tasks.has(task))) ||
        (processing && task === null)
      )
        throw new Error('STATUS_UNCONFIRMED');
      ids.add(id);
      if (task !== null) tasks.add(task);
      return Object.freeze({ id, processing, task });
    });
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 65536)
      throw new Error('STATUS_UNCONFIRMED');
    return Object.freeze(result);
  } catch {
    throw new Error('STATUS_UNCONFIRMED');
  }
}
