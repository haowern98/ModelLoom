import { expect, it } from 'vitest';
import { parseApiJson, decodeApiCompletion } from './request.js';
import { capabilities } from '../model-configuration/test-fixtures.js';
it('rejects duplicate JSON keys including escaped spellings and excessive nesting', () => {
  for (const text of [
    '{"model":"first","model":"second"}',
    '{"model":"first","mo\\u0064el":"second"}',
    '{"messages":[{"role":"user","role":"assistant","content":"x"}]}',
    '['.repeat(17) + '0' + ']'.repeat(17),
    '{"model":NaN}',
    '{"model":"x"} trailing',
  ])
    expect(() => parseApiJson(Buffer.from(text))).toThrow();
  expect(
    parseApiJson(Buffer.from('{"model":"x","messages":[{"role":"user","content":"界"}]}')),
  ).toMatchObject({ model: 'x' });
});
it('decodes only the declared text completion fields, preserving explicit zero samplers', () => {
  expect(
    decodeApiCompletion(
      {
        model: 'model',
        messages: [
          { role: 'system', content: '' },
          { role: 'user', content: 'Hello' },
        ],
        temperature: 0,
        seed: 0,
        max_tokens: 64,
        stream: true,
        stream_options: { include_usage: true },
        response_format: { type: 'text' },
      },
      capabilities,
    ),
  ).toMatchObject({
    model: 'model',
    stream: true,
    includeUsage: true,
    input: { overrides: { temperature: 0, seed: 0, max_tokens: 64 } },
  });
});
it.each(
  [
    { n: 2 },
    { stream: 'true' },
    { max_tokens: 513 },
    { max_tokens: 0 },
    { temperature: NaN },
    { tools: [] },
    { id_slot: 0 },
    { response_format: { type: 'json_object' } },
    { stream_options: { include_usage: true } },
    { stream: true, stream_options: { include_usage: true, private: true } },
    { stop: [] },
  ].map((extra) => ({ extra })),
)('rejects unsupported fields and invalid options %#', ({ extra }) => {
  expect(() =>
    decodeApiCompletion(
      { model: 'model', messages: [{ role: 'user', content: 'Hello' }], ...extra },
      capabilities,
    ),
  ).toThrow();
});
