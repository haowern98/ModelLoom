import { app, BrowserWindow, session } from 'electron';
import path from 'node:path';

/** Creates a renderer without Node, a preload, or privileged IPC; native controls own the window. */
async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 1000,
    minHeight: 620,
    show: false,
    title: 'ModelLoom',
    backgroundColor: '#212121',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#212121', symbolColor: '#c7c8d1', height: 44 },
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });

  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // All in-app navigation is React state. A page cannot replace the trusted renderer.
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.once('ready-to-show', () => window.show());

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    await window.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
}

void app
  .whenReady()
  .then(async () => {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    await createWindow();
  })
  .catch((error: unknown) => {
    console.error('ModelLoom could not open its desktop window:', error);
    app.quit();
  });

// Full Quit applies on every platform. The current milestone owns no native engines.
app.on('window-all-closed', () => app.quit());
