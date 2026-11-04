import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ChatPage } from './ChatPage';
import { createDemoChat } from '../../mocks/chat';

function fixture() {
  const chat = createDemoChat(true);
  return {
    demo: true,
    chat: {
      ...chat,
      conversations: [
        ...chat.conversations.map((item, index) =>
          index === 0 ? { ...item, draft: 'Keep this draft' } : item,
        ),
        {
          id: 'archived',
          title: 'Archived setup notes',
          group: 'Older' as const,
          draft: '',
          archived: true,
          messages: [{ id: 'message', role: 'assistant' as const, text: 'An archived needle' }],
        },
      ],
    },
    dispatch: vi.fn(),
    activeModel: undefined,
    onCluster: vi.fn(),
  };
}

it('opens a chats-only modal from the 16px icon and removes the inline search', async () => {
  const user = userEvent.setup();
  const props = fixture();
  render(<ChatPage {...props} />);
  const sidebar = screen.getByRole('complementary', { name: 'Conversations' });
  const trigger = within(sidebar).getByRole('button', { name: 'Search chats' });
  expect(trigger.querySelector('svg')).toHaveAttribute('width', '16');
  expect(trigger.querySelector('svg')).toHaveAttribute('height', '16');
  expect(trigger.querySelector('svg')).toHaveAttribute('viewBox', '0 0 16 16');
  await user.click(trigger);
  const dialog = screen.getByRole('dialog', { name: 'Search chats' });
  const search = within(dialog).getByRole('searchbox', { name: 'Search chats' });
  expect(search).toHaveAttribute('placeholder', 'Search chats');
  expect(search).toHaveFocus();
  expect(within(sidebar).queryByRole('searchbox')).toBeNull();
  expect(within(dialog).getByRole('heading', { name: 'Chats' })).toBeVisible();
  expect(within(dialog).getAllByRole('option')).toHaveLength(5);
  expect(within(dialog).queryByRole('tablist')).toBeNull();
  expect(dialog).not.toHaveTextContent(/Quick actions|Open folder|Search ChatGPT/);
  await user.type(search, 'Q4_K_M');
  expect(within(dialog).getAllByRole('option')).toHaveLength(1);
  expect(within(dialog).getByRole('option', { name: 'Explain model quantization' })).toBeVisible();
  expect(sidebar.querySelectorAll('[data-conversation-id]')).toHaveLength(4);
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Keep this draft');
  await user.clear(search);
  await user.type(search, 'nothing matches');
  expect(within(dialog).getByText('No matching chats')).toBeVisible();
  fireEvent.keyDown(search, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(props.dispatch).not.toHaveBeenCalled();
});

it('opens an archived result by keyboard without changing a draft during search', async () => {
  const user = userEvent.setup();
  const props = fixture();
  render(<ChatPage {...props} />);
  await user.click(screen.getByRole('button', { name: 'Search chats' }));
  const search = screen.getByRole('searchbox', { name: 'Search chats' });
  await user.type(search, 'needle');
  const result = screen.getByRole('option', { name: 'Archived setup notes' });
  expect(search).toHaveAttribute('aria-activedescendant', result.id);
  await user.keyboard('{Enter}');
  expect(props.dispatch).toHaveBeenCalledWith({ type: 'select', id: 'archived' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('button', { name: 'Archived setup notes' })).toBeVisible();
});

it('uses saved-message search results and clears the search on dismissal', async () => {
  const user = userEvent.setup(),
    props = fixture(),
    search = vi.fn();
  const live = {
    ready: true,
    busy: false,
    notice: '',
    send: vi.fn(),
    stop: vi.fn(),
    retry: vi.fn(),
    search,
    matches: undefined as readonly string[] | undefined,
  };
  const view = render(<ChatPage {...props} live={live} />);
  await user.click(screen.getByRole('button', { name: 'Search chats' }));
  const field = screen.getByRole('searchbox', { name: 'Search chats' });
  await user.type(field, 'saved body');
  expect(search).toHaveBeenLastCalledWith('saved body');
  expect(screen.getByText('Searching…')).toBeVisible();
  view.rerender(<ChatPage {...props} live={{ ...live, matches: ['start'] }} />);
  expect(screen.getByRole('option', { name: 'Getting started' })).toBeVisible();
  expect(screen.getAllByRole('option')).toHaveLength(1);
  fireEvent.keyDown(field, { key: 'Escape' });
  expect(search).toHaveBeenLastCalledWith('');
});
