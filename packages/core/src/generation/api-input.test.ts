import { expect, it } from 'vitest';
import { decodeApiMessages } from './api-execution.js';
import { ApiCallerScope, requireApiCaller } from './api-authority.js';
import type { ApiCaller } from './api-authority.js';
it('preserves explicit system messages and role order without merging or truncating', () => {
  const messages = [
    { role: 'system', content: 'System' },
    { role: 'assistant', content: '' },
    { role: 'user', content: ' Question ' },
  ];
  const decoded = decodeApiMessages(messages);
  expect(decoded).toEqual(messages);
  expect(Object.isFrozen(decoded[0])).toBe(true);
});
it.each(
  [
    [],
    [{ role: 'developer', content: 'unsupported' }],
    [{ role: 'assistant', content: 'unfinished' }],
    [{ role: 'user', content: ' ' }],
    [{ role: 'user', content: 'Question', reasoning_content: 'forged' }],
    [{ role: 'user', content: [{ type: 'image_url', url: 'private' }] }],
    [
      { role: 'user', content: 'First' },
      { role: 'system', content: 'Late' },
      { role: 'user', content: 'Last' },
    ],
    [{ role: 'user', content: '\ud800' }],
    [{ role: 'user', content: 'x'.repeat(12001) }],
    Array.from({ length: 257 }, () => ({ role: 'user', content: 'x' })),
  ].map((input) => ({ input })),
)('rejects unsupported stateless input %#', ({ input }) => {
  expect(() => decodeApiMessages(input)).toThrow('INVALID_CONTROL');
});
it('rejects serialized authority and revokes every caller issued by a closed scope', () => {
  const scope = new ApiCallerScope(),
    caller = scope.issue();
  expect(requireApiCaller(caller)).toMatch(/^api-/u);
  expect(() => requireApiCaller(JSON.parse(JSON.stringify(caller)) as ApiCaller)).toThrow('DENIED');
  scope.close();
  expect(() => requireApiCaller(caller)).toThrow('DENIED');
  expect(() => scope.issue()).toThrow('DENIED');
});
