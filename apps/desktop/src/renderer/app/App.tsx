import { useEffect, useReducer, useRef, useState } from 'react';
import { AppShell } from './AppShell';
import type { Destination } from './navigation';
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
import type { SettingsCategory } from '../features/settings/SettingsPage';
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
  const [library, dispatch] = useReducer(transitionDemoLibrary, undefined, () =>
    demo ? createDemoLibrary() : { models: [], activeModelId: null },
  );
  const [destination, setDestination] = useState<Destination>('Models');
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>('Appearance');
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
  const [configurationModelId, setConfigurationModelId] = useState<string | null>(null);
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
    (model) => model.id === configurationModelId,
  );
  const configuration = configurationModel ? configurations[configurationModel.id] : undefined;
  const liveConfiguration = configurationModel
    ? configurationReplies[configurationModel.id]
    : undefined;
  const activeModel = displayLibrary.models.find(
    (model) => model.id === displayLibrary.activeModelId,
  );
  const [localSelection, setLocalSelection] = useState<string | null>(null);

  useEffect(() => {
    if (destination !== 'Models' || configurationModel || !restoreConfigurationFocus.current)
      return;
    const label = restoreConfigurationFocus.current;
    Array.from(document.querySelectorAll('button'))
      .find((button) => button.getAttribute('aria-label') === label)
      ?.focus();
    restoreConfigurationFocus.current = null;
  }, [destination, configurationModel]);

  const navigate = (next: Destination) => {
    configurationOpen.current++;
    setConfigurationModelId(null);
    setDestination(next);
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
    <AppShell destination={destination} onNavigate={navigate} demo={demo && !local}>
      {destination === 'Models' && configurationModel && configuration ? (
        <ModelConfigurationPage
          key={configurationModel.id}
          model={configurationModel}
          configuration={configuration}
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
          }}
          onBack={() => {
            restoreConfigurationFocus.current = `Configure ${configurationModel.name}`;
            setConfigurationModelId(null);
          }}
          onCluster={() => navigate('Cluster')}
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
          onRemove={(model) =>
            live
              ? setModal({
                  type: 'info',
                  title: 'Remove model',
                  text: 'Model removal is not connected in this first local runtime slice.',
                })
              : setModal({ type: 'remove', model })
          }
          onDetails={(model) => setModal({ type: 'details', model })}
          onConfigure={(model) => {
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
                  setConfigurationModelId(model.id);
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
            setConfigurationModelId(model.id);
          }}
          onInfo={(title, text) => setModal({ type: 'info', title, text })}
        />
      ) : destination === 'Cluster' ? (
        <ClusterPage
          demo={demo && !local}
          {...(local && window.modelLoomCluster ? { configurations: clusterConfigurations } : {})}
          joining={joining}
          onJoining={dispatchJoining}
          devices={
            local
              ? localDevice
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
                          kind: 'cpu',
                        },
                        ...supportedDeviceGpus(localDevice.inventory?.gpus ?? []).map(
                          (gpu, index, gpus) => ({
                            id: `local-${gpu.id}`,
                            label: gpus.length > 1 ? `GPU ${index}` : 'GPU',
                            name: gpu.name,
                            detail:
                              gpu.totalMemoryBytes !== undefined
                                ? `${(gpu.totalMemoryBytes / 2 ** 30).toFixed(1)} GiB dedicated memory`
                                : 'Dedicated memory unavailable',
                            memoryGb: (gpu.totalMemoryBytes ?? 0) / 2 ** 30,
                            kind: 'gpu' as const,
                          }),
                        ),
                      ],
                    },
                  ]
                : []
              : demoDevices.map((device) => ({
                  ...device,
                  name: deviceNames[device.id] ?? device.name,
                }))
          }
          onRenameDevice={(id, name) => setDeviceNames((current) => ({ ...current, [id]: name }))}
          activeModel={activeModel}
          models={displayLibrary.models}
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
                  loading:
                    runtime.loading ||
                    runtime.view?.phase === 'starting' ||
                    runtime.view?.phase === 'loading',
                  onChoose: (model: DemoModel) => {
                    setLocalSelection(model.id);
                    void clusterConfigurations.selectModel(model.id);
                  },
                  onRunConfiguration: (configurationId: string, revision: number) => {
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
          demo={demo && !live}
          chat={live ? liveChat.chat : chat}
          dispatch={live ? liveChat.dispatch : dispatchChat}
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
          onCategory={setSettingsCategory}
          onApi={() => navigate('API')}
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
                Remove <strong>{displayedModal.model.name}</strong> from this sample library? No
                model files will be deleted.
              </p>
              <footer>
                <Button onClick={closeModal}>Cancel</Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    dispatch({ type: 'remove', modelId: displayedModal.model.id });
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
