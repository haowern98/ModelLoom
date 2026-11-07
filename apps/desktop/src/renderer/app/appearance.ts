import { createContext, useContext } from 'react';

export const themes = ['Light', 'Dark', 'System'] as const;
export type Theme = (typeof themes)[number];

export const AppearanceContext = createContext<{
  theme: Theme;
  resolvedTheme: 'dark' | 'light';
  reduceMotion: boolean;
  reducedMotion: boolean;
  setTheme: (theme: Theme) => void;
  setReduceMotion: (enabled: boolean) => void;
}>({
  theme: 'Dark',
  resolvedTheme: 'dark',
  reduceMotion: false,
  reducedMotion: false,
  setTheme: () => {},
  setReduceMotion: () => {},
});

export function useAppearance() {
  return useContext(AppearanceContext);
}
