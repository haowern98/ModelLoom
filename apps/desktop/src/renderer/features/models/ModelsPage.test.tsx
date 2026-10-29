import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ModelsPage } from './ModelsPage';
import { createDemoLibrary, type DemoModel } from '../../mocks/modelLibrary';

function setup() {
  const model = createDemoLibrary().models[0]!;
  const head: DemoModel = {
    ...model,
    id: 'head',
    name: 'Qwen DFlash',
    speculativeHead: 'dflash',
  };
  const onImport = vi.fn();
  const mtp: DemoModel = { ...model, id: 'mtp-head', name: 'Qwen MTP', speculativeHead: 'mtp' };
  render(
    <ModelsPage
      library={{ models: [model, head, mtp], activeModelId: null }}
      demo={false}
      onRemove={vi.fn()}
      onDetails={vi.fn()}
      onConfigure={vi.fn()}
      onInfo={vi.fn()}
      onImport={onImport}
    />,
  );
  return { user: userEvent.setup(), onImport, model, head, mtp };
}

it('separates ordinary models and speculative heads while All shows both', async () => {
  const { user, model, head } = setup();
  expect(screen.getByRole('article', { name: model.name })).toBeVisible();
  const headRow = screen.getByRole('article', { name: head.name });
  expect(within(headRow).getByText('DFlash')).toBeVisible();
  expect(within(headRow).queryByRole('button', { name: `Configure ${head.name}` })).toBeNull();
  await user.click(screen.getByRole('tab', { name: 'Models' }));
  expect(screen.queryByRole('article', { name: head.name })).toBeNull();
  await user.click(screen.getByRole('tab', { name: 'Speculative heads' }));
  expect(screen.getByRole('article', { name: head.name })).toBeVisible();
  expect(screen.queryByRole('article', { name: model.name })).toBeNull();
});

it('imports from the heads tab through the shared flow and clears the filter', async () => {
  const { user, onImport } = setup();
  await user.click(screen.getByRole('tab', { name: 'Speculative heads' }));
  await user.type(screen.getByRole('searchbox', { name: 'Find model' }), 'missing');
  expect(screen.getByText('No models found')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Import GGUF' }));
  expect(onImport).toHaveBeenCalledOnce();
  expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('searchbox', { name: 'Find model' })).toHaveValue('');
});

it('classifies MTP heads and omits their Configure action', async () => {
  const { user, mtp } = setup();
  await user.click(screen.getByRole('tab', { name: 'Models' }));
  expect(screen.queryByRole('article', { name: mtp.name })).toBeNull();
  await user.click(screen.getByRole('tab', { name: 'Speculative heads' }));
  const row = screen.getByRole('article', { name: mtp.name });
  expect(within(row).getByText('MTP')).toBeVisible();
  expect(within(row).queryByRole('button', { name: `Configure ${mtp.name}` })).toBeNull();
});
