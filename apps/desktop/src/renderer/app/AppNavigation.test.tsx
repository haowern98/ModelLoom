import type * as MotionReact from 'motion/react';
import type * as ClusterConfigurationModule from '../features/cluster/useClusterConfigurations';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';

const { requestLeave } = vi.hoisted(() => ({
  requestLeave: vi.fn<(action: () => void | Promise<void>) => Promise<void>>(),
}));
vi.mock('../features/cluster/useClusterConfigurations', async (load) => {
  const actual = await load<typeof ClusterConfigurationModule>();
  return {
    ...actual,
    useClusterConfigurations: (...args: Parameters<typeof actual.useClusterConfigurations>) => ({
      ...actual.useClusterConfigurations(...args),
      requestLeave,
    }),
  };
});
vi.mock('motion/react', async (load) => ({
  ...(await load<typeof MotionReact>()),
  useReducedMotion: () => true,
}));
beforeEach(() => {
  requestLeave.mockImplementation(async (action) => {
    await action();
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
});
const back = () => screen.getByRole('button', { name: 'Back' });
const forward = () => screen.getByRole('button', { name: 'Forward' });

it('restores settings categories with buttons, keyboard and mouse, and clears abandoned forward history', async () => {
  const user = userEvent.setup();
  render(<App />);
  expect(back()).toBeDisabled();
  expect(forward()).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Models' }));
  expect(back()).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Settings' }));
  await user.click(screen.getByRole('button', { name: 'Network' }));
  await user.click(screen.getByRole('button', { name: 'Storage' }));
  await user.click(back());
  expect(screen.getByRole('heading', { name: 'Network' })).toBeVisible();
  fireEvent.keyDown(window, { key: ']', ctrlKey: true });
  expect(screen.getByRole('heading', { name: 'Storage' })).toBeVisible();
  fireEvent.keyDown(window, { key: '[', ctrlKey: true });
  expect(screen.getByRole('heading', { name: 'Network' })).toBeVisible();
  fireEvent.mouseUp(window, { button: 3 });
  expect(screen.getByRole('heading', { name: 'Appearance' })).toBeVisible();
  fireEvent.mouseUp(window, { button: 4 });
  expect(screen.getByRole('heading', { name: 'Network' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'API' }));
  expect(forward()).toBeDisabled();
});

it('restores individual chats and retains their drafts without creating a new chat', async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: 'Chat' }));
  await user.click(screen.getByRole('button', { name: 'Explain model quantization' }));
  await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Keep this draft');
  await user.click(screen.getByRole('button', { name: 'API' }));
  await user.click(back());
  expect(screen.getByRole('heading', { name: 'Explain model quantization' })).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Keep this draft');
  await user.click(back());
  expect(screen.getByRole('heading', { name: 'Planning a local setup' })).toBeVisible();
  await user.click(forward());
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Keep this draft');
});

it('restores device details independently of assignment undo and redo', async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: 'Cluster' }));
  await user.click(screen.getByRole('button', { name: 'Actions for studio-desktop' }));
  await user.click(screen.getByRole('menuitem', { name: 'Device details' }));
  expect(screen.getByRole('heading', { name: 'Devices' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Settings' }));
  await user.click(back());
  expect(screen.getByRole('heading', { name: 'Devices' })).toBeVisible();
  await user.click(back());
  expect(screen.getByRole('button', { name: 'Undo' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Devices' })).not.toBeInTheDocument();
});

it('leaves history untouched when the existing Cluster departure guard declines navigation', async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: 'Cluster' }));
  requestLeave.mockImplementation(async () => {});
  await user.click(back());
  expect(requestLeave).toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Cluster' })).toHaveAttribute('aria-current', 'page');
  expect(forward()).toBeDisabled();
  requestLeave.mockImplementation(async (action) => {
    await action();
  });
  await user.click(back());
  expect(screen.getByRole('button', { name: 'Models' })).toHaveAttribute('aria-current', 'page');
  expect(forward()).toBeEnabled();
});

it('restores the model configuration and its unsaved draft, and does not navigate behind a dialog', async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: 'Configure Llama 3.1 8B' }));
  await user.type(screen.getByRole('textbox', { name: 'System Prompt' }), 'Keep this instruction');
  await user.click(screen.getByRole('button', { name: 'API' }));
  await user.click(back());
  expect(screen.getByRole('textbox', { name: 'System Prompt' })).toHaveValue(
    'Keep this instruction',
  );
  await user.click(back());
  await user.click(screen.getByRole('button', { name: 'Import GGUF' }));
  expect(screen.getByRole('dialog')).toBeVisible();
  fireEvent.keyDown(window, { key: ']', ctrlKey: true });
  expect(screen.getByRole('dialog')).toBeVisible();
  expect(screen.queryByRole('textbox', { name: 'System Prompt' })).not.toBeInTheDocument();
});
