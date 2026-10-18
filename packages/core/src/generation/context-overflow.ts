import type { AdvancedPreferences } from '../model-configuration/contracts.js';
import type { ChatMessage } from './service.js';
import { MAX_CONTROL_BYTES } from '../runtime/contracts.js';
import { GENERATION_LIMITS } from './contracts.js';

/** Fit a captured request, never its retained history. Count the selected native template exactly.
 * Truncation removes complete user/assistant turns; instructions and the newest input stay intact.
 */
export async function fitContext(
  messages: readonly ChatMessage[],
  policy: AdvancedPreferences['overflow'],
  capacity: number,
  reserve: number,
  count: (messages: readonly ChatMessage[]) => Promise<number>,
  signal: AbortSignal,
): Promise<readonly ChatMessage[]> {
  const fits = async (candidate: readonly ChatMessage[]) => {
    if (signal.aborted) throw Error('NOT_READY');
    // Leave room for the closed identity/settings envelope, including escaped system text.
    if (
      Buffer.byteLength(JSON.stringify(candidate)) >
      MAX_CONTROL_BYTES - 2 * GENERATION_LIMITS.maxEventBytes
    )
      return false;
    const tokens = await count(candidate);
    if (signal.aborted) throw Error('NOT_READY');
    if (!Number.isSafeInteger(tokens) || tokens < 0) throw Error('TOKEN_COUNT_FAILED');
    return tokens + reserve <= capacity;
  };
  if (await fits(messages)) return messages;
  if (policy === 'stop') throw Error('CONTEXT_FULL');
  const prefix = messages[0]?.role === 'system' ? [messages[0]] : [];
  const turns: ChatMessage[][] = [];
  for (const message of messages.slice(prefix.length)) {
    if (message.role === 'user' || !turns.length) turns.push([]);
    turns.at(-1)!.push(message);
  }
  const firstUser = turns.findIndex((turn) => turn[0]?.role === 'user');
  const keep = policy === 'truncate-middle' ? firstUser + 1 : 0;
  const removable = turns.length - keep - 1;
  if (removable < 1) throw Error('CONTEXT_FULL');
  const candidate = (removed: number) =>
    Object.freeze([
      ...prefix,
      ...turns.slice(0, keep).flat(),
      ...turns.slice(keep + removed).flat(),
    ]);
  let result = candidate(removable);
  if (!(await fits(result))) throw Error('CONTEXT_FULL');
  // Search the retained suffix instead of making one native count call per historical turn.
  let low = 1;
  let high = removable;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const proposed = candidate(middle);
    if (await fits(proposed)) {
      high = middle;
      result = proposed;
    } else low = middle + 1;
  }
  return result;
}
