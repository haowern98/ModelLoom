import { contextBridge, ipcRenderer } from 'electron';
import { decodeCatalogCommand } from '../shared/runtime-catalog';

contextBridge.exposeInMainWorld(
  'modelLoomRuntimeCatalog',
  Object.freeze({
    command: (input: unknown) =>
      ipcRenderer.invoke('modelloom:runtime-catalog', decodeCatalogCommand(input)),
  }),
);
contextBridge.exposeInMainWorld(
  'modelLoomAppearance',
  Object.freeze({
    setTheme: (theme: unknown) => {
      if (theme !== 'light' && theme !== 'dark' && theme !== 'system') return;
      return ipcRenderer.invoke('modelloom:appearance-theme', theme);
    },
  }),
);
import { decodeCacheCommand, decodeCacheReply } from '../shared/tensor-cache';
contextBridge.exposeInMainWorld(
  'modelLoomCache',
  Object.freeze({
    command: (input: unknown) =>
      ipcRenderer
        .invoke('modelloom:tensor-cache', decodeCacheCommand(input))
        .then(decodeCacheReply),
  }),
);
import { decodeNetworkCommand, decodeNetworkReply } from '../shared/network';
import { decodePeerCommand, decodePeerReply } from '../shared/peers';
import { decodeApiManagementCommand, decodeApiManagementReply } from '../shared/local-api';
import { decodeRuntimeLogCommand, decodeRuntimeLogReply } from '../shared/runtime-logs';
contextBridge.exposeInMainWorld(
  'modelLoomLogs',
  Object.freeze({
    command: (input: unknown) =>
      ipcRenderer
        .invoke('modelloom:runtime-logs', decodeRuntimeLogCommand(input))
        .then(decodeRuntimeLogReply),
  }),
);
import { decodeRuntimeCommand } from '../shared/runtime';
import { decodeChatCommand, decodeChatReply } from '../shared/chat';
import { decodeClusterCommand, decodeClusterReply } from '../shared/cluster-configuration';
import {
  decodeConfigurationCommand,
  decodeConfigurationReply,
} from '../shared/model-configuration';
/** Sandbox bridge exposes a closed data API, never ipcRenderer or a generic channel. */
contextBridge.exposeInMainWorld(
  'modelLoomNetwork',
  Object.freeze({
    command: (input: unknown) =>
      ipcRenderer.invoke('modelloom:network', decodeNetworkCommand(input)).then(decodeNetworkReply),
    subscribe: (listener: () => void) => {
      if (typeof listener !== 'function') throw Error('INVALID_CONTROL');
      const changed = () => listener();
      ipcRenderer.on('modelloom:network-changed', changed);
      return () => ipcRenderer.removeListener('modelloom:network-changed', changed);
    },
    invite: (candidateId: unknown) => {
      if (typeof candidateId !== 'string' || !/^[a-f0-9-]{36}$/u.test(candidateId))
        throw Error('INVALID_CONTROL');
      return ipcRenderer.invoke('modelloom:network-invite', candidateId).then(decodePeerReply);
    },
  }),
);
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
