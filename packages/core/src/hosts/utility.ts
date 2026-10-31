import type { EngineAdapter, OwnedEngine } from '../runtime/engine-adapter.js';
import type { Selection } from '../runtime/contracts.js';
import { MAX_CONTROL_BYTES } from '../runtime/contracts.js';
import { decodeObject, exact } from './control.js';
import { decodeEngine, selectionFrom, selectionKey } from './broker-protocol.js';
import { FIXTURE_SCOPE } from './broker-protocol.js';
import { fixtureSession } from './session.js';
import { ChatController } from '../generation/chat-controller.js';
import { UtilityChatTransport } from './chat-channel.js';
import { trackModelUse } from '../generation/model-use-transport.js';
import { openHistoryStore } from '../history/store.js';
import type { HistoryStore, Provenance } from '../history/store.js';
import { trustedHistoryRoot } from '../history/windows-directory.js';
import { openModelConfigurationStore } from '../model-configuration/store.js';
import { ConfigurationController } from '../model-configuration/controller.js';
import { ClusterController } from '../cluster/controller.js';
import { createConfigurationProfile } from '../model-configuration/development-profile.js';
import type { ActiveLoadSnapshot } from '../model-configuration/contracts.js';
import { actualizeContext } from '../model-configuration/resolve.js';
import { speculationOff } from '../speculative-decoding/contracts.js';
import type { ConfigurationReply } from '../model-configuration/wire.js';
import { ApiController } from '../local-api/controller.js';
import { windowsApiKeyProtection } from '../model-configuration/windows-protection.js';
import type { ApiOwnerReply } from '../local-api/wire.js';
import { captureClusterRun, captureClusterDraft } from '../cluster/run-plan.js';
import { requireStockClusterProfile } from '../cluster/stock-profile.js';
import { decodeClusterDevice } from '../cluster/device-id.js';
import {
  decodeSavedClusterConfiguration,
  decodeCapturedClusterLoad,
} from '../cluster/contracts.js';
import { isDeepStrictEqual } from 'node:util';
import { PeerOwner } from '../peers/owner.js';
import { decodePeerCommand } from '../peers/wire.js';
import type { PeerReply } from '../peers/wire.js';

export interface UtilityChannel {
  send(text: string): void;
  receive(handler: (text: unknown) => void): void;
  exit(code: number): void;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}
