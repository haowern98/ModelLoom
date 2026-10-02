import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('Models milestone', () => {
  it('discloses sample data and renders the five reference models', () => {
    render(<App />);
    expect(screen.getByText('Demo data')).toBeVisible();
    expect(screen.getAllByRole('article')).toHaveLength(5);
    expect(
      within(screen.getByRole('article', { name: 'Qwen3.8-27B' })).getByText('Running'),
    ).toBeVisible();
  });

  it('filters case-insensitively and recovers from no matches', async () => {
    const user = userEvent.setup();
    render(<App />);
    const search = screen.getByRole('searchbox', { name: 'Search models' });
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

  it('keeps the running model until switching is explicitly confirmed', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      within(screen.getByRole('article', { name: 'Llama 3.1 8B' })).getByRole('button', {
        name: 'Start',
      }),
    );
    expect(screen.getByRole('dialog', { name: 'Switch demo model?' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      within(screen.getByRole('article', { name: 'Qwen3.8-27B' })).getByText('Running'),
    ).toBeVisible();
    await user.click(
      within(screen.getByRole('article', { name: 'Llama 3.1 8B' })).getByRole('button', {
        name: 'Start',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Switch demo model' }));
    expect(
      within(screen.getByRole('article', { name: 'Llama 3.1 8B' })).getByText('Running'),
    ).toBeVisible();
    expect(
      within(screen.getByRole('article', { name: 'Qwen3.8-27B' })).queryByText('Running'),
    ).not.toBeInTheDocument();
  });

  it('stops a demo session through its menu and protects active removal', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Actions for Qwen3.8-27B' }));
    expect(screen.getByRole('button', { name: 'Remove demo entry' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Stop demo model' }));
    expect(screen.queryByText('Running')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Actions for Qwen3.8-27B' }));
    await user.click(screen.getByRole('button', { name: 'Remove demo entry' }));
    expect(screen.getByRole('dialog', { name: 'Remove demo entry?' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Remove entry' }));
    expect(screen.queryByRole('article', { name: 'Qwen3.8-27B' })).not.toBeInTheDocument();
  });

  it('navigates without presenting unfinished screens as operational', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Open in Cluster' }));
    expect(screen.getByRole('heading', { name: 'Cluster' })).toBeVisible();
    expect(screen.getByText('This screen comes in the next milestone.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Models' }));
    expect(screen.getByRole('heading', { name: 'Models' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Open API' }));
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
