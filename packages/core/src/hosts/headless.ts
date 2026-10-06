import { createFixtureDeployment } from './fixture-engine.js';
import type { FixtureMode } from './fixture-engine.js';
import { fixtureSession } from './session.js';
import { commandLines, writeReply } from './pipes.js';

// Dedicated development entry; no model/runtime path or public control listener is accepted.
const mode = process.argv[2] ?? 'ready';
if (!['ready', 'hang', 'loading', 'descendant'].includes(mode)) throw new Error('INVALID_CONTROL');
const deployment = createFixtureDeployment();
const session = fixtureSession(deployment.adapter(mode as FixtureMode), () => deployment.crash());
let finishing: Promise<void> | undefined;
function finish(): Promise<void> {
  finishing ??= session.core.stop().then(() => deployment.close());
  return finishing;
}
function end(): void {
  void finish().then(
    () => process.exit(0),
    () => process.exit(1),
  );
}
commandLines(
  process.stdin,
  (text) => {
    void session
      .handle(text)
      .then(async ({ reply, quit }) => {
        if (quit) await finish();
        await writeReply(process.stdout, { ...reply, pids: deployment.children() });
        if (quit) process.exit(reply.snapshot?.phase === 'stopped' ? 0 : 1);
      })
      .catch(end);
  },
  end,
);
process.once('SIGINT', end);
process.once('SIGTERM', end);
