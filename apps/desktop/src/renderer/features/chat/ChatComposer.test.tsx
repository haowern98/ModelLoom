import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ChatPage } from './ChatPage';
import { createDemoChat } from '../../mocks/chat';

it('preserves send, stop and IME behavior while expanded Enter inserts a line', async () => {
  const base = createDemoChat(false);
  const chat = {
    ...base,
    conversations: base.conversations.map((item) => ({ ...item, draft: 'First\nSecond' })),
  };
  const live = {
    ready: true,
    busy: false,
    notice: '',
    send: vi.fn(),
    stop: vi.fn(),
    retry: vi.fn(),
  };
  const props = {
    demo: false,
    chat,
    dispatch: vi.fn(),
    activeModel: undefined,
    onCluster: vi.fn(),
    live,
  };
  const view = render(<ChatPage {...props} />);
  const input = screen.getByRole('textbox', { name: 'Message' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(live.send).toHaveBeenCalledTimes(1);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Expand message editor' }));
  expect(input).toHaveFocus();
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(live.send).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
  expect(live.send).toHaveBeenCalledTimes(2);
  fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
  expect(live.send).toHaveBeenCalledTimes(3);
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, shiftKey: true });
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, isComposing: true });
  expect(live.send).toHaveBeenCalledTimes(3);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Send message' }));
  expect(live.send).toHaveBeenCalledTimes(4);
  view.rerender(<ChatPage {...props} live={{ ...live, busy: true }} />);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Stop response' }));
  expect(live.stop).toHaveBeenCalledTimes(1);
  expect(input).toHaveValue('First\nSecond');
});

it('switches conversations without replacing the focused textarea or retaining expansion', async () => {
  const base = createDemoChat(false);
  const first = { ...base.conversations[0]!, draft: 'First\nSecond' };
  const second = { ...first, id: 'second', draft: 'Another\ndraft' };
  const props = {
    demo: false,
    chat: { ...base, conversations: [first, second] },
    dispatch: vi.fn(),
    activeModel: undefined,
    onCluster: vi.fn(),
  };
  const view = render(<ChatPage {...props} />);
  const input = screen.getByRole('textbox', { name: 'Message' });
  await userEvent.setup().click(screen.getByRole('button', { name: 'Expand message editor' }));
  view.rerender(<ChatPage {...props} chat={{ ...props.chat, selectedId: second.id }} />);
  expect(screen.getByRole('textbox', { name: 'Message' })).toBe(input);
  expect(input).toHaveFocus();
  expect(input).toHaveValue('Another\ndraft');
  expect(screen.getByRole('button', { name: 'Expand message editor' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});