/** Utility core host: lifecycle, protected history and admission; no engine credentials or renderer channel. */
export function runUtility(
  channel: UtilityChannel,
  injectedHistory?: HistoryStore,
  injectedConfiguration?: ConfigurationController,
  injectedApi?: ApiController,
  injectedCluster?: ClusterController,
): void {
  let admitted = false;
  let scope = FIXTURE_SCOPE;
  let chat: ChatController | undefined, remote: UtilityChatTransport | undefined;
  let historyOwner: Awaited<ReturnType<typeof openHistoryStore>> | undefined;
  let chatPreparation: Promise<void> | undefined;
  let generationId = 0;
  let chatEpoch = 0;
  let provenance: Provenance | undefined;
  let configuration = injectedConfiguration;
  let cluster = injectedCluster;
  let lastCluster = 0;
  let lastPeer = 0;
  let peerSetup: { applicationData: string; caller: string } | undefined;
  let peerPreparation: Promise<PeerOwner> | undefined;
  let api = injectedApi,
    lastApi = 0;
  let configurationOwner: ReturnType<typeof openModelConfigurationStore> | undefined;
  let configurationPreparation: Promise<void> | undefined;
  let activeLoad: ActiveLoadSnapshot | null = null;
  const loadConfigurations = new Map<string, ActiveLoadSnapshot>();
  const loadProvenances = new Map<string, Provenance>();
  let lastConfiguration = 0;
  let lastChat = 0,
    quitting = false,
    dirty = false;
  const entries = new Map<
    string,
    {
      selection: Selection;
      capturedReceipt: boolean;
      captured: ReturnType<typeof deferred<OwnedEngine>>;
      ready: ReturnType<typeof deferred<void>>;
      exited: ReturnType<typeof deferred<{ code: number; signal: null }>>;
    }
  >();
  const send = (value: unknown) => {
    const text = JSON.stringify(value);
    if (Buffer.byteLength(text) > MAX_CONTROL_BYTES) throw new Error('INVALID_CONTROL');
    channel.send(text);
  };
  const adapter: EngineAdapter = {
    launch(input, abort) {
      const selection = selectionFrom(input, scope);
      const key = selectionKey(selection);
      if (!admitted || abort.aborted || entries.has(key))
        return Promise.reject(new Error('START_FAILED'));
      const entry = {
        selection,
        capturedReceipt: false,
        captured: deferred<OwnedEngine>(),
        ready: deferred<void>(),
        exited: deferred<{ code: number; signal: null }>(),
      };
      entries.set(key, entry);
      send({ type: 'broker', action: 'launch', selection });
      return entry.captured.promise;
    },
  };
  let session = fixtureSession(
    adapter,
    () => {
      const selection = session.core.snapshot().selection;
      if (selection) send({ type: 'broker', action: 'crash', selection });
    },
    () => channel.exit(23),
  );
  channel.receive((input) => {
    try {
      if (typeof input !== 'string') throw new Error('INVALID_CONTROL');
      const envelope = decodeObject(input);
      if (envelope.type === 'peer-command') {
        exact(envelope, ['type', 'id', 'caller', 'command']);
        if (
          !admitted ||
          typeof envelope.id !== 'number' ||
          !Number.isSafeInteger(envelope.id) ||
          envelope.id <= lastPeer ||
          !peerSetup ||
          envelope.caller !== peerSetup.caller
        )
          throw new Error('INVALID_CONTROL');
        lastPeer = envelope.id;
        const command = decodePeerCommand(envelope.command);
        const setup = peerSetup;
        if (!quitting) peerPreparation ??= PeerOwner.open(setup.applicationData, setup.caller);
        void (async (): Promise<PeerReply> => {
          try {
            const owner = await peerPreparation;
            return !quitting && owner
              ? await owner.command(setup.caller, command)
              : { ok: false, error: 'NOT_READY' };
          } catch {
            return { ok: false, error: 'PEER_UNAVAILABLE' };
          }
        })()
          .then((reply) => send({ type: 'peer-reply', id: envelope.id, reply }))
          .catch(() => channel.exit(1));
        return;
      }
      if (envelope.type === 'cluster-command') {
        exact(envelope, ['type', 'id', 'caller', 'command']);
        if (
          !admitted ||
          typeof envelope.id !== 'number' ||
          !Number.isSafeInteger(envelope.id) ||
          envelope.id <= lastCluster ||
          typeof envelope.caller !== 'string' ||
          envelope.caller.length > 128
        )
          throw Error('INVALID_CONTROL');
        lastCluster = envelope.id;
        const caller = envelope.caller;
        void (configurationPreparation ?? Promise.resolve())
          .catch(() => undefined)
          .then(() =>
            !quitting && cluster
              ? cluster.command(caller, envelope.command)
              : ({ ok: false, error: 'NOT_READY' } as const),
          )
          .then((reply) => send({ type: 'cluster-reply', id: envelope.id, reply }))
          .catch(() => channel.exit(1));
        return;
      }
      if (envelope.type === 'api-command') {
        exact(envelope, ['type', 'id', 'caller', 'command']);
        if (
          !admitted ||
          typeof envelope.id !== 'number' ||
          !Number.isSafeInteger(envelope.id) ||
          envelope.id <= lastApi ||
          typeof envelope.caller !== 'string' ||
          envelope.caller.length > 128
        )
          throw new Error('INVALID_CONTROL');
        lastApi = envelope.id;
        const caller = envelope.caller;
        void (configurationPreparation ?? Promise.resolve())
          .catch(() => undefined)
          .then((): Promise<ApiOwnerReply> | ApiOwnerReply =>
            !quitting && api
              ? api.command(caller, envelope.command)
              : { ok: false, error: quitting ? 'NOT_READY' : 'API_UNAVAILABLE' },
          )
          .then((reply) => send({ type: 'api-reply', id: envelope.id, reply }))
          .catch(() => channel.exit(1));
        return;
      }
      if (envelope.type === 'generation-result') {
        remote?.receive(envelope);
        return;
      }
      if (envelope.type === 'configuration-command') {
        exact(envelope, ['type', 'id', 'caller', 'command']);
        if (
          !admitted ||
          typeof envelope.id !== 'number' ||
          !Number.isSafeInteger(envelope.id) ||
          envelope.id <= lastConfiguration ||
          typeof envelope.caller !== 'string' ||
          envelope.caller.length > 128
        )
          throw new Error('INVALID_CONTROL');
        lastConfiguration = envelope.id;
        const caller = envelope.caller;
        void (configurationPreparation ?? Promise.resolve())
          .catch(() => undefined)
          .then(async (): Promise<ConfigurationReply> =>
            !quitting && configuration
              ? configuration.command(caller, envelope.command)
              : { ok: false, error: quitting ? 'NOT_READY' : 'CONFIGURATION_UNAVAILABLE' },
          )
          .then((reply) => send({ type: 'configuration-reply', id: envelope.id, reply }))
          .catch(() => channel.exit(1));
        return;
      }
      if (envelope.type === 'chat-command') {
        exact(envelope, ['type', 'id', 'caller', 'command']);
        if (
          !admitted ||
          typeof envelope.id !== 'number' ||
          !Number.isSafeInteger(envelope.id) ||
          envelope.id <= lastChat ||
          typeof envelope.caller !== 'string'
        )
          throw new Error('INVALID_CONTROL');
        lastChat = envelope.id;
        dirty = false;
        const caller = envelope.caller;
        const reply = (chatPreparation ?? Promise.resolve())
          .catch(() => undefined)
          .then(() =>
            !quitting && chat
              ? chat.command(caller, envelope.command)
              : {
                  ok: false,
                  error: !quitting && chatPreparation ? 'HISTORY_UNAVAILABLE' : 'NOT_READY',
                },
          );
        void reply
          .then((value) => send({ type: 'chat-reply', id: envelope.id, reply: value }))
          .catch(() => channel.exit(1));
        return;
      }
      if (envelope.type === 'admitted') {
        exact(envelope, [
          'type',
          'deploymentId',
          'packageId',
          'modelId',
          ...(envelope.chat === undefined ? [] : ['chat']),
        ]);
        if (admitted) throw new Error('INVALID_CONTROL');
        if (typeof envelope.deploymentId !== 'string') throw new Error('INVALID_CONTROL');
        const admittedSelection = selectionFrom(
          {
            deploymentId: envelope.deploymentId,
            packageId: envelope.packageId,
            modelId: envelope.modelId,
            sessionId: 'admission',
            operationId: 'admission',
          },
          {
            deploymentId: envelope.deploymentId,
            packageId: String(envelope.packageId),
            modelId: String(envelope.modelId),
          },
        );
        scope = {
          deploymentId: admittedSelection.deploymentId,
          packageId: admittedSelection.packageId,
          modelId: admittedSelection.modelId,
        };
        session = fixtureSession(
          adapter,
          () => {
            const selection = session.core.snapshot().selection;
            if (selection) send({ type: 'broker', action: 'crash', selection });
          },
          () => channel.exit(23),
          envelope.deploymentId,
        );
        admitted = true;
        if (envelope.chat !== undefined) {
          const setup = decodeObject(JSON.stringify(envelope.chat));
          exact(setup, ['applicationData', 'caller', 'provenance']);
          if (
            typeof setup.applicationData !== 'string' ||
            typeof setup.caller !== 'string' ||
            !/^[a-zA-Z0-9_-]{1,128}$/u.test(setup.caller)
          )
            throw new Error('INVALID_CONTROL');
          provenance = setup.provenance as Provenance;
          const caller = setup.caller,
            applicationData = setup.applicationData;
          peerSetup = { caller, applicationData };
          if (
            !injectedConfiguration &&
            provenance.upstreamCommit === '4f31296a907d73f3409f720429bcf31111615d77' &&
            /^[a-f0-9]{64}$/u.test(scope.modelId)
          ) {
            configurationPreparation = Promise.resolve().then(() => {
              const profile = createConfigurationProfile(provenance!);
              configurationOwner = openModelConfigurationStore(
                trustedHistoryRoot(applicationData),
                (modelId) => /^[a-f0-9]{64}$/u.test(modelId),
                profile.capabilities,
                profile.load,
                {
                  cacheK: provenance!.configuration.cacheK,
                  cacheV: provenance!.configuration.cacheV,
                },
              );
              configuration = new ConfigurationController(
                configurationOwner.store,
                caller,
                profile.capabilities,
                profile.load,
                () => activeLoad,
                async (modelId) =>
                  createConfigurationProfile(
                    provenance!,
                    (await configurationOwner!.store.readImportSource(modelId)) ?? undefined,
                  ).capabilities,
              );
              cluster = new ClusterController(configurationOwner.store, caller, {
                cacheK: provenance!.configuration.cacheK,
                cacheV: provenance!.configuration.cacheV,
              });
              if (!injectedApi)
                api = new ApiController(
                  configurationOwner.store,
                  caller,
                  scope.modelId,
                  profile.capabilities,
                  windowsApiKeyProtection,
                  () => activeLoad !== null && session.core.snapshot().phase === 'ready',
                  () => chat,
                );
            });
            void configurationPreparation.catch(() => undefined);
          }
          chatPreparation = (async () => {
            if (!injectedHistory)
              historyOwner = await openHistoryStore(trustedHistoryRoot(applicationData));
            const history = injectedHistory ?? historyOwner?.store;
            if (!history) throw new Error('HISTORY_UNAVAILABLE');
            chat = new ChatController(history, caller, () => {
              if (!dirty) {
                dirty = true;
                send({ type: 'chat-changed' });
              }
            });
          })();
          void chatPreparation.catch(() => undefined);
        }
        return;
      }
      if (envelope.type === 'exit') {
        exact(envelope, ['type']);
        if (session.core.snapshot().phase !== 'stopped') throw new Error('INVALID_CONTROL');
        channel.exit(0);
        return;
      }
      if (envelope.type === 'engine') {
        const event = decodeEngine(input, scope);
        const entry = entries.get(selectionKey(event.selection));
        if (!entry) return; // Late receipts cannot settle a newer load.
        switch (event.phase) {
          case 'captured':
            entry.capturedReceipt = true;
            entry.captured.resolve({
              selection: entry.selection,
              exited: entry.exited.promise,
              waitReady(signal) {
                if (signal.aborted) return Promise.reject(new Error('START_FAILED'));
                return new Promise<void>((resolve, reject) => {
                  const cancel = () => {
                    signal.removeEventListener('abort', cancel);
                    reject(new Error('START_FAILED'));
                  };
                  signal.addEventListener('abort', cancel, { once: true });
                  void entry.ready.promise
                    .then(resolve, reject)
                    .finally(() => signal.removeEventListener('abort', cancel));
                });
              },
              requestStop() {
                send({ type: 'broker', action: 'stop', selection: entry.selection });
                return Promise.resolve();
              },
              forceStop() {
                send({ type: 'broker', action: 'force', selection: entry.selection });
                return Promise.resolve();
              },
            });
            break;
          case 'ready': {
            const epoch = chatEpoch;
            void (async () => {
              await chatPreparation?.catch(() => undefined);
              if (
                quitting ||
                epoch !== chatEpoch ||
                entries.get(selectionKey(event.selection)) !== entry
              ) {
                entry.ready.resolve();
                return;
              }
              activeLoad = loadConfigurations.get(selectionKey(entry.selection)) ?? null;
              if (chat && provenance) {
                let activeProvenance =
                  loadProvenances.get(selectionKey(entry.selection)) ?? provenance;
                if (
                  activeLoad &&
                  provenance.upstreamCommit === '4f31296a907d73f3409f720429bcf31111615d77'
                ) {
                  if (event.contextLength === undefined) throw Error('CONTEXT_MISMATCH');
                  activeLoad = actualizeContext(activeLoad, event.contextLength);
                  activeProvenance = Object.freeze({
                    ...activeProvenance,
                    configuration: Object.freeze({
                      ...activeProvenance.configuration,
                      contextPerSlot: activeLoad.load.contextLength,
                    }),
                  });
                }
                remote = new UtilityChatTransport(entry.selection, send, () => ++generationId);
                try {
                  await chat.bind({
                    session: {
                      deploymentId: entry.selection.deploymentId,
                      sessionId: entry.selection.sessionId,
                      operationId: entry.selection.operationId,
                    },
                    provenance: activeProvenance,
                    transport: trackModelUse(remote, async (usedAt) => {
                      await configurationPreparation;
                      if (configurationOwner)
                        await configurationOwner.store.recordUse(entry.selection.modelId, usedAt);
                    }),
                    ...(provenance.upstreamCommit === '4f31296a907d73f3409f720429bcf31111615d77'
                      ? {
                          configuration: {
                            capabilities: createConfigurationProfile(
                              activeProvenance,
                              (await configurationOwner?.store.readImportSource(
                                entry.selection.modelId,
                              )) ?? undefined,
                            ).capabilities,
                            capture: async (overrides) => {
                              await configurationPreparation;
                              if (!configuration || !activeLoad)
                                throw new Error('CONFIGURATION_UNAVAILABLE');
                              return configuration.resolve(activeLoad, overrides);
                            },
                          },
                        }
                      : {}),
                    cleanup: () => {
                      send({ type: 'broker', action: 'stop', selection: entry.selection });
                      return Promise.resolve();
                    },
                  });
                } catch {
                  remote?.close();
                }
              }
              entry.ready.resolve();
            })().catch(() => channel.exit(1));
            break;
          }
          case 'exited':
            activeLoad = null;
            loadConfigurations.delete(selectionKey(event.selection));
            chatEpoch++;
            remote?.engineExited(event.selection);
            void chat?.bind(null).catch(() => channel.exit(1));
            entry.ready.reject(new Error('ENGINE_EXITED'));
            entry.exited.resolve({ code: event.code, signal: null });
            entries.delete(selectionKey(event.selection));
            break;
          case 'failed':
            loadConfigurations.delete(selectionKey(event.selection));
            entry.captured.reject(new Error('START_FAILED'));
            entry.ready.reject(new Error('START_FAILED'));
            // A captured engine still needs its exact owned-exit receipt for cleanup.
            if (!entry.capturedReceipt) entries.delete(selectionKey(event.selection));
            break;
        }
        return;
      }
      if (!admitted) throw new Error('INVALID_CONTROL');
      exact(envelope, ['type', 'text']);
      if (envelope.type !== 'command' || typeof envelope.text !== 'string')
        throw new Error('INVALID_CONTROL');
      const command = decodeObject(envelope.text);
      const handle = async () => {
        let remoteLoad = false;
        if (command.action === 'quit') quitting = true;
        if (command.action === 'quit' || command.action === 'stop') chatEpoch++;
        if (command.action === 'quit' || command.action === 'stop') activeLoad = null;
        if (command.action === 'quit' || command.action === 'stop') loadConfigurations.clear();
        if (command.action === 'quit' || command.action === 'stop') loadProvenances.clear();
        await chatPreparation?.catch(() => undefined);
        if (command.action === 'quit') {
          await configurationPreparation?.catch(() => undefined);
          await api?.close().catch(() => undefined);
        }
        if (command.action === 'quit' || command.action === 'stop') await chat?.bind(null);
        if (command.action === 'load' && (configuration || configurationPreparation)) {
          try {
            await configurationPreparation;
            if (quitting || !configuration) throw new Error('NOT_READY');
            const selection = selectionFrom(command.selection, scope);
            if (
              Object.hasOwn(command, 'clusterDraft') &&
              !Object.hasOwn(command, 'modelConfiguration')
            )
              throw Error('INVALID_CONTROL');
            let snapshot: ActiveLoadSnapshot;
            if (
              Object.hasOwn(command, 'clusterConfiguration') ||
              Object.hasOwn(command, 'modelConfiguration')
            ) {
              const direct = Object.hasOwn(command, 'modelConfiguration');
              exact(command, [
                'id',
                'action',
                'selection',
                direct ? 'modelConfiguration' : 'clusterConfiguration',
                ...(direct && Object.hasOwn(command, 'clusterDraft') ? ['clusterDraft'] : []),
              ]);
              const modelConfiguration = direct
                ? decodeSavedClusterConfiguration(command.modelConfiguration)
                : undefined;
              const target = command.clusterConfiguration;
              if (!direct && (!target || typeof target !== 'object' || Array.isArray(target)))
                throw Error('INVALID_CONTROL');
              const selected = modelConfiguration
                ? { id: modelConfiguration.id, revision: modelConfiguration.revision }
                : (target as Record<string, unknown>);
              exact(selected, ['id', 'revision', ...(direct ? [] : ['load'])]);
              if (
                typeof selected.id !== 'string' ||
                typeof selected.revision !== 'number' ||
                !configurationOwner ||
                !provenance
              )
                throw Error('NOT_READY');
              const saved =
                modelConfiguration ?? configurationOwner.store.cluster.read(selected.id);
              if (!saved || saved.modelId !== scope.modelId) throw Error('UNKNOWN_CONFIGURATION');
              if (
                !direct &&
                !isDeepStrictEqual(decodeCapturedClusterLoad(selected.load), saved.load)
              )
                throw Error('STALE_CONFIGURATION');
              if (modelConfiguration) {
                const defaults = await configurationOwner.store.read(scope.modelId);
                const source = await configurationOwner.store.readImportSource(scope.modelId);
                if (Object.hasOwn(command, 'clusterDraft')) {
                  const ref = decodeObject(JSON.stringify(command.clusterDraft));
                  exact(ref, ['key', 'revision']);
                  if (
                    typeof ref.key !== 'string' ||
                    typeof ref.revision !== 'number' ||
                    !source?.blockCount
                  )
                    throw Error('INVALID_CONTROL');
                  const draft = configurationOwner.store.cluster.readDraft(ref.key);
                  if (!draft || draft.modelId !== scope.modelId) throw Error('STALE_CONFIGURATION');
                  if (draft.load.defaults.contextLength > source.contextLimit)
                    throw Error('INVALID_CLUSTER_CONFIGURATION');
                  const expected = captureClusterDraft(
                    draft,
                    ref.revision,
                    source.blockCount,
                    createConfigurationProfile(provenance).capabilities.profileId,
                    saved.id,
                  );
                  if (!isDeepStrictEqual(saved, expected)) throw Error('STALE_CONFIGURATION');
                } else if (
                  defaults.revision !== saved.revision ||
                  source?.blockCount !== saved.blockCount ||
                  !isDeepStrictEqual(defaults.load, saved.load.defaults) ||
                  !isDeepStrictEqual(
                    defaults.speculation ?? speculationOff(),
                    saved.load.speculation ?? speculationOff(),
                  ) ||
                  !isDeepStrictEqual(defaults.preferences, saved.load.preferences)
                )
                  throw Error('STALE_CONFIGURATION');
              }
              const effective = captureClusterRun(
                saved,
                selected.revision,
                modelConfiguration
                  ? null
                  : configurationOwner.store.cluster.readDraft(`config:${saved.id}`),
                'b11306-cuda12.4-msvc14.44-dev1',
              );
              requireStockClusterProfile(effective);
              const companion = saved.load.speculation?.enabled
                ? saved.load.speculation.proposer?.source
                : undefined;
              if (
                companion?.kind === 'asset' &&
                !(await configurationOwner.store.readImportSource(companion.modelId))
              )
                throw Error('MODEL_FILE_UNAVAILABLE');
              remoteLoad = effective.placement.orderedUuids.some(
                (uuid) => decodeClusterDevice(uuid).kind === 'peer',
              );
              snapshot = Object.freeze({
                modelId: saved.modelId,
                revision: saved.revision,
                profileId: saved.profileId,
                load: saved.load.defaults,
                ...(saved.load.preferences ? { preferences: saved.load.preferences } : {}),
                ...(saved.load.speculation ? { speculation: saved.load.speculation } : {}),
              });
              loadProvenances.set(
                selectionKey(selection),
                Object.freeze({
                  ...provenance,
                  configuration: Object.freeze({
                    ...provenance.configuration,
                    gpuDevice: decodeClusterDevice(effective.placement.orderedUuids[0]!).uuid,
                    modelSha256: effective.modelSha256,
                    contextPerSlot: effective.contextPerSlot,
                    slots: effective.slots,
                    cacheK: effective.cacheK,
                    cacheV: effective.cacheV,
                    gpuLayers: effective.blockCount + 1,
                  }),
                  cluster: saved,
                }),
              );
            } else snapshot = await configuration.captureLoad(scope.modelId);
            if (
              snapshot.speculation?.enabled &&
              !Object.hasOwn(command, 'clusterConfiguration') &&
              !Object.hasOwn(command, 'modelConfiguration')
            )
              throw Error('NEEDS_SPECULATIVE_EVIDENCE');
            if (quitting) throw new Error('NOT_READY');
            loadConfigurations.set(selectionKey(selection), snapshot);
          } catch {
            return { reply: { id: command.id, error: 'NOT_READY' }, quit: false };
          }
        }
        const {
          clusterConfiguration: _clusterConfiguration,
          modelConfiguration: _modelConfiguration,
          clusterDraft: _clusterDraft,
          ...lifecycleCommand
        } = command;
        const reply = await session.handle(
          command.action === 'load' &&
            (_clusterConfiguration !== undefined ||
              _modelConfiguration !== undefined ||
              _clusterDraft !== undefined)
            ? JSON.stringify(lifecycleCommand)
            : (envelope.text as string),
          remoteLoad,
        );
        if (command.action === 'load' && reply.reply.error) {
          try {
            loadConfigurations.delete(selectionKey(selectionFrom(command.selection, scope)));
          } catch {
            /* Invalid controls never acquired a load snapshot. */
          }
        }
        if (reply.quit) {
          await peerPreparation?.then(
            (owner) => owner.close(),
            () => undefined,
          );
          await chat?.close();
          await configurationPreparation?.catch(() => undefined);
          await configuration?.close();
          await cluster?.close();
          configurationOwner?.close();
          remote?.close();
          historyOwner?.close();
        }
        return reply;
      };
      void handle()
        .then(({ reply, quit }) => send({ type: 'reply', reply, quit }))
        .catch(() => channel.exit(1));
    } catch {
      channel.exit(1);
    }
  });
  send({ type: 'booted' });
}
