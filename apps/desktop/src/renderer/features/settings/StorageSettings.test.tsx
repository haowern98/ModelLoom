import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StorageSettings } from './StorageSettings';
import type { CacheBridge, CacheReply, CacheView } from '../../../shared/tensor-cache';

const savedView: CacheView = {
  settings: {
    enabled: true,
    limitGiB: 10,
    reserveGiB: 5,
    policy: 'replace',
    location: 'E:\\ModelLoom-TensorCache-v1',
  },
  usedBytes: 0,
};

afterEach(() => {
  cleanup();
  delete window.modelLoomCache;
});
function setup(error?: CacheView['error']) {
  let view: CacheView = {
    ...savedView,
    ...(error ? { error } : {}),
  };
  const command = vi.fn<CacheBridge['command']>((input) => {
    if (input.action === 'set')
      view = { ...view, settings: { ...view.settings, ...input.settings } };
    return Promise.resolve({ ok: true, view });
  });
  window.modelLoomCache = { command };
  render(<StorageSettings />);
  return command;
}
it('shows an unavailable worker cache instead of silently presenting zero usage', async () => {
  setup('CACHE_LOCATION_UNAVAILABLE');
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('cache location is unavailable');
  expect(alert.textContent).toContain('Model loading can continue without caching');
});
it('shows persisted settings and changes the enabled preference without discarding limits', async () => {
  const command = setup();
  const toggle = await screen.findByRole('switch', { name: 'Tensor cache' });
  await waitFor(() => expect(toggle).toHaveProperty('checked', true));
  fireEvent.click(toggle);
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith({
      action: 'set',
      settings: { enabled: false, limitGiB: 10, reserveGiB: 5, policy: 'replace' },
    }),
  );
});
it('uses the existing keyboard dropdown for both full-cache policies', async () => {
  const command = setup();
  const select = await screen.findByRole('combobox', { name: 'When cache is full' });
  await waitFor(() => expect(select).toHaveProperty('disabled', false));
  fireEvent.keyDown(select, { key: 'ArrowDown' });
  expect(screen.getByRole('listbox', { name: 'When cache is full' })).toBeTruthy();
  fireEvent.click(screen.getByRole('option', { name: 'Keep existing entries' }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith({
      action: 'set',
      settings: { enabled: true, limitGiB: 10, reserveGiB: 5, policy: 'keep' },
    }),
  );
  expect(screen.queryByRole('listbox')).toBeNull();
});
it('delegates location selection and clearing without sending a filesystem path', async () => {
  const command = setup();
  const browse = await screen.findByRole('button', { name: 'Browse' });
  await waitFor(() => expect(browse).toHaveProperty('disabled', false));
  fireEvent.click(browse);
  await waitFor(() => expect(command).toHaveBeenCalledWith({ action: 'choose-location' }));
  expect(command.mock.calls.every(([input]) => !Object.hasOwn(input, 'path'))).toBe(true);
});
it('keeps invalid numeric drafts visible instead of sending a zero or silently changing them', async () => {
  const command = setup();
  const limit = await screen.findByRole('spinbutton', { name: 'Cache size limit' });
  await waitFor(() => expect(limit).toHaveProperty('disabled', false));
  fireEvent.change(limit, { target: { value: '0' } });
  fireEvent.blur(limit);
  expect(screen.getByRole('alert').textContent).toContain('whole number');
  expect(command.mock.calls.filter(([input]) => input.action === 'set')).toHaveLength(0);
});

it.each([
  ['Cache size limit', '10'],
  ['Keep disk space free', '5'],
])('clears validation when %s is restored to its saved value', async (name, saved) => {
  const command = setup();
  const input = screen.getByRole('spinbutton', { name });
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, { target: { value: '0' } });
  fireEvent.blur(input);
  expect(screen.getByRole('alert')).toHaveTextContent('whole number');
  fireEvent.change(input, { target: { value: saved } });
  fireEvent.blur(input);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(command.mock.calls.filter(([input]) => input.action === 'set')).toHaveLength(0);
});

it('preserves the cache warning while numeric validation is shown and corrected', async () => {
  setup('CACHE_LOCATION_UNAVAILABLE');
  await screen.findByText(/cache location is unavailable/);
  const input = screen.getByRole('spinbutton', { name: 'Cache size limit' });
  fireEvent.change(input, { target: { value: '0' } });
  fireEvent.blur(input);
  expect(screen.getByRole('alert')).toHaveTextContent('whole number');
  expect(screen.getByRole('alert')).toHaveTextContent('cache location is unavailable');
  fireEvent.change(input, { target: { value: '10' } });
  fireEvent.blur(input);
  expect(screen.getByRole('alert')).not.toHaveTextContent('whole number');
  expect(screen.getByRole('alert')).toHaveTextContent('cache location is unavailable');
});

it('shows unavailable cache information when there is no bridge', () => {
  render(<StorageSettings />);
  expect(screen.queryAllByText('Loading…')).toHaveLength(0);
  expect(screen.getByText('Unavailable')).toBeVisible();
  expect(screen.getByText('Usage unavailable')).toBeVisible();
});

it.each(['rejected', 'failed'])(
  'leaves loading after a %s first read and recovers on retry',
  async (failure) => {
    let resolve!: (reply: CacheReply) => void;
    let reject!: (error: Error) => void;
    const firstRead = new Promise<CacheReply>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const command = vi
      .fn<CacheBridge['command']>()
      .mockImplementationOnce(() => firstRead)
      .mockResolvedValue({ ok: true, view: savedView });
    window.modelLoomCache = { command };
    render(<StorageSettings />);
    await waitFor(() => expect(command).toHaveBeenCalledOnce());
    expect(screen.getAllByText('Loading…')).toHaveLength(2);
    await act(async () => {
      if (failure === 'rejected') reject(new Error('read failed'));
      else resolve({ ok: false, error: 'CACHE_BUSY' });
      await firstRead.catch(() => undefined);
    });
    expect(screen.queryAllByText('Loading…')).toHaveLength(0);
    expect(screen.getByText('Unavailable')).toBeVisible();
    expect(screen.getByText('Usage unavailable')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(savedView.settings.location)).toBeVisible();
    expect(screen.getByText('0 B of 10 GiB used')).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
  },
);

it('keeps the last cache values alongside an error when a later refresh fails', async () => {
  const command = setup('CACHE_LOCATION_UNAVAILABLE');
  await screen.findByRole('alert');
  command.mockRejectedValueOnce(new Error('read failed'));
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByText('Cache information is unavailable. Try again.');
  expect(screen.getByText(savedView.settings.location)).toBeVisible();
  expect(screen.getByText('0 B of 10 GiB used')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  expect(screen.queryAllByText('Loading…')).toHaveLength(0);
});
