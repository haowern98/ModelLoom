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
it.each([undefined, null, 0, 0.75])(
  'shows measured speeds and conditional acceptance inline after Copy/Retry: %s',
  (acceptance) => {
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
            speeds: {
              generation: 24.8,
              prefill: 1420,
              ...(acceptance === undefined ? {} : { acceptance }),
            },
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
        live={{
          ready: true,
          busy: false,
          notice: '',
          send: vi.fn(),
          stop: vi.fn(),
          retry: vi.fn(),
        }}
      />,
    );
    const copy = screen.getByRole('button', { name: 'Copy response 1' });
    const retry = screen.getByRole('button', { name: 'Retry response 1' });
    const generation = screen.getByText('Generation: 24.8 tok/s');
    const prefill = screen.getByText('Prompt processing: 1,420 tok/s');
    expect(generation.parentElement?.parentElement).toBe(copy.parentElement);
    expect(
      retry.compareDocumentPosition(generation) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(copy.parentElement).not.toHaveTextContent('·');
    expect(prefill).toBeVisible();
    if (acceptance === undefined) expect(screen.queryByText(/Acceptance rate:/)).toBeNull();
    else {
      const metric = screen.getByText(
        `Acceptance rate: ${acceptance === null ? '—' : `${acceptance * 100}%`}`,
      );
      expect(metric).toBeVisible();
      expect(
        prefill.compareDocumentPosition(metric) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: /Good response|Bad response/ })).toBeNull();
  },
);
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
it('replaces Copy feedback with new live status and does not resurrect it after completion', async () => {
  const user = userEvent.setup(),
    base = createDemoChat(false),
    chat = {
      ...base,
      conversations: [
        {
          ...base.conversations[0]!,
          draft: 'Next question',
          messages: [{ id: 'answer', role: 'assistant' as const, text: 'Answer' }],
        },
      ],
    },
    props = { demo: false, chat, dispatch: vi.fn(), activeModel: undefined, onCluster: vi.fn() },
    live = {
      ready: true,
      busy: false,
      notice: 'Saved on this device',
      send: vi.fn(),
      stop: vi.fn(),
      retry: vi.fn(),
    };
  const view = render(<ChatPage {...props} live={live} />);
  await user.click(screen.getByRole('button', { name: 'Copy response 1' }));
  expect(screen.getByRole('status')).toHaveTextContent('Response copied');
  view.rerender(<ChatPage {...props} live={{ ...live, notice: 'Local history is full.' }} />);
  expect(screen.getByRole('status')).toHaveTextContent('Local history is full.');
  view.rerender(<ChatPage {...props} live={live} />);
  expect(screen.getByRole('status')).toHaveTextContent('Saved on this device');
});
it('replaces Delete feedback when a new Send operation starts', async () => {
  const user = userEvent.setup(),
    base = createDemoChat(false),
    chat = { ...base, conversations: [{ ...base.conversations[0]!, draft: 'Question' }] },
    props = { demo: false, chat, dispatch: vi.fn(), activeModel: undefined, onCluster: vi.fn() },
    live = {
      ready: true,
      busy: false,
      notice: 'Saved on this device',
      send: vi.fn(),
      stop: vi.fn(),
      retry: vi.fn(),
      remove: () => Promise.resolve(true),
    };
  const view = render(<ChatPage {...props} live={live} />);
  await user.click(screen.getByRole('button', { name: 'Chat actions: New chat' }));
  await user.click(screen.getByRole('menuitem', { name: 'Delete chat' }));
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  expect(screen.getByRole('status')).toHaveTextContent('Chat deleted.');
  await user.click(screen.getByRole('button', { name: 'Send message' }));
  expect(screen.getByRole('status')).toHaveTextContent('Saved on this device');
  view.rerender(
    <ChatPage {...props} live={{ ...live, busy: true, notice: 'Preparing response…' }} />,
  );
  expect(screen.getByRole('status')).toHaveTextContent('Preparing response…');
});
it.each(['send', 'enter', 'retry', 'stop'] as const)(
  'clears Copy feedback when starting %s before the live status changes',
  async (action) => {
    const user = userEvent.setup(),
      base = createDemoChat(false),
      chat = {
        ...base,
        conversations: [
          {
            ...base.conversations[0]!,
            draft: 'Next question',
            messages: [
              { id: 'answer', role: 'assistant' as const, text: 'Answer', attemptId: 'attempt1' },
            ],
          },
        ],
      },
      live = {
        ready: true,
        busy: action === 'stop',
        notice: action === 'stop' ? 'Generating…' : 'Saved on this device',
        send: vi.fn(),
        stop: vi.fn(),
        retry: vi.fn(),
      };
    render(
      <ChatPage
        demo={false}
        chat={chat}
        dispatch={vi.fn()}
        activeModel={undefined}
        onCluster={vi.fn()}
        live={live}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Copy response 1' }));
    expect(screen.getByRole('status')).toHaveTextContent('Response copied');
    if (action === 'enter') {
      await user.click(screen.getByRole('textbox', { name: 'Message' }));
      await user.keyboard('{Enter}');
    } else {
      await user.click(
        screen.getByRole('button', {
          name: {
            send: 'Send message',
            retry: 'Retry response 1',
            stop: 'Stop response',
          }[action],
        }),
      );
    }
    expect(screen.getByRole('status')).toHaveTextContent(live.notice);
    expect(live[action === 'enter' ? 'send' : action]).toHaveBeenCalledTimes(1);
    if (action === 'retry') expect(live.retry).toHaveBeenCalledWith('attempt1');
  },
);
