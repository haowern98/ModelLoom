import { expect, it } from 'vitest';
import { GenerationAdmission } from './admission.js';
import { decodeExecutionIdentity } from './contracts.js';
import type { ExecutionIdentity, TerminalOutcome } from './contracts.js';
it('shares four slots between stateless API and Chat without fabricated history IDs', async () => {
  const session = { deploymentId: 'desktop', sessionId: 'session', operationId: 'load' };
  const started: ExecutionIdentity[] = [];
  const work: ((outcome: TerminalOutcome) => void)[] = [];
  const admission = new GenerationAdmission<ExecutionIdentity>(session, {
    start(identity) {
      started.push(identity);
      let finish!: (outcome: TerminalOutcome) => void;
      const settled = new Promise<TerminalOutcome>((resolve) => {
        finish = resolve;
      });
      work.push(finish);
      return { settled, cancel: () => finish({ status: 'cancelled', reason: 'USER_CANCELLED' }) };
    },
  });
  const receipts = [];
  for (let index = 0; index < 12; index++)
    receipts.push(
      admission.submit(
        index % 2 === 0
          ? { ...session, kind: 'api', callerId: 'api', requestId: `request-${index}` }
          : {
              ...session,
              callerId: 'window',
              requestId: `request-${index}`,
              conversationId: `chat-${index}`,
              attemptId: `attempt-${index}`,
            },
      ),
    );
  expect(receipts.every((value) => value.accepted)).toBe(true);
  expect(started).toHaveLength(4);
  expect(started[0]).not.toHaveProperty('conversationId');
  expect(started[0]).not.toHaveProperty('attemptId');
  expect(
    admission.submit({ ...session, kind: 'api', callerId: 'api', requestId: 'overflow' }),
  ).toEqual({ accepted: false, code: 'QUEUE_FULL' });
  expect(() =>
    decodeExecutionIdentity({
      ...session,
      kind: 'api',
      callerId: 'api',
      requestId: 'forged',
      conversationId: 'chat',
    }),
  ).toThrow('INVALID_CONTROL');
  expect(admission.cancel('api', 'request-1')).toBe('denied');
  admission.close('SESSION_STOPPED');
  await Promise.all(receipts.flatMap((value) => (value.accepted ? [value.done] : [])));
});
