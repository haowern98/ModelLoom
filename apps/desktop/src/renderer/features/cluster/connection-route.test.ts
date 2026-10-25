import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { ConnectionDetails } from './ConnectionDetails';
import type { DemoDevice } from '../../mocks/cluster';
import type { NetworkBridge } from '../../../shared/network';
import { connectionRoute } from './connection-route';

const now = 100000;
afterEach(() => {
  cleanup();
  delete window.modelLoomNetwork;
});
it.each(['direct', 'relayed'] as const)(
  'uses a fresh observed %s route matching the worker',
  (path) => {
    expect(
      connectionRoute(
        'http://100.64.1.2:49301',
        [{ address: '100.64.1.2', path, observedAt: now - 1 }],
        now,
      ),
    ).toEqual({ network: 'Tailscale', path: path === 'direct' ? 'Direct' : 'Relayed' });
  },
);
it('identifies Tailscale without inventing a route from stale or missing observations', () => {
  expect(
    connectionRoute(
      '100.64.1.2',
      [{ address: '100.64.1.2', path: 'direct', observedAt: now - 15001 }],
      now,
    ),
  ).toEqual({ network: 'Tailscale', path: 'Unknown' });
  expect(connectionRoute('100.64.1.2', [{ address: '100.64.1.2', path: 'unknown' }], now)).toEqual({
    network: 'Tailscale',
    path: 'Unknown',
  });
});
it('identifies manual LAN addresses but does not assume CGNAT is LAN', () => {
  expect(connectionRoute('192.168.1.2:49301', [], now)).toEqual({ network: 'LAN' });
  expect(connectionRoute('100.64.1.2', [], now)).toEqual({ network: 'Unknown' });
  expect(connectionRoute('not-an-address', [], now)).toEqual({ network: 'Unknown' });
});
it('fails unknown when the bridge is unavailable and rejects future route observations', () => {
  expect(connectionRoute('192.168.1.2', undefined, now)).toEqual({ network: 'Unknown' });
  expect(
    connectionRoute(
      '100.64.1.2',
      [{ address: '100.64.1.2', path: 'direct', observedAt: now + 1 }],
      now,
    ),
  ).toEqual({ network: 'Tailscale', path: 'Unknown' });
});

it('subscribes to observed routes, fails unknown on bridge errors and cleans up', async () => {
  let notify = () => {};
  const unsubscribe = vi.fn();
  const command = vi.fn<NetworkBridge['command']>().mockResolvedValue({
    ok: true,
    view: {
      state: 'connected',
      addresses: [],
      candidates: [],
      paths: [{ address: '100.64.1.2', path: 'direct', observedAt: Date.now() }],
    },
  });
  window.modelLoomNetwork = {
    command,
    subscribe: (listener) => {
      notify = listener;
      return unsubscribe;
    },
  };
  const from: DemoDevice = {
    id: 'local',
    name: 'Local',
    role: 'Coordinator',
    os: 'Windows',
    address: 'This device',
    hardware: [],
  };
  const to: DemoDevice = {
    ...from,
    id: 'peer',
    name: 'Remote',
    role: 'Worker',
    address: '100.64.1.2',
  };
  const { unmount } = render(createElement(ConnectionDetails, { from, to }));
  expect(await screen.findByText('Direct')).toBeTruthy();
  expect(screen.getByText('Tailscale')).toBeTruthy();
  expect(screen.queryByText('100.64.1.2')).toBeNull();
  command.mockRejectedValue(Error('private detail'));
  await act(() => {
    notify();
    return Promise.resolve();
  });
  await waitFor(() => expect(screen.queryByText('Tailscale')).toBeNull());
  expect(screen.getByText('Unknown')).toBeTruthy();
  expect(screen.queryByText('private detail')).toBeNull();
  unmount();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});
