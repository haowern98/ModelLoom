import { expect, it, vi } from 'vitest';
import { NetworkOwner } from './owner.js';
import type { HelperEvents } from './helper.js';
it('disconnect cancels enrollment and ignores late login/status events', async () => {
  let events!: HelperEvents;
  const component = {
    command: vi.fn(() => Promise.resolve(undefined)),
    dial: vi.fn(),
    close: vi.fn(() => Promise.resolve(undefined)),
  };
  const openLogin = vi.fn(() => Promise.resolve(undefined));
  const owner = new NetworkOwner({
    open: (callbacks) => {
      events = callbacks;
      return Promise.resolve(component);
    },
    openLogin,
    probe: () => Promise.resolve(null),
  });
  await owner.command({ action: 'connect' });
  await owner.command({ action: 'disconnect' });
  events.login('https://login.tailscale.com/a/stale');
  events.status({ state: 'connected', addresses: ['100.90.40.12'], candidates: [] }, []);
  expect(await owner.command({ action: 'read' })).toEqual({
    ok: true,
    view: { state: 'disconnected', addresses: [], candidates: [] },
  });
  expect(openLogin).not.toHaveBeenCalled();
  await owner.close();
});
it('reports unavailable protected storage without blocking read or inventing a replacement enrollment', async () => {
  const open = vi.fn(() => Promise.reject(Error('NETWORK_STORAGE_UNAVAILABLE')));
  const owner = new NetworkOwner({
    open,
    openLogin: () => Promise.resolve(undefined),
    probe: () => Promise.resolve(null),
  });
  await owner.command({ action: 'connect' });
  const reply = await owner.command({ action: 'read' });
  expect(reply.ok && reply.view.error).toBe('NETWORK_STORAGE_UNAVAILABLE');
  expect(open).toHaveBeenCalledTimes(1);
  await owner.close();
});
it('closes the owned helper even when disabling persisted enrollment fails', async () => {
  const component = {
    command: vi.fn(() => Promise.resolve(undefined)),
    dial: vi.fn(),
    close: vi.fn(() => Promise.resolve(undefined)),
  };
  const owner = new NetworkOwner({
    open: () => Promise.resolve(component),
    openLogin: () => Promise.resolve(undefined),
    probe: () => Promise.resolve(null),
    rememberEnabled: (enabled) =>
      enabled ? Promise.resolve() : Promise.reject(Error('NETWORK_STORAGE_UNAVAILABLE')),
  });
  await owner.command({ action: 'connect' });
  await owner.command({ action: 'disconnect' });
  expect(component.close).toHaveBeenCalledOnce();
  expect(owner.snapshot().state).toBe('failed');
  await owner.close();
});
it('quiesces a failed helper and rejects its late status and incoming streams', async () => {
  let events!: HelperEvents;
  const component = {
    command: vi.fn(() => Promise.resolve(undefined)),
    dial: vi.fn(),
    close: vi.fn(() => Promise.resolve(undefined)),
  };
  const owner = new NetworkOwner({
    open: (callbacks) => {
      events = callbacks;
      return Promise.resolve(component);
    },
    openLogin: () => Promise.resolve(undefined),
    probe: () => Promise.resolve(null),
  });
  await owner.command({ action: 'connect' });
  events.lost();
  await vi.waitFor(() => expect(component.close).toHaveBeenCalledOnce());
  events.status({ state: 'connected', addresses: [], candidates: [] }, []);
  expect(owner.snapshot().state).toBe('failed');
  await owner.close();
});
it('signs out a disconnected enrollment without starting a node or browser', async () => {
  const open = vi.fn(),
    forgetEnrollment = vi.fn(() => Promise.resolve(undefined));
  const owner = new NetworkOwner({
    open,
    forgetEnrollment,
    openLogin: vi.fn(),
    probe: () => Promise.resolve(null),
  });
  expect((await owner.command({ action: 'sign-out' })).ok).toBe(true);
  expect(forgetEnrollment).toHaveBeenCalledOnce();
  expect(open).not.toHaveBeenCalled();
  expect(owner.snapshot().state).toBe('disconnected');
  await owner.close();
});

