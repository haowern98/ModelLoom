import { useEffect, useState } from 'react';
import { decodePeerReply } from '../../../shared/peers';
import type { PeerView } from '../../../shared/peers';

/** Read-only canvas inventory. Invalidations retain accepted facts while discarding
 * superseded reads, avoiding canvas churn during routine memory updates. */
export function usePeerInventory(enabled: boolean): PeerView | null {
  const [view, setView] = useState<PeerView | null>(null);
  useEffect(() => {
    const bridge = window.modelLoomPeers;
    if (!enabled || !bridge) return;
    let stopped = false,
      reading = false,
      revision = 0,
      pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    queueMicrotask(() => {
      if (!stopped) setView(null);
    });
    const read = async () => {
      if (stopped) return;
      if (reading) {
        pending = true;
        return;
      }
      clearTimeout(timer);
      reading = true;
      const startedAt = revision;
      try {
        const reply = decodePeerReply(await bridge.command({ action: 'read' }));
        if (!stopped && startedAt === revision) setView(reply.ok ? reply.view : null);
      } catch {
        if (!stopped && startedAt === revision) setView(null);
      } finally {
        reading = false;
        if (!stopped) {
          if (pending) {
            pending = false;
            void read();
          } else
            timer = setTimeout(
              () => {
                void read();
              },
              bridge.subscribe ? 10000 : 1500,
            );
        }
      }
    };
    const unsubscribe = bridge.subscribe?.(() => {
      if (stopped) return;
      revision++;
      void read();
    });
    void read();
    return () => {
      stopped = true;
      clearTimeout(timer);
      unsubscribe?.();
    };
  }, [enabled]);
  return enabled ? view : null;
}
