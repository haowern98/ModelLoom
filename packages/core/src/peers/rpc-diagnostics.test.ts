import { expect, it, vi } from 'vitest';
import { rpcDiagnostics } from './rpc-diagnostics.js';
import type { RuntimeDiagnostic } from '../hosts/runtime-diagnostics.js';

it('correlates stages, preserves bounded failure context and excludes arbitrary error contents', () => {
  const write = vi.fn<RuntimeDiagnostic>();
  const trace = rpcDiagnostics('gateway', write);
  trace.event('gateway-open', 'begin');
  trace.event('overlay', 'error', {
    error: Object.assign(Error('private prompt and credentials'), { code: 'ETIMEDOUT' }),
  });
  expect(write).toHaveBeenCalledWith('peer', expect.stringContaining('ETIMEDOUT'));
  expect(write.mock.calls.map((call) => call[1]).join('')).not.toContain('private prompt');
  expect(write.mock.calls.map((call) => call[1]).join('')).toContain(trace.id);
  for (let i = 0; i < 100; i++) trace.event('forwarding', 'ready');
  trace.event('forwarding', 'error', { side: 'remote', uploaded: 100, downloaded: 20 });
  const context = write.mock.calls
    .filter((call) => call[1].startsWith('rpc.failure-context '))
    .at(-1)![1];
  expect(context.length).toBeLessThan(4096);
  const history: unknown = JSON.parse(context.slice('rpc.failure-context '.length));
  expect(Array.isArray(history) && history.length <= 8).toBe(true);
  expect(() =>
    rpcDiagnostics('gateway', () => {
      throw Error('closed sink');
    }).event('gateway-open', 'begin'),
  ).not.toThrow();
});
