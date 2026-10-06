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

type Modal =
  { type: 'remove' | 'details'; model: DemoModel } | { type: 'info'; title: string; text: string };

export function App() {
  const demo = __DEMO_DATA_ENABLED__;
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
  const activeModel = library.models.find((model) => model.id === library.activeModelId);

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
    if (!placement.launch) return;
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
  }, [placement.launch, library.models]);

  return (
    <AppShell destination={destination} onNavigate={navigate} demo={demo}>
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
          library={library}
          demo={demo}
          onRemove={(model) => setModal({ type: 'remove', model })}
          onDetails={(model) => setModal({ type: 'details', model })}
          onConfigure={(model) => {
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
          demo={demo}
          joining={joining}
          onJoining={dispatchJoining}
          devices={demoDevices.map((device) => ({
            ...device,
            name: deviceNames[device.id] ?? device.name,
          }))}
          onRenameDevice={(id, name) => setDeviceNames((current) => ({ ...current, [id]: name }))}
          activeModel={activeModel}
          models={library.models}
          placement={placement}
          dispatch={dispatchPlacement}
          onStop={() => {
            if (activeModel) dispatch({ type: 'stop', modelId: activeModel.id });
            dispatchPlacement({ type: 'stop' });
          }}
        />
      ) : destination === 'Chat' ? (
        <ChatPage
          demo={demo}
          chat={chat}
          dispatch={dispatchChat}
          activeModel={activeModel}
          onCluster={() => navigate('Cluster')}
        />
      ) : destination === 'API' ? (
        <ApiPage demo={demo} activeModel={activeModel} onCluster={() => navigate('Cluster')} />
      ) : (
        <SettingsPage
          category={settingsCategory}
          onCategory={setSettingsCategory}
          onApi={() => navigate('API')}
        />
      )}
      {modal && (
        <Dialog
          title={
            modal.type === 'info'
              ? modal.title
              : modal.type === 'remove'
                ? 'Remove demo entry?'
                : modal.model.name
          }
          onClose={() => setModal(null)}
        >
          {modal.type === 'info' && (
            <>
              <p>{modal.text}</p>
              <footer>
                <Button onClick={() => setModal(null)}>Got it</Button>
              </footer>
            </>
          )}
          {modal.type === 'remove' && (
            <>
              <p>
                Remove <strong>{modal.model.name}</strong> from this sample library? No model files
                will be deleted.
              </p>
              <footer>
                <Button onClick={() => setModal(null)}>Cancel</Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    dispatch({ type: 'remove', modelId: modal.model.id });
                    setModal(null);
                  }}
                >
                  Remove entry
                </Button>
              </footer>
            </>
          )}
          {modal.type === 'details' && (
            <>
              <p>
                Sample metadata from the supplied screen. Compatibility and file contents have not
                been checked by a runtime.
              </p>
              <p>{modal.model.description}</p>
              <dl>
                <div>
                  <dt>Identifier</dt>
                  <dd>{modal.model.identifier}</dd>
                </div>
                <div>
                  <dt>Format</dt>
                  <dd>GGUF</dd>
                </div>
                <div>
                  <dt>Quantization</dt>
                  <dd>{modal.model.quantization}</dd>
                </div>
                <div>
                  <dt>Size</dt>
                  <dd>{modal.model.size}</dd>
                </div>
                <div>
                  <dt>Architecture</dt>
                  <dd>{modal.model.architecture}</dd>
                </div>
                <div>
                  <dt>Parameters</dt>
                  <dd>{modal.model.parameters}</dd>
                </div>
                <div>
                  <dt>Context length</dt>
                  <dd>{modal.model.context}</dd>
                </div>
                <div>
                  <dt>Compatibility</dt>
                  <dd>Not verified</dd>
                </div>
              </dl>
              <footer>
                <Button onClick={() => setModal(null)}>Close</Button>
              </footer>
            </>
          )}
        </Dialog>
      )}
    </AppShell>
  );
}
