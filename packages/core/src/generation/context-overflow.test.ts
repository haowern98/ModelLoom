import { expect, it } from 'vitest';
import { fitContext } from './context-overflow.js';
import type { ChatMessage } from './service.js';
import { MAX_CONTROL_BYTES } from '../runtime/contracts.js';

const history: readonly ChatMessage[] = [
  { role: 'system', content: 'Rules' },
  { role: 'user', content: 'First question' },
  { role: 'assistant', content: 'First answer' },
  { role: 'user', content: 'Middle question' },
  { role: 'assistant', content: 'Middle answer' },
  { role: 'user', content: 'Recent question' },
  { role: 'assistant', content: 'Recent answer' },
  { role: 'user', content: 'Latest question' },
];
const signal = () => new AbortController().signal;
const count = (messages: readonly ChatMessage[]) => Promise.resolve(messages.length * 10);

it('fits long retained histories before sending a bounded native counting request', async () => {
  const longHistory = history.map((message, index) =>
    index === 3 ? { ...message, content: 'x'.repeat(MAX_CONTROL_BYTES) } : message,
  );
  const boundedCount = (messages: readonly ChatMessage[]) => {
    if (Buffer.byteLength(JSON.stringify(messages)) > MAX_CONTROL_BYTES)
      throw Error('TRANSPORT_FRAME_FULL');
    return count(messages);
  };
  await expect(
    fitContext(longHistory, 'truncate-middle', 61, 1, boundedCount, signal()),
  ).resolves.toEqual([...longHistory.slice(0, 3), ...longHistory.slice(5)]);
});

it('rejects full contexts in stop mode and leaves fitting input unchanged', async () => {
  await expect(fitContext(history, 'stop', 70, 1, count, signal())).rejects.toThrow('CONTEXT_FULL');
  expect(await fitContext(history, 'stop', 81, 1, count, signal())).toBe(history);
  await expect(fitContext(history, 'stop', 81, 2, count, signal())).rejects.toThrow('CONTEXT_FULL');
});

it('rolling removes oldest complete turns and keeps the system and newest question', async () => {
  const result = await fitContext(history, 'rolling', 61, 1, count, signal());
  expect(result).toEqual([history[0], ...history.slice(3)]);
  expect(history).toHaveLength(8);
});

it('truncate-middle preserves the first turn and removes middle turns first', async () => {
  const result = await fitContext(history, 'truncate-middle', 61, 1, count, signal());
  expect(result).toEqual([...history.slice(0, 3), ...history.slice(5)]);
  expect(history).toHaveLength(8);
});

it.each(['rolling', 'truncate-middle'] as const)(
  '%s never drops protected instructions or the latest user input to force a fit',
  async (policy) => {
    await expect(fitContext(history, policy, 11, 1, count, signal())).rejects.toThrow(
      'CONTEXT_FULL',
    );
  },
);

it('propagates cancellation and rejects invalid token counts', async () => {
  const abort = new AbortController();
  abort.abort();
  await expect(fitContext(history, 'rolling', 61, 1, count, abort.signal)).rejects.toThrow(
    'NOT_READY',
  );
  await expect(
    fitContext(history, 'rolling', 61, 1, () => Promise.resolve(NaN), signal()),
  ).rejects.toThrow('TOKEN_COUNT_FAILED');
});
