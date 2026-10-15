import type { ChatTransport } from './service.js';

/** Record trusted native dispatch for both Chat and API. Queuing and token counting
 * do not touch usage. Join persistence before releasing the request's settlement.
 * A usage-storage failure must not alter generation output or native cleanup evidence.
 */
export function trackModelUse(
  transport: ChatTransport,
  record: (usedAt: number) => Promise<void>,
): ChatTransport {
  return {
    tokenCount: (messages, signal, settings) => transport.tokenCount(messages, signal, settings),
    start(identity, messages, progress, settings) {
      const native = transport.start(identity, messages, progress, settings);
      const usedAt = Date.now();
      const recorded = Promise.resolve()
        .then(() => record(usedAt))
        .catch(() => {
          console.error('Model last-use time could not be saved.');
        });
      return {
        cancel: () => native.cancel(),
        settled: (async () => {
          try {
            return await native.settled;
          } finally {
            await recorded;
          }
        })(),
      };
    },
  };
}
