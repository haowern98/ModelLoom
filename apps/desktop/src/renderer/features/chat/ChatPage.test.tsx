import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ChatPage } from './ChatPage';
import { createDemoChat } from '../../mocks/chat';
it.each(['running', 'completed'] as const)(
  'shows the %s label without inventing a missing duration',
  (state) => {
    const base = createDemoChat(false),
      chat = {
        ...base,
        conversations: [
          {
            ...base.conversations[0]!,
            messages: [
              {
                id: 'answer',
                role: 'assistant' as const,
                text: state === 'running' ? '' : 'Answer',
                reasoning: 'Think',
                state,
              },
            ],
          },
        ],
      };
    render(
      <ChatPage
        demo={false}
        chat={chat}
        dispatch={vi.fn()}
        activeModel={undefined}
        onCluster={vi.fn()}
      />,
    );
    expect(
      screen.getByText(state === 'running' ? 'Thinking' : 'Thought', { exact: true }),
    ).toBeVisible();
    expect(screen.queryByText('Thinking…', { exact: true })).toBeNull();
    expect(screen.queryByText(/^Thought for /)).toBeNull();
  },
);
it.each([
  [0, 'Thought for <1s'],
  [12000, 'Thought for 12s'],
  [576000, 'Thought for 9m 36s'],
  [3600000, 'Thought for 1h 0m 0s'],
] as const)(
  'shows completed thinking duration %i while retaining the expandable row',
  async (thinkingMs, label) => {
    const base = createDemoChat(false);
    const chat = {
      ...base,
      conversations: [
        {
          ...base.conversations[0]!,
          messages: [
            {
              id: 'answer',
              role: 'assistant' as const,
              text: 'Answer',
              reasoning: 'Think',
              state: 'completed',
              thinkingMs,
            },
          ],
        },
      ],
    };
    render(
      <ChatPage
        demo={false}
        chat={chat}
        dispatch={vi.fn()}
        activeModel={undefined}
        onCluster={vi.fn()}
      />,
    );
    const summary = screen.getByText(label);
    expect(summary.closest('details')).not.toHaveAttribute('open');
    await userEvent.setup().click(summary);
    expect(summary.closest('details')).toHaveAttribute('open');
    expect(screen.getByText('Think')).toBeVisible();
  },
);
it('shows measured speeds inline after Copy/Retry, without feedback icons or a separator', () => {
  const base = createDemoChat(false);
  const chat = {
    ...base,
    conversations: base.conversations.map((conversation) => ({
      ...conversation,
      messages: [
        {
          id: 'answer',
          role: 'assistant' as const,
          text: 'Hello',
          state: 'completed',
          attemptId: 'attempt',
          speeds: { generation: 24.8, prefill: 1420 },
        },
      ],
    })),
  };
  render(
    <ChatPage
      demo={false}
      chat={chat}
      dispatch={vi.fn()}
      activeModel={undefined}
      onCluster={vi.fn()}
      live={{ ready: true, busy: false, notice: '', send: vi.fn(), stop: vi.fn(), retry: vi.fn() }}
    />,
  );
  const copy = screen.getByRole('button', { name: 'Copy response 1' });
  const retry = screen.getByRole('button', { name: 'Retry response 1' });
  const generation = screen.getByText('Generation: 24.8 tok/s');
  const prefill = screen.getByText('Prompt processing: 1,420 tok/s');
  expect(generation.parentElement?.parentElement).toBe(copy.parentElement);
  expect(retry.compareDocumentPosition(generation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(copy.parentElement).not.toHaveTextContent('·');
  expect(prefill).toBeVisible();
  expect(screen.queryByRole('button', { name: /Good response|Bad response/ })).toBeNull();
});
it('enables ready Send and targets Stop without changing the chat presentation', async () => {
  const user = userEvent.setup();
  const send = vi.fn(),
    stop = vi.fn();
  const chat = createDemoChat(false);
  const edited = {
    ...chat,
    conversations: chat.conversations.map((conversation) => ({ ...conversation, draft: 'Hello' })),
  };
  const props = {
    demo: false,
    chat: edited,
    dispatch: vi.fn(),
    activeModel: undefined,
    onCluster: vi.fn(),
  };
  const view = render(
    <ChatPage
      {...props}
      live={{ ready: true, busy: false, notice: '', send, stop, retry: vi.fn() }}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Send message' }));
  expect(send).toHaveBeenCalledTimes(1);
  view.rerender(
    <ChatPage
      {...props}
      live={{ ready: true, busy: true, notice: 'Generating…', send, stop, retry: vi.fn() }}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Stop response' }));
  expect(stop).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status')).toHaveTextContent('Generating');
});
