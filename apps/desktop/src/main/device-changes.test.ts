import { expect, it, vi } from 'vitest';
import { watchDeviceChanges } from './device-changes';

it('refreshes on Windows devnode changes and ignores unrelated or malformed messages', () => {
  const window = { hookWindowMessage: vi.fn() };
  const changed = vi.fn();
  watchDeviceChanges(window, changed, 'win32');
  expect(window.hookWindowMessage).toHaveBeenCalledWith(0x0219, expect.any(Function));
  const callback = window.hookWindowMessage.mock.calls[0]![1] as (value: Buffer) => void;
  callback(Buffer.from([7, 0, 0, 0, 0, 0, 0, 0]));
  callback(Buffer.from([1, 0, 0, 0]));
  callback(Buffer.from([7]));
  expect(changed).toHaveBeenCalledTimes(1);
});

it('does not install Windows hooks on other platforms', () => {
  const window = { hookWindowMessage: vi.fn() };
  watchDeviceChanges(window, vi.fn(), 'darwin');
  expect(window.hookWindowMessage).not.toHaveBeenCalled();
});
