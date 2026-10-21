import { useEffect, useState } from 'react';
import { decodePeerReply } from '../../../shared/peers';
import type { PeerView } from '../../../shared/peers';

/** Read-only canvas inventory. Failed reads remove live authority, while saved
 * assignments remain in the separate configuration owner. */
export function usePeerInventory(enabled: boolean): PeerView | null {
  const [view, setView] = useState<PeerView | null>(null);
  useEffect(() => {
    if (!enabled || !window.modelLoomPeers) return;
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const reply = decodePeerReply(await window.modelLoomPeers!.command({ action: 'read' }));
        if (!stopped) setView(reply.ok ? reply.view : null);
      } catch {
        if (!stopped) setView(null);
      }
      if (!stopped)
        timer = setTimeout(() => {
          void read();
        }, 1500);
    };
    void read();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [enabled]);
  return enabled ? view : null;
}
