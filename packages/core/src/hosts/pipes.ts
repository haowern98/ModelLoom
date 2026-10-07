import type { Readable, Writable } from 'node:stream';
import { MAX_CONTROL_BYTES } from '../runtime/contracts.js';

/** Local inherited NDJSON only; overlong/unfinished input closes the host, without echoing data. */
export function commandLines(
  input: Readable,
  consume: (text: string) => void,
  close: () => void,
): void {
  let buffer = Buffer.alloc(0);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let closed = false;
  const end = () => {
    if (!closed) {
      closed = true;
      close();
    }
  };
  input.on('data', (chunk: Buffer) => {
    if (closed) return;
    // A stream chunk is bounded by Node's pipe reader; the retained partial line is separately bounded.
    buffer = Buffer.concat([buffer, chunk]);
    let newline: number;
    while ((newline = buffer.indexOf(10)) !== -1) {
      if (newline > MAX_CONTROL_BYTES) {
        end();
        return;
      }
      try {
        consume(decoder.decode(buffer.subarray(0, newline)));
      } catch {
        end();
        return;
      }
      buffer = buffer.subarray(newline + 1);
    }
    if (buffer.length > MAX_CONTROL_BYTES) end();
  });
  input.on('end', end);
  input.on('error', end);
}
export async function writeReply(output: Writable, value: unknown): Promise<void> {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > MAX_CONTROL_BYTES) throw new Error('INVALID_CONTROL');
  await new Promise<void>((resolve, reject) =>
    output.write(text + '\n', (error) => (error ? reject(error) : resolve())),
  );
}
