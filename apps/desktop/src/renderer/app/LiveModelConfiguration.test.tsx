import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { App } from './App';
import { ModelConfigurationStore } from '../../../../../packages/core/src/model-configuration/store';
import { ConfigurationController } from '../../../../../packages/core/src/model-configuration/controller';
import {
  capabilities,
  record,
} from '../../../../../packages/core/src/model-configuration/test-fixtures';

const owners: { database: DatabaseSync; controller: ConfigurationController }[] = [];
afterEach(async () => {
  delete window.modelLoomRuntime;
  delete window.modelLoomConfiguration;
  for (const owner of owners.splice(0)) {
    await owner.controller.close();
    owner.database.close();
  }
});
function setup() {
  let failed = false;
  const database = new DatabaseSync(':memory:');
  const store = new ModelConfigurationStore(
    database,
    () => {
      if (failed) throw Error('private storage error');
    },
    (id) => id === record().modelId,
    capabilities,
    record().load,
  );
  const controller = new ConfigurationController(
    store,
    'window',
    capabilities,
    record().load,
    () => null,
  );
  owners.push({ database, controller });
  window.modelLoomRuntime = {
    command: () =>
      Promise.resolve({
        enabled: true,
        model: { id: `model-${record().modelId}`, name: 'Bonsai 27B', size: '4.73 GB' },
        phase: 'stopped',
        error: null,
      }),
  };
  window.modelLoomConfiguration = { command: (input) => controller.command('window', input) };
  return {
    store,
    fail: () => {
      failed = true;
    },
  };
}

it('opens the imported model editor and reports Save only after the core commits its defaults', async () => {
  const { store } = setup();
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('button', { name: 'Configure Bonsai 27B' }));
  expect(await screen.findByRole('heading', { name: 'Model configuration' })).toBeVisible();
  expect(screen.getByRole('spinbutton', { name: 'Temperature' })).toHaveValue(0.8);
  expect(screen.getByRole('switch', { name: 'Enable Thinking' })).toBeDisabled();
  const temperature = screen.getByRole('spinbutton', { name: 'Temperature' });
  await user.clear(temperature);
  await user.type(temperature, '0.2');
  await user.click(screen.getByRole('button', { name: 'Save defaults' }));
  expect(
    await screen.findByText('Defaults saved. New requests will use these settings.'),
  ).toBeVisible();
  expect((await store.read(record().modelId)).generation.temperature).toBe(0.2);
});

it('retains the pending draft when storage fails and never claims it was saved', async () => {
  const { store, fail } = setup();
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('button', { name: 'Configure Bonsai 27B' }));
  await screen.findByRole('heading', { name: 'Model configuration' });
  const temperature = screen.getByRole('spinbutton', { name: 'Temperature' });
  await user.clear(temperature);
  await user.type(temperature, '0.3');
  fail();
  await user.click(screen.getByRole('button', { name: 'Save defaults' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Settings could not be confirmed');
  expect(temperature).toHaveValue(0.3);
  expect((await store.read(record().modelId)).generation.temperature).toBe(0.8);
  expect(screen.queryByText('Defaults saved. New requests will use these settings.')).toBeNull();
});
