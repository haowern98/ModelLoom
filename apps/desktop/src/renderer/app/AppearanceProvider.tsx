import { useLayoutEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { AppearanceContext, themes } from './appearance';
import type { Theme } from './appearance';

const themeKey = 'modelloom.appearance.theme';
const motionKey = 'modelloom.appearance.reduce-motion';

function readPreference(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function savePreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The preference still applies for this session if storage is unavailable.
  }
}

function useMediaPreference(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia?.(query)?.matches ?? false);
  useLayoutEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => setMatches(media.matches);
    media.addEventListener?.('change', update);
    update();
    return () => media.removeEventListener?.('change', update);
  }, [query]);
  return matches;
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = readPreference(themeKey);
    return themes.find((option) => option === saved) ?? 'Dark';
  });
  const [reduceMotion, setReduceMotion] = useState(() => readPreference(motionKey) === 'true');
  const systemDark = useMediaPreference('(prefers-color-scheme: dark)');
  const systemReducedMotion = useMediaPreference('(prefers-reduced-motion: reduce)');
  const resolvedTheme = theme === 'Dark' || (theme === 'System' && systemDark) ? 'dark' : 'light';
  const reducedMotion = reduceMotion || systemReducedMotion;

  useLayoutEffect(() => {
    const nativeTheme = theme === 'Light' ? 'light' : theme === 'Dark' ? 'dark' : 'system';
    void window.modelLoomAppearance?.setTheme(nativeTheme).catch(() => {
      // The renderer theme still applies if the native window is closing.
    });
  }, [theme]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.dataset.reduceMotion = String(reducedMotion);
    return () => {
      delete root.dataset.theme;
      delete root.dataset.reduceMotion;
    };
  }, [resolvedTheme, reducedMotion]);

  return (
    <AppearanceContext.Provider
      value={{
        theme,
        resolvedTheme,
        reduceMotion,
        reducedMotion,
        setTheme: (value) => {
          setTheme(value);
          savePreference(themeKey, value);
        },
        setReduceMotion: (value) => {
          setReduceMotion(value);
          savePreference(motionKey, String(value));
        },
      }}
    >
      {children}
    </AppearanceContext.Provider>
  );
}
