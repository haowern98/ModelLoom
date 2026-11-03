import type * as MotionReact from 'motion/react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

vi.mock('motion/react', async (load) => ({
  ...(await load<typeof MotionReact>()),
  useReducedMotion: () => true,
}));

async function editRange(
  user: ReturnType<typeof userEvent.setup>,
  device: string,
  gpu: string,
  first: string,
  last: string,
) {
  await user.click(screen.getByRole('button', { name: `Edit layers for ${device} ${gpu}` }));
  await user.clear(screen.getByRole('textbox', { name: /^First layer for / }));
  await user.type(screen.getByRole('textbox', { name: /^First layer for / }), first);
  await user.clear(screen.getByRole('textbox', { name: /^Last layer for / }));
  await user.type(screen.getByRole('textbox', { name: /^Last layer for / }), last);
  await user.click(screen.getByRole('button', { name: 'Done' }));
}

describe('Cluster demo', () => {
  it('renames a device through its actions without changing layer drafts and retains the name across navigation', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Cluster' }));
    await editRange(user, 'inference-node', 'GPU 0', '97', '127');
    await user.click(screen.getByRole('button', { name: 'Select inference-node' }));
    await user.click(screen.getByRole('button', { name: 'Actions for inference-node' }));
    await user.click(screen.getByRole('menuitem', { name: 'Rename device' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename device' });
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
    expect(screen.getByRole('group', { name: 'Layer assignment for office-node' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(
      screen.getByRole('button', { name: 'Edit layers for office-node GPU 0' }),
    ).toHaveTextContent('97\u2013127');
    await user.click(screen.getByRole('button', { name: 'Models' }));
    await user.click(screen.getByRole('button', { name: 'Cluster' }));
    expect(screen.getAllByRole('article')).toHaveLength(4);
    expect(screen.getByRole('article', { name: 'office-node' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Actions for office-node' }));
    await user.click(screen.getByRole('menuitem', { name: 'Rename device' }));
    await user.clear(screen.getByRole('textbox', { name: 'Device name' }));
    await user.type(screen.getByRole('textbox', { name: 'Device name' }), 'cancelled-name');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('article', { name: 'office-node' })).toBeVisible();
    expect(screen.queryByRole('article', { name: 'cancelled-name' })).not.toBeInTheDocument();
  });

  it('commits inline previews as one undoable edit and keeps selection read-only', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Cluster' }));
    await editRange(user, 'studio-desktop', 'GPU 0', '0', '26');
    const range = () =>
      screen.getByRole('button', { name: 'Edit layers for studio-desktop GPU 0' });
    expect(range()).toHaveTextContent('0\u201326');
    await user.click(screen.getByRole('button', { name: 'Select mac-studio' }));
    expect(screen.queryByRole('textbox', { name: /^First layer for / })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Layer assignment for mac-studio' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(range()).toHaveTextContent('0\u201327');
    await user.click(screen.getByRole('button', { name: 'Redo' }));
    expect(range()).toHaveTextContent('0\u201326');
    await user.click(screen.getByRole('button', { name: 'Models' }));
    await user.click(screen.getByRole('button', { name: 'Cluster' }));
    expect(range()).toHaveTextContent('0\u201326');
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
      within(screen.getByRole('article', { name: 'mac-studio' })).getByText('192.0 GiB'),
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
    expect(
      within(panel).getByRole('group', { name: 'Layer assignment for ml-workstation' }),
    ).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Select ml-workstation' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(coordinator).toHaveAttribute('aria-pressed', 'false');
    await user.click(coordinator);
    expect(
      within(panel).getByRole('group', { name: 'Layer assignment for studio-desktop' }),
    ).toHaveAttribute('aria-current', 'true');
    expect(screen.getAllByRole('article')).toHaveLength(4);
    expect(screen.getAllByRole('button', { name: /^Edit layers for / })).toHaveLength(5);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('complementary', { name: 'Cluster panel' })).not.toBeInTheDocument();
    expect(coordinator).toHaveFocus();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    await user.click(toggle);
    expect(toggle).toHaveFocus();
    expect(screen.getAllByRole('button', { name: /^Edit layers for / })).toHaveLength(5);
  });

  it('validates before restart, cancels without applying and applies only after simulated loading', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Cluster' }));
    await user.click(screen.getByRole('button', { name: 'Edit layers for studio-desktop GPU 0' }));
    const last = screen.getByRole('textbox', { name: /^Last layer for / });
    await user.clear(last);
    await user.type(last, '-');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/whole/);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.clear(last);
    await user.type(last, '25');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Apply and restart' }));
    expect(screen.getByRole('dialog', { name: 'Restart demo model?' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      screen.getByRole('button', { name: 'Edit layers for studio-desktop GPU 0' }),
    ).toHaveTextContent('0\u201325');
    await user.click(screen.getByRole('button', { name: 'Apply and restart' }));
    await user.click(screen.getByRole('button', { name: 'Restart demo' }));
    expect(screen.getByRole('button', { name: 'Cancel loading' })).toBeVisible();
    await screen.findByRole('button', { name: 'Unload model' });
    expect(
      screen.getByRole('button', { name: 'Edit layers for studio-desktop GPU 0' }),
    ).toHaveTextContent('0\u201325');
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
        name: 'Add device',
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
    await user.click(screen.getByRole('button', { name: 'Unload model' }));
    expect(screen.getByRole('button', { name: 'Load model' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Select studio-desktop' }));
    expect(screen.getByRole('heading', { name: 'Cluster overview' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Edit layers for studio-desktop GPU 0' }));
    expect(screen.getByRole('textbox', { name: /^First layer for / })).toBeVisible();
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
    expect(within(panel).getByText(/not verified/)).toBeVisible();
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
