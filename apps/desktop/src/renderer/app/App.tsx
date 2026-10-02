import { useReducer, useState } from 'react';
import { Monitor } from 'lucide-react';
import { AppShell } from './AppShell';
import type { Destination } from './navigation';
import { ModelsPage } from '../features/models/ModelsPage';
import { createDemoLibrary, transitionDemoLibrary } from '../mocks/modelLibrary';
import type { DemoModel } from '../mocks/modelLibrary';
import { Dialog } from '../components/Dialog';
import { Button } from '../components/Button';
import styles from './App.module.css';

type Modal =
  | { type: 'switch' | 'remove' | 'details'; model: DemoModel }
  | { type: 'info'; title: string; text: string };

export function App() {
  const demo = __DEMO_DATA_ENABLED__;
  const [library, dispatch] = useReducer(transitionDemoLibrary, undefined, () =>
    demo ? createDemoLibrary() : { models: [], activeModelId: null },
  );
  const [destination, setDestination] = useState<Destination>('Models');
  const [modal, setModal] = useState<Modal | null>(null);
  const activeModel = library.models.find((model) => model.id === library.activeModelId);

  const start = (model: DemoModel) => {
    if (activeModel && activeModel.id !== model.id) setModal({ type: 'switch', model });
    else dispatch({ type: 'start', modelId: model.id });
  };

  return (
    <AppShell
      destination={destination}
      onNavigate={setDestination}
      demo={demo}
      modelRunning={Boolean(activeModel)}
    >
      {destination === 'Models' ? (
        <ModelsPage
          library={library}
          demo={demo}
          onStart={start}
          onStop={(modelId) => dispatch({ type: 'stop', modelId })}
          onRemove={(model) => setModal({ type: 'remove', model })}
          onDetails={(model) => setModal({ type: 'details', model })}
          onCluster={() => setDestination('Cluster')}
          onInfo={(title, text) => setModal({ type: 'info', title, text })}
        />
      ) : (
        <section className={styles.placeholder}>
          <h1>{destination}</h1>
          <div>
            <Monitor size={36} />
            <h2>This screen comes in the next milestone.</h2>
            <p>The current milestone covers the shared shell and Models screen.</p>
            {destination === 'Cluster' && activeModel && (
              <p>
                Selected demo model: <strong>{activeModel.name}</strong>
              </p>
            )}
            {destination === 'API' && <p>No API server is running.</p>}
            <Button onClick={() => setDestination('Models')}>Back to Models</Button>
          </div>
        </section>
      )}
      {modal && (
        <Dialog
          title={
            modal.type === 'info'
              ? modal.title
              : modal.type === 'switch'
                ? 'Switch demo model?'
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
          {modal.type === 'switch' && (
            <>
              <p>
                Stop the simulated session for <strong>{activeModel?.name}</strong> and start{' '}
                <strong>{modal.model.name}</strong>?
              </p>
              <p>
                In the connected app, switching interrupts active Chat and API requests. This demo
                runs no inference.
              </p>
              <footer>
                <Button onClick={() => setModal(null)}>Cancel</Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    dispatch({ type: 'start', modelId: modal.model.id });
                    setModal(null);
                  }}
                >
                  Switch demo model
                </Button>
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
              <dl>
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
