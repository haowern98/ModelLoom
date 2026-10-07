import { contextBridge, ipcRenderer } from 'electron';
import { decodeRuntimeCommand } from '../shared/runtime';
/** Sandbox bridge exposes a closed data API, never ipcRenderer or a generic channel. */
contextBridge.exposeInMainWorld(
  'modelLoomRuntime',
  Object.freeze({
    command: (value: unknown) =>
      ipcRenderer.invoke('modelloom:runtime', decodeRuntimeCommand(value)),
  }),
);
