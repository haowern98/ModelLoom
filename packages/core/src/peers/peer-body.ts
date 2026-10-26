import type { IncomingMessage } from 'node:http';

/** Collect bytes as HTTP delivers them, before an owned duplex can close.
 * A raced close is acceptable only with parser-complete framing, an explicit
 * exact byte count and valid bounded JSON. Truncation never becomes success. */
export function readPeerBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    let settled = false;
    const chunks: Buffer[] = [];
    const header = request.headers['content-length'];
    const length =
      typeof header === 'string' && /^(?:0|[1-9]\d{0,4})$/u.test(header)
        ? Number(header)
        : undefined;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : Error('INVALID_PEER_MESSAGE'));
    };
    const finish = () => {
      if (settled) return;
      if (!request.complete || (length !== undefined && bytes !== length)) {
        fail(Error('INVALID_PEER_MESSAGE'));
        return;
      }
      try {
        const result: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        settled = true;
        resolve(result);
      } catch (error) {
        fail(error);
      }
    };
    const racedClose = (error: unknown) => {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ERR_STREAM_PREMATURE_CLOSE' &&
        request.complete &&
        length !== undefined &&
        bytes === length
      )
        finish();
      else fail(error);
    };
    const data = (chunk: Buffer | string) => {
      if (settled) return;
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += value.length;
      if (bytes > 16384) {
        fail(Error('PEER_MESSAGE_TOO_LARGE'));
        request.destroy();
        return;
      }
      chunks.push(value);
    };
    request.on('data', data);
    request.once('end', finish);
    request.on('error', racedClose);
    request.once('close', () => {
      racedClose(Object.assign(Error('Premature close'), { code: 'ERR_STREAM_PREMATURE_CLOSE' }));
      request.off('data', data);
      request.off('end', finish);
      request.off('error', racedClose);
    });
    if (
      (header !== undefined && length === undefined) ||
      (length !== undefined && length > 16384)
    ) {
      fail(Error(length !== undefined ? 'PEER_MESSAGE_TOO_LARGE' : 'INVALID_PEER_MESSAGE'));
      request.destroy();
    }
  });
}
