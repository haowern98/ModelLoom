import { createRoot } from 'react-dom/client';
import { ConfigurationSelect } from '../../src/renderer/features/models/ConfigurationControls';
import { ClusterModelPicker } from '../../src/renderer/features/cluster/ClusterModelPicker';
import { createDemoLibrary } from '../../src/renderer/mocks/modelLibrary';
import cluster from '../../src/renderer/features/cluster/ClusterPage.module.css';

/** Exercise the real dropdowns with enough entries to overflow at either window edge. */
export function mountDropdown(kind: 'configuration' | 'cluster', bottom: boolean) {
  const host = document.createElement('div');
  host.className = cluster.page!;
  Object.assign(host.style, {
    position: 'fixed',
    zIndex: '1000',
    display: 'block',
    width: '180px',
    height: '32px',
    right: '8px',
    [bottom ? 'bottom' : 'top']: '40px',
  });
  document.body.append(host);
  const options = Array.from({ length: 80 }, (_, index) => ({
    value: String(index),
    label: `Option ${index + 1}`,
  }));
  createRoot(host).render(
    kind === 'configuration' ? (
      <ConfigurationSelect
        id="dropdown-fixture"
        label="Dropdown fixture"
        value={bottom ? '79' : '0'}
        options={options}
      />
    ) : (
      <ClusterModelPicker
        models={options.map((option) => ({
          ...createDemoLibrary().models[0]!,
          id: option.value,
          name: option.label,
        }))}
        selectedModel={undefined}
        activeModelId={undefined}
        disabled={false}
        onChoose={() => {}}
      />
    ),
  );
}
