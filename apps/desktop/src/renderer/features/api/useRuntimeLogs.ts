import { useEffect, useRef, useState } from 'react';
import { decodeRuntimeLogReply } from '../../../shared/runtime-logs';
import type { RuntimeLogEntry } from '../../../shared/runtime-logs';

export function useRuntimeLogs() {
  const [entries, setEntries] = useState<readonly RuntimeLogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const revision = useRef<number | undefined>(undefined),
    epoch = useRef(0),
    alive = useRef(false),
    clearing = useRef(false);
  useEffect(() => {
    alive.current = true;
    let stopped = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const version = epoch.current;
      try {
        if (clearing.current || !window.modelLoomLogs) return;
        const reply = decodeRuntimeLogReply(
          await window.modelLoomLogs.command({
            action: 'read',
            ...(revision.current === undefined ? {} : { after: revision.current }),
          }),
        );
        if (
          stopped ||
          version !== epoch.current ||
          !reply.ok ||
          reply.revision < (revision.current ?? 0)
        )
          return;
        revision.current = reply.revision;
        if (reply.entries !== null) setEntries(reply.entries);
      } catch {
        /* Retain the last valid diagnostics when the bridge is temporarily unavailable. */
      } finally {
        if (!stopped) timer = setTimeout(() => void poll(), 500);
      }
    };
    void poll();
    return () => {
      stopped = true;
      alive.current = false;
      clearTimeout(timer);
    };
  }, []);
  const clear = async () => {
    if (clearing.current || !window.modelLoomLogs) return;
    clearing.current = true;
    epoch.current++;
    setBusy(true);
    try {
      const reply = decodeRuntimeLogReply(await window.modelLoomLogs.command({ action: 'clear' }));
      if (!alive.current) return;
      if (!reply.ok || reply.entries === null) throw Error('NOT_READY');
      revision.current = reply.revision;
      setEntries(reply.entries);
      return true;
    } catch {
      if (alive.current) return false;
    } finally {
      clearing.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return { entries, busy, clear };
}
