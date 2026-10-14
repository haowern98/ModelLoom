import { decodeApiManagementCommand, decodeApiManagementReply } from '../shared/local-api';
import type { ApiManagementCommand, ApiManagementReply } from '../shared/local-api';
interface Sender {
  readonly sender: object;
  readonly senderFrame: object | null;
}
interface Dependencies {
  readonly sender: object;
  readonly frame: () => object | null;
  readonly closing: () => boolean;
  readonly command: (input: ApiManagementCommand) => Promise<ApiManagementReply>;
  readonly copy: (secret: string) => Promise<void>;
}
/** Exact-window/main-frame management, rechecked after awaits before transient key delivery. */
export function createApiManagementHandler(deps: Dependencies) {
  const requireSender = (event: Sender) => {
    if (
      deps.closing() ||
      event.sender !== deps.sender ||
      event.senderFrame === null ||
      event.senderFrame !== deps.frame()
    )
      throw new Error('INVALID_CONTROL');
  };
  return async (event: Sender, input: unknown): Promise<ApiManagementReply> => {
    requireSender(event);
    const command = decodeApiManagementCommand(input);
    const reply = decodeApiManagementReply(
      await deps.command(command),
      command.action === 'copyKey' || command.action === 'revealKey',
    );
    requireSender(event);
    if (
      reply.ok &&
      (command.action === 'copyKey' || command.action === 'revealKey') &&
      !reply.secret
    )
      return { ok: false, error: 'CREDENTIAL_UNAVAILABLE' };
    if (command.action === 'copyKey' && reply.ok) {
      try {
        await deps.copy(reply.secret!);
      } catch {
        return { ok: false, error: 'API_UNAVAILABLE' };
      }
      return decodeApiManagementReply({ ok: true, status: reply.status });
    }
    return reply;
  };
}
