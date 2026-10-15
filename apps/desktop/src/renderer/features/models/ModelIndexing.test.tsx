import { render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { createDemoLibrary } from '../../mocks/modelLibrary';
import { ModelsPage } from './ModelsPage';

const callbacks = () => ({
  onRemove: vi.fn(),
  onDetails: vi.fn(),
  onConfigure: vi.fn(),
  onInfo: vi.fn(),
  onImport: vi.fn(),
});

it('shows a filename and indexing status alongside existing models, then normal metadata', () => {
  const models = createDemoLibrary().models;
  const [existing, imported] = models;
  if (!existing || !imported) throw new Error('Expected two model fixtures');
  const props = {
    ...callbacks(),
    demo: false,
    library: { models: [existing], activeModelId: null },
  };
  const view = render(<ModelsPage {...props} indexing="new-model.gguf" />);
  const pending = within(screen.getByRole('article', { name: 'new-model.gguf' }));
  expect(pending.getByRole('heading', { name: 'new-model.gguf' })).toBeVisible();
  expect(pending.getByRole('status')).toHaveTextContent('Indexing…');
  expect(pending.queryByRole('group')).not.toBeInTheDocument();
  expect(pending.queryByRole('button')).not.toBeInTheDocument();
  expect(pending.queryByLabelText('Last used: unknown')).not.toBeInTheDocument();
  expect(screen.getByRole('article', { name: existing.name })).toBeVisible();
  expect(screen.queryByText('No models imported')).not.toBeInTheDocument();
  const completed = { ...imported, name: 'new-model.gguf', ready: true };
  view.rerender(
    <ModelsPage {...props} library={{ models: [existing, completed], activeModelId: null }} />,
  );
  expect(screen.queryByText('Indexing…')).not.toBeInTheDocument();
  const restored = within(screen.getByRole('article', { name: completed.name }));
  expect(restored.getByRole('group', { name: `Metadata for ${completed.name}` })).toBeVisible();
  expect(restored.getByRole('button', { name: `Configure ${completed.name}` })).toBeEnabled();
});

it('does not show an empty library while restoring persisted entries', () => {
  const props = { ...callbacks(), demo: false, library: { models: [], activeModelId: null } };
  const view = render(<ModelsPage {...props} restoring />);
  expect(screen.getByRole('status')).toHaveTextContent('Updating library…');
  expect(screen.queryByText('No models imported')).not.toBeInTheDocument();
  view.rerender(<ModelsPage {...props} />);
  expect(screen.getByText('No models imported')).toBeVisible();
});

it('explains an unavailable imported file and disables configuration', () => {
  const [fixture] = createDemoLibrary().models;
  if (!fixture) throw new Error('Expected a model fixture');
  const model = {
    ...fixture,
    ready: false,
    description: 'File unavailable. Re-import this model.',
  };
  render(
    <ModelsPage {...callbacks()} demo={false} library={{ models: [model], activeModelId: null }} />,
  );
  expect(screen.getByText(model.description)).toBeVisible();
  expect(screen.getByRole('button', { name: `Configure ${model.name}` })).toBeDisabled();
  expect(screen.getByRole('button', { name: `Actions for ${model.name}` })).toBeEnabled();
});
