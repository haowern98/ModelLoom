import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('Models milestone', () => {
  it('discloses sample data and renders compact model rows without launch controls', () => {
    render(<App />);
    expect(screen.getByText('Demo data')).toBeVisible();
    expect(screen.getAllByRole('article')).toHaveLength(5);
    const qwen = within(screen.getByRole('article', { name: 'Qwen3.8-27B' }));
    expect(qwen.getByText('16.4 GB')).toBeVisible();
    expect(qwen.getByText('GGUF')).toBeVisible();
    expect(qwen.getByText('Q4_K_M')).toBeVisible();
    expect(qwen.getByText('qwen3.8')).toBeVisible();
    expect(screen.getAllByLabelText('Last used: unknown')).toHaveLength(5);
    expect(
      screen.queryByRole('button', { name: /Start|Stop|Open in Cluster/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/^(Running|Ready|Stopped|Fully compatible)$/),
    ).not.toBeInTheDocument();
  });

  it('filters case-insensitively and recovers from no matches', async () => {
    const user = userEvent.setup();
    render(<App />);
    const search = screen.getByRole('searchbox', { name: 'Find model' });
    await user.type(search, 'LLAMA');
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('article', { name: 'Llama 3.1 8B' })).toBeVisible();
    await user.clear(search);
    await user.type(search, '<script>unknown</script>');
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.getByText('No models found')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getAllByRole('article')).toHaveLength(5);
  });

  it('opens six configuration sections and saves model defaults without changing Cluster', async () => {
    const user = userEvent.setup();
    render(<App />);
    const configure = screen.getByRole('button', { name: 'Configure Llama 3.1 8B' });
    await user.click(configure);
    expect(screen.getByRole('heading', { name: 'Model configuration' })).toBeVisible();
    for (const name of [
      'Prompt',
      'Context and Performance',
      'Generation',
      'Reasoning',
      'Speculative decoding',
      'Advanced',
    ])
      expect(screen.getByRole('region', { name })).toBeVisible();
    const temperature = screen.getByRole('spinbutton', { name: 'Temperature' });
    await user.clear(temperature);
    await user.type(temperature, '0.6');
    await user.click(screen.getByRole('button', { name: 'Save defaults' }));
    expect(screen.getByRole('status')).toHaveTextContent('Defaults saved for this demo session');
    await user.click(screen.getByRole('button', { name: 'Back to Models' }));
    expect(screen.getByRole('button', { name: 'Configure Llama 3.1 8B' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Configure Llama 3.1 8B' }));
    expect(screen.getByRole('spinbutton', { name: 'Temperature' })).toHaveValue(0.6);
    await user.click(screen.getByRole('button', { name: 'Cluster' }));
    expect(screen.getByRole('button', { name: 'Selected demo model: Qwen3.8-27B' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Stop model' })).toBeVisible();
  });

  it('protects active removal until the model is stopped in Cluster', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Actions for Qwen3.8-27B' }));
    expect(screen.getByRole('button', { name: 'Remove demo entry' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Stop demo model' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Cluster' }));
    await user.click(screen.getByRole('button', { name: 'Stop model' }));
    await user.click(screen.getByRole('button', { name: 'Models' }));
    await user.click(screen.getByRole('button', { name: 'Actions for Qwen3.8-27B' }));
    await user.click(screen.getByRole('button', { name: 'Remove demo entry' }));
    expect(screen.getByRole('dialog', { name: 'Remove demo entry?' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Remove entry' }));
    expect(screen.queryByRole('article', { name: 'Qwen3.8-27B' })).not.toBeInTheDocument();
  });

  it('navigates without presenting unfinished screens as operational', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Cluster' }));
    expect(screen.getByRole('heading', { name: 'Cluster' })).toBeVisible();
    expect(screen.getByText('Demo data')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Models' }));
    expect(screen.getByRole('heading', { name: 'Models' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'API' }));
    expect(screen.getByRole('heading', { name: 'API' })).toBeVisible();
    expect(screen.getByText('No API server is running.')).toBeVisible();
  });

  it('explains unavailable imports instead of pretending to load a GGUF', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Import GGUF' }));
    expect(screen.getByRole('dialog', { name: 'GGUF import' })).toBeVisible();
    expect(screen.getByText(/No file is imported in this demo/)).toBeVisible();
  });
});
