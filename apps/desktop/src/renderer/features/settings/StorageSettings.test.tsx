import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StorageSettings } from './StorageSettings';
import type { CacheBridge, CacheView } from '../../../shared/tensor-cache';

afterEach(() => {
  cleanup();
  delete window.modelLoomCache;
});
function setup(error?: CacheView['error']) {
  let view: CacheView = {
    settings: {
      enabled: true,
      limitGiB: 10,
      reserveGiB: 5,
      policy: 'replace',
      location: 'E:\\ModelLoom-TensorCache-v1',
    },
    usedBytes: 0,
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
