import { decodeRuntimeLogCommand, decodeRuntimeLogReply } from '../shared/runtime-logs';
import type { RuntimeLogReply, RuntimeLogSnapshot } from '../shared/runtime-logs';
interface Dependencies {
  sender: object;
  frame(): object | null;
  closing(): boolean;
  log(): { read(after?: number): RuntimeLogSnapshot; clear(): void } | undefined;
}
/** Main-frame-only, bounded diagnostic snapshots. No filesystem or generic IPC authority. */
export function createRuntimeLogsHandler(deps: Dependencies) {
  return async (
    event: { sender: object; senderFrame: object | null },
    input: unknown,
  ): Promise<RuntimeLogReply> => {
    if (
      deps.closing() ||
      event.sender !== deps.sender ||
      event.senderFrame === null ||
      event.senderFrame !== deps.frame()
    )
      throw Error('INVALID_CONTROL');
    const command = decodeRuntimeLogCommand(input);
    const log = deps.log();
    if (!log) return { ok: false, error: 'NOT_READY' };
    if (command.action === 'clear') log.clear();
    const reply = await Promise.resolve(
      log.read(command.action === 'read' ? command.after : undefined),
    );
    if (deps.closing() || event.senderFrame !== deps.frame()) throw Error('INVALID_CONTROL');
    return decodeRuntimeLogReply(reply);
  };
}
