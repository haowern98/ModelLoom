import { describe, expect, it } from 'vitest';
import { createDemoChat, transitionDemoChat } from './chat';

describe('Chat preview state', () => {
  it('does not seed sample conversations when demo data is disabled', () => {
    const chat = createDemoChat(false);
    expect(chat.conversations).toHaveLength(1);
    expect(chat.conversations[0]?.messages).toEqual([]);
    expect(chat.conversations[0]?.draft).toBe('');
    expect(chat.conversations[0]?.title).toBe('New chat');
  });

  it('retains separate drafts and produces a fresh session instead of persisting prior data', () => {
    let chat = createDemoChat(true);
    chat = transitionDemoChat(chat, { type: 'draft', text: 'Keep this draft' });
    chat = transitionDemoChat(chat, { type: 'new', id: 'local-new' });
    chat = transitionDemoChat(chat, { type: 'draft', text: 'Second draft' });
    chat = transitionDemoChat(chat, { type: 'select', id: 'setup' });
    expect(chat.conversations.find((item) => item.id === 'setup')?.draft).toBe('Keep this draft');
    expect(chat.conversations.find((item) => item.id === 'local-new')?.draft).toBe('Second draft');
    expect(createDemoChat(true).conversations.find((item) => item.id === 'setup')?.draft).toBe('');
    expect(createDemoChat(true).conversations.some((item) => item.id === 'local-new')).toBe(false);
  });
});
