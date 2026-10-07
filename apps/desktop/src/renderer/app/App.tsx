import { useEffect, useReducer, useRef, useState } from 'react';
import { AppShell } from './AppShell';
import type { Destination } from './navigation';
import { ModelsPage } from '../features/models/ModelsPage';
import { ModelConfigurationPage } from '../features/models/ModelConfigurationPage';
import { createDemoDefaults } from '../features/models/configuration';
import type { DemoConfiguration } from '../features/models/configuration';
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

type Modal =
  { type: 'remove' | 'details'; model: DemoModel } | { type: 'info'; title: string; text: string };

export function App() {
  const runtime = useRuntime();
  const live = runtime.view?.enabled === true;
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
  const restoreConfigurationFocus = useRef<string | null>(null);
  const configurationModel = library.models.find((model) => model.id === configurationModelId);
  const configuration = configurationModel ? configurations[configurationModel.id] : undefined;
  const importedModel: DemoModel | undefined = runtime.view?.model
    ? {
        ...runtime.view.model,
        identifier: 'prism-ml/bonsai-27b',
        description: 'Imported and hash-verified Bonsai 27B Q1_0',
        family: 'qwen',
        quantization: 'Q1_0',
        architecture: 'qwen35',
        parameters: '27B',
        context: '262144',
        ready: true,
      }
    : undefined;
  const displayLibrary = local
    ? {
        models: importedModel ? [importedModel] : [],
        activeModelId: runtime.view?.phase === 'ready' ? (importedModel?.id ?? null) : null,
      }
    : library;
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
          onSave={(draft) =>
            setConfigurations((current) => ({
              ...current,
              [configurationModel.id]: { saved: draft, draft },
            }))
          }
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
              setModal({
                type: 'info',
                title: 'Model configuration',
                text: 'This first connection uses the tested settings: 7,680 tokens per request, one slot, Q8_0 KV cache, full GPU offload, seed 7 and temperature 0.8. Custom settings are not connected yet.',
              });
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
                      address: 'This device',
                      hardware: [
                        {
                          id: 'local-cpu',
                          label: 'CPU',
                          name: localDevice.cpuName,
                          detail: `${localDevice.threads} threads`,
                          memoryGb: 0,
                          kind: 'cpu',
                        },
                        ...(localDevice.gpuMemoryGiB !== undefined
                          ? [
                              {
                                id: 'local-gpu',
                                label: 'GPU',
                                name: localDevice.gpuName ?? 'GPU name unavailable',
                                detail: `${localDevice.gpuMemoryGiB.toFixed(1)} GiB VRAM`,
                                memoryGb: localDevice.gpuMemoryGiB,
                                kind: 'gpu' as const,
                              },
                            ]
                          : []),
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
                  loading:
                    runtime.loading ||
                    runtime.view?.phase === 'starting' ||
                    runtime.view?.phase === 'loading',
                  onChoose: (model: DemoModel) => setLocalSelection(model.id),
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
          chat={chat}
          dispatch={dispatchChat}
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
      {displayedModal && (
        <Dialog
          title={
            displayedModal.type === 'info'
              ? displayedModal.title
              : displayedModal.type === 'remove'
                ? 'Remove demo entry?'
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
