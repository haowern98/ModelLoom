import { contextBridge, ipcRenderer } from 'electron';
import { decodeRuntimeCommand } from '../shared/runtime';
import { decodeChatCommand, decodeChatReply } from '../shared/chat';
/** Sandbox bridge exposes a closed data API, never ipcRenderer or a generic channel. */
contextBridge.exposeInMainWorld(
  'modelLoomRuntime',
  Object.freeze({
    command: (value: unknown) =>
      ipcRenderer.invoke('modelloom:runtime', decodeRuntimeCommand(value)),
  }),
);
contextBridge.exposeInMainWorld(
  'modelLoomChat',
  Object.freeze({
    command: (value: unknown) =>
      ipcRenderer.invoke('modelloom:chat', decodeChatCommand(value)).then(decodeChatReply),
    subscribe: (listener: () => void) => {
      if (typeof listener !== 'function') throw new Error('INVALID_CONTROL');
      const changed = () => listener();
      ipcRenderer.on('modelloom:chat-changed', changed);
      return () => ipcRenderer.removeListener('modelloom:chat-changed', changed);
    },
  }),
);
