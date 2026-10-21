import { app, BrowserWindow, session, dialog, ipcMain, utilityProcess, clipboard } from 'electron';
import { createApiManagementHandler } from './api-management';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { runtimePaths } from './runtime-paths';
import { createRuntimeController } from './runtime-controller';
import { watchDeviceChanges } from './device-changes';
import type { RuntimeDependencies } from './runtime-controller';
import { localDeviceSnapshot } from './local-device';
import type { developmentDesktopDependencies } from '../../../../packages/core/src/hosts/development-desktop.js';

// Vite serves changing modules at stable URLs; stale Chromium cache can break startup.
if (MAIN_WINDOW_VITE_DEV_SERVER_URL) app.commandLine.appendSwitch('disable-http-cache');

let controller: ReturnType<typeof createRuntimeController> | undefined;
let quitting = false,
  quitConfirmed = false;

const locations = runtimePaths({
  packaged: app.isPackaged,
  development: PACKAGED_DEVELOPMENT,
  resources: process.resourcesPath,
  workspaceCore: path.resolve(__dirname, '../../../../packages/core'),
  localData: process.env.LOCALAPPDATA ?? '',
  home: app.getPath('home'),
});
if (locations?.chromium) {
  app.setName('ModelLoom Development');
  mkdirSync(locations.chromium, { recursive: true });
  app.setPath('userData', locations.chromium);
  app.setPath('sessionData', locations.chromium);
}
const duplicateDevelopment = !!locations?.chromium && !app.requestSingleInstanceLock();
if (duplicateDevelopment) {
  app.exit(0);
} else if (locations?.chromium) {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
}

/** Creates the sandboxed renderer and sender-checked device/runtime bridge. */
async function createWindow(): Promise<void> {
  const chatCaller = randomUUID();
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
    device: () => localDeviceSnapshot(),
  };
  // Only the explicit compiled development profile can select packaged resources.
  if (locations) {
    const coreRoot = locations.core;
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
        locations.bootstrap,
        // Follow LM Studio's profile-root storage, separate from Chromium's AppData cache.
        locations.profile,
        chatCaller,
        locations.state,
      );
      dependencies = {
        ...development,
        device: async () => {
          const local = await localDeviceSnapshot();
          const runtimeBackends = development.runtimeBackends?.();
          return {
            ...local,
            inventory: { ...local.inventory, ...(runtimeBackends ? { runtimeBackends } : {}) },
          };
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
      if (app.isPackaged && PACKAGED_DEVELOPMENT)
        dialog.showErrorBox(
          'Development runtime unavailable',
          'The bundled development core could not be loaded. Rebuild the development package; no workspace fallback is used.',
        );
    }
  }
  const windowController = createRuntimeController(dependencies, chatCaller);
  controller = windowController;
  watchDeviceChanges(window, () => {
    void windowController.deviceChanged().catch(() => {
      console.error('Hardware refresh could not be completed.');
    });
  });
  ipcMain.handle(
    'modelloom:api',
    createApiManagementHandler({
      sender: window.webContents,
      frame: () => window.webContents.mainFrame,
      closing: () => quitting || window.isDestroyed(),
      command: (input) => windowController.api(input),
      copy: (secret) => clipboard.writeText(secret),
    }),
  );
  ipcMain.handle('modelloom:runtime', async (event, input: unknown) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      quitting
    )
      throw new Error('INVALID_CONTROL');
    return windowController.command(input);
  });
  ipcMain.handle('modelloom:chat', async (event, input: unknown) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      quitting
    )
      throw new Error('INVALID_CONTROL');
    return windowController.chat(input);
  });
  ipcMain.handle('modelloom:configuration', async (event, input: unknown) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      quitting
    )
      throw new Error('INVALID_CONTROL');
    return windowController.configuration(input);
  });
  ipcMain.handle('modelloom:cluster', async (event, input: unknown) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      quitting
    )
      throw Error('INVALID_CONTROL');
    return windowController.cluster(input);
  });
  ipcMain.handle('modelloom:peers', async (event, input: unknown) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      quitting
    )
      throw new Error('INVALID_CONTROL');
    return windowController.peers(input);
  });
  windowController.subscribeChat(() => {
    if (!quitting && !window.webContents.isDestroyed())
      window.webContents.send('modelloom:chat-changed');
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

if (!duplicateDevelopment)
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
