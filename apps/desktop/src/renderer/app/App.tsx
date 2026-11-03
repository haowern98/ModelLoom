import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { AppShell } from './AppShell';
import type { Destination, NavigationLocation } from './navigation';
import { useNavigationHistory } from './useNavigationHistory';
import type { ClusterView } from '../features/cluster/ClusterSidebar';
import { ModelsPage } from '../features/models/ModelsPage';
import { ModelConfigurationPage } from '../features/models/ModelConfigurationPage';
import { createDemoDefaults } from '../features/models/configuration';
import type { DemoConfiguration } from '../features/models/configuration';
import { fromModelEditor, toModelEditor } from '../features/models/live-configuration';
import type { ConfigurationReply } from '../../shared/model-configuration';
import { useClusterConfigurations } from '../features/cluster/useClusterConfigurations';
import { ClusterPage } from '../features/cluster/ClusterPage';
import { ChatPage } from '../features/chat/ChatPage';
import { ApiPage } from '../features/api/ApiPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { createDemoChat, transitionDemoChat } from '../mocks/chat';
import { createDemoPlacement, demoDevices, transitionDemoPlacement } from '../mocks/cluster';
import { createDemoJoining, transitionDemoJoining } from '../mocks/clusterJoining';
import { createDemoLibrary, transitionDemoLibrary } from '../mocks/modelLibrary';
import type { DemoModel } from '../mocks/modelLibrary';
import { Dialog } from '../components/Dialog';
import { Button } from '../components/Button';
import { useRuntime } from './useRuntime';
import { supportedDeviceGpus } from '../../shared/runtime';
import { useLiveChat } from '../features/chat/useLiveChat';
import { usePeerInventory } from '../features/cluster/usePeerInventory';
import { peerDevices } from '../features/cluster/peer-devices';

type Modal =
  { type: 'remove' | 'details'; model: DemoModel } | { type: 'info'; title: string; text: string };

