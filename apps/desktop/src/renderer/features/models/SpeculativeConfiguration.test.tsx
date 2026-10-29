import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ModelConfigurationPage } from './ModelConfigurationPage';
import { createDemoDefaults } from './configuration';
import { createDemoLibrary } from '../../mocks/modelLibrary';

it('blocks incomplete companions, saves typed intent and keeps retrieval independent', async () => {
  const save = vi.fn();
  const user = userEvent.setup();
  function Editor() {
    const [draft, setDraft] = useState(createDemoDefaults);
    const [saved] = useState(createDemoDefaults);
    const target = createDemoLibrary().models[0]!;
    return (
      <ModelConfigurationPage
        model={target}
        configuration={{ draft, saved }}
        onChange={setDraft}
        onSave={save}
        onBack={vi.fn()}
        onCluster={vi.fn()}
        speculativeAssets={[
          {
            ...target,
            id: `model-${'b'.repeat(64)}`,
            name: 'Companion',
            speculativeHead: 'dflash',
          },
        ]}
      />
    );
  }
  render(<Editor />);
  await user.click(screen.getByRole('combobox', { name: 'Method' }));
  await user.click(screen.getByRole('option', { name: 'DFlash' }));
  expect(screen.getByRole('spinbutton', { name: 'Max Draft Tokens' })).toHaveAttribute(
    'placeholder',
    'Native default',
  );
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Select a companion');
  expect(save).not.toHaveBeenCalled();
  await user.click(screen.getByRole('combobox', { name: 'Companion' }));
  await user.click(screen.getByRole('option', { name: 'Companion' }));
  await user.type(screen.getByRole('spinbutton', { name: 'Max Draft Tokens' }), '257');
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(save).not.toHaveBeenCalled();
  await user.clear(screen.getByRole('spinbutton', { name: 'Max Draft Tokens' }));
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      speculation: {
        method: 'dflash',
        source: 'b'.repeat(64),
        maxDraftTokens: '',
        retrieval: 'off',
      },
    }),
  );
});
