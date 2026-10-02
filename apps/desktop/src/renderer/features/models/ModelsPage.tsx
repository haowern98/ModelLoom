import { useState } from 'react';
import { Search, LayoutGrid, List, Upload, Download, ChevronDown, Box } from 'lucide-react';
import { Button } from '../../components/Button';
import { ModelCard } from './ModelCard';
import type { DemoLibrary, DemoModel } from '../../mocks/modelLibrary';
import styles from './ModelsPage.module.css';

interface ModelsPageProps {
  library: DemoLibrary;
  demo: boolean;
  onStart: (model: DemoModel) => void;
  onStop: (modelId: string) => void;
  onRemove: (model: DemoModel) => void;
  onDetails: (model: DemoModel) => void;
  onCluster: () => void;
  onInfo: (title: string, text: string) => void;
}

export function ModelsPage({
  library,
  demo,
  onStart,
  onStop,
  onRemove,
  onDetails,
  onCluster,
  onInfo,
}: ModelsPageProps) {
  const [query, setQuery] = useState('');
  const [grid, setGrid] = useState(false);
  const filtered = library.models.filter((model) =>
    `${model.name} ${model.description} ${model.architecture}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const models = [...filtered].sort(
    (a, b) => Number(b.id === library.activeModelId) - Number(a.id === library.activeModelId),
  );
  return (
    <section className={styles.page} aria-labelledby="models-heading">
      <header className={styles.header}>
        <h1 id="models-heading">Models</h1>
        <div className={styles.toolbar}>
          <label className={styles.search}>
            <Search size={18} />
            <input
              type="search"
              aria-label="Search models"
              placeholder="Search models..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <Button
            variant="icon"
            aria-label={grid ? 'Show list view' : 'Show grid view'}
            title={grid ? 'List view' : 'Grid view'}
            aria-pressed={grid}
            onClick={() => setGrid(!grid)}
          >
            {grid ? <List size={18} /> : <LayoutGrid size={18} />}
          </Button>
          <Button
            className={styles.import}
            onClick={() =>
              onInfo(
                'GGUF import',
                'No file is imported in this demo. GGUF import becomes available when model storage and runtime integration are ready.',
              )
            }
          >
            <Upload size={17} />
            Import GGUF
          </Button>
          <Button
            variant="primary"
            onClick={() =>
              onInfo(
                'Model downloads',
                'Model downloads are not connected yet. No files are downloaded in this demo; the current library contains sample entries only.',
              )
            }
          >
            <Download size={17} />
            Download models
            <ChevronDown size={14} />
          </Button>
        </div>
      </header>
      <div className={`${styles.library} ${grid ? styles.grid : ''}`}>
        {models.map((model) => (
          <ModelCard
            key={model.id}
            model={model}
            active={model.id === library.activeModelId}
            grid={grid}
            onStart={() => onStart(model)}
            onStop={() => onStop(model.id)}
            onRemove={() => onRemove(model)}
            onDetails={() => onDetails(model)}
            onCluster={onCluster}
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
                  : 'No runtime connected'}
            </h2>
            <p>
              {query.trim()
                ? 'Try another model name or clear your search.'
                : demo
                  ? 'Restart this demo to restore the sample entries.'
                  : 'Model management becomes available after runtime integration.'}
            </p>
            {query.trim() && <Button onClick={() => setQuery('')}>Clear search</Button>}
          </div>
        )}
      </div>
    </section>
  );
}
