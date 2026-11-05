import { fileURLToPath } from 'node:url';
import type { EngineAdapter, OwnedEngine } from '../runtime/engine-adapter.js';
import type { Selection } from '../runtime/contracts.js';
import { MAX_CONTROL_BYTES, LIFECYCLE_POLICY } from '../runtime/contracts.js';
import { GENERATION_POLICY } from '../generation/contracts.js';
import { createFixtureDeployment } from './fixture-engine.js';
import type { FixtureMode } from './fixture-engine.js';
import { decodeBroker, decodeReply, selectionKey } from './broker-protocol.js';
import { FIXTURE_SCOPE } from './broker-protocol.js';
import type { BrokerScope } from './broker-protocol.js';
import { decodeObject, exact } from './control.js';
import { OwnerChatChannel } from './chat-channel.js';
import type { ChatTransport } from '../generation/service.js';
import type { Provenance } from '../history/store.js';
import type { ChatReply } from '../generation/chat-wire.js';
import { decodeChatCommand, decodeChatReply } from '../generation/chat-wire.js';
import {
  decodeConfigurationCommand,
  decodeConfigurationReply,
} from '../model-configuration/wire.js';
import type { ConfigurationReply } from '../model-configuration/wire.js';
import { decodeApiOwnerCommand, decodeApiOwnerReply } from '../local-api/wire.js';
import type { ApiOwnerCommand, ApiOwnerReply } from '../local-api/wire.js';
import { decodeClusterCommand, decodeClusterReply } from '../cluster/wire.js';
import { decodePeerCommand, decodePeerReply } from '../peers/wire.js';
import type { PeerReply } from '../peers/wire.js';
import type { ClusterReply } from '../cluster/wire.js';

