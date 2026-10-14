import { expect, it } from 'vitest';
import { parseGenerationStream } from './stream.js';
import type { GenerationChunk } from './contracts.js';
async function collect(usage: unknown) {
  const envelope = { id: 'fixture', model: 'private', object: 'chat.completion.chunk', created: 1 };
  const text =
    `data: ${JSON.stringify({ ...envelope, choices: [{ index: 0, delta: {}, finish_reason: 'length' }] })}\n\n` +
    `data: ${JSON.stringify({ ...envelope, choices: [], usage })}\n\ndata: [DONE]\n\n`;
  async function* source() {
    yield await Promise.resolve(Buffer.from(text));
  }
  const chunks: GenerationChunk[] = [];
  for await (const chunk of parseGenerationStream(source(), new AbortController().signal))
    chunks.push(chunk);
  return chunks;
}
it('projects actual usage including reasoning tokens without inventing visible answer tokens', async () => {
  expect(
    await collect({
      prompt_tokens: 10,
      completion_tokens: 32,
      total_tokens: 42,
      completion_tokens_details: { reasoning_tokens: 32 },
      prompt_tokens_details: { cached_tokens: 5 },
    }),
  ).toEqual([
    {
      type: 'terminal',
      outcome: { status: 'limit-reached', reason: 'OUTPUT_LIMIT' },
      usage: {
        prompt_tokens: 10,
        completion_tokens: 32,
        total_tokens: 42,
        completion_tokens_details: { reasoning_tokens: 32 },
      },
    },
  ]);
});
it.each([
  { prompt_tokens: 10, completion_tokens: 2, total_tokens: 13 },
  { prompt_tokens: -1, completion_tokens: 2, total_tokens: 1 },
  {
    prompt_tokens: 10,
    completion_tokens: 2,
    total_tokens: 12,
    completion_tokens_details: { reasoning_tokens: 3 },
  },
])('rejects malformed accounting rather than presenting false usage: %j', async (usage) => {
  await expect(collect(usage)).rejects.toThrow('INVALID_STREAM');
});
