import { contextBridge, ipcRenderer } from 'electron';
import { decodePeerCommand, decodePeerReply } from '../shared/peers';
import { decodeApiManagementCommand, decodeApiManagementReply } from '../shared/local-api';
import { decodeRuntimeCommand } from '../shared/runtime';
import { decodeChatCommand, decodeChatReply } from '../shared/chat';
import { decodeClusterCommand, decodeClusterReply } from '../shared/cluster-configuration';
import {
  decodeConfigurationCommand,
  decodeConfigurationReply,
} from '../shared/model-configuration';
/** Sandbox bridge exposes a closed data API, never ipcRenderer or a generic channel. */
contextBridge.exposeInMainWorld(
  'modelLoomPeers',
  Object.freeze({
    command: (input: unknown) =>
      ipcRenderer.invoke('modelloom:peers', decodePeerCommand(input)).then(decodePeerReply),
    subscribe: (listener: () => void) => {
      if (typeof listener !== 'function') throw Error('INVALID_CONTROL');
      const changed = () => listener();
      ipcRenderer.on('modelloom:peers-changed', changed);
      return () => ipcRenderer.removeListener('modelloom:peers-changed', changed);
    },
  }),
);
contextBridge.exposeInMainWorld(
  'modelLoomCluster',
  Object.freeze({
    command: (input: unknown) =>
      ipcRenderer.invoke('modelloom:cluster', decodeClusterCommand(input)).then(decodeClusterReply),
  }),
);
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
