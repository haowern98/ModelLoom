import {
  app,
  BrowserWindow,
  session,
  dialog,
  ipcMain,
  utilityProcess,
  clipboard,
  safeStorage,
  shell,
  nativeTheme,
} from 'electron';
import { createDesktopNetwork } from '../../../../packages/core/src/network/desktop';
import { decodeNetworkCommand, decodeNetworkReply } from '../shared/network';
import { validateLoginUrl } from '../../../../packages/core/src/network/wire';
import { networkProtection } from './network-protection';
import { developmentInstance } from './development-launch';
import { cleanupForQuit } from './quit-cleanup';
import { createApiManagementHandler } from './api-management';
import { createRuntimeLogsHandler } from './runtime-logs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { runtimePaths } from './runtime-paths';
import { createRuntimeController } from './runtime-controller';
import { watchDeviceChanges } from './device-changes';
import type { RuntimeDependencies } from './runtime-controller';
import { invalidateDeviceInventory, localDeviceSnapshot } from './local-device';
import { createCacheHandler } from './tensor-cache';
import type { developmentDesktopDependencies } from '../../../../packages/core/src/hosts/development-desktop.js';
import {
  createRuntimeLog,
  forwardUtilityDiagnostics,
} from '../../../../packages/core/src/hosts/runtime-diagnostics';

// Vite serves changing modules at stable URLs; stale Chromium cache can break startup.
if (MAIN_WINDOW_VITE_DEV_SERVER_URL) app.commandLine.appendSwitch('disable-http-cache');

let controller: ReturnType<typeof createRuntimeController> | undefined;
let network: ReturnType<typeof createDesktopNetwork> | undefined;
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
const primaryInstance = developmentInstance(
  app,
  process.env,
  () => BrowserWindow.getAllWindows()[0],
);

