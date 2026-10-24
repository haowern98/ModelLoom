import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deadline, cleanupAll } from './diagnostic-lifecycle.mjs';

test('a stalled cleanup cannot prevent independent restoration or hide a failure', async () => {
  const visited = [];
  await assert.rejects(
    cleanupAll(
      [
        { name: 'worker', run: () => new Promise(() => {}) },
        {
          name: 'mining',
          run: () => {
            visited.push('mining');
            return Promise.resolve();
          },
        },
        {
          name: 'firewall',
          run: () => {
            visited.push('firewall');
            return Promise.reject(new Error('failed'));
          },
        },
      ],
      30,
    ),
    (error) => {
      assert(error instanceof AggregateError);
      assert.equal(error.errors.length, 2);
      return true;
    },
  );
  assert.deepEqual(visited, ['mining', 'firewall']);
});

test('a total deadline expires even when the operation never settles', async () => {
  await assert.rejects(deadline(new Promise(() => {}), 20, 'TEST_TIMEOUT'), /TEST_TIMEOUT/u);
  assert.equal(await deadline(Promise.resolve('confirmed'), 20, 'UNEXPECTED'), 'confirmed');
});
