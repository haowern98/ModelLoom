import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { developmentInstance } from './development-launch';

it('has exactly one supported desktop development script', () => {
  const workspace = JSON.parse(
    readFileSync(path.resolve(__dirname, '../../../../package.json'), 'utf8'),
  ) as { scripts: Record<string, string> };
  const desktop = JSON.parse(
    readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'),
  ) as { scripts: Record<string, string> };
  expect(workspace.scripts.electron).toBe('node scripts/electron.mjs');
  expect(workspace.scripts.dev).toBeUndefined();
  expect(desktop.scripts.start).toBeUndefined();
});

it('rejects direct source starts before claiming an instance', () => {
  const app = { isPackaged: false, requestSingleInstanceLock: vi.fn(), on: vi.fn(), exit: vi.fn() };
  expect(developmentInstance(app, {}, () => undefined)).toBe(false);
  expect(app.exit).toHaveBeenCalledWith(1);
  expect(app.requestSingleInstanceLock).not.toHaveBeenCalled();
});

it('takes one lock and restores the existing window on a repeated launch', () => {
  const app = {
    isPackaged: false,
    requestSingleInstanceLock: vi.fn(() => true),
    on: vi.fn<(event: 'second-instance', listener: () => void) => void>(),
    exit: vi.fn(),
  };
  const window = { isMinimized: () => true, restore: vi.fn(), show: vi.fn(), focus: vi.fn() };
  expect(developmentInstance(app, { MODELLOOM_DEV_LAUNCH: 'electron-dev' }, () => window)).toBe(
    true,
  );
  app.on.mock.calls[0]![1]();
  expect(window.restore).toHaveBeenCalledOnce();
  expect(window.show).toHaveBeenCalledOnce();
  expect(window.focus).toHaveBeenCalledOnce();
  app.requestSingleInstanceLock.mockReturnValue(false);
  expect(developmentInstance(app, { MODELLOOM_DEV_LAUNCH: 'electron-dev' }, () => window)).toBe(
    false,
  );
  expect(app.exit).toHaveBeenCalledWith(0);
});
