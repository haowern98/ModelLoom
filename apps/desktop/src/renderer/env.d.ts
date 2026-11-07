/// <reference types="vite/client" />

declare const __DEMO_DATA_ENABLED__: boolean;

interface Window {
  modelLoomAppearance?: {
    setTheme(theme: 'light' | 'dark' | 'system'): Promise<void>;
  };
}
