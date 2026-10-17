import { expect, it, vi } from 'vitest';
import { runUtility } from './utility.js';

it('retains a captured engine until its owned exit after readiness verification fails', async () => {
  let receive!: (text: unknown) => void;
  const messages: Record<string, unknown>[] = [];
  const selection = {
    deploymentId: 'test',
    packageId: 'test',
    modelId: 'test',
    sessionId: 's',
    operationId: 'o',
  };
  runUtility({
    receive(handler) {
      receive = handler;
    },
    exit: vi.fn(),
    send(text) {
      const message = JSON.parse(text) as Record<string, unknown>;
      messages.push(message);
      if (message.type === 'broker' && message.action === 'launch')
        queueMicrotask(() => {
          receive(JSON.stringify({ type: 'engine', phase: 'captured', selection, code: 0 }));
          receive(JSON.stringify({ type: 'engine', phase: 'failed', selection, code: 0 }));
        });
      if (message.type === 'broker' && message.action === 'stop')
        queueMicrotask(() => {
          receive(JSON.stringify({ type: 'engine', phase: 'exited', selection, code: 0 }));
        });
    },
  });
  receive(
    JSON.stringify({ type: 'admitted', deploymentId: 'test', packageId: 'test', modelId: 'test' }),
  );
  receive(
    JSON.stringify({ type: 'command', text: JSON.stringify({ id: 1, action: 'load', selection }) }),
  );
  await vi.waitFor(() =>
    expect(messages.some((m) => m.type === 'broker' && m.action === 'stop')).toBe(true),
  );
  receive(JSON.stringify({ type: 'command', text: JSON.stringify({ id: 2, action: 'stop' }) }));
  await vi.waitFor(() => {
    const reply = messages.find((m) => m.type === 'reply' && (m.reply as { id: number }).id === 2);
    expect(reply).toMatchObject({
      reply: { snapshot: { phase: 'stopped', fault: { code: 'START_FAILED' } } },
    });
  });
});
