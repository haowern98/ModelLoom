export {
  decodeChatCommand,
  decodeChatReply,
} from '../../../../packages/core/src/generation/chat-wire';
export type {
  ChatBridge,
  ChatCommand,
  ChatReply,
} from '../../../../packages/core/src/generation/chat-wire';
import type { ChatBridge } from '../../../../packages/core/src/generation/chat-wire';
declare global {
  interface Window {
    modelLoomChat?: ChatBridge;
  }
}
