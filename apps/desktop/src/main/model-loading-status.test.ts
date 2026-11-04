import { expect, it } from 'vitest';
import { createModelLoadingStatus } from './model-loading-status';

it('advances on observed startup stages and resets between attempts', () => {
  const status = createModelLoadingStatus();
  status.observe('native.ready context=128');
  expect(status.stage).toBe(0);
  status.begin();
  status.observe('native.captured pid=123');
  expect(status.stage).toBe(0);
  for (const [message, stage] of [
    ['load.begin model=test.gguf context=128 slots=1 speculation=off', 1],
    ['load.memory-admitted', 2],
    ['native.launch backend=cuda devices=GPU', 3],
    ['native.captured pid=123', 4],
    ['native.ready context=128', 5],
  ] as const) {
    status.observe(message);
    expect(status.stage).toBe(stage);
  }
  status.begin();
  expect(status.stage).toBe(0);
  status.observe('load.begin model=test.gguf context=128 slots=1 speculation=off');
  status.observe('stop.requested');
  status.observe('native.ready context=128');
  expect(status.stage).toBe(1);
});
