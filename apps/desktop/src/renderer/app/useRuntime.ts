import { useEffect, useRef, useState } from 'react';
import type { RuntimeCommand, RuntimeView } from '../../shared/runtime';
/** Public snapshots include persisted library metadata and transient indexing progress. */
export function useRuntime() {
  const [view, setView] = useState<RuntimeView | null>(null);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0),
    busy = useRef(false),
    importing = useRef(false);
  useEffect(() => {
    const bridge = window.modelLoomRuntime;
    if (!bridge) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!busy.current || importing.current) {
        const current = generation.current;
        try {
          const next = await bridge.command({ action: 'snapshot' });
          if (alive && current === generation.current && (!busy.current || importing.current))
            setView(next);
        } catch {
          /* Main's Quit gate closes the bridge before the window disappears. */
        }
      }
      if (alive)
        timer = setTimeout(() => {
          void poll();
        }, 500);
    };
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);
  async function run(command: RuntimeCommand) {
    const bridge = window.modelLoomRuntime;
    if (!bridge) return;
    const current = ++generation.current;
    busy.current = true;
    importing.current = command.action === 'import';
    setLoading(command.action === 'load');
    try {
      const next = await bridge.command(command);
      if (current === generation.current) setView(next);
    } catch {
      if (current === generation.current)
        setView((previous) =>
          previous
            ? { ...previous, phase: 'failed', error: 'The app connection failed. Stop and retry.' }
            : null,
        );
    } finally {
      if (current === generation.current) {
        ++generation.current;
        busy.current = false;
        importing.current = false;
        setLoading(false);
      }
    }
  }
  return { view, loading, run };
}