export function App() {
  const runtime = useRuntime();
  const clusterConfigurations = useClusterConfigurations(window.modelLoomCluster);
  const live = runtime.view?.enabled === true;
  const liveChat = useLiveChat(live, runtime.view?.phase === 'ready');
  const demo = __DEMO_DATA_ENABLED__;
  const localDevice = runtime.view?.device;
  const local = live || (!demo && Boolean(localDevice));
  const peers = usePeerInventory(local && Boolean(window.modelLoomPeers));
  const [library, dispatch] = useReducer(transitionDemoLibrary, undefined, () =>
    demo ? createDemoLibrary() : { models: [], activeModelId: null },
  );
  const navigation = useNavigationHistory();
  const { destination, settingsCategory, configurationModelId } = navigation.location;
  const visit = navigation.visit;
  const replace = navigation.replace;
  const onClusterNavigation = useCallback(
    (clusterView: ClusterView, deviceId: string | null) => {
      visit({ clusterView, deviceId });
    },
    [visit],
  );
  const [connectionsRequest, setConnectionsRequest] = useState(0);
  const [speculativeRequest, setSpeculativeRequest] = useState(0);
  const [chat, dispatchChat] = useReducer(transitionDemoChat, demo, createDemoChat);
  const [deviceNames, setDeviceNames] = useState<Record<string, string>>({});
  const [joining, dispatchJoining] = useReducer(
    transitionDemoJoining,
    undefined,
    createDemoJoining,
  );
  const [placement, dispatchPlacement] = useReducer(transitionDemoPlacement, undefined, () =>
    createDemoPlacement(demo ? 'qwen' : null),
  );
  const [modal, setModal] = useState<Modal | null>(null);
  const [configurations, setConfigurations] = useState<Record<string, DemoConfiguration>>({});
  const [configurationReplies, setConfigurationReplies] = useState<
    Record<string, Extract<ConfigurationReply, { ok: true }>>
  >({});
  const configurationOpen = useRef(0);
  const restoreConfigurationFocus = useRef<string | null>(null);
  const importedModels: readonly DemoModel[] = (
    runtime.view?.models ?? (runtime.view?.model ? [runtime.view.model] : [])
  ).map((model) => ({
    ...model,
    identifier: model.filename ?? model.name,
    description: model.unavailable
      ? 'File unavailable. Re-import this model.'
      : 'Indexed GGUF model',
    family: 'unknown',
    quantization: model.quantization ?? 'Unknown',
    architecture: model.architecture ?? 'Unknown',
    parameters: model.parameters ?? 'Unknown',
    context: model.contextLimit ? String(model.contextLimit) : 'Unknown',
    ready: model.unavailable !== true,
  }));
  const importedModel = importedModels.find((model) => model.id === runtime.view?.model?.id);
  const displayLibrary = local
    ? {
        models: importedModels,
        activeModelId: runtime.view?.phase === 'ready' ? (importedModel?.id ?? null) : null,
      }
    : library;
  const configurationModel = displayLibrary.models.find(
    (model) => model.id === configurationModelId && !model.speculativeHead,
  );
  const configuration = configurationModel ? configurations[configurationModel.id] : undefined;
  const liveConfiguration = configurationModel
    ? configurationReplies[configurationModel.id]
    : undefined;
  const activeModel = displayLibrary.models.find(
    (model) => model.id === displayLibrary.activeModelId,
  );
  const [localSelection, setLocalSelection] = useState<string | null>(null);
  const currentChat = live ? liveChat.chat : chat;
  const chatDispatch = live ? liveChat.dispatch : dispatchChat;
  const previousChatId = useRef(currentChat.selectedId);
  useEffect(() => {
    const previous = previousChatId.current;
    previousChatId.current = currentChat.selectedId;
    if (destination !== 'Chat' || previous === currentChat.selectedId) return;
    // Initial history hydration is not a second user visit. A new chat is.
    if (!previous) replace({ chatId: currentChat.selectedId });
    else visit({ chatId: currentChat.selectedId });
  }, [currentChat.selectedId, destination, visit, replace]);

  useEffect(() => {
    if (destination !== 'Models' || configurationModel || !restoreConfigurationFocus.current)
      return;
    const label = restoreConfigurationFocus.current;
    Array.from(document.querySelectorAll('button'))
      .find((button) => button.getAttribute('aria-label') === label)
      ?.focus();
    restoreConfigurationFocus.current = null;
  }, [destination, configurationModel]);

  const commitNavigation = (next: Destination) => {
    configurationOpen.current++;
    visit({
      destination: next,
      configurationModelId: null,
      ...(next === 'Chat' ? { chatId: currentChat.selectedId } : {}),
    });
  };
  const navigate = (next: Destination) => {
    if (destination === 'Cluster' && next !== 'Cluster')
      void clusterConfigurations.requestLeave(() => commitNavigation(next));
    else commitNavigation(next);
  };
  const availableLocation = (location: NavigationLocation) => {
    if (location.destination === 'Chat' && location.chatId)
      return currentChat.conversations.some((item) => item.id === location.chatId);
    if (location.destination === 'Models' && location.configurationModelId)
      return displayLibrary.models.some((model) => model.id === location.configurationModelId);
    if (location.destination === 'Cluster' && location.deviceId)
      return (local ? [{ id: 'local' }, ...peerDevices(peers)] : demoDevices).some(
        (device) => device.id === location.deviceId,
      );
    return true;
  };
  const travel = (direction: -1 | 1) => {
    const target = navigation.target(direction, availableLocation);
    if (!target) return;
    const apply = () => {
      if (!navigation.move(target)) return;
      configurationOpen.current++;
      if (target.location.destination === 'Chat' && target.location.chatId)
        chatDispatch({ type: 'select', id: target.location.chatId });
    };
    if (destination === 'Cluster' && target.location.destination !== 'Cluster')
      void clusterConfigurations.requestLeave(apply);
    else apply();
  };

  useEffect(() => {
    if (live || !placement.launch) return;
    const modelId = placement.launch.modelId;
    if (!library.models.some((model) => model.id === modelId)) {
      dispatchPlacement({ type: 'cancel' });
      return;
    }
    // Simulate an observable, cancellable load. This never starts an engine or inference.
    const timer = window.setTimeout(() => {
      dispatch({ type: 'start', modelId });
      dispatchPlacement({ type: 'complete' });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [placement.launch, library.models, live]);

  const openConfiguration = (model: DemoModel) => {
    if (live) {
      const operation = ++configurationOpen.current;
      const bridge = window.modelLoomConfiguration;
      void (async () => {
        try {
          if (!bridge) throw Error('CONFIGURATION_UNAVAILABLE');
          const reply = await bridge.command({
            action: 'read',
            modelId: model.id.replace(/^model-/u, ''),
          });
          if (operation !== configurationOpen.current) return;
          if (!reply.ok) throw Error(reply.error);
          const saved = toModelEditor(reply.record);
          const preserve =
            configurationReplies[model.id]?.record.revision === reply.record.revision;
          setConfigurationReplies((current) => ({ ...current, [model.id]: reply }));
          setConfigurations((current) => ({
            ...current,
            [model.id]: {
              saved,
              draft: preserve ? (current[model.id]?.draft ?? saved) : saved,
            },
          }));
          visit({ destination: 'Models', configurationModelId: model.id });
        } catch {
          if (operation === configurationOpen.current)
            setModal({
              type: 'info',
              title: 'Model configuration',
              text: 'Saved settings are unavailable. Try opening model configuration again.',
            });
        }
      })();
      return;
    }
    setConfigurations((current) => {
      if (current[model.id]) return current;
      const draft = createDemoDefaults();
      return { ...current, [model.id]: { saved: draft, draft } };
    });
    visit({ destination: 'Models', configurationModelId: model.id });
  };

  const [dismissedRuntimeError, setDismissedRuntimeError] = useState<string | null>(null);
  const memoryWarning = runtime.view?.memoryWarning;
  const displayedModal =
    modal ??
    (runtime.view?.error && runtime.view.error !== dismissedRuntimeError
      ? { type: 'info' as const, title: 'Runtime', text: runtime.view.error }
      : null);
  const closeModal = () => {
    setModal(null);
    setDismissedRuntimeError(runtime.view?.error ?? null);
  };

  return (
    <AppShell
      destination={destination}
      onNavigate={navigate}
      demo={demo && !local}
      history={{
        canGoBack: Boolean(navigation.target(-1, availableLocation)),
        canGoForward: Boolean(navigation.target(1, availableLocation)),
        onBack: () => travel(-1),
        onForward: () => travel(1),
      }}
    >
      {destination === 'Models' && configurationModel && configuration ? (
        <ModelConfigurationPage
          key={configurationModel.id}
          model={configurationModel}
          configuration={configuration}
          speculativeAssets={displayLibrary.models}
          embeddedMtp={Boolean(configurationModel.embeddedMtp)}
          executionDevice={(() => {
            const allocation = clusterConfigurations.raw;
            if (!allocation || allocation.modelId !== configurationModel.id.replace(/^model-/u, ''))
              return 'Choose an allocation in Cluster';
            const device = allocation.proposerDevice ?? 'auto';
            if (device === 'auto') return 'Automatic';
            if (device === 'cpu') return `${localDevice?.name ?? 'This PC'} · CPU`;
            const localGpu = localDevice?.inventory?.gpus?.find(
              (gpu) => gpu.executionIdentity?.uuid === device,
            );
            if (localGpu) return `${localDevice?.name ?? 'This PC'} · ${localGpu.name}`;
            for (const peer of peerDevices(peers)) {
              const gpu = peer.hardware.find((entry) => entry.id === device);
              if (gpu) return `${peer.name} · ${gpu.name}`;
            }
            return 'Assigned device unavailable';
          })()}
          onChange={(draft) =>
            setConfigurations((current) => {
              const existing = current[configurationModel.id];
              return existing
                ? { ...current, [configurationModel.id]: { ...existing, draft } }
                : current;
            })
          }
          {...(live && liveConfiguration
            ? {
                live: {
                  maxOutputTokens: liveConfiguration.maxOutputTokens,
                  thinkingSupported: liveConfiguration.thinkingSupported,
                  pendingReload: liveConfiguration.pendingReload,
                  resetDefaults: toModelEditor(liveConfiguration.defaults),
                },
              }
            : {})}
          onSave={async (draft) => {
            const modelId = configurationModel.id;
            if (!live) {
              setConfigurations((current) => ({ ...current, [modelId]: { saved: draft, draft } }));
              return;
            }
            const bridge = window.modelLoomConfiguration;
            if (!bridge || !liveConfiguration) throw Error('CONFIGURATION_UNAVAILABLE');
            const previousDraft = configurations[modelId]?.draft;
            const record = fromModelEditor(draft, liveConfiguration.record);
            const reply = await bridge.command({
              action: 'save',
              modelId: record.modelId,
              expectedRevision: record.revision,
              record,
            });
            if (!reply.ok) throw Error(reply.error);
            const saved = toModelEditor(reply.record);
            setConfigurationReplies((current) => ({ ...current, [modelId]: reply }));
            setConfigurations((current) => ({
              ...current,
              [modelId]: {
                saved,
                draft:
                  JSON.stringify(current[modelId]?.draft) === JSON.stringify(previousDraft)
                    ? saved
                    : (current[modelId]?.draft ?? saved),
              },
            }));
            await clusterConfigurations.refreshModel(record.modelId);
            return { pendingReload: reply.pendingReload };
          }}
          onBack={() => {
            restoreConfigurationFocus.current = `Configure ${configurationModel.name}`;
            visit({ configurationModelId: null });
          }}
          onCluster={(section) => {
            if (section === 'speculation') setSpeculativeRequest((value) => value + 1);
            if (local) {
              setLocalSelection(configurationModel.id);
              void clusterConfigurations.selectModel(configurationModel.id);
            } else if (placement.modelId !== configurationModel.id) {
              dispatchPlacement({ type: 'choose', modelId: configurationModel.id, mode: 'manual' });
            }
            navigate('Cluster');
          }}
        />
      ) : destination === 'Models' ? (
        <ModelsPage
          library={displayLibrary}
          demo={demo && !live}
          {...(live
            ? {
                onImport: () => {
                  void runtime.run({ action: 'import' });
                },
                ...(runtime.view?.indexing ? { indexing: runtime.view.indexing } : {}),
                restoring: runtime.view?.restoring ?? false,
              }
            : {})}
          onRemove={(model) => setModal({ type: 'remove', model })}
          onDetails={(model) => setModal({ type: 'details', model })}
          onConfigure={openConfiguration}
          onInfo={(title, text) => setModal({ type: 'info', title, text })}
        />
      ) : destination === 'Cluster' ? (
        <ClusterPage
          navigation={{
            view: navigation.location.clusterView,
            deviceId: navigation.location.deviceId,
            onChange: onClusterNavigation,
          }}
          speculativeRequest={speculativeRequest}
          onSpeculationOpened={() => setSpeculativeRequest(0)}
          onModelConfiguration={(modelId) => {
            const model = displayLibrary.models.find(
              (entry) => entry.id.replace(/^model-/u, '') === modelId,
            );
            if (!model || model.speculativeHead) return;
            void clusterConfigurations.requestLeave(() => {
              openConfiguration(model);
            });
          }}
          connectionsRequest={connectionsRequest}
          onConnectionsOpened={() => setConnectionsRequest(0)}
          pendingPeerRequests={
            peers?.incoming.filter((request) => request.phase === 'pending').length ?? 0
          }
          demo={demo && !local}
          {...(local && window.modelLoomCluster ? { configurations: clusterConfigurations } : {})}
          joining={joining}
          onJoining={dispatchJoining}
          devices={
            local
              ? [
                  ...(localDevice
                    ? [
                        {
                          id: 'local',
                          name: localDevice.name,
                          role: localDevice.role,
                          os: localDevice.os,
                          ...(localDevice.inventory ? { inventory: localDevice.inventory } : {}),
                          address: 'This device',
                          hardware: [
                            {
                              id: 'local-cpu',
                              label: 'CPU',
                              name: localDevice.cpuName,
                              detail:
                                localDevice.threads > 0
                                  ? `${localDevice.inventory?.cpuCores !== undefined ? `${localDevice.inventory.cpuCores} cores · ` : ''}${localDevice.threads} threads`
                                  : 'Unavailable',
                              memoryGb: 0,
                              kind: 'cpu' as const,
                            },
                            ...supportedDeviceGpus(localDevice.inventory?.gpus ?? []).map(
                              (gpu, index, gpus) => ({
                                id: `local-${gpu.id}`,
                                label: gpus.length > 1 ? `GPU ${index}` : 'GPU',
                                name: gpu.name,
                                detail:
                                  gpu.memoryKind === 'unified'
                                    ? 'Unified memory shared with the system'
                                    : gpu.totalMemoryBytes !== undefined
                                      ? `${(gpu.totalMemoryBytes / 2 ** 30).toFixed(1)} GiB dedicated memory`
                                      : 'Dedicated memory unavailable',
                                memoryGb: (gpu.totalMemoryBytes ?? 0) / 2 ** 30,
                                kind: 'gpu' as const,
                              }),
                            ),
                          ],
                        },
                      ]
                    : []),
                  ...peerDevices(peers),
                ]
              : demoDevices.map((device) => ({
                  ...device,
                  name: deviceNames[device.id] ?? device.name,
                }))
          }
          onRenameDevice={(id, name) => setDeviceNames((current) => ({ ...current, [id]: name }))}
          activeModel={activeModel}
          models={displayLibrary.models.filter((model) => !model.speculativeHead)}
          placement={
            local
              ? {
                  ...createDemoPlacement(),
                  modelId: localSelection,
                  inputs: [],
                  baseline: [],
                  applied: [],
                  appliedModelId: activeModel?.id ?? null,
                }
              : placement
          }
          {...(local
            ? {
                localRuntime: {
                  activeCluster: runtime.view?.activeCluster ?? null,
                  loadingStage: runtime.view?.loadingStage,
                  loading:
                    runtime.loading ||
                    runtime.view?.phase === 'starting' ||
                    runtime.view?.phase === 'loading',
                  onChoose: (model: DemoModel) => {
                    void clusterConfigurations.selectModel(model.id);
                  },
                  onRunConfiguration: (configurationId: string, revision: number) => {
                    setDismissedRuntimeError(null);
                    void runtime.run({ action: 'run-configuration', configurationId, revision });
                  },
                  onRunDraft: (target: { key: string; revision: number; modelId: string }) => {
                    setDismissedRuntimeError(null);
                    void (async () => {
                      if (runtime.view?.phase === 'ready') await runtime.run({ action: 'stop' });
                      await runtime.run({
                        action: 'load',
                        modelId: `model-${target.modelId}`,
                        draft: { key: target.key, revision: target.revision },
                      });
                    })();
                  },
                  onRun: () => {
                    setDismissedRuntimeError(null);
                    if (localSelection)
                      void runtime.run({ action: 'load', modelId: localSelection });
                  },
                },
              }
            : {})}
          dispatch={dispatchPlacement}
          onStop={() => {
            if (live) {
              void runtime.run({ action: 'stop' });
              return;
            }
            if (activeModel) dispatch({ type: 'stop', modelId: activeModel.id });
            dispatchPlacement({ type: 'stop' });
          }}
        />
      ) : destination === 'Chat' ? (
        <ChatPage
          archived={navigation.location.chatArchived}
          onArchivedChange={(chatArchived) => visit({ chatArchived })}
          onConversationSelect={(chatId, chatArchived) => {
            visit({ chatId, chatArchived });
            chatDispatch({ type: 'select', id: chatId });
          }}
          demo={demo && !live}
          chat={currentChat}
          dispatch={chatDispatch}
          live={live ? liveChat.controls : undefined}
          activeModel={activeModel}
          onCluster={() => navigate('Cluster')}
        />
      ) : destination === 'API' ? (
        <ApiPage
          demo={demo && !live}
          activeModel={activeModel}
          onCluster={() => navigate('Cluster')}
        />
      ) : (
        <SettingsPage
          category={settingsCategory}
          onCategory={(settingsCategory) => visit({ settingsCategory })}
          onApi={() => navigate('API')}
          onConnections={() => {
            setConnectionsRequest((request) => request + 1);
            navigate('Cluster');
          }}
        />
      )}
      {memoryWarning && (
        <Dialog
          initialFocus="cancel"
          title="Not enough available memory"
          onClose={() => void runtime.answerMemory(memoryWarning.id, false)}
        >
          <p>
            This configuration is estimated to need more memory than is currently available. Loading
            may fail or run slowly. Your model and settings will stay the same.
          </p>
          <footer>
            <Button
              data-dialog-cancel
              autoFocus
              onClick={() => void runtime.answerMemory(memoryWarning.id, false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void runtime.answerMemory(memoryWarning.id, true)}
            >
              Load anyway
            </Button>
          </footer>
        </Dialog>
      )}
      {!memoryWarning && displayedModal && (
        <Dialog
          title={
            displayedModal.type === 'info'
              ? displayedModal.title
              : displayedModal.type === 'remove'
                ? 'Remove model entry?'
                : displayedModal.model.name
          }
          onClose={closeModal}
        >
          {displayedModal.type === 'info' && (
            <>
              <p>{displayedModal.text}</p>
              <footer>
                <Button onClick={closeModal}>Got it</Button>
              </footer>
            </>
          )}
          {displayedModal.type === 'remove' && (
            <>
              <p>
                Remove <strong>{displayedModal.model.name}</strong> from this{' '}
                {live ? 'model' : 'sample'} library? No model files will be deleted.
              </p>
              <footer>
                <Button onClick={closeModal}>Cancel</Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    if (live)
                      void runtime.run({ action: 'remove', modelId: displayedModal.model.id });
                    else dispatch({ type: 'remove', modelId: displayedModal.model.id });
                    setModal(null);
                  }}
                >
                  Remove entry
                </Button>
              </footer>
            </>
          )}
          {displayedModal.type === 'details' && (
            <>
              <p>
                {live
                  ? 'Bonsai file identity was verified during import. Runtime readiness is confirmed separately when you load it.'
                  : 'Sample metadata from the supplied screen. Compatibility and file contents have not been checked by a runtime.'}
              </p>
              <p>{displayedModal.model.description}</p>
              <dl>
                <div>
                  <dt>Identifier</dt>
                  <dd>{displayedModal.model.identifier}</dd>
                </div>
                <div>
                  <dt>Format</dt>
                  <dd>GGUF</dd>
                </div>
                <div>
                  <dt>Quantization</dt>
                  <dd>{displayedModal.model.quantization}</dd>
                </div>
                <div>
                  <dt>Size</dt>
                  <dd>{displayedModal.model.size}</dd>
                </div>
                <div>
                  <dt>Architecture</dt>
                  <dd>{displayedModal.model.architecture}</dd>
                </div>
                <div>
                  <dt>Parameters</dt>
                  <dd>{displayedModal.model.parameters}</dd>
                </div>
                <div>
                  <dt>Context length</dt>
                  <dd>{displayedModal.model.context}</dd>
                </div>
                <div>
                  <dt>Compatibility</dt>
                  <dd>{live ? 'Tested local development configuration only' : 'Not verified'}</dd>
                </div>
              </dl>
              <footer>
                <Button onClick={closeModal}>Close</Button>
              </footer>
            </>
          )}
        </Dialog>
      )}
    </AppShell>
  );
}
