import { expect, it } from 'vitest';
import { fixtureSession } from './session.js';
it('keeps a live desktop identity distinct from the fixture deployment', async () => {
  const session = Reflect.apply(fixtureSession, undefined, [
    { launch: () => Promise.reject(new Error('START_FAILED')) },
    () => {},
    undefined,
    'desktop-development',
  ]);
  const result = await session.handle(JSON.stringify({ id: 1, action: 'snapshot' }));
  expect(result.reply.snapshot?.deploymentId).toBe('desktop-development');
  const fixtureSelection = {
    deploymentId: 'fixture-host',
    sessionId: 'session',
    operationId: 'operation',
    modelId: 'model',
    packageId: 'package',
  };
  expect(
    (await session.handle(JSON.stringify({ id: 2, action: 'load', selection: fixtureSelection })))
      .reply.error,
  ).toBe('INVALID_TRANSITION');
});
