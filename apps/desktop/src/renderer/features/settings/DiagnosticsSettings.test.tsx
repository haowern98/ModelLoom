import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { RuntimeLogEntry } from '../../../shared/runtime-logs';
import { copyText } from '../../components/copyText';
import { DiagnosticsSettings } from './DiagnosticsSettings';

vi.mock('../../components/copyText', () => ({ copyText: vi.fn().mockResolvedValue(undefined) }));

afterEach(() => {
  cleanup();
  delete window.modelLoomLogs;
  vi.clearAllMocks();
});

it('previews and copies only the latest failure and its related safe events', async () => {
  const at = '2026-11-08T02:00:00.000Z';
  const connection = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const rpc = (phase: string, event: string, details = {}) =>
    `rpc.lifecycle ${JSON.stringify({ at, connection, role: 'client', phase, event, elapsedMs: 12, ...details })}`;
  const entries: RuntimeLogEntry[] = [
    { id: 1, at, source: 'runtime', level: 'error', message: 'load.failed code=START_FAILED' },
    { id: 2, at, source: 'peer', level: 'info', message: rpc('overlay', 'ready') },
    {
      id: 3,
      at,
      source: 'peer',
      level: 'info',
      message: rpc('status', 'ready', { connection: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }),
    },
    {
      id: 4,
      at,
      source: 'peer',
      level: 'error',
      message: rpc('tls', 'error', { code: 'https://private.example/secret', cause: 'ECONNRESET' }),
    },
  ];
  window.modelLoomLogs = { command: vi.fn().mockResolvedValue({ ok: true, revision: 4, entries }) };
  render(<DiagnosticsSettings onApi={vi.fn()} />);

  expect(await screen.findByText('Peer connection failed during RPC tls')).toBeVisible();
  expect(copyText).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Preview report' }));
  const dialog = screen.getByRole('dialog', { name: 'Support report' });
  const preview = within(dialog).getByLabelText('Support report contents');
  expect(preview).toHaveTextContent(`Time (UTC): ${at}`);
  expect(preview).toHaveTextContent('Code: UNKNOWN');
  expect(preview).toHaveTextContent('overlay · ready');
  expect(preview).toHaveTextContent('tls · error');
  expect(preview).not.toHaveTextContent(/START_FAILED|status · ready|private\.example|ECONNRESET/u);
  expect(preview).not.toHaveTextContent(connection);
  expect(copyText).not.toHaveBeenCalled();

  fireEvent.click(within(dialog).getByRole('button', { name: 'Copy support report' }));
  expect(copyText).toHaveBeenCalledExactlyOnceWith(preview.textContent);
  expect(await within(dialog).findByText('Support report copied.')).toBeVisible();
});
