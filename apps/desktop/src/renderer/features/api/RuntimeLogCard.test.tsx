import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeLogCard } from './RuntimeLogCard';
import type { RuntimeLogEntry } from '../../../shared/runtime-logs';
import toastStyles from '../../components/Toast.module.css';

afterEach(() => {
  delete window.modelLoomLogs;
  vi.useRealTimers();
});
const row = (id: number, message: string, level: 'info' | 'error' = 'info'): RuntimeLogEntry => ({
  id,
  at: '2026-10-30T01:00:00.000Z',
  source: 'runtime',
  level,
  message,
});

it('shows shared logs with the API absent, filters errors and clears through the shared bridge', async () => {
  let revision = 2,
    entries = [row(1, 'native.ready'), row(2, 'CUDA error: device lost', 'error')];
  const command = vi.fn((input: { action: 'read' | 'clear'; after?: number }) => {
    if (input.action === 'clear') {
      entries = [];
      revision++;
    }
    return Promise.resolve({
      ok: true as const,
      revision,
      entries: input.after === revision ? null : entries,
    });
  });
  window.modelLoomLogs = { command };
  const user = userEvent.setup();
  render(<RuntimeLogCard />);
  expect(await screen.findByText('native.ready')).toBeVisible();
  expect(screen.queryByText(/Only service events/)).not.toBeInTheDocument();
  const copy = screen.getByRole('button', { name: 'Copy runtime logs' });
  expect(copy).toHaveTextContent('');
  await user.click(screen.getByRole('button', { name: 'Errors' }));
  expect(screen.queryByText('native.ready')).not.toBeInTheDocument();
  expect(screen.getByText('CUDA error: device lost')).toBeVisible();
  await user.click(copy);
  expect(await navigator.clipboard.readText()).toContain('CUDA error: device lost');
  expect(await navigator.clipboard.readText()).not.toContain('native.ready');
  await user.click(screen.getByRole('button', { name: 'Clear runtime logs' }));
  expect(command).toHaveBeenCalledWith({ action: 'clear' });
  await waitFor(() =>
    expect(screen.queryByText('CUDA error: device lost')).not.toBeInTheDocument(),
  );
  expect(screen.getByText('Logs cleared').parentElement).toHaveClass(toastStyles.success!);
});

it('automatically dismisses the green cleared popup after five seconds', async () => {
  vi.useFakeTimers();
  let cleared = false;
  window.modelLoomLogs = {
    command: (input) => {
      if (input.action === 'clear') cleared = true;
      return Promise.resolve({
        ok: true,
        revision: cleared ? 2 : 1,
        entries: cleared ? [] : [row(1, 'old event')],
      });
    },
  };
  render(<RuntimeLogCard />);
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Clear runtime logs' }));
    await Promise.resolve();
  });
  expect(screen.getByText('Logs cleared').parentElement).toHaveClass(toastStyles.success!);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5001);
  });
  expect(screen.queryByText('Logs cleared')).not.toBeInTheDocument();
});

it('ignores a read response captured before a successful clear', async () => {
  vi.useFakeTimers();
  let resolveOld!: (reply: { ok: true; revision: number; entries: RuntimeLogEntry[] }) => void;
  let reads = 0;
  window.modelLoomLogs = {
    command: (input) => {
      if (input.action === 'clear') return Promise.resolve({ ok: true, revision: 2, entries: [] });
      if (++reads === 1)
        return Promise.resolve({ ok: true, revision: 1, entries: [row(1, 'old event')] });
      return new Promise((resolve) => {
        resolveOld = resolve;
      });
    },
  };
  render(<RuntimeLogCard />);
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Clear runtime logs' }));
    await Promise.resolve();
  });
  await act(async () => {
    resolveOld({ ok: true, revision: 1, entries: [row(1, 'old event')] });
    await Promise.resolve();
  });
  expect(screen.queryByText('old event')).not.toBeInTheDocument();
});

it('renders only a viewport of rows from a full retained history', async () => {
  window.modelLoomLogs = {
    command: () =>
      Promise.resolve({
        ok: true,
        revision: 2000,
        entries: Array.from({ length: 2000 }, (_, i) => row(i + 1, `event ${i}`)),
      }),
  };
  render(<RuntimeLogCard />);
  await screen.findByText('event 0');
  expect(screen.getAllByTestId('runtime-log-row').length).toBeLessThan(40);
});

it('puts peer failure codes before their diagnostic metadata', async () => {
  const message = JSON.stringify({
    stage: 'inventory',
    decision: 'disconnect',
    code: 'PEER_UNAVAILABLE',
    cause: 'ECONNRESET',
    transport: 'OVERLAY_UNAVAILABLE',
  });
  window.modelLoomLogs = {
    command: () =>
      Promise.resolve({
        ok: true,
        revision: 1,
        entries: [{ ...row(1, message, 'error'), source: 'peer' }],
      }),
  };
  render(<RuntimeLogCard />);
  expect(
    await screen.findByText(
      'PEER_UNAVAILABLE: inventory.disconnect (ECONNRESET, OVERLAY_UNAVAILABLE)',
    ),
  ).toBeVisible();
});

it('does not follow new events after the user scrolls up', async () => {
  vi.useFakeTimers();
  let revision = 30;
  window.modelLoomLogs = {
    command: () =>
      Promise.resolve({
        ok: true,
        revision,
        entries: Array.from({ length: revision }, (_, i) => row(i + 1, `event ${i}`)),
      }),
  };
  render(<RuntimeLogCard />);
  await act(async () => {
    await Promise.resolve();
  });
  const viewer = screen.getByRole('log', { name: 'Runtime log viewer' });
  Object.defineProperties(viewer, {
    clientHeight: { configurable: true, value: 360 },
    scrollHeight: { configurable: true, value: 2000 },
  });
  viewer.scrollTop = 0;
  fireEvent.scroll(viewer);
  revision++;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  expect(viewer.scrollTop).toBe(0);
});
