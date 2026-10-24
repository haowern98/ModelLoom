import type { ChatTransport } from './service.js';
import type { GenerationExecution } from './admission.js';

/** Suspend peer probes before native work starts. Failed native cleanup retains
 * its activity reference until the enclosing engine proves exit. */
export function withPeerActivity(
  transport: ChatTransport,
  setBusy: (busy: boolean) => Promise<void>,
): ChatTransport {
  let active = 0;
  let transition = Promise.resolve();
  const notify = (busy: boolean) => (transition = transition.then(() => setBusy(busy)));
  const acquire = () => {
    active += 1;
    return active === 1 ? notify(true) : transition;
  };
  const release = () => {
    active -= 1;
    return active === 0 ? notify(false) : Promise.resolve();
  };
  return {
    async tokenCount(messages, signal, settings) {
      await acquire();
      try {
        return await transport.tokenCount(messages, signal, settings);
      } finally {
        await release();
      }
    },
    start(identity, messages, progress, settings) {
      let cancelled = false;
      let native: GenerationExecution | undefined;
      const settled = (async () => {
        await acquire();
        if (cancelled) {
          await release();
          return { status: 'cancelled' as const, reason: 'USER_CANCELLED' as const };
        }
        try {
          native = transport.start(identity, messages, progress, settings);
        } catch (error) {
          // A synchronous transport rejection guarantees no native work exists.
          await release();
          throw error;
        }
        const outcome = await native.settled;
        await release();
        return outcome;
      })();
      return {
        settled,
        cancel() {
          cancelled = true;
          return native?.cancel();
        },
      };
    },
  };
}
