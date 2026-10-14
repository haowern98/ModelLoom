import { contextBridge, ipcRenderer } from 'electron';
import { decodeApiManagementCommand, decodeApiManagementReply } from '../shared/local-api';
import { decodeRuntimeCommand } from '../shared/runtime';
import { decodeChatCommand, decodeChatReply } from '../shared/chat';
import {
  decodeConfigurationCommand,
  decodeConfigurationReply,
} from '../shared/model-configuration';
/** Sandbox bridge exposes a closed data API, never ipcRenderer or a generic channel. */
contextBridge.exposeInMainWorld(
  'modelLoomApi',
  Object.freeze({
    command: (input: unknown) => {
      const command = decodeApiManagementCommand(input);
      return ipcRenderer
        .invoke('modelloom:api', command)
        .then((reply) => decodeApiManagementReply(reply, command.action === 'revealKey'));
    },
  }),
);
contextBridge.exposeInMainWorld(
  'modelLoomRuntime',
  Object.freeze({
    command: (value: unknown) =>
      ipcRenderer.invoke('modelloom:runtime', decodeRuntimeCommand(value)),
  }),
);
contextBridge.exposeInMainWorld(
  'modelLoomConfiguration',
  Object.freeze({
    command: (value: unknown) =>
      ipcRenderer
        .invoke('modelloom:configuration', decodeConfigurationCommand(value))
        .then(decodeConfigurationReply),
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
