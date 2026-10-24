import { request } from 'node:http';
import { nativeContextSize } from '../runtime/context.js';
/** Fixed loopback endpoints, bounded payloads, no redirects and no public-health readiness shortcut. */
export async function checkOwnedReadiness(
  port: number,
  key: string,
  model: string,
  context: number,
  slots: number,
  ownsListener: () => boolean,
  signal: AbortSignal,
): Promise<number> {
  try {
    const allocation = nativeContextSize(context, slots);
    if (
      !Number.isInteger(port) ||
      port < 1024 ||
      port > 65535 ||
      !/^[a-zA-Z0-9_-]{1,128}$/u.test(key) ||
      signal.aborted ||
      !ownsListener()
    )
      throw new Error('NOT_READY');
    const get = (
      endpoint: '/v1/models' | '/props',
      authenticated: boolean,
    ): Promise<{ status: number; value: unknown }> =>
      new Promise((resolve, reject) => {
        const req = request(
          {
            hostname: '127.0.0.1',
            port,
            path: endpoint,
            method: 'GET',
            signal,
            timeout: 1000,
            headers: authenticated ? { authorization: `Bearer ${key}` } : {},
          },
          (response) => {
            let count = 0;
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => {
              count += chunk.length;
              if (count > 65536) {
                req.destroy(new Error('NOT_READY'));
                return;
              }
              chunks.push(chunk);
            });
            response.on('error', reject);
            response.on('end', () => {
              try {
                const bytes = Buffer.concat(chunks);
                const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
                resolve({
                  status: response.statusCode ?? 0,
                  value: response.statusCode === 200 ? JSON.parse(text) : null,
                });
              } catch {
                reject(new Error('NOT_READY'));
              }
            });
          },
        );
        req.on('timeout', () => req.destroy(new Error('NOT_READY')));
        req.on('error', reject);
        req.end();
      });
    if ((await get('/v1/models', false)).status !== 401 || !ownsListener())
      throw new Error('NOT_READY');
    const models = await get('/v1/models', true);
    if (
      models.status !== 200 ||
      !models.value ||
      typeof models.value !== 'object' ||
      !('data' in models.value) ||
      !Array.isArray(models.value.data) ||
      models.value.data.length !== 1 ||
      !ownsListener()
    )
      throw new Error('NOT_READY');
    const selected: unknown = models.value.data[0];
    if (!selected || typeof selected !== 'object' || !('id' in selected) || selected.id !== model)
      throw new Error('NOT_READY');
    const props = await get('/props', true);
    if (
      props.status !== 200 ||
      !props.value ||
      typeof props.value !== 'object' ||
      !('total_slots' in props.value) ||
      props.value.total_slots !== slots ||
      !('default_generation_settings' in props.value)
    )
      throw new Error('NOT_READY');
    const settings = props.value.default_generation_settings;
    if (
      !settings ||
      typeof settings !== 'object' ||
      !('n_ctx' in settings) ||
      !ownsListener() ||
      signal.aborted
    )
      throw new Error('NOT_READY');
    if (settings.n_ctx !== allocation.perSlot) throw Error('CONTEXT_MISMATCH');
    return settings.n_ctx;
  } catch (error) {
    if (error instanceof Error && error.message === 'CONTEXT_MISMATCH') throw error;
    throw new Error('NOT_READY', { cause: error });
  }
}
