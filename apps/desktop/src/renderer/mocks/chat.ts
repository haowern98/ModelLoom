export interface ChatMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly reasoning?: string;
  readonly thinkingMs?: number;
  readonly speeds?: { readonly generation: number | null; readonly prefill: number | null };
  readonly state?: string;
  readonly attemptId?: string;
  readonly requestId?: string;
  readonly reason?: string;
}

export interface DemoConversation {
  readonly id: string;
  readonly title: string;
  readonly group: 'Today' | 'Yesterday' | 'Older';
  readonly draft: string;
  readonly messages: readonly ChatMessage[];
}

export interface DemoChat {
  readonly selectedId: string;
  readonly conversations: readonly DemoConversation[];
}

export type ChatAction =
  | { type: 'select'; id: string }
  | { type: 'delete'; id: string }
  | { type: 'new'; id: string }
  | { type: 'draft'; text: string };

/** Preview conversations live only in renderer memory; no model or storage is contacted. */
export function createDemoChat(demo: boolean): DemoChat {
  if (!demo)
    return {
      selectedId: 'new',
      conversations: [{ id: 'new', title: 'New chat', group: 'Today', draft: '', messages: [] }],
    };
  const examples = [
    [
      'setup',
      'Planning a local setup',
      'How do I connect my two PCs?',
      'You can start from either PC. Open Add in Cluster, then choose Add device or Join cluster.\n\nThe other PC reviews the request before accepting it.',
    ],
    [
      'quantization',
      'Explain model quantization',
      'What does Q4_K_M mean?',
      'This is sample conversation text for the Chat preview. No model generated this answer.',
    ],
    [
      'memory',
      'Compare memory requirements',
      'Where can I see available memory?',
      'The Cluster overview separates discrete VRAM from unified memory. Values in this preview are samples.',
    ],
    [
      'start',
      'Getting started',
      'Where should I start?',
      'Review a model in Models, then open Cluster to explore the sample placement.',
    ],
  ] as const;
  return {
    selectedId: 'setup',
    conversations: examples.map(([id, title, prompt, response], index) => ({
      id,
      title,
      group: index === 3 ? 'Yesterday' : 'Today',
      draft: '',
      messages: [
        { id: `${id}-user`, role: 'user', text: prompt },
        { id: `${id}-assistant`, role: 'assistant', text: response },
      ],
    })),
  };
}

/** Session-only conversation actions cannot change the globally active model. */
export function transitionDemoChat(state: DemoChat, action: ChatAction): DemoChat {
  if (action.type === 'delete')
    return {
      selectedId: state.selectedId === action.id ? '' : state.selectedId,
      conversations: state.conversations.filter((chat) => chat.id !== action.id),
    };
  if (action.type === 'select')
    return state.conversations.some((chat) => chat.id === action.id)
      ? { ...state, selectedId: action.id }
      : state;
  if (action.type === 'new') {
    const empty = state.conversations.find((chat) => !chat.messages.length && !chat.draft);
    if (empty) return { ...state, selectedId: empty.id };
    return {
      selectedId: action.id,
      conversations: [
        { id: action.id, title: 'New chat', group: 'Today', draft: '', messages: [] },
        ...state.conversations,
      ],
    };
  }
  return {
    ...state,
    conversations: state.conversations.map((chat) => {
      if (chat.id !== state.selectedId) return chat;
      return { ...chat, draft: action.text };
    }),
  };
}
