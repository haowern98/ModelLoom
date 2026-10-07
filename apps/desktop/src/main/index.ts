import { app, BrowserWindow, session, dialog, ipcMain, utilityProcess } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRuntimeController } from './runtime-controller';
import type { RuntimeDependencies } from './runtime-controller';
import { localDeviceSnapshot } from './local-device';
import type { developmentDesktopDependencies } from '../../../../packages/core/src/hosts/development-desktop.js';

let controller: ReturnType<typeof createRuntimeController> | undefined;
let quitting = false,
  quitConfirmed = false;

/** Creates the sandboxed renderer and sender-checked device/runtime bridge. */
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
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // All in-app navigation is React state. A page cannot replace the trusted renderer.
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.once('ready-to-show', () => window.show());

  let dependencies: RuntimeDependencies = {
    enabled: false,
    device: () => Promise.resolve(localDeviceSnapshot()),
  };
  // A packaged/ordinary build never discovers a developer runtime from ambient paths or env.
  if (!app.isPackaged) {
    const coreRoot = path.resolve(__dirname, '../../../../packages/core');
    try {
      const module: unknown = await import(
        pathToFileURL(path.join(coreRoot, 'out/hosts/development-desktop.js')).href
      );
      if (
        !module ||
        typeof module !== 'object' ||
        !('developmentDesktopDependencies' in module) ||
        typeof module.developmentDesktopDependencies !== 'function'
      )
        throw new Error('MISSING_RUNTIME');
      const createDependencies =
        module.developmentDesktopDependencies as typeof developmentDesktopDependencies;
      const development = createDependencies(
        (entry) =>
          utilityProcess.fork(entry, [], { serviceName: 'ModelLoom Core', stdio: 'ignore' }),
        path.join(coreRoot, 'out/activation/b11306'),
      );
      dependencies = {
        ...development,
        device: async () => {
          const local = localDeviceSnapshot();
          try {
            return { ...local, ...(await development.device()) };
          } catch {
            return local;
          }
        },
        pick: async () => {
          const selected = await dialog.showOpenDialog(window, {
            title: 'Import GGUF',
            properties: ['openFile'],
            filters: [{ name: 'GGUF model', extensions: ['gguf'] }],
          });
          return selected.canceled ? null : (selected.filePaths[0] ?? null);
        },
      };
    } catch {
      /* Missing explicit development assets keep the ordinary preview closed. */
    }
  }
  const windowController = createRuntimeController(dependencies);
  controller = windowController;
  ipcMain.handle('modelloom:runtime', async (event, input: unknown) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      quitting
    )
      throw new Error('INVALID_CONTROL');
    return windowController.command(input);
  });
  window.on('close', (event) => {
    if (!quitConfirmed) {
      event.preventDefault();
      app.quit();
    }
  });

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

// Full Quit waits for core policy and confirmed owned-engine exit before main releases ownership.
app.on('before-quit', (event) => {
  if (quitConfirmed) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  void (controller?.quit() ?? Promise.resolve()).then(
    () => {
      quitConfirmed = true;
      app.quit();
    },
    () => {
      quitting = false;
      dialog.showErrorBox(
        'Runtime cleanup failed',
        'Owned runtime exit could not be confirmed. The app remains open.',
      );
    },
  );
});
app.on('window-all-closed', () => app.quit());
