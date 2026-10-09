import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { HistoryStore } from '../../../../../../packages/core/src/history/store';
import { ChatController } from '../../../../../../packages/core/src/generation/chat-controller';
import type {
  GenerationChunk,
  TerminalOutcome,
} from '../../../../../../packages/core/src/generation/contracts';
import { useLiveChat } from './useLiveChat';
import { ChatPage } from './ChatPage';
const stores: HistoryStore[] = [];
afterEach(() => {
  delete window.modelLoomChat;
  for (const store of stores.splice(0)) store.close();
});
async function fixture(
  count: (messages: readonly unknown[], signal: AbortSignal) => Promise<number> = () =>
    Promise.resolve(10),
) {
  const history = new HistoryStore(new DatabaseSync(':memory:'));
  stores.push(history);
  const listeners = new Set<() => void>();
  const core = new ChatController(history, 'window', () => {
    for (const listener of listeners) listener();
  });
  const work: {
    progress: (chunk: GenerationChunk) => void | Promise<void>;
    settle: (outcome: TerminalOutcome) => void;
  }[] = [];
  let cancellations = 0;
  await core.bind({
    session: { deploymentId: 'desktop', sessionId: 'session', operationId: 'load' },
    provenance: {
      packageId: 'package',
      upstreamCommit: 'a'.repeat(40),
      configuration: {
        modelSha256: 'a'.repeat(64),
        slots: 4,
        contextPerSlot: 7680,
        gpuLayers: 0,
        cacheK: 'f16',
        cacheV: 'f16',
        seed: 7,
        temperature: 0.8,
      },
    },
    cleanup: () => Promise.resolve(),
    transport: {
      tokenCount: count,
      start(_identity, _messages, progress) {
        let settle!: (outcome: TerminalOutcome) => void;
        const settled = new Promise<TerminalOutcome>((yes) => {
          settle = yes;
        });
        work.push({ progress, settle });
        return {
          settled,
          cancel: () => {
            cancellations++;
            settle({ status: 'cancelled', reason: 'USER_CANCELLED' });
          },
        };
      },
    },
  });
  window.modelLoomChat = {
    command: (command) => core.command('window', command),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { core, history, work, cancellations: () => cancellations };
}
function Harness({ ready = true }: { ready?: boolean }) {
  const live = useLiveChat(true, ready);
  return (
    <ChatPage
      demo={false}
      chat={live.chat}
      dispatch={live.dispatch}
      activeModel={undefined}
      onCluster={() => undefined}
      live={live.controls}
    />
  );
}
it('Stop aborts prompt preparation without creating a turn or starting generation', async () => {
  let counting: AbortSignal | undefined;
  const f = await fixture((_messages, signal) => {
    counting = signal;
    return new Promise(() => undefined);
  });
  const user = userEvent.setup();
  render(<Harness />);
  try {
    await screen.findByText('Saved on this device');
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Keep this unsent question');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(counting).toBeDefined());
    await user.click(screen.getByRole('button', { name: 'Stop response' }));
    await waitFor(() => expect(counting?.aborted).toBe(true));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled());
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(
      'Keep this unsent question',
    );
    const saved = await f.history.readConversation((await f.history.listConversations())[0]!.id);
    expect(saved.turns).toHaveLength(0);
    expect(saved.draft).toBe('Keep this unsent question');
    expect(f.work).toHaveLength(0);
  } finally {
    await f.core.close();
  }
});
it('searches saved messages before opening their conversation, including after reload', async () => {
  const f = await fixture(),
    user = userEvent.setup();
  render(<Harness />);
  await screen.findByText('Saved on this device');
  await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Ordinary title');
  await user.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(f.work).toHaveLength(1));
  await f.work[0]!.progress({ type: 'text', text: 'A hidden CAFÉ reference' });
  await f.work[0]!.progress({ type: 'terminal', outcome: { status: 'completed', reason: 'STOP' } });
  f.work[0]!.settle({ status: 'completed', reason: 'STOP' });
  await screen.findByText('Complete');
  await user.click(screen.getAllByRole('button', { name: 'New chat' })[0]!);
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(''));
  const { cleanup } = await import('@testing-library/react');
  cleanup();
  render(<Harness ready={false} />);
  await screen.findByText('Saved on this device');
  await user.click(screen.getByRole('button', { name: 'Search conversations' }));
  await user.type(screen.getByRole('searchbox', { name: 'Search chats' }), 'café');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Ordinary title' })).toBeVisible());
  expect(screen.queryByText('A hidden CAFÉ reference')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Ordinary title' }));
  expect(await screen.findByText('A hidden CAFÉ reference')).toBeVisible();
  await f.core.close();
});
it('groups persisted chats by local calendar day and retains older chats', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(new Date(2026, 9, 8, 12).getTime());
  const f = await fixture();
  try {
    await f.history.newConversation();
    clock.mockReturnValue(new Date(2026, 9, 9, 12).getTime());
    await f.history.newConversation();
    clock.mockReturnValue(new Date(2026, 9, 10, 12).getTime());
    await f.history.newConversation();
    render(<Harness ready={false} />);
    await screen.findByText('Saved on this device');
    expect(screen.getByRole('heading', { name: 'Today' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Yesterday' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Older' })).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'New chat' })).toHaveLength(4);
  } finally {
    clock.mockRestore();
    await f.core.close();
  }
});
it('reuses an untouched empty chat but never replaces another chat draft', async () => {
  const f = await fixture(),
    user = userEvent.setup();
  render(<Harness ready={false} />);
  await screen.findByText('Saved on this device');
  const first = (await f.history.listConversations())[0]!.id;
  for (let i = 0; i < 3; i++)
    await user.click(screen.getAllByRole('button', { name: 'New chat' })[0]!);
  await waitFor(async () => expect(await f.history.listConversations()).toHaveLength(1));
  await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Keep my draft');
  await user.click(screen.getAllByRole('button', { name: 'New chat' })[0]!);
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(''));
  expect(await f.history.listConversations()).toHaveLength(2);
  expect((await f.history.readConversation(first)).draft).toBe('Keep my draft');
  await f.core.close();
});
it('confirms deletion, stops the chosen active response and opens an empty chat', async () => {
  const f = await fixture(),
    user = userEvent.setup();
  const kept = await f.history.newConversation();
  await f.history.saveDraft(kept.id, 'Keep my draft');
  render(<Harness />);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved on this device'));
  await user.click(screen.getAllByRole('button', { name: 'New chat' })[0]!);
  await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Delete this response');
  await user.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(f.work).toHaveLength(1));
  await user.click(screen.getByRole('button', { name: 'Delete chat: Delete this response' }));
  expect(screen.getByRole('dialog', { name: 'Delete chat?' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(f.cancellations()).toBe(0);
  await user.click(screen.getByRole('button', { name: 'Delete chat: Delete this response' }));
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(f.cancellations()).toBe(1));
  await waitFor(() => expect(screen.getByRole('heading', { name: 'New chat' })).toBeVisible());
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
  expect(
    (await f.history.listConversations()).some((c) => c.title === 'Delete this response'),
  ).toBe(false);
  expect((await f.history.readConversation(kept.id)).draft).toBe('Keep my draft');
  await f.core.close();
});
it('retains the selected saved chat and draft if deletion fails', async () => {
  const f = await fixture(),
    user = userEvent.setup();
  const c = await f.history.newConversation();
  await f.history.saveDraft(c.id, 'Saved draft');
  const bridge = window.modelLoomChat!,
    command = bridge.command.bind(bridge);
  bridge.command = (input) =>
    input.action === 'deleteConversation'
      ? Promise.resolve({ ok: false, error: 'HISTORY_UNAVAILABLE' })
      : command(input);
  render(<Harness ready={false} />);
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Saved draft'),
  );
  await user.click(screen.getByRole('button', { name: 'Delete chat: New chat' }));
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Could not delete'));
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Saved draft');
  expect((await f.history.readConversation(c.id)).draft).toBe('Saved draft');
  await f.core.close();
});
it('deletes during prompt preparation without sending or losing an unrelated draft', async () => {
  const f = await fixture(() => new Promise(() => undefined)),
    user = userEvent.setup();
  const kept = await f.history.newConversation();
  await f.history.saveDraft(kept.id, 'Other draft');
  render(<Harness />);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved on this device'));
  await user.click(screen.getAllByRole('button', { name: 'New chat' })[0]!);
  await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Preparing draft');
  await user.click(screen.getByRole('button', { name: 'Send message' }));
  await screen.findByText('Preparing response…');
  const deleted = (await f.history.listConversations())[0]!.id;
  await user.click(screen.getAllByRole('button', { name: 'Delete chat: New chat' })[0]!);
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Chat deleted'));
  expect(f.work).toHaveLength(0);
  await expect(f.history.readConversation(deleted)).rejects.toThrow('UNKNOWN_CONVERSATION');
  expect((await f.history.readConversation(kept.id)).draft).toBe('Other draft');
  await f.core.close();
});
it('shows saved native speeds after completion and renderer reload', async () => {
  const f = await fixture(),
    user = userEvent.setup();
  const view = render(<Harness />);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved on this device'));
  await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Question');
  await user.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(f.work).toHaveLength(1));
  const speeds = { generation: 24.8, prefill: 1420 },
    outcome = { status: 'completed', reason: 'STOP' } as const;
  await f.work[0]!.progress({ type: 'reasoning', text: 'Consider' });
  await f.work[0]!.progress({ type: 'text', text: 'Answer' });
  await f.work[0]!.progress({ type: 'terminal', outcome, speeds });
  f.work[0]!.settle(outcome);
  await screen.findByText('Generation: 24.8 tok/s');
  const thoughtLabel = screen.getByText(/^Thought for /).textContent;
  expect(screen.getByText('Prompt processing: 1,420 tok/s')).toBeVisible();
  view.unmount();
  render(<Harness />);
  await screen.findByText('Generation: 24.8 tok/s');
  expect(screen.getByText(thoughtLabel, { exact: true })).toBeVisible();
  expect(screen.getByText('Prompt processing: 1,420 tok/s')).toBeVisible();
  await f.core.close();
});
it('shows streamed thinking in a collapsed row, expands safely and retains it after Stop', async () => {
  const f = await fixture(),
    user = userEvent.setup();
  render(<Harness />);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved on this device'));
  await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Question');
  await user.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(f.work).toHaveLength(1));
  await f.work[0]!.progress({ type: 'reasoning', text: '<img src=x onerror=alert(1)>Thinking' });
  await waitFor(() => expect(screen.getByText('Thinking', { exact: true })).toBeVisible());
  expect(screen.queryByText('Thinking…', { exact: true })).toBeNull();
  const thinking = screen.getByText('Thinking', { exact: true }).closest('details')!;
  expect(thinking).not.toHaveAttribute('open');
  await user.click(screen.getByText('Thinking', { exact: true }));
  expect(thinking).toHaveAttribute('open');
  expect(screen.getByText('<img src=x onerror=alert(1)>Thinking')).toBeVisible();
  expect(thinking.querySelector('img')).toBeNull();
  await f.work[0]!.progress({ type: 'text', text: 'Answer' });
  await waitFor(() => expect(screen.getByText('Answer')).toBeVisible());
  await user.click(screen.getByRole('button', { name: 'Stop response' }));
  await screen.findByText('Stopped');
  await waitFor(() => expect(screen.getByText('Saved on this device')).toBeVisible());
  expect(screen.getByText(/^Thought for /)).toBeVisible();
  expect(screen.getByText('<img src=x onerror=alert(1)>Thinking')).toBeVisible();
  const saved = await f.history.readConversation((await f.history.listConversations())[0]!.id);
  expect(saved.turns[0]?.attempts[0]).toMatchObject({
    text: 'Answer',
    reasoning: '<img src=x onerror=alert(1)>Thinking',
    state: 'cancelled',
  });
  await f.core.close();
});
it('retains typing before the core exists and saves it when history becomes available', async () => {
  const f = await fixture();
  const bridge = window.modelLoomChat!;
  const command = bridge.command.bind(bridge);
  let available = false;
  window.modelLoomChat!.command = (input) =>
    available ? command(input) : Promise.resolve({ ok: false, error: 'NOT_READY' });
  const user = userEvent.setup();
  const view = render(<Harness ready={false} />);
  await screen.findByText('Load a model before sending.');
  const composer = screen.getByRole('textbox', { name: 'Message' });
  await user.type(composer, 'Keep this question');
  expect(composer).toHaveValue('Keep this question');
  expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  available = true;
  view.rerender(<Harness />);
  await waitFor(async () => {
    expect((await f.history.listConversations())[0]?.draft).toBe('Keep this question');
  });
  expect(composer).toHaveValue('Keep this question');
  await user.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(f.work).toHaveLength(1));
  expect(
    (await f.history.readConversation((await f.history.listConversations())[0]!.id)).turns[0]?.text,
  ).toBe('Keep this question');
  await f.core.close();
});
it('retains typing after New chat fails and shows the storage error', async () => {
  window.modelLoomChat = {
    command: () => Promise.resolve({ ok: false, error: 'HISTORY_UNAVAILABLE' }),
    subscribe: () => () => undefined,
  };
  const user = userEvent.setup();
  render(<Harness />);
  await screen.findByText(/Local history is unavailable/);
  await user.click(screen.getByRole('button', { name: 'New chat' }));
  const composer = screen.getByRole('textbox', { name: 'Message' });
  await user.type(composer, 'Do not discard this');
  expect(composer).toHaveValue('Do not discard this');
  expect(screen.getByText(/Local history is unavailable/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
});
it('opens a separate conversation for typing before history loads without replacing an older draft', async () => {
  const f = await fixture();
  const older = await f.history.newConversation();
  await f.history.saveDraft(older.id, 'Older unsent question');
  const bridge = window.modelLoomChat!;
  const command = bridge.command.bind(bridge);
  let available = false;
  bridge.command = (input) =>
    available ? command(input) : Promise.resolve({ ok: false, error: 'NOT_READY' });
  const user = userEvent.setup();
  render(<Harness />);
  await screen.findByText('Load a model before sending.');
  const composer = screen.getByRole('textbox', { name: 'Message' });
  await user.type(composer, 'New unsent question');
  available = true;
  await waitFor(async () => {
    expect(await f.history.listConversations()).toHaveLength(2);
  });
  await waitFor(() => expect(composer).toHaveValue('New unsent question'));
  expect((await f.history.readConversation(older.id)).draft).toBe('Older unsent question');
  await f.core.close();
});
it('sends through the real core, displays saved partial text, stops and reloads without replay', async () => {
  const f = await fixture();
  const user = userEvent.setup();
  const view = render(<Harness />);
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled());
  await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Hello');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(f.work).toHaveLength(1));
  await f.work[0]!.progress({ type: 'text', text: '<b>Saved partial</b>' });
  expect(await screen.findByText('<b>Saved partial</b>')).toBeVisible();
  expect(document.querySelector('b')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Stop response' }));
  await waitFor(() => expect(f.cancellations()).toBe(1));
  expect(await screen.findByText('Stopped')).toBeVisible();
  view.unmount();
  render(<Harness />);
  expect(await screen.findByText('<b>Saved partial</b>')).toBeVisible();
  expect(f.work).toHaveLength(1);
  await f.core.close();
});
it('keeps Send disabled without a ready model and preserves saved drafts on reopen', async () => {
  const f = await fixture();
  const user = userEvent.setup();
  const view = render(<Harness ready={false} />);
  await user.type(screen.getByRole('textbox', { name: 'Message' }), 'draft');
  expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  await waitFor(async () => {
    const chats = await f.history.listConversations();
    expect(chats[0]?.draft).toBe('draft');
  });
  view.unmount();
  render(<Harness ready={false} />);
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('draft'),
  );
  expect(f.work).toEqual([]);
  await f.core.close();
});
it('coalesces draft changes while a save is pending', async () => {
  const f = await fixture();
  const bridge = window.modelLoomChat!;
  const command = bridge.command.bind(bridge);
  let release!: () => void;
  const held = new Promise<void>((yes) => {
    release = yes;
  });
  let saves = 0;
  bridge.command = async (input) => {
    if (input.action === 'saveDraft') {
      saves++;
      if (saves === 1) await held;
    }
    return command(input);
  };
  render(<Harness ready={false} />);
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled());
  const user = userEvent.setup();
  await user.type(screen.getByRole('textbox', { name: 'Message' }), 'abcdefghijklmnop');
  expect(saves).toBe(1);
  release();
  await waitFor(async () =>
    expect((await f.history.listConversations())[0]?.draft).toBe('abcdefghijklmnop'),
  );
  expect(saves).toBeLessThanOrEqual(2);
  await f.core.close();
});
it('retries a stopped attempt without duplicating its user turn or losing partial text', async () => {
  const f = await fixture();
  const user = userEvent.setup();
  render(<Harness />);
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled());
  await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Try again');
  await user.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(f.work).toHaveLength(1));
  await f.work[0]!.progress({ type: 'text', text: 'First partial' });
  await user.click(screen.getByRole('button', { name: 'Stop response' }));
  expect(await screen.findByText('Stopped')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Retry response 2' }));
  await waitFor(() => expect(f.work).toHaveLength(2));
  await f.work[1]!.progress({ type: 'text', text: 'Second answer' });
  await f.work[1]!.progress({ type: 'terminal', outcome: { status: 'completed', reason: 'STOP' } });
  f.work[1]!.settle({ status: 'completed', reason: 'STOP' });
  expect(await screen.findByText('Complete')).toBeVisible();
  expect(screen.getByText('First partial')).toBeVisible();
  expect(screen.getByText('Second answer')).toBeVisible();
  const summaries = await f.history.listConversations();
  const saved = await f.history.readConversation(summaries[0]!.id);
  expect(saved.turns).toHaveLength(1);
  expect(saved.turns[0]!.attempts).toHaveLength(2);
  await f.core.close();
});
it('retains a newer draft typed while the sent prompt is being prepared', async () => {
  let release!: (value: number) => void;
  const f = await fixture(
    () =>
      new Promise<number>((yes) => {
        release = yes;
      }),
  );
  const user = userEvent.setup();
  render(<Harness />);
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled());
  const composer = screen.getByRole('textbox', { name: 'Message' });
  await user.type(composer, 'First question');
  await user.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(release).toBeTypeOf('function'));
  await user.clear(composer);
  await user.type(composer, 'Next question');
  release(10);
  await waitFor(() => expect(f.work).toHaveLength(1));
  await waitFor(() => expect(composer).toHaveValue('Next question'));
  await waitFor(async () =>
    expect((await f.history.listConversations())[0]?.draft).toBe('Next question'),
  );
  const saved = await f.history.readConversation((await f.history.listConversations())[0]!.id);
  expect(saved.turns[0]?.text).toBe('First question');
  await f.core.close();
});
it('reloads a newer saved draft before the original Send reply reaches the renderer', async () => {
  let releaseCount!: (tokens: number) => void, releaseReply!: () => void;
  const f = await fixture(
    () =>
      new Promise<number>((resolve) => {
        releaseCount = resolve;
      }),
  );
  const bridge = window.modelLoomChat!,
    command = bridge.command.bind(bridge),
    held = new Promise<void>((resolve) => {
      releaseReply = resolve;
    });
  bridge.command = async (input) => {
    const reply = await command(input);
    if (input.action === 'send') await held;
    return reply;
  };
  const user = userEvent.setup(),
    view = render(<Harness />);
  try {
    await screen.findByText('Saved on this device');
    const composer = screen.getByRole('textbox', { name: 'Message' });
    await user.type(composer, 'First question');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(releaseCount).toBeTypeOf('function'));
    await user.clear(composer);
    await user.type(composer, 'Next question');
    const id = (await f.history.listConversations())[0]!.id;
    await waitFor(async () =>
      expect((await f.history.readConversation(id)).draft).toBe('Next question'),
    );
    releaseCount(10);
    await waitFor(() => expect(f.work).toHaveLength(1));
    view.unmount();
    render(<Harness ready={false} />);
    await screen.findByRole('heading', { name: 'First question' });
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Next question');
    expect((await f.history.readConversation(id)).draft).toBe('Next question');
    expect(f.work).toHaveLength(1);
  } finally {
    releaseReply();
    await f.core.close();
  }
});
it('keeps another conversation running when navigating and stopping the selected response', async () => {
  const f = await fixture();
  const user = userEvent.setup();
  render(<Harness />);
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled());
  await user.type(screen.getByRole('textbox', { name: 'Message' }), 'First conversation');
  await user.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(f.work).toHaveLength(1));
  await user.click(screen.getByRole('button', { name: 'New chat' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(''));
  await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Second conversation');
  await user.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(f.work).toHaveLength(2));
  await user.click(screen.getByRole('button', { name: 'Stop response' }));
  expect(await screen.findByText('Stopped')).toBeVisible();
  expect(f.cancellations()).toBe(1);
  await user.click(screen.getByRole('button', { name: 'First conversation' }));
  expect(await screen.findByText('Generating…')).toBeVisible();
  await f.work[0]!.progress({
    type: 'terminal',
    outcome: { status: 'limit-reached', reason: 'OUTPUT_LIMIT' },
  });
  f.work[0]!.settle({ status: 'limit-reached', reason: 'OUTPUT_LIMIT' });
  expect(await screen.findByText('Output limit reached')).toBeVisible();
  await f.core.close();
});