/** Creates the sandboxed renderer and sender-checked device/runtime bridge. */
async function createWindow(): Promise<void> {
  const chatCaller = randomUUID();
  const networkTarget = `${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch === 'x64' ? 'amd64' : process.arch}`;
  const networkAssets = app.isPackaged
    ? path.join(process.resourcesPath, 'tailscale')
    : path.resolve(__dirname, '../../../../components/tailscale/out', networkTarget);
  network ??= createDesktopNetwork({
    executable: path.join(
      networkAssets,
      `modelloom-network${process.platform === 'win32' ? '.exe' : ''}`,
    ),
    // Chromium owns a Network directory inside userData on Windows. Enrollment
    // needs its own namespace so browser files and case aliases cannot collide.
    directory: path.join(app.getPath('userData'), 'embedded-tailscale'),
    protection: networkProtection(safeStorage),
    openLogin: (url) => shell.openExternal(validateLoginUrl(url)),
  });
  const windowNetwork = network;
  if (process.platform === 'win32') nativeTheme.themeSource = 'dark';
  const window = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 1000,
    minHeight: 620,
    show: false,
    title: 'ModelLoom',
    backgroundColor: process.platform === 'win32' ? '#00000000' : '#212121',
    backgroundMaterial: process.platform === 'win32' ? 'mica' : 'none',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#c7c8d1', height: 44 },
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
  let tensorCache: ReturnType<typeof developmentDesktopDependencies>['tensorCache'] | undefined;
  let runtimeLog: ReturnType<typeof createRuntimeLog> | undefined;
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
      const logDirectory = path.join(locations.profile, 'logs');
      mkdirSync(logDirectory, { recursive: true });
      const diagnostics = createRuntimeLog(logDirectory);
      runtimeLog = diagnostics;
      diagnostics.write('app', `logging.started file=${path.join(logDirectory, 'runtime.log')}`);
      const development = createDependencies(
        (entry) => {
          const child = utilityProcess.fork(entry, [], {
            serviceName: 'ModelLoom Core',
            stdio: 'pipe',
          });
          forwardUtilityDiagnostics(child, diagnostics.write);
          child.on('exit', (code) => diagnostics.write('core', `utility.exit code=${code}`));
          return child;
        },
        locations.bootstrap,
        // Follow LM Studio's profile-root storage, separate from Chromium's AppData cache.
        locations.profile,
        chatCaller,
        locations.state,
        {
          addresses: () => windowNetwork.routes().filter((address) => /^100\./u.test(address)),
          dial: (address, port, signal) => windowNetwork.dial(address, port, signal),
          subscribe: (listener) => windowNetwork.subscribe(listener),
          incoming: (listener) => windowNetwork.setIncoming(listener),
        },
        diagnostics.write,
      );
      tensorCache = development.tensorCache;
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
  ipcMain.handle(
    'modelloom:tensor-cache',
    createCacheHandler({
      sender: window.webContents,
      frame: () => window.webContents.mainFrame,
      closing: () => quitting || window.isDestroyed(),
      owner: () => tensorCache,
      pick: async () => {
        const selected = await dialog.showOpenDialog(window, {
          title: 'Choose tensor cache location',
          properties: ['openDirectory', 'createDirectory'],
        });
        return selected.canceled ? null : (selected.filePaths[0] ?? null);
      },
    }),
  );
  watchDeviceChanges(window, () => {
    invalidateDeviceInventory();
    void windowController.deviceChanged().catch(() => {
      console.error('Hardware refresh could not be completed.');
    });
  });
  ipcMain.handle(
    'modelloom:runtime-logs',
    createRuntimeLogsHandler({
      sender: window.webContents,
      frame: () => window.webContents.mainFrame,
      closing: () => quitting || window.isDestroyed(),
      log: () => runtimeLog,
    }),
  );
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
  windowController.subscribePeers(() => {
    if (!quitting && !window.webContents.isDestroyed())
      window.webContents.send('modelloom:peers-changed');
    if (!quitting)
      void windowController
        .peers({ action: 'read' })
        .then((reply) => {
          if (reply.ok) return windowNetwork.setSharing(reply.view.sharing, reply.view.fingerprint);
        })
        .catch(() => undefined);
  });
  ipcMain.handle('modelloom:network', async (event, input: unknown) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      quitting
    )
      throw Error('INVALID_CONTROL');
    return decodeNetworkReply(await windowNetwork.command(decodeNetworkCommand(input)));
  });
  ipcMain.handle('modelloom:network-invite', async (event, input: unknown) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      quitting ||
      typeof input !== 'string' ||
      !/^[a-f0-9-]{36}$/u.test(input)
    )
      throw Error('INVALID_CONTROL');
    const candidate = windowNetwork.resolveCandidate(input);
    if (!candidate || !/^100\./u.test(candidate.address))
      return { ok: false, error: 'NETWORK_ROUTE_UNAVAILABLE' };
    return windowController.peers({
      action: 'invite',
      address: candidate.address,
      expectedFingerprint: candidate.fingerprint,
    });
  });
  windowNetwork.subscribe(() => {
    if (!quitting && !window.webContents.isDestroyed())
      window.webContents.send('modelloom:network-changed');
  });
  void windowNetwork.resume();
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

if (primaryInstance)
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
  void cleanupForQuit(controller, network).then(
    () => {
      quitConfirmed = true;
      app.quit();
    },
    (error: unknown) => {
      quitting = false;
      const messages: Record<string, string> = {
        RUNTIME_CLEANUP_FAILED: 'Runtime or peer cleanup could not be confirmed.',
        NETWORK_CLEANUP_FAILED: 'Network cleanup could not be confirmed.',
        RUNTIME_AND_NETWORK_CLEANUP_FAILED:
          'Runtime, peer and network cleanup could not be confirmed.',
      };
      const reason =
        error instanceof Error && Object.hasOwn(messages, error.message)
          ? messages[error.message]
          : 'Application cleanup could not be confirmed.';
      dialog.showErrorBox('Application cleanup failed', `${reason} The app remains open.`);
    },
  );
});
app.on('window-all-closed', () => app.quit());
