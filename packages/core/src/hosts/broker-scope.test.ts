import { expect, it } from 'vitest';
import { selectionFrom, decodeReply } from './broker-protocol.js';
it('accepts only the main-approved model and deployment in a live utility scope', () => {
  const scope = { deploymentId: 'desktop-development', packageId: 'runtime', modelId: 'model' };
  const selection = { ...scope, sessionId: 'session', operationId: 'operation' };
  expect(Reflect.apply(selectionFrom, undefined, [selection, scope])).toEqual(selection);
  expect(() =>
    Reflect.apply(selectionFrom, undefined, [{ ...selection, modelId: 'different' }, scope]),
  ).toThrow('INVALID_CONTROL');
  const reply = {
    id: 1,
    snapshot: {
      deploymentId: scope.deploymentId,
      phase: 'stopped',
      selection: null,
      fault: null,
      requests: {},
    },
  };
  expect(Reflect.apply(decodeReply, undefined, [reply, scope])).toEqual(reply);
});
