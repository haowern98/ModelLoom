interface DeviceChangeWindow {
  hookWindowMessage(message: number, callback: (wParam: Buffer, lParam: Buffer) => void): void;
}

/** Observe Windows devnode changes through the existing native window; no new renderer command. */
export function watchDeviceChanges(
  window: DeviceChangeWindow,
  changed: () => void,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== 'win32') return;
  const message = 0x0219; // WM_DEVICECHANGE
  window.hookWindowMessage(message, (wParam) => {
    if (wParam.length >= 4 && wParam.readUInt32LE(0) === 0x0007) changed(); // DBT_DEVNODES_CHANGED
  });
  // The native window owns the hook. Keep it through a cancelled close/failed Quit.
}
