import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { ClusterModelPicker } from '../features/cluster/ClusterModelPicker';
import { createDemoLibrary } from '../mocks/modelLibrary';
import { vi } from 'vitest';

describe('Cluster planning and launch', () => {
  it('plans a different model manually without switching and checks coverage before Run', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Cluster' }));
    await user.click(screen.getByRole('button', { name: 'Selected demo model: Qwen3.8-27B' }));
    await user.click(screen.getByRole('menuitem', { name: /Llama 3.1 8B/ }));
    const modal = screen.getByRole('dialog', { name: 'Plan layer placement' });
    await user.click(within(modal).getByRole('button', { name: 'Place manually' }));
    expect(screen.getByRole('button', { name: 'Selected demo model: Llama 3.1 8B' })).toBeVisible();
    expect(screen.queryByText(/^Planned layers/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Keep draft/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Run model' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/cover all 32 sample layers exactly once/);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Models' }));
    await user.click(screen.getByRole('button', { name: 'Actions for Qwen3.8-27B' }));
    expect(screen.getByRole('button', { name: 'Remove demo entry' })).toBeDisabled();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Actions for Llama 3.1 8B' }));
    expect(screen.getByRole('button', { name: 'Remove demo entry' })).toBeEnabled();
  });
  it('launches a manually assigned model only after switch confirmation, then stops it', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Cluster' }));
    await user.click(screen.getByRole('button', { name: 'Selected demo model: Qwen3.8-27B' }));
    await user.click(screen.getByRole('menuitem', { name: /Llama 3.1 8B/ }));
    await user.click(screen.getByRole('button', { name: 'Place manually' }));
    await user.click(screen.getByRole('button', { name: 'Edit layers for inference-node GPU 0' }));
    await user.type(screen.getByRole('spinbutton', { name: 'First layer for GPU 0' }), '0');
    await user.type(screen.getByRole('spinbutton', { name: 'Last layer for GPU 0' }), '31');
    expect(screen.getByText('Planned layers 0 – 31')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Run model' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Planned layers 0 – 31')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Run model' }));
    await user.click(screen.getByRole('button', { name: 'Switch and run demo' }));
    expect(screen.getByRole('button', { name: 'Cancel loading' })).toBeVisible();
    await screen.findByRole('button', { name: 'Stop model' });
    expect(screen.getByText('Layers 0 – 31')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Stop model' }));
    expect(screen.getByRole('button', { name: 'Run model' })).toBeVisible();
    expect(screen.queryByText('In use')).not.toBeInTheDocument();
  });

  it('cancels placement selection and loading without losing the previous session', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Cluster' }));
    const selector = screen.getByRole('button', { name: 'Selected demo model: Qwen3.8-27B' });
    await user.click(selector);
    await user.click(screen.getByRole('menuitem', { name: /Llama 3.1 8B/ }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(selector).toHaveFocus();
    expect(selector).toHaveTextContent('Qwen3.8-27B');
    await user.click(selector);
    await user.click(screen.getByRole('menuitem', { name: /Llama 3.1 8B/ }));
    await user.click(screen.getByRole('button', { name: 'Auto place' }));
    expect(screen.getAllByText(/^Planned layers/)).toHaveLength(5);
    await user.click(screen.getByRole('button', { name: 'Run model' }));
    await user.click(screen.getByRole('button', { name: 'Switch and run demo' }));
    await user.click(screen.getByRole('button', { name: 'Cancel loading' }));
    await user.click(screen.getByRole('button', { name: 'Models' }));
    await user.click(screen.getByRole('button', { name: 'Actions for Qwen3.8-27B' }));
    expect(screen.getByRole('button', { name: 'Remove demo entry' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Cluster' }));
    expect(screen.getByRole('button', { name: 'Selected demo model: Llama 3.1 8B' })).toBeVisible();
  });

  it('keeps the full long model name in the accessible label and tooltip', () => {
    const model = {
      ...createDemoLibrary().models[0]!,
      name: 'A very long model name that must fit beside the Run icon',
    };
    render(
      <ClusterModelPicker
        models={[model]}
        selectedModel={model}
        activeModelId={undefined}
        disabled={false}
        onChoose={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: `Selected demo model: ${model.name}` }),
    ).toHaveAttribute('title', model.name);
  });
});
