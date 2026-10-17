import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { createDemoLibrary } from '../../mocks/modelLibrary';
import { ClusterModelPicker } from '../cluster/ClusterModelPicker';
import { ModelRow } from './ModelRow';

it('keeps library entries readable and actionable without model artwork', async () => {
  const user = userEvent.setup();
  const models = createDemoLibrary().models;
  const [first] = models;
  if (!first) throw new Error('Expected a model fixture');
  const onConfigure = vi.fn();
  render(
    <>
      {models.map((model) => (
        <ModelRow
          key={model.id}
          model={model}
          active={false}
          onRemove={vi.fn()}
          onDetails={vi.fn()}
          onConfigure={onConfigure}
        />
      ))}
    </>,
  );
  for (const model of models) {
    const row = screen.getByRole('article', { name: model.name });
    expect(within(row).getByRole('heading', { name: model.name })).toBeVisible();
    expect(within(row).getByText(model.identifier)).toBeVisible();
    expect(row.querySelector('svg defs, svg path[fill]')).toBeNull();
  }
  await user.click(screen.getByRole('button', { name: `Configure ${first.name}` }));
  expect(onConfigure).toHaveBeenCalledOnce();
});

it('offers text-only model choices while preserving selection', async () => {
  const user = userEvent.setup();
  const models = createDemoLibrary().models;
  const [first] = models;
  if (!first) throw new Error('Expected a model fixture');
  const onChoose = vi.fn();
  render(
    <ClusterModelPicker
      models={models}
      selectedModel={undefined}
      activeModelId={undefined}
      disabled={false}
      onChoose={onChoose}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Choose model' }));
  const menu = screen.getByRole('menu', { name: 'Model library' });
  expect(menu.querySelector('svg')).toBeNull();
  await user.click(within(menu).getByRole('menuitem', { name: new RegExp(first.name) }));
  expect(onChoose).toHaveBeenCalledWith(first);
});
