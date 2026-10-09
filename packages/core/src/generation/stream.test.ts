import { describe, expect, it } from 'vitest';
import { parseGenerationStream } from './stream.js';
import { GENERATION_LIMITS } from './contracts.js';
import type { GenerationChunk } from './contracts.js';

// Synthetic envelopes match the pinned server-task.cpp serializers, not captured user prompts.
function frame(delta: Record<string, unknown>, finish: unknown = null) {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-fixture',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'bonsai',
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`;
}
const done = 'data: [DONE]\n\n';
async function* bytes(chunks: readonly Uint8Array[]) {
  for (const chunk of chunks) yield await Promise.resolve(chunk);
}
async function collect(
  input: string | readonly Uint8Array[],
  signal = new AbortController().signal,
) {
  const result: GenerationChunk[] = [];
  const source = bytes(typeof input === 'string' ? [Buffer.from(input)] : input);
  for await (const event of parseGenerationStream(source, signal)) result.push(event);
  return result;
}
const terminal = { type: 'terminal', outcome: { status: 'completed', reason: 'STOP' } };

describe('pinned text-only chat stream', () => {
  it.each(['finish', 'usage'])(
    'projects measured native speeds from the final %s envelope',
    async (where) => {
      const finish = JSON.parse(frame({}, 'stop').slice(6)) as Record<string, unknown>;
      const timings = { predicted_per_second: 24.8, prompt_per_second: 1420, cache_n: 0 };
      const last =
        where === 'finish'
          ? { ...finish, timings }
          : { ...finish, choices: [], usage: { completion_tokens: 5 }, timings };
      const stream =
        frame({ reasoning_content: 'Consider' }) +
        frame({ content: 'Hello' }) +
        (where === 'usage' ? frame({}, 'stop') : '') +
        `data: ${JSON.stringify(last)}\n\n` +
        done;
      expect((await collect(stream)).at(-1)).toEqual({
        ...terminal,
        speeds: { generation: 24.8, prefill: 1420 },
      });
    },
  );
  it.each([null, [], {}, { predicted_per_second: -1, prompt_per_second: 'secret' }])(
    'keeps valid output when optional native timing data is unusable: %#',
    async (timings) => {
      const finish = JSON.parse(frame({}, 'stop').slice(6)) as Record<string, unknown>;
      expect(await collect(`data: ${JSON.stringify({ ...finish, timings })}\n\n` + done)).toEqual([
        terminal,
      ]);
    },
  );
  it('hides a zero prefill rate for a fully cached prompt without losing generation speed', async () => {
    const finish = JSON.parse(frame({}, 'stop').slice(6)) as Record<string, unknown>;
    expect(
      (
        await collect(
          `data: ${JSON.stringify({ ...finish, timings: { predicted_per_second: 18.5, prompt_per_second: 0 } })}\n\n` +
            done,
        )
      ).at(-1),
    ).toEqual({ ...terminal, speeds: { generation: 18.5, prefill: null } });
  });
  it('handles every transport split including a multibyte code point and SSE framing', async () => {
    const input = Buffer.from(
      frame({ role: 'assistant', content: '界👋' }) + frame({}, 'stop') + done,
    );
    for (let split = 0; split <= input.length; split++) {
      expect(await collect([input.subarray(0, split), input.subarray(split)])).toEqual([
        { type: 'text', text: '界👋' },
        terminal,
      ]);
    }
  });
  it('handles CRLF, keepalive comments, role-only and multiple events in one read', async () => {
    const stream =
      ':\n\n' +
      frame({ role: 'assistant' }) +
      frame({ content: 'Hello' }) +
      frame({ content: ' world' }) +
      frame({}, 'stop') +
      done;
    expect(await collect(stream.replaceAll('\n', '\r\n'))).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
      terminal,
    ]);
  });
  it('reports length termination separately from ordinary completion', async () => {
    expect(await collect(frame({ content: 'partial' }) + frame({}, 'length') + done)).toEqual([
      { type: 'text', text: 'partial' },
      { type: 'terminal', outcome: { status: 'limit-reached', reason: 'OUTPUT_LIMIT' } },
    ]);
  });
  it.each([
    frame({ content: 'partial' }),
    frame({ content: 'partial' }) + done,
    frame({}, 'stop'),
    frame({}, 'stop') + frame({}, 'stop') + done,
    frame({}, 'stop') + done + done,
    frame({}, 'stop') + done + frame({ content: 'late' }),
    'data: {bad secret}\n\n',
    'data: {"error":{"message":"secret"}}\n\n',
    frame({ content: '\ud800' }) + frame({}, 'stop') + done,
    frame({ tool_calls: [] }) + frame({}, 'stop') + done,
    frame({ reasoning_content: 7 }) + frame({}, 'stop') + done,
    frame({ reasoning_content: '\ud800' }) + frame({}, 'stop') + done,
    frame({}, 'tool_calls') + done,
    frame({ role: 'user', content: 'not assistant output' }) + frame({}, 'stop') + done,
    frame({ content: 'a' }).replace('"index":0', '"index":1') + frame({}, 'stop') + done,
    frame({ content: 'a' }) +
      frame({}, 'stop').replace('chatcmpl-fixture', 'other-response') +
      done,
  ])('rejects incomplete, malformed or unsupported stream %#', async (input) => {
    await expect(collect(input)).rejects.toThrow(/^INVALID_STREAM$/u);
  });
  it('retains previously emitted text when EOF is incomplete, without a completion event', async () => {
    const received: GenerationChunk[] = [];
    const consume = async () => {
      for await (const item of parseGenerationStream(
        bytes([Buffer.from(frame({ content: 'retained' }))]),
        new AbortController().signal,
      ))
        received.push(item);
    };
    await expect(consume()).rejects.toThrow('INVALID_STREAM');
    expect(received).toEqual([{ type: 'text', text: 'retained' }]);
  });
  it('requires the entire stream to validate before emitting completion', async () => {
    const received: GenerationChunk[] = [];
    const consume = async () => {
      for await (const item of parseGenerationStream(
        bytes([Buffer.from(frame({}, 'stop') + done + 'data: broken\n\n')]),
        new AbortController().signal,
      ))
        received.push(item);
    };
    await expect(consume()).rejects.toThrow('INVALID_STREAM');
    expect(received).toEqual([]);
  });
  it('bounds the whole event in UTF-8 bytes, accepting exactly 64 KiB', async () => {
    const room = GENERATION_LIMITS.maxEventBytes - Buffer.byteLength(frame({ content: '' }));
    expect(
      (await collect(frame({ content: 'x'.repeat(room) }) + frame({}, 'stop') + done))[0],
    ).toEqual({ type: 'text', text: 'x'.repeat(room) });
    await expect(
      collect(frame({ content: 'x'.repeat(room + 1) }) + frame({}, 'stop') + done),
    ).rejects.toThrow('INVALID_STREAM');
    await expect(collect(frame({ content: '界'.repeat(22_000) }))).rejects.toThrow(
      'INVALID_STREAM',
    );
  });
  it('bounds aggregate assistant text without silently truncating', async () => {
    const chunk = frame({ content: 'x'.repeat(16_384) });
    const atLimit = chunk.repeat(GENERATION_LIMITS.maxResponseBytes / 16_384);
    expect((await collect(atLimit + frame({}, 'stop') + done)).at(-1)).toEqual(terminal);
    await expect(
      collect(atLimit + frame({ content: 'x' }) + frame({}, 'stop') + done),
    ).rejects.toThrow('RESPONSE_TOO_LARGE');
  });
  it('preserves separate thinking and answer deltas, including a shared frame', async () => {
    expect(
      await collect(
        frame({ role: 'assistant', content: null }) +
          frame({ reasoning_content: 'Consider 界👋' }) +
          frame({ reasoning_content: ' carefully', content: 'Hello' }) +
          frame({}, 'stop') +
          done,
      ),
    ).toEqual([
      { type: 'reasoning', text: 'Consider 界👋' },
      { type: 'reasoning', text: ' carefully' },
      { type: 'text', text: 'Hello' },
      terminal,
    ]);
  });
  it('shares the response byte limit between thinking and answer', async () => {
    const thinking = frame({ reasoning_content: 'x'.repeat(16_384) });
    const atLimit = thinking.repeat(GENERATION_LIMITS.maxResponseBytes / 16_384);
    expect((await collect(atLimit + frame({}, 'length') + done)).at(-1)).toMatchObject({
      type: 'terminal',
      outcome: { status: 'limit-reached' },
    });
    await expect(
      collect(atLimit + frame({ content: 'x' }) + frame({}, 'stop') + done),
    ).rejects.toThrow('RESPONSE_TOO_LARGE');
  });
  it('rejects invalid UTF-8 rather than inventing replacement characters', async () => {
    await expect(
      collect([Buffer.from('data: '), new Uint8Array([0xff]), Buffer.from('\n\n')]),
    ).rejects.toThrow('INVALID_STREAM');
  });
  it('cancels promptly even while the next source read is unresolved', async () => {
    const controller = new AbortController();
    const source: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise<IteratorResult<Uint8Array>>(() => {}),
      }),
    };
    const parsed = parseGenerationStream(source, controller.signal)[Symbol.asyncIterator]();
    const next = parsed.next();
    controller.abort();
    await expect(next).rejects.toThrow('GENERATION_CANCELLED');
  });
  it('redacts source failures and rejects pre-aborted reads', async () => {
    async function* broken() {
      yield await Promise.reject(new Error('private engine credential'));
    }
    const consume = async () => {
      for await (const item of parseGenerationStream(broken(), new AbortController().signal))
        expect(item).toBeDefined();
    };
    await expect(consume()).rejects.toThrow(/^INVALID_STREAM$/u);
    const controller = new AbortController();
    controller.abort();
    await expect(collect(frame({}, 'stop') + done, controller.signal)).rejects.toThrow(
      'GENERATION_CANCELLED',
    );
  });
  it('redacts a source that fails while constructing its iterator', async () => {
    const source: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        throw new Error('private source setup details');
      },
    };
    const parsed = parseGenerationStream(source, new AbortController().signal)[
      Symbol.asyncIterator
    ]();
    await expect(parsed.next()).rejects.toThrow(/^INVALID_STREAM$/u);
  });
});
