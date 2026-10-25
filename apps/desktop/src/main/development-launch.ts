interface InstanceApp {
  readonly isPackaged: boolean;
  requestSingleInstanceLock(): boolean;
  on(event: 'second-instance', listener: () => void): unknown;
  exit(code: number): void;
}
interface InstanceWindow {
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
}
/** Source sessions use one launcher/profile. Packaging remains a separate release/test workflow. */
export function developmentInstance(
  app: InstanceApp,
  env: Readonly<Record<string, string | undefined>>,
  window: () => InstanceWindow | undefined,
): boolean {
  if (!app.isPackaged && env.MODELLOOM_DEV_LAUNCH !== 'electron-dev') {
    console.error('Start ModelLoom with npm run electron dev from the workspace root.');
    app.exit(1);
    return false;
  }
  if (!app.requestSingleInstanceLock()) {
    app.exit(0);
    return false;
  }
  app.on('second-instance', () => {
    const current = window();
    if (current?.isMinimized()) current.restore();
    current?.show();
    current?.focus();
  });
  return true;
}
