import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

describe('Cluster demo', () => {
  it('renames a device through its actions without changing layer drafts and retains the name across navigation', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Cluster' }));
    await user.click(screen.getByRole('button', { name: 'Select inference-node' }));
    await user.clear(screen.getByRole('spinbutton', { name: 'First layer for GPU 0' }));
    await user.type(screen.getByRole('spinbutton', { name: 'First layer for GPU 0' }), '95');
    await user.click(screen.getByRole('button', { name: 'Actions for inference-node' }));
    await user.click(screen.getByRole('button', { name: 'Rename device' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const dialog = screen.getByRole('complementary', { name: 'Cluster panel' });
    const input = within(dialog).getByRole('textbox', { name: 'Device name' });
    expect(input).toHaveValue('inference-node');
    await user.clear(input);
    await user.type(input, '   ');
    await user.click(within(dialog).getByRole('button', { name: 'Save name' }));
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByText('Enter a device name.')).toBeVisible();
    await user.clear(input);
    await user.type(input, '  office-node  ');
    await user.click(within(dialog).getByRole('button', { name: 'Save name' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'office-node' })).toBeVisible();
    expect(
      within(screen.getByRole('complementary', { name: 'Cluster panel' })).getByRole('heading', {
        name: 'office-node',
      }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Apply and restart' })).toBeVisible();
    expect(
      within(screen.getByRole('article', { name: 'office-node' })).getByText(
        'Planned layers 95 – 127',
      ),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Models' }));
    await user.click(screen.getByRole('button', { name: 'Cluster' }));
    expect(screen.getAllByRole('article')).toHaveLength(4);
    expect(screen.getByRole('article', { name: 'office-node' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Actions for office-node' }));
    await user.click(screen.getByRole('button', { name: 'Rename device' }));
    await user.clear(screen.getByRole('textbox', { name: 'Device name' }));
    await user.type(screen.getByRole('textbox', { name: 'Device name' }), 'cancelled-name');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('article', { name: 'office-node' })).toBeVisible();
    expect(screen.queryByRole('article', { name: 'cancelled-name' })).not.toBeInTheDocument();
  });

  it('updates edits directly, keeps invalid drafts across panels and restores them through undo and redo', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Cluster' }));
    await user.click(screen.getByRole('button', { name: 'Select studio-desktop' }));
    const last = screen.getByRole('spinbutton', { name: 'Last layer for GPU 0' });
    await user.clear(last);
    await user.type(last, '26');
    await user.click(screen.getByRole('button', { name: 'Apply and restart' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/cover all 128 sample layers/);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.clear(screen.getByRole('spinbutton', { name: 'First layer for GPU 1' }));
    await user.type(screen.getByRole('spinbutton', { name: 'First layer for GPU 1' }), '27');
    await user.click(screen.getByRole('button', { name: 'Select mac-studio' }));
    let first = screen.getByRole('spinbutton', {
      name: 'First layer for Apple Silicon (M2 Ultra)',
    });
    await user.clear(first);
    await user.type(first, '-1');
    await user.click(screen.getByRole('button', { name: 'Models' }));
    await user.click(screen.getByRole('button', { name: 'Cluster' }));
    await user.click(screen.getByRole('button', { name: 'Select mac-studio' }));
    expect(
      screen.getByRole('spinbutton', { name: 'First layer for Apple Silicon (M2 Ultra)' }),
    ).toHaveValue('-1');
    expect(
      screen.getByRole('spinbutton', { name: 'First layer for Apple Silicon (M2 Ultra)' }),
    ).toHaveAttribute('aria-invalid', 'false');
    first = screen.getByRole('spinbutton', { name: 'First layer for Apple Silicon (M2 Ultra)' });
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(first).toHaveValue('-');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(first).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(first).toHaveValue('72');
    await user.click(screen.getByRole('button', { name: 'Redo' }));
    await user.click(screen.getByRole('button', { name: 'Redo' }));
    await user.click(screen.getByRole('button', { name: 'Redo' }));
    expect(first).toHaveValue('-1');
    expect(screen.queryByRole('button', { name: 'Discard changes' })).not.toBeInTheDocument();
  });

  it('opens with a compact model selector and one demo label, without redundant status rows', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Cluster' }));
    expect(screen.getByRole('heading', { name: 'Cluster' })).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Selected demo model: Qwen3.8-27B' }),
    ).toHaveTextContent(/^Qwen3\.8-27B$/);
    expect(screen.getAllByRole('article')).toHaveLength(4);
    expect(screen.getAllByText('Demo data')).toHaveLength(1);
    expect(
      screen.queryByText(/Hardware, links, and layer ranges are samples/),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Cluster sample summary')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('article', { name: 'mac-studio' })).getByText(
        '192 GB unified memory',
      ),
    ).toBeVisible();
  });

  it('shows all devices without a device search field', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Cluster' }));
    expect(screen.queryByRole('searchbox', { name: 'Find devices' })).not.toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'mac-studio' })).toBeVisible();
    expect(screen.getAllByRole('article')).toHaveLength(4);
  });

  it('opens the overview and selects devices without treating the coordinator as selected', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Cluster' }));
    const toggle = screen.getByRole('button', { name: 'Cluster panel' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Auto place' })).not.toBeInTheDocument();
    await user.click(toggle);
    const panel = screen.getByRole('complementary', { name: 'Cluster panel' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(panel).getByRole('heading', { name: 'Cluster overview' })).toBeVisible();
    expect(
      within(panel).queryByRole('button', { name: 'Layer placement' }),
    ).not.toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Auto place' })).not.toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Save placement' })).not.toBeInTheDocument();
    const coordinator = screen.getByRole('button', { name: 'Select studio-desktop' });
    expect(coordinator).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'Select ml-workstation' }));
    expect(within(panel).getByRole('heading', { name: 'ml-workstation' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Select ml-workstation' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(coordinator).toHaveAttribute('aria-pressed', 'false');
    await user.click(coordinator);
    expect(within(panel).getByRole('heading', { name: 'studio-desktop' })).toBeVisible();
    expect(screen.getAllByRole('article')).toHaveLength(4);
    expect(screen.getAllByText(/^Layers /)).toHaveLength(5);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('complementary', { name: 'Cluster panel' })).not.toBeInTheDocument();
    expect(coordinator).toHaveFocus();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    await user.click(toggle);
    expect(toggle).toHaveFocus();
    expect(screen.getAllByText(/^Layers /)).toHaveLength(5);
  });

  it('validates before restart, cancels without applying and applies only after simulated loading', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Cluster' }));
    await user.click(screen.getByRole('button', { name: 'Edit layers for studio-desktop GPU 0' }));
    const last = screen.getByRole('spinbutton', { name: 'Last layer for GPU 0' });
    await user.clear(last);
    await user.type(last, '25');
    await user.click(screen.getByRole('button', { name: 'Apply and restart' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/cover all 128 sample layers/);
    expect(
      within(screen.getByRole('complementary', { name: 'Cluster panel' })).queryByText(
        /cover all 128 sample layers/,
      ),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    await user.clear(screen.getByRole('spinbutton', { name: 'First layer for GPU 1' }));
    await user.type(screen.getByRole('spinbutton', { name: 'First layer for GPU 1' }), '26');
    await user.click(screen.getByRole('button', { name: 'Apply and restart' }));
    expect(screen.getByRole('dialog', { name: 'Restart demo model?' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Active layers 0 – 27')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Apply and restart' }));
    await user.click(screen.getByRole('button', { name: 'Restart demo' }));
    expect(screen.getByRole('button', { name: 'Cancel loading' })).toBeVisible();
    await screen.findByRole('button', { name: 'Stop model' });
    expect(screen.getByText('Layers 0 – 25')).toBeVisible();
    expect(screen.queryByText('Active layers 0 – 27')).not.toBeInTheDocument();
  });

  it('explains enrollment without adding peers and keeps API honestly unavailable', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Cluster' }));
    const navigation = within(screen.getByRole('navigation', { name: 'Cluster navigation' }));
    await user.click(navigation.getByRole('button', { name: /^Connections/u }));
    await user.click(screen.getByRole('tab', { name: 'Add device' }));
    const panel = screen.getByRole('tabpanel', { name: 'Add device' });
    expect(within(panel).getByRole('heading', { name: 'Connect manually' })).toBeVisible();
    expect(
      within(panel).getByText(/No discovery, request delivery or pairing occurs/),
    ).toBeVisible();
    await user.click(navigation.getByRole('button', { name: 'Overview' }));
    await user.click(screen.getByRole('button', { name: 'Add device near studio-desktop' }));
    expect(
      within(screen.getByRole('complementary', { name: 'Cluster panel' })).getByRole('heading', {
        name: 'Add to canvas',
      }),
    ).toBeVisible();
    expect(screen.getAllByRole('article')).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: 'API' }));
    expect(screen.getByText('No API server is running.')).toBeVisible();
  });

  it('allows unloaded planning after the demo model stops', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Cluster' }));
    await user.click(screen.getByRole('button', { name: 'Stop model' }));
    expect(screen.getByRole('button', { name: 'Run model' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Select studio-desktop' }));
    expect(screen.getByRole('spinbutton', { name: 'First layer for GPU 0' })).toBeVisible();
    expect(screen.queryByText('In use')).not.toBeInTheDocument();
  });

  it('shows connection details in the same panel without selecting a device', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Cluster' }));
    await user.click(
      screen.getByRole('button', { name: 'Sample connection studio to workstation: 12 ms' }),
    );
    const panel = screen.getByRole('complementary', { name: 'Cluster panel' });
    expect(within(panel).getByRole('heading', { name: 'Connection' })).toBeVisible();
    expect(within(panel).getByText('12 ms')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Select studio-desktop' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(within(panel).getByText(/No latency measurement/)).toBeVisible();
  });

  it('never shows sample peers in the build with demo data disabled', async () => {
    vi.stubGlobal('__DEMO_DATA_ENABLED__', false);
    try {
      const user = userEvent.setup();
      render(<App />);
      await user.click(screen.getByRole('button', { name: 'Cluster' }));
      expect(screen.queryByRole('article')).not.toBeInTheDocument();
      expect(screen.getByText('No devices connected')).toBeVisible();
      expect(screen.queryByText('studio-desktop')).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
