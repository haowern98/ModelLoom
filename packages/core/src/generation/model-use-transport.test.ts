import { expect, it, vi } from 'vitest';
import { trackModelUse } from './model-use-transport.js';
import type { ChatTransport } from './service.js';

const chat = {
  deploymentId: 'desktop',
  sessionId: 'session',
  operationId: 'load',
  callerId: 'window',
  conversationId: 'chat',
  requestId: 'request',
  attemptId: 'attempt',
};
const api = {
  kind: 'api' as const,
  deploymentId: 'desktop',
  sessionId: 'session',
  operationId: 'load',
  callerId: 'http',
  requestId: 'request',
};
const outcome = { status: 'completed' as const, reason: 'STOP' as const };

it.each([chat, api])(
  'records only native dispatch for Chat and API and joins persistence before settlement',
  async (identity) => {
    let saved!: () => void;
    const record = vi.fn<(time: number) => Promise<void>>(
      () =>
        new Promise<void>((resolve) => {
          saved = resolve;
        }),
    );
    const cancel = vi.fn();
    const original: ChatTransport = {
      tokenCount: vi.fn(() => Promise.resolve(3)),
      start: vi.fn(() => ({ settled: Promise.resolve(outcome), cancel })),
    };
    const transport = trackModelUse(original, record);
    const signal = new AbortController().signal;
    await transport.tokenCount([], signal);
    expect(record).not.toHaveBeenCalled();
    const before = Date.now();
    const execution = transport.start(identity, [], () => {});
    await Promise.resolve();
    expect(record).toHaveBeenCalledOnce();
    expect(record.mock.calls[0]?.[0]).toBeGreaterThanOrEqual(before);
    await execution.cancel();
    expect(cancel).toHaveBeenCalledOnce();
    let settled = false;
    void execution.settled.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    saved();
    expect(await execution.settled).toEqual(outcome);
  },
);

it('does not record synchronous start rejection and preserves native errors', async () => {
  const record = vi.fn<(time: number) => Promise<void>>(() => Promise.resolve());
  const original: ChatTransport = {
    tokenCount: () => Promise.resolve(1),
    start: () => {
      throw new Error('START_FAILED');
    },
  };
  expect(() => trackModelUse(original, record).start(chat, [], () => {})).toThrow('START_FAILED');
  expect(record).not.toHaveBeenCalled();
  const failed = trackModelUse(
    {
      ...original,
      start: () => ({ settled: Promise.reject(new Error('CLEANUP_FAILED')), cancel() {} }),
    },
    record,
  );
  await expect(failed.start(api, [], () => {}).settled).rejects.toThrow('CLEANUP_FAILED');
  expect(record).toHaveBeenCalledOnce();
});

it('preserves cancelled requests and inference outcomes when usage storage fails', async () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const cancelled = { status: 'cancelled' as const, reason: 'USER_CANCELLED' as const };
    const original: ChatTransport = {
      tokenCount: () => Promise.resolve(1),
      start: () => ({ settled: Promise.resolve(cancelled), cancel() {} }),
    };
    const transport = trackModelUse(original, () =>
      Promise.reject(new Error('private database path')),
    );
    expect(await transport.start(chat, [], () => {}).settled).toEqual(cancelled);
    expect(logged).toHaveBeenCalledWith('Model last-use time could not be saved.');
  } finally {
    logged.mockRestore();
  }
});
