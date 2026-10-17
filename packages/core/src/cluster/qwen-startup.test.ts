import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { resolveClusterLoad } from './effective-load.js';
import { verifyStockPlacement } from './stock-placement.js';
import { record } from '../model-configuration/test-fixtures.js';

it('verifies actual pinned Qwen startup observations, including its mixed q3_K embedding tensor', () => {
  const first = 'GPU-22c23971-dacf-2123-2169-ad70d8f6729a';
  const second = 'GPU-13888736-7373-258e-4c34-7c64696954cd';
  const load = resolveClusterLoad(
    {
      id: '12345678-1234-4234-8234-123456789abc',
      name: 'Qwen',
      revision: 1,
      modelId: '40fac4050e940397dbf13087afd50f4734a11805bf9d65ef8ddd7483470e6199',
      profileId: 'b11306-four-slot',
      blockCount: 65,
      load: {
        defaults: {
          ...record().load,
          contextLength: 4096,
          concurrency: 2,
          threads: 8,
          evaluationBatch: 512,
          physicalBatch: 128,
        },
        cacheK: 'q8_0',
        cacheV: 'q8_0',
      },
      runs: [
        { uuid: first, first: 0, last: 48 },
        { uuid: second, first: 49, last: 64 },
      ],
    },
    'b11306-cuda12.4-msvc14.44-dev1',
  );
  const log = readFileSync(new URL('./fixtures/qwen35-stock-startup.log', import.meta.url), 'utf8');
  const physical = [
    { uuid: first, pciBus: '0000:04:00.0' },
    { uuid: second, pciBus: '0000:01:00.0' },
  ];
  const caches = Array.from({ length: 65 }, (_, i) =>
    i === 64 ? ('none' as const) : ('auto' as const),
  );
  expect(verifyStockPlacement(log, load, physical, caches).blocks).toHaveLength(65);
  expect(() =>
    verifyStockPlacement(log.replace('(and 0 others)', '(and 1 others)'), load, physical, caches),
  ).toThrow('PLACEMENT_MISMATCH');
});
