import { expect, it, vi } from 'vitest';
import { createRuntimeLogsHandler } from './runtime-logs';

it('binds log reads and clears to the current main frame without API or model ownership', async () => {
  const sender = {},
    frame = {};
  const read = vi.fn(() => ({ ok: true as const, revision: 1, entries: [] }));
  const clear = vi.fn();
  const handler = createRuntimeLogsHandler({
    sender,
    frame: () => frame,
    closing: () => false,
    log: () => ({ read, clear }),
  });
  await expect(handler({ sender: {}, senderFrame: frame }, { action: 'clear' })).rejects.toThrow(
    'INVALID_CONTROL',
  );
  await expect(handler({ sender, senderFrame: {} }, { action: 'read' })).rejects.toThrow(
    'INVALID_CONTROL',
  );
  expect(clear).not.toHaveBeenCalled();
  await expect(handler({ sender, senderFrame: frame }, { action: 'read' })).resolves.toMatchObject({
    ok: true,
    entries: [],
  });
  await handler({ sender, senderFrame: frame }, { action: 'clear' });
  expect(clear).toHaveBeenCalledOnce();
});
it('rechecks frame ownership before delivering the bounded log snapshot', async () => {
  const sender = {},
    original = {};
  let frame = original;
  const handler = createRuntimeLogsHandler({
    sender,
    frame: () => frame,
    closing: () => false,
    log: () => ({ read: () => ({ ok: true, revision: 0, entries: [] }), clear: () => undefined }),
  });
  const pending = handler({ sender, senderFrame: original }, { action: 'read' });
  frame = {};
  await expect(pending).rejects.toThrow('INVALID_CONTROL');
});
