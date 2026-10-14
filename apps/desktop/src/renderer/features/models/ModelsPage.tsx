import { useState } from 'react';
import { Upload, Compass, Box } from 'lucide-react';
import { Button } from '../../components/Button';
import { SearchField } from '../../components/SearchField';
import { ModelRow } from './ModelRow';
import type { DemoLibrary, DemoModel } from '../../mocks/modelLibrary';
import styles from './ModelsPage.module.css';

interface ModelsPageProps {
  library: DemoLibrary;
  demo: boolean;
  onRemove: (model: DemoModel) => void;
  onDetails: (model: DemoModel) => void;
  onConfigure: (model: DemoModel) => void;
  onInfo: (title: string, text: string) => void;
  onImport?: () => void;
}

export function ModelsPage({
  library,
  demo,
  onRemove,
  onDetails,
  onConfigure,
  onInfo,
  onImport,
}: ModelsPageProps) {
  const [query, setQuery] = useState('');
  const filtered = library.models.filter((model) =>
    `${model.name} ${model.description} ${model.architecture}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const models = filtered;
  return (
    <section className={styles.page} aria-labelledby="models-heading">
      <header className={styles.header}>
        <h1 id="models-heading">Models</h1>
        <div className={styles.toolbar}>
          <SearchField label="Find model" value={query} onChange={setQuery} />
          <Button
            variant="icon"
            className={`${styles.iconAction} ${styles.importAction}`}
            aria-label="Import GGUF"
            title="Import GGUF"
            onClick={() =>
              onImport
                ? onImport()
                : onInfo(
                    'GGUF import',
                    'No file is imported in this demo. GGUF import becomes available when model storage and runtime integration are ready.',
                  )
            }
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
      <div className={styles.columns}>
        <span>Name</span>
        <span>Last used</span>
      </div>
      <div className={styles.library}>
        {models.map((model) => (
          <ModelRow
            key={model.id}
            model={model}
            active={model.id === library.activeModelId}
            onRemove={() => onRemove(model)}
            onDetails={() => onDetails(model)}
            onConfigure={() => onConfigure(model)}
          />
        ))}
        {models.length === 0 && (
          <div className={styles.empty}>
            <Box size={34} />
            <h2>
              {query.trim()
                ? 'No models found'
                : demo
                  ? 'Your demo library is empty'
                  : onImport
                    ? 'No models imported'
                    : 'No runtime connected'}
            </h2>
            <p>
              {query.trim()
                ? 'Try another model name or clear your search.'
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
    </section>
  );
}
