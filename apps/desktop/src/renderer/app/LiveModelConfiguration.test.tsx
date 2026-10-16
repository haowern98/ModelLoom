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
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
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
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Settings could not be confirmed');
  expect(temperature).toHaveValue(0.3);
  expect((await store.read(record().modelId)).generation.temperature).toBe(0.8);
  expect(screen.queryByText('Defaults saved. New requests will use these settings.')).toBeNull();
});

it('commits supported performance and advanced load settings while keeping unsafe overrides unavailable', async () => {
  const { store } = setup();
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('button', { name: 'Configure Bonsai 27B' }));
  await screen.findByRole('heading', { name: 'Model configuration' });
  for (const [name, value] of [
    ['Context Length', '4096'],
    ['Evaluation Batch Size', '1024'],
    ['Physical Batch Size', '256'],
    ['Max Concurrent Predictions', '2'],
  ] as const) {
    const field = screen.getByRole('spinbutton', { name });
    expect(field).toBeEnabled();
    await user.clear(field);
    await user.type(field, value);
  }
  await user.click(screen.getByRole('switch', { name: 'Flash Attention' }));
  await user.click(screen.getByRole('checkbox', { name: 'Enable Reasoning Budget' }));
  const budget = screen.getByRole('spinbutton', { name: 'Reasoning Budget' });
  await user.clear(budget);
  await user.type(budget, '256');
  await user.type(screen.getByRole('textbox', { name: 'Reasoning Budget Message' }), 'Answer now');
  await user.click(screen.getByRole('checkbox', { name: 'Enable RoPE Frequency Base' }));
  const base = screen.getByRole('spinbutton', { name: 'RoPE Frequency Base' });
  await user.clear(base);
  await user.type(base, '20000');
  await user.click(screen.getByRole('checkbox', { name: 'Enable RoPE Frequency Scale' }));
  const scale = screen.getByRole('spinbutton', { name: 'RoPE Frequency Scale' });
  await user.clear(scale);
  await user.type(scale, '2');
  await user.click(screen.getByText('Chat Template', { selector: 'summary span' }));
  await user.type(screen.getByRole('textbox', { name: 'Chat Template text' }), 'Custom template');
  expect(screen.getByRole('switch', { name: 'llama.cpp Arguments Override' })).toBeDisabled();
  expect(screen.getByRole('combobox', { name: 'Context Overflow' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('Defaults saved. New requests will use these settings.');
  const saved = await store.read(record().modelId);
  expect(saved.load).toMatchObject({
    contextLength: 4096,
    evaluationBatch: 1024,
    physicalBatch: 256,
    concurrency: 2,
    flashAttention: false,
  });
  expect(saved.preferences).toMatchObject({
    reasoningBudget: { enabled: true, value: 256 },
    reasoningMessage: 'Answer now',
    ropeBase: { enabled: true, value: 20000 },
    ropeScale: { enabled: true, value: 2 },
    customTemplate: true,
    chatTemplate: 'Custom template',
    argumentsEnabled: false,
  });
});
