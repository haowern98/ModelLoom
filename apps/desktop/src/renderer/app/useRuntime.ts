import { useEffect, useRef, useState } from 'react';
import type { RuntimeCommand, RuntimeView } from '../../shared/runtime';
/** Public snapshots include persisted library metadata and transient indexing progress. */
export function useRuntime() {
  const [view, setView] = useState<RuntimeView | null>(null);
  const [selectedRuntime, setSelectedRuntime] = useState<RuntimeView['selectedRuntime']>();
  const [loading, setLoading] = useState(false);
  const generation = useRef(0),
    busy = useRef(false),
    importing = useRef(false);
  useEffect(() => {
    const bridge = window.modelLoomRuntime;
    if (!bridge) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    void bridge.command({ action: 'runtime-selection' }).then(
      (next) => {
        if (alive) setSelectedRuntime(next.selectedRuntime ?? null);
      },
      () => {
        if (alive) setSelectedRuntime(null);
      },
    );
    const poll = async () => {
      const current = generation.current;
      try {
        const next = await bridge.command({ action: 'snapshot' });
        if (alive && current === generation.current)
          setView((previous) =>
            !busy.current || importing.current
              ? next
              : previous
                ? {
                    ...previous,
                    ...(['starting', 'loading'].includes(next.phase)
                      ? { phase: next.phase, error: null, loadingStage: next.loadingStage }
                      : {}),
                    ...(next.device ? { device: next.device } : {}),
                    memoryWarning: next.memoryWarning ?? null,
                  }
                : null,
          );
      } catch {
        /* Main's Quit gate closes the bridge before the window disappears. */
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
    const startsLoad = command.action === 'load' || command.action === 'run-configuration';
    setLoading(startsLoad);
    // A retry is a new observation. Do not redisplay the previous attempt's fault
    // while main is still preparing the next one.
    if (startsLoad)
      setView((previous) =>
        previous ? { ...previous, error: null, memoryWarning: null, loadingStage: 0 } : null,
      );
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
  async function answerMemory(id: string, loadAnyway: boolean) {
    const bridge = window.modelLoomRuntime;
    if (!bridge) return;
    const current = generation.current;
    try {
      const next = await bridge.command({ action: 'memory-decision', id, loadAnyway });
      if (current === generation.current)
        setView((previous) =>
          previous?.memoryWarning?.id === id
            ? { ...previous, memoryWarning: next.memoryWarning ?? null }
            : previous,
        );
    } catch {
      /* Keep the warning open so the user can retry their decision. */
    }
  }
  return { view, selectedRuntime, loading, run, answerMemory };
}
