export interface ChatMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly feedback?: 'up' | 'down' | undefined;
}

export interface DemoConversation {
  readonly id: string;
  readonly title: string;
  readonly group: 'Today' | 'Yesterday';
  readonly draft: string;
  readonly messages: readonly ChatMessage[];
}

export interface DemoChat {
  readonly selectedId: string;
  readonly conversations: readonly DemoConversation[];
}

export type ChatAction =
  | { type: 'select'; id: string }
  | { type: 'new'; id: string }
  | { type: 'draft'; text: string }
  | { type: 'feedback'; messageId: string; value: 'up' | 'down' };

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
      if (action.type === 'draft') return { ...chat, draft: action.text };
      return {
        ...chat,
        messages: chat.messages.map((message) =>
          message.id === action.messageId && message.role === 'assistant'
            ? { ...message, feedback: message.feedback === action.value ? undefined : action.value }
            : message,
        ),
      };
    }),
  };
}
