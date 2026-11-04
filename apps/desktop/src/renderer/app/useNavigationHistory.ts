import { useCallback, useRef, useState } from 'react';
import type { NavigationLocation } from './navigation';

interface HistoryState {
  entries: readonly NavigationLocation[];
  index: number;
}
interface HistoryTarget {
  index: number;
  location: NavigationLocation;
}
const initial: NavigationLocation = {
  destination: 'Models',
  settingsCategory: 'Appearance',
  clusterView: 'overview',
  deviceId: null,
  configurationModelId: null,
  chatId: null,
  chatArchived: false,
};

/** Per-window route history, separate from assignment edits and runtime state. */
export function useNavigationHistory() {
  const [state, setState] = useState<HistoryState>({ entries: [initial], index: 0 });
  const current = useRef(state);
  const write = useCallback((patch: Partial<NavigationLocation>, replace: boolean) => {
    const previous = current.current;
    const location = previous.entries[previous.index]!;
    const next = { ...location, ...patch };
    if (
      (Object.keys(next) as (keyof NavigationLocation)[]).every(
        (key) => next[key] === location[key],
      )
    )
      return;
    const entries = replace
      ? previous.entries.map((entry, index) => (index === previous.index ? next : entry))
      : [...previous.entries.slice(0, previous.index + 1), next];
    current.current = { entries, index: replace ? previous.index : entries.length - 1 };
    setState(current.current);
  }, []);
  const visit = useCallback((patch: Partial<NavigationLocation>) => write(patch, false), [write]);
  const replace = useCallback((patch: Partial<NavigationLocation>) => write(patch, true), [write]);
  const target = useCallback(
    (
      direction: -1 | 1,
      available: (location: NavigationLocation) => boolean = () => true,
    ): HistoryTarget | null => {
      for (
        let index = state.index + direction;
        index >= 0 && index < state.entries.length;
        index += direction
      ) {
        const location = state.entries[index]!;
        if (available(location)) return { index, location };
      }
      return null;
    },
    [state],
  );
  const move = useCallback((next: HistoryTarget) => {
    // A departure dialog may resolve after the user has chosen a different branch.
    if (current.current.entries[next.index] !== next.location) return false;
    current.current = { ...current.current, index: next.index };
    setState(current.current);
    return true;
  }, []);
  return { location: state.entries[state.index]!, visit, replace, target, move };
}
