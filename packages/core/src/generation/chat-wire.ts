/** Closed data contract shared with the sandbox; no Node/native capability. */
export type ChatCommand =
  | { action: 'newConversation' }
  | { action: 'list'; cursor?: string }
  | { action: 'search'; query: string; cursor?: string }
  | { action: 'read'; conversationId: string; cursor?: string }
  | { action: 'deleteConversation'; conversationId: string }
  | { action: 'cancelConversation'; conversationId: string }
  | { action: 'saveDraft' | 'send'; conversationId: string; text: string }
  | { action: 'cancel'; requestId: string }
  | { action: 'retry'; attemptId: string };
export interface ChatPageData {
  readonly payload: string;
  readonly next: string | null;
  readonly revision: number;
}
export interface ChatReply {
  readonly ok: boolean;
  readonly error?: string;
  readonly page?: ChatPageData;
  readonly conversationId?: string;
  readonly requestId?: string;
}
export interface ChatBridge {
  command(command: ChatCommand): Promise<ChatReply>;
  subscribe(listener: () => void): () => void;
}
/** Closed result projection is checked before main forwards it to the sandbox. */
export function decodeChatReply(input: unknown): ChatReply {
  const invalid = () => {
    throw new Error('INVALID_CONTROL');
  };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid();
  const value: Record<string, unknown> = Object.fromEntries(Object.entries(input));
  const keys = Object.keys(value).sort().join(',');
  if (new TextEncoder().encode(JSON.stringify(value)).length > 65536) return invalid();
  if (value.ok === false) {
    if (
      keys !== 'error,ok' ||
      typeof value.error !== 'string' ||
      ![
        'STALE_VIEW',
        'NOT_READY',
        'DENIED',
        'QUEUE_FULL',
        'CONVERSATION_BUSY',
        'CONTEXT_FULL',
        'INVALID_CONTROL',
        'HISTORY_FULL',
        'HISTORY_UNAVAILABLE',
        'NEEDS_RESOURCE_EVIDENCE',
        'TOKEN_COUNT_FAILED',
      ].includes(value.error)
    )
      return invalid();
    return { ok: false, error: value.error };
  }
  if (value.ok !== true) return invalid();
  if (keys === 'ok') return { ok: true };
  const identifier = (id: unknown): string => {
    if (
      typeof id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,128}$/u.test(id) ||
      ['constructor', 'prototype', '__proto__'].includes(id)
    )
      return invalid();
    return id;
  };
  if (keys === 'conversationId,ok' || keys === 'conversationId,ok,requestId')
    return {
      ok: true,
      conversationId: identifier(value.conversationId),
      ...(value.requestId === undefined ? {} : { requestId: identifier(value.requestId) }),
    };
  if (
    keys !== 'ok,page' ||
    !value.page ||
    typeof value.page !== 'object' ||
    Array.isArray(value.page)
  )
    return invalid();
  const page: Record<string, unknown> = Object.fromEntries(Object.entries(value.page));
  if (
    Object.keys(page).sort().join(',') !== 'next,payload,revision' ||
    typeof page.payload !== 'string' ||
    typeof page.revision !== 'number' ||
    !Number.isSafeInteger(page.revision) ||
    page.revision < 0
  )
    return invalid();
  return {
    ok: true,
    page: {
      payload: page.payload,
      next: page.next === null ? null : identifier(page.next),
      revision: page.revision,
    },
  };
}
/** Exact keys and Unicode/byte limits are enforced again at privileged entry. */
export function decodeChatCommand(input: unknown): ChatCommand {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('INVALID_CONTROL');
  const value: Record<string, unknown> = Object.fromEntries(Object.entries(input));
  const action = value.action;
  let keys: string[];
  if (action === 'newConversation') keys = ['action'];
  else if (action === 'list') keys = ['action', ...(value.cursor === undefined ? [] : ['cursor'])];
  else if (action === 'search')
    keys = ['action', 'query', ...(value.cursor === undefined ? [] : ['cursor'])];
  else if (action === 'read')
    keys = ['action', 'conversationId', ...(value.cursor === undefined ? [] : ['cursor'])];
  else if (action === 'deleteConversation' || action === 'cancelConversation')
    keys = ['action', 'conversationId'];
  else if (action === 'saveDraft' || action === 'send') keys = ['action', 'conversationId', 'text'];
  else if (action === 'cancel') keys = ['action', 'requestId'];
  else if (action === 'retry') keys = ['action', 'attemptId'];
  else throw new Error('INVALID_CONTROL');
  if (Object.keys(value).length !== keys.length || !keys.every((key) => Object.hasOwn(value, key)))
    throw new Error('INVALID_CONTROL');
  for (const key of keys.filter((key) => !['action', 'text', 'query'].includes(key))) {
    if (typeof value[key] !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/u.test(value[key]))
      throw new Error('INVALID_CONTROL');
  }
  if (
    'query' in value &&
    (typeof value.query !== 'string' ||
      value.query.length > 12000 ||
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value.query))
  )
    throw new Error('INVALID_CONTROL');
  if (
    'text' in value &&
    (typeof value.text !== 'string' ||
      value.text.length > 12000 ||
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value.text) ||
      (action === 'send' && !value.text.trim()))
  )
    throw new Error('INVALID_CONTROL');
  if (new TextEncoder().encode(JSON.stringify(value)).length > 1048576)
    throw new Error('INVALID_CONTROL');
  return value as ChatCommand;
}