it('retries cleanup of the exact failed component before reconnecting', async () => {
  let events!: HelperEvents;
  const component = {
    command: vi.fn(() => Promise.resolve()),
    dial: vi.fn(),
    close: vi.fn(() => Promise.resolve()).mockRejectedValueOnce(Error('NETWORK_CLEANUP_FAILED')),
  };
  const open = vi.fn((callbacks: HelperEvents) => {
    events = callbacks;
    return Promise.resolve(component);
  });
  const owner = new NetworkOwner({
    open,
    openLogin: () => Promise.resolve(),
    probe: () => Promise.resolve(null),
  });
  await owner.command({ action: 'connect' });
  events.lost();
  await vi.waitFor(() => expect(component.close).toHaveBeenCalledOnce());
  await owner.command({ action: 'connect' });
  expect(component.close).toHaveBeenCalledTimes(2);
  expect(open).toHaveBeenCalledTimes(2);
  expect(owner.snapshot().state).toBe('starting');
  await owner.close();
});
it('serializes sign-out before connect while status reads remain available', async () => {
  let release!: () => void;
  const disabled = new Promise<void>((resolve) => {
    release = resolve;
  });
  let running = false;
  const forgetEnrollment = vi.fn(() => {
    expect(running).toBe(false);
    return Promise.resolve();
  });
  const open = vi.fn(() =>
    Promise.resolve({
      command: () => {
        running = true;
        return Promise.resolve();
      },
      dial: vi.fn(),
      close: () => {
        running = false;
        return Promise.resolve();
      },
    }),
  );
  const owner = new NetworkOwner({
    open,
    forgetEnrollment,
    openLogin: () => Promise.resolve(),
    probe: () => Promise.resolve(null),
    rememberEnabled: (enabled) => (enabled ? Promise.resolve() : disabled),
  });
  const logout = owner.command({ action: 'sign-out' });
  const connect = owner.command({ action: 'connect' });
  expect((await owner.command({ action: 'read' })).ok).toBe(true);
  expect(open).not.toHaveBeenCalled();
  release();
  await Promise.all([logout, connect]);
  expect(forgetEnrollment).toHaveBeenCalledOnce();
  expect(open).toHaveBeenCalledOnce();
  await owner.close();
});
it('restarts an expired enrollment for a fresh browser sign-in', async () => {
  let events!: HelperEvents;
  const component = {
    command: vi.fn(() => Promise.resolve()),
    dial: vi.fn(),
    close: vi.fn(() => Promise.resolve()),
  };
  const open = vi.fn((callbacks: HelperEvents) => {
    events = callbacks;
    return Promise.resolve(component);
  });
  const owner = new NetworkOwner({
    open,
    openLogin: () => Promise.resolve(),
    probe: () => Promise.resolve(null),
  });
  await owner.command({ action: 'connect' });
  events.status({ state: 'expired', addresses: [], candidates: [] }, []);
  await owner.command({ action: 'connect' });
  expect(open).toHaveBeenCalledTimes(2);
  expect(component.close).toHaveBeenCalledOnce();
  await owner.close();
});

it('retries the retained component after shutdown cleanup fails', async () => {
  const close = vi
    .fn()
    .mockRejectedValueOnce(Error('NETWORK_CLEANUP_FAILED'))
    .mockResolvedValue(undefined);
  const owner = new NetworkOwner({
    open: () => Promise.resolve({ command: () => Promise.resolve(), dial: vi.fn(), close }),
    openLogin: async () => {},
    probe: () => Promise.resolve(null),
  });
  await owner.command({ action: 'connect' });
  await expect(owner.close()).rejects.toThrow('NETWORK_CLEANUP_FAILED');
  await owner.close();
  expect(close).toHaveBeenCalledTimes(2);
});
