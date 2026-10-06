import type { EngineAdapter } from '../runtime/engine-adapter.js';
import { LIFECYCLE_POLICY } from '../runtime/contracts.js';
import type { Snapshot } from '../runtime/contracts.js';
import { RuntimeSupervisor } from '../runtime/supervisor.js';
import { decodeCommand, decodeObject } from './control.js';

export interface HostReply {
  readonly id: number;
  readonly snapshot?: Snapshot;
  readonly error?: string;
}
/** Shared fixture host policy; monotonic request IDs reject replay without an unbounded seen-ID set. */
export function fixtureSession(
  adapter: EngineAdapter,
  crash: () => void,
  crashCore: () => void = () => {
    throw new Error('INVALID_CONTROL');
  },
) {
  const core = new RuntimeSupervisor('fixture-host', adapter, LIFECYCLE_POLICY);
  let lastId = 0;
  let quitting = false;
  return {
    core,
    async handle(text: string): Promise<{ reply: HostReply; quit: boolean }> {
      let id = 0;
      try {
        const envelope = decodeObject(text);
        if (typeof envelope.id === 'number' && Number.isSafeInteger(envelope.id) && envelope.id > 0)
          id = envelope.id;
        const command = decodeCommand(text);
        if (quitting || command.id <= lastId) throw new Error('INVALID_CONTROL');
        lastId = command.id;
        let snapshot: Snapshot;
        switch (command.action) {
          case 'load':
            snapshot = await core.load(command.selection);
            break;
          case 'stop':
            snapshot = await core.stop();
            break;
          case 'quit':
            quitting = true;
            snapshot = await core.stop();
            break;
          case 'record':
            core.record(command.event);
            snapshot = core.snapshot();
            break;
          case 'crash':
            crash();
            snapshot = core.snapshot();
            break;
          case 'crash-core':
            crashCore();
            throw new Error('CORE_EXITED');
          case 'snapshot':
            snapshot = core.snapshot();
            break;
        }
        return { reply: { id, snapshot }, quit: command.action === 'quit' };
      } catch (error: unknown) {
        const safe =
          error instanceof Error &&
          ['BUSY', 'NOT_READY', 'INVALID_TRANSITION'].includes(error.message)
            ? error.message
            : 'INVALID_CONTROL';
        return { reply: { id, error: safe }, quit: false };
      }
    },
  };
}
