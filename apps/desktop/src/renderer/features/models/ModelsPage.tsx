import { useEffect, useState, type KeyboardEvent } from 'react';
import { Upload, Compass, Box } from 'lucide-react';
import { Button } from '../../components/Button';
import { SearchField } from '../../components/SearchField';
import { ModelRow } from './ModelRow';
import type { DemoLibrary, DemoModel } from '../../mocks/modelLibrary';
import styles from './ModelsPage.module.css';

const libraryTabs = [
  { id: 'all', label: 'All' },
  { id: 'main', label: 'Models' },
  { id: 'draft', label: 'Speculative heads' },
] as const;
type LibraryTab = (typeof libraryTabs)[number]['id'];

interface ModelsPageProps {
  library: DemoLibrary;
  demo: boolean;
  onRemove: (model: DemoModel) => void;
  onDetails: (model: DemoModel) => void;
  onConfigure: (model: DemoModel) => void;
  onInfo: (title: string, text: string) => void;
  onImport?: () => void;
  indexing?: string;
  restoring?: boolean;
}

export function ModelsPage({
  library,
  demo,
  onRemove,
  onDetails,
  onConfigure,
  onInfo,
  onImport,
  indexing,
  restoring = false,
}: ModelsPageProps) {
  const [tab, setTab] = useState<LibraryTab>('all');
  const [query, setQuery] = useState('');
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const filtered = library.models.filter((model) =>
    `${model.name} ${model.description} ${model.architecture}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const models = filtered.filter((model) =>
    tab === 'all'
      ? true
      : tab === 'draft'
        ? Boolean(model.speculativeHead)
        : !model.speculativeHead,
  );
  const visibleIndexing = tab === 'draft' ? undefined : indexing;
  const selectTab = (next: LibraryTab) => {
    if (next === tab) return;
    setTab(next);
    setQuery('');
  };
  const navigateTabs = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % libraryTabs.length;
    else if (event.key === 'ArrowLeft')
      next = (index + libraryTabs.length - 1) % libraryTabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = libraryTabs.length - 1;
    else return;
    event.preventDefault();
    selectTab(libraryTabs[next]!.id);
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next]?.focus();
  };
  return (
    <section className={styles.page} aria-labelledby="models-heading">
      <header className={styles.header}>
        <div className={styles.title}>
          <h1 id="models-heading">Model library</h1>
          {restoring && (
            <span role="status" className={styles.restoring}>
              <span className={styles.spinner} aria-hidden="true" />
              Updating library…
            </span>
          )}
        </div>
        <div className={styles.toolbar}>
          <SearchField label="Find model" value={query} onChange={setQuery} />
          <Button
            variant="icon"
            className={`${styles.iconAction} ${styles.importAction}`}
            aria-label="Import GGUF"
            title="Import GGUF"
            disabled={Boolean(indexing) || restoring}
            onClick={() => {
              if (onImport) {
                selectTab('all');
                setQuery('');
                onImport();
              } else
                onInfo(
                  'GGUF import',
                  'No file is imported in this demo. GGUF import becomes available when model storage and runtime integration are ready.',
                );
            }}
          >
            <Upload size={16} aria-hidden="true" />
          </Button>
          <Button
            variant="icon"
            className={styles.iconAction}
            aria-label="Explore models"
            title="Explore models"
            onClick={() =>
              onInfo(
                'Model downloads',
                'Model downloads are not connected yet. No files are downloaded in this demo; the current library contains sample entries only.',
              )
            }
          >
            <Compass size={16} aria-hidden="true" />
          </Button>
        </div>
      </header>
      <div className={styles.tabs} role="tablist" aria-label="Model library">
        {libraryTabs.map((item, index) => (
          <button
            key={item.id}
            id={`models-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls="models-panel"
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => selectTab(item.id)}
            onKeyDown={(event) => navigateTabs(event, index)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        id="models-panel"
        className={styles.panel}
        role="tabpanel"
        aria-labelledby={`models-tab-${tab}`}
      >
        <div className={styles.columns}>
          <span>Name</span>
          <span>Last used</span>
        </div>
        <div className={styles.library}>
          {visibleIndexing && (
            <ModelRow
              model={{
                id: 'pending-import',
                name: visibleIndexing,
                identifier: '',
                description: '',
                family: 'unknown',
                quantization: '',
                size: '',
                architecture: '',
                parameters: '',
                context: '',
                ready: false,
              }}
              active={false}
              indexing
              onRemove={() => undefined}
              onDetails={() => undefined}
              onConfigure={() => undefined}
            />
          )}
          {models.map((model) => (
            <ModelRow
              key={model.id}
              now={now}
              model={model}
              active={model.id === library.activeModelId}
              unavailable={!demo && !model.ready}
              onRemove={() => onRemove(model)}
              onDetails={() => onDetails(model)}
              onConfigure={() => onConfigure(model)}
            />
          ))}
          {models.length === 0 && !visibleIndexing && !restoring && (
            <div className={styles.empty}>
              <Box size={34} />
              <h2>
                {query.trim()
                  ? 'No models found'
                  : tab === 'draft'
                    ? 'No speculative heads'
                    : demo
                      ? 'Your demo library is empty'
                      : onImport
                        ? 'No models imported'
                        : 'No runtime connected'}
              </h2>
              <p>
                {query.trim()
                  ? 'Try another model name or clear your search.'
                  : tab === 'draft' && onImport
                    ? 'Import a speculative head GGUF to get started.'
                    : demo
                      ? 'Restart this demo to restore the sample entries.'
                      : onImport
                        ? 'Import a GGUF model to get started.'
                        : 'Model management becomes available after runtime integration.'}
              </p>
              {query.trim() && <Button onClick={() => setQuery('')}>Clear search</Button>}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