/** Captured Electron utility child. This capability is constructed by trusted main, never IPC. */
export interface UtilityChild {
  readonly pid?: number | undefined;
  postMessage(text: string): void;
  on(event: 'spawn' | 'exit' | 'message', listener: (...args: unknown[]) => void): void;
  kill(): boolean;
}
export type UtilityFork = (entry: string) => UtilityChild;
export interface DesktopFixtureHost {
  command(text: string, retainClusterDrafts?: boolean): Promise<Record<string, unknown>>;
  close(): Promise<void>;
  chat?(caller: string, command: unknown): Promise<ChatReply>;
  configuration?(caller: string, command: unknown): Promise<ConfigurationReply>;
  cluster?(caller: string, command: unknown): Promise<ClusterReply>;
  peers?(caller: string, command: unknown): Promise<PeerReply>;
  api?(caller: string, command: unknown): Promise<ApiOwnerReply>;
  changed?(listener: () => void): () => void;
}
/** Trusted main supplies instance capabilities. No renderer-provided entry point or launcher. */
export interface DesktopDeployment {
  readonly adapter: EngineAdapter;
  /** Captured owner policy after preparation; no deadline comes from serialized controls. */
  startupMs?(): number;
  children(): readonly number[];
  admitCore(pid: number, expectedImage: string, launchTime: number): void;
  close(): Promise<void>;
  chat?(engine: OwnedEngine): ChatTransport;
  chatSetup?: {
    readonly applicationData: string;
    readonly caller: string;
    readonly provenance: Provenance;
    readonly resumeClusterDrafts?: true;
  };
  /** Optional fault hook for synthetic development tests; not provided by live desktop ownership. */
  crash?(): void;
}
/** Main-owned development fixture host; containment precedes utility launch authority. */
export async function createDesktopFixtureHost(
  fork: UtilityFork,
  mode: FixtureMode = 'ready',
): Promise<DesktopFixtureHost> {
  const deployment = createFixtureDeployment();
  return createDesktopEngineHost(fork, {
    adapter: deployment.adapter(mode),
    children: () => deployment.children(),
    admitCore: (pid, image, time) => deployment.admitCore(pid, image, time),
    close: () => deployment.close(),
    crash: () => deployment.crash(),
  });
}
/** Shared desktop broker. Main retains engine/core ownership; the utility runs lifecycle policy. */
export async function createDesktopEngineHost(
  fork: UtilityFork,
  deployment: DesktopDeployment,
  deploymentId = 'fixture-host',
  scope: BrokerScope = FIXTURE_SCOPE,
): Promise<DesktopFixtureHost> {
  const adapter = deployment.adapter;
  const began = Date.now();
  const utility = fork(fileURLToPath(new URL('../../scripts/utility-entry.cjs', import.meta.url)));
  let alive = true;
  let closing: Promise<void> | undefined;
  let engine: { key: string; value: OwnedEngine } | undefined;
  let launching = false;
  const chatPending = new Map<
    number,
    {
      resolve: (reply: ChatReply) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const observers = new Set<() => void>();
  let configurationId = 0;
  let clusterId = 0;
  let peerId = 0;
  const peerPending = new Map<
    number,
    {
      resolve: (reply: PeerReply) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const clusterPending = new Map<
    number,
    {
      resolve: (reply: ClusterReply) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  let apiId = 0;
  const apiPending = new Map<
    number,
    {
      command: ApiOwnerCommand;
      resolve: (reply: ApiOwnerReply) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const configurationPending = new Map<
    number,
    {
      resolve: (reply: ConfigurationReply) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  let chatId = 0;
  const chatChannel = new OwnerChatChannel(
    (value) => send(value),
    () => {
      if (!engine || !deployment.chat) throw new Error('NOT_READY');
      return { selection: engine.value.selection, transport: deployment.chat(engine.value) };
    },
    () => {
      utility.kill();
      void close().catch(() => undefined);
    },
  );
  let boot!: () => void;
  const booted = new Promise<void>((resolve) => {
    boot = resolve;
  });
  const pending = new Map<
    number,
    {
      resolve: (reply: Record<string, unknown>) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const send = (value: unknown) => {
    const text = JSON.stringify(value);
    if (!alive || Buffer.byteLength(text) > MAX_CONTROL_BYTES) throw new Error('CORE_EXITED');
    utility.postMessage(text);
  };
  function close(): Promise<void> {
    chatChannel.close();
    observers.clear();
    closing ??= deployment.close();
    return closing;
  }
  const exit = new Promise<void>((resolve) =>
    utility.on('exit', () => {
      alive = false;
      for (const item of pending.values()) {
        clearTimeout(item.timer);
        item.reject(new Error('CORE_EXITED'));
      }
      pending.clear();
      for (const item of chatPending.values()) {
        clearTimeout(item.timer);
        item.reject(new Error('CORE_EXITED'));
      }
      chatPending.clear();
      for (const item of configurationPending.values()) {
        clearTimeout(item.timer);
        item.reject(new Error('CORE_EXITED'));
      }
      configurationPending.clear();
      for (const item of clusterPending.values()) {
        clearTimeout(item.timer);
        item.reject(Error('CORE_EXITED'));
      }
      clusterPending.clear();
      for (const item of peerPending.values()) {
        clearTimeout(item.timer);
        item.reject(new Error('CORE_EXITED'));
      }
      peerPending.clear();
      for (const item of apiPending.values()) {
        clearTimeout(item.timer);
        item.reject(new Error('CORE_EXITED'));
      }
      apiPending.clear();
      void close().then(resolve, resolve);
    }),
  );
  const phase = (selection: Selection, state: string, code = 0, contextLength?: number) => {
    if (alive)
      send({
        type: 'engine',
        phase: state,
        selection,
        code,
        ...(contextLength === undefined ? {} : { contextLength }),
      });
  };
  utility.on('message', (input) => {
    void (async () => {
      if (typeof input !== 'string') throw new Error('INVALID_CONTROL');
      const envelope = decodeObject(input);
      if (envelope.type === 'peer-reply') {
        exact(envelope, ['type', 'id', 'reply']);
        if (
          typeof envelope.id !== 'number' ||
          !Number.isSafeInteger(envelope.id) ||
          Buffer.byteLength(input) > 131072
        )
          throw new Error('INVALID_CONTROL');
        const item = peerPending.get(envelope.id);
        if (!item) return;
        const reply = decodePeerReply(envelope.reply);
        clearTimeout(item.timer);
        peerPending.delete(envelope.id);
        item.resolve(reply);
        return;
      }
      if (envelope.type === 'cluster-reply') {
        exact(envelope, ['type', 'id', 'reply']);
        if (
          typeof envelope.id !== 'number' ||
          !Number.isSafeInteger(envelope.id) ||
          Buffer.byteLength(input) > 131072
        )
          throw Error('INVALID_CONTROL');
        const item = clusterPending.get(envelope.id);
        if (!item) return;
        const reply = decodeClusterReply(envelope.reply);
        clearTimeout(item.timer);
        clusterPending.delete(envelope.id);
        item.resolve(reply);
        return;
      }
      if (envelope.type === 'api-reply') {
        exact(envelope, ['type', 'id', 'reply']);
        if (typeof envelope.id !== 'number' || Buffer.byteLength(input) > 131072)
          throw new Error('INVALID_CONTROL');
        const item = apiPending.get(envelope.id);
        if (!item) return;
        const reply = decodeApiOwnerReply(envelope.reply, item.command);
        clearTimeout(item.timer);
        apiPending.delete(envelope.id);
        item.resolve(reply);
        return;
      }
      if (envelope.type === 'configuration-reply') {
        exact(envelope, ['type', 'id', 'reply']);
        if (typeof envelope.id !== 'number' || Buffer.byteLength(input) > 131072)
          throw new Error('INVALID_CONTROL');
        const reply = decodeConfigurationReply(envelope.reply),
          item = configurationPending.get(envelope.id);
        if (!item) return;
        clearTimeout(item.timer);
        configurationPending.delete(envelope.id);
        item.resolve(reply);
        return;
      }
      if (envelope.type === 'generation') {
        await chatChannel.receive(envelope);
        return;
      }
      if (envelope.type === 'chat-changed') {
        exact(envelope, ['type']);
        for (const observer of observers) observer();
        return;
      }
      if (envelope.type === 'chat-reply') {
        exact(envelope, ['type', 'id', 'reply']);
        if (typeof envelope.id !== 'number' || Buffer.byteLength(input) > 65536)
          throw new Error('INVALID_CONTROL');
        const reply = decodeChatReply(envelope.reply);
        const item = chatPending.get(envelope.id);
        if (!item) return;
        clearTimeout(item.timer);
        chatPending.delete(envelope.id);
        item.resolve(reply);
        return;
      }
      if (envelope.type === 'booted') {
        exact(envelope, ['type']);
        boot();
        return;
      }
      if (envelope.type === 'broker') {
        const command = decodeBroker(input, scope);
        const key = selectionKey(command.selection);
        if (command.action === 'launch') {
          if (engine || launching) throw new Error('BUSY');
          launching = true;
          try {
            const instance = await adapter.launch(command.selection, new AbortController().signal);
            engine = { key, value: instance };
            phase(command.selection, 'captured');
            void instance
              .waitReady(new AbortController().signal)
              .then(
                () => phase(command.selection, 'ready', 0, instance.contextLength),
                () => phase(command.selection, 'failed'),
              )
              .catch(() => {
                utility.kill();
                void close().catch(() => undefined);
              });
            void instance.exited
              .then((receipt) => {
                if (engine?.key === key) engine = undefined;
                phase(command.selection, 'exited', receipt.code ?? 1);
              })
              .catch(() => {
                utility.kill();
                void close().catch(() => undefined);
              });
          } catch {
            phase(command.selection, 'failed');
          } finally {
            launching = false;
          }
        } else if (engine?.key === key) {
          if (command.action === 'stop') await engine.value.requestStop();
          else if (command.action === 'force') await engine.value.forceStop();
          else if (deployment.crash) deployment.crash();
          else throw new Error('INVALID_CONTROL');
        }
        return;
      }
      exact(envelope, ['type', 'reply', 'quit']);
      if (envelope.type !== 'reply' || typeof envelope.quit !== 'boolean')
        throw new Error('INVALID_CONTROL');
      const reply = decodeReply(envelope.reply, scope);
      if (typeof reply.id !== 'number') throw new Error('INVALID_CONTROL');
      const waiter = pending.get(reply.id);
      if (!waiter) return;
      pending.delete(reply.id);
      clearTimeout(waiter.timer);
      try {
        if (envelope.quit) {
          send({ type: 'exit' });
          await exit;
          await close();
        }
        waiter.resolve({
          ...reply,
          pids: deployment.children(),
          corePid: utility.pid ?? 0,
          quit: envelope.quit,
        });
      } catch {
        waiter.reject(new Error('CLEANUP_FAILED'));
      }
    })().catch(() => {
      utility.kill();
      void close().catch(() => undefined);
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      // Cold utility imports and native storage setup can exceed five seconds.
      // This bounds service boot separately from the selected model's startup policy.
      const timer = setTimeout(() => reject(new Error('CORE_START_TIMEOUT')), 30_000);
      utility.on('exit', () => {
        clearTimeout(timer);
        reject(new Error('CORE_EXITED'));
      });
      utility.on('spawn', () => {
        try {
          const pid = utility.pid;
          if (!pid) throw new Error('CORE_EXITED');
          deployment.admitCore(pid, process.execPath, began);
          void booted
            .then(() => {
              send({
                type: 'admitted',
                deploymentId,
                packageId: scope.packageId,
                modelId: scope.modelId,
                ...(deployment.chatSetup ? { chat: deployment.chatSetup } : {}),
              });
              clearTimeout(timer);
              resolve();
            })
            .catch(reject);
        } catch {
          clearTimeout(timer);
          reject(new Error('OWNERSHIP_FAILED'));
        }
      });
    });
  } catch (error: unknown) {
    utility.kill();
    await close();
    throw error;
  }
  return {
    close,
    peers(caller, input) {
      if (
        !alive ||
        closing ||
        !deployment.chatSetup ||
        caller !== deployment.chatSetup.caller ||
        peerPending.size >= 16
      )
        return Promise.resolve({ ok: false, error: 'NOT_READY' });
      const command = decodePeerCommand(input),
        id = ++peerId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          peerPending.delete(id);
          reject(new Error('CORE_TIMEOUT'));
        }, 20000);
        peerPending.set(id, { resolve, reject, timer });
        try {
          send({ type: 'peer-command', id, caller, command });
        } catch {
          clearTimeout(timer);
          peerPending.delete(id);
          reject(new Error('CORE_EXITED'));
        }
      });
    },
    cluster(caller, input) {
      if (
        !alive ||
        closing ||
        !deployment.chatSetup ||
        caller !== deployment.chatSetup.caller ||
        clusterPending.size >= 16
      )
        return Promise.resolve({ ok: false, error: 'NOT_READY' });
      const command = decodeClusterCommand(input),
        id = ++clusterId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          clusterPending.delete(id);
          reject(Error('CORE_TIMEOUT'));
        }, 15000);
        clusterPending.set(id, { resolve, reject, timer });
        try {
          send({ type: 'cluster-command', id, caller, command });
        } catch {
          clearTimeout(timer);
          clusterPending.delete(id);
          reject(Error('CORE_EXITED'));
        }
      });
    },
    api(caller, input) {
      if (
        !alive ||
        closing ||
        !deployment.chatSetup ||
        caller !== deployment.chatSetup.caller ||
        apiPending.size >= 16
      )
        return Promise.resolve({ ok: false, error: 'NOT_READY' });
      const command = decodeApiOwnerCommand(input),
        id = ++apiId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          apiPending.delete(id);
          reject(new Error('CORE_TIMEOUT'));
        }, 30000);
        apiPending.set(id, { command, resolve, reject, timer });
        try {
          send({ type: 'api-command', id, caller, command });
        } catch {
          clearTimeout(timer);
          apiPending.delete(id);
          reject(new Error('CORE_EXITED'));
        }
      });
    },
    configuration(caller, input) {
      if (
        !alive ||
        closing ||
        !deployment.chatSetup ||
        caller !== deployment.chatSetup.caller ||
        configurationPending.size >= 16
      )
        return Promise.resolve({ ok: false, error: 'NOT_READY' });
      const command = decodeConfigurationCommand(input),
        id = ++configurationId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          configurationPending.delete(id);
          reject(new Error('CORE_TIMEOUT'));
        }, 15000);
        configurationPending.set(id, { resolve, reject, timer });
        try {
          send({ type: 'configuration-command', id, caller, command });
        } catch {
          clearTimeout(timer);
          configurationPending.delete(id);
          reject(new Error('CORE_EXITED'));
        }
      });
    },
    changed(listener) {
      observers.add(listener);
      return () => observers.delete(listener);
    },
    chat(caller, input) {
      if (
        !alive ||
        closing ||
        !deployment.chatSetup ||
        caller !== deployment.chatSetup.caller ||
        chatPending.size >= 16
      )
        return Promise.resolve({ ok: false, error: 'NOT_READY' });
      const command = decodeChatCommand(input),
        id = ++chatId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          chatPending.delete(id);
          reject(new Error('CORE_TIMEOUT'));
        }, GENERATION_POLICY.generationMs + 5000);
        chatPending.set(id, { resolve, reject, timer });
        try {
          send({ type: 'chat-command', id, caller, command });
        } catch {
          clearTimeout(timer);
          chatPending.delete(id);
          reject(new Error('CORE_EXITED'));
        }
      });
    },
    command(text, retainClusterDrafts = false) {
      let value: Record<string, unknown>;
      try {
        value = decodeObject(text);
      } catch {
        return Promise.resolve({ id: 0, error: 'INVALID_CONTROL', pids: deployment.children() });
      }
      if (
        typeof value.id !== 'number' ||
        !Number.isSafeInteger(value.id) ||
        (retainClusterDrafts && value.action !== 'quit') ||
        value.id < 1 ||
        pending.has(value.id) ||
        pending.size >= 64
      )
        return Promise.resolve({ id: 0, error: 'INVALID_CONTROL', pids: deployment.children() });
      const id = value.id;
      const startupMs =
        value.action === 'load'
          ? (deployment.startupMs?.() ?? LIFECYCLE_POLICY.startupMs)
          : LIFECYCLE_POLICY.startupMs;
      if (!Number.isInteger(startupMs) || startupMs <= 0 || startupMs > 2_147_478_647)
        return Promise.resolve({ id, error: 'INVALID_CONTROL', pids: deployment.children() });
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('CORE_TIMEOUT'));
          utility.kill();
          void close().catch(() => undefined);
        }, startupMs + 5_000);
        pending.set(id, { resolve, reject, timer });
        try {
          send({ type: 'command', text, ...(retainClusterDrafts ? { retainClusterDrafts } : {}) });
        } catch {
          clearTimeout(timer);
          pending.delete(id);
          reject(new Error('CORE_EXITED'));
        }
      });
    },
  };
}
