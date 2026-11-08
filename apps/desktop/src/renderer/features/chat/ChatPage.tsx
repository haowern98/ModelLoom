import { useEffect, useRef, useState } from 'react';
import type { Dispatch } from 'react';
import { ArrowUp, Square, RotateCcw, ChevronDown, ChevronRight, Copy, Plus } from 'lucide-react';
import { ChatSearchDialog } from './ChatSearchDialog';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { ChatNavIcon } from '../../components/ChatNavIcon';
import { ChatHistoryRow } from './ChatHistoryRow';
import { ChatMarkdown } from './ChatMarkdown';
import { ChatComposerInput } from './ChatComposerInput';
import { copyText } from '../../components/copyText';
import type { ChatAction, ChatMessage, DemoChat } from '../../mocks/chat';
import type { DemoModel } from '../../mocks/modelLibrary';
import styles from './ChatPage.module.css';

interface ChatPageProps {
  archived?: boolean;
  onArchivedChange?: (archived: boolean) => void;
  onConversationSelect?: (id: string, archived: boolean) => void;
  demo: boolean;
  chat: DemoChat;
  dispatch: Dispatch<ChatAction>;
  activeModel: DemoModel | undefined;
  onCluster: () => void;
  live?:
    | {
        ready: boolean;
        busy: boolean;
        notice: string;
        draft?: string;
        send(): void;
        stop(): void;
        retry(attemptId: string): void;
        remove?(conversationId: string): Promise<boolean>;
        matches?: readonly string[] | undefined;
        search?: (query: string) => void;
      }
    | undefined;
}

function thinkingLabel(message: ChatMessage): string {
  if (message.thinkingMs === undefined)
    return !message.text && ['queued', 'running', 'cancelling'].includes(message.state ?? '')
      ? 'Thinking'
      : 'Thought';
  const seconds = Math.floor(message.thinkingMs / 1000);
  if (!seconds) return 'Thought for <1s';
  const minutes = Math.floor(seconds / 60),
    hours = Math.floor(minutes / 60);
  return `Thought for ${hours ? `${hours}h ${minutes % 60}m ` : minutes ? `${minutes}m ` : ''}${seconds % 60}s`;
}

/** Local conversation presentation with inert Markdown and preserved raw response actions. */
export function ChatPage({
  demo,
  chat,
  dispatch,
  activeModel,
  onCluster,
  live,
  archived: controlledArchived,
  onArchivedChange,
  onConversationSelect,
}: ChatPageProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [localArchived, setLocalArchived] = useState(false);
  const archived = controlledArchived ?? localArchived;
  const setArchived = onArchivedChange ?? setLocalArchived;
  const selectConversation = (id: string, archived: boolean) => {
    if (onConversationSelect) onConversationSelect(id, archived);
    else {
      dispatch({ type: 'select', id });
      setArchived(archived);
    }
  };
  const [collapsed, setCollapsed] = useState<Readonly<Record<string, boolean>>>({});
  const [modelOpen, setModelOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [previousLiveNotice, setPreviousLiveNotice] = useState(live?.notice);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [removing, setRemoving] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const previousConversation = useRef(chat.selectedId);
  const model = useRef<HTMLDivElement>(null);
  const modelButton = useRef<HTMLButtonElement>(null);
  const conversation = chat.conversations.find((item) => item.id === chat.selectedId);
  const lastMessage = conversation?.messages[conversation.messages.length - 1];
  const visible = chat.conversations.filter((item) => Boolean(item.archived) === archived);

  // Copy/Delete feedback belongs to the current live status, never a later operation.
  if (previousLiveNotice !== live?.notice) {
    setPreviousLiveNotice(live?.notice);
    setNotice('');
  }

  useEffect(() => {
    if (previousConversation.current !== chat.selectedId) following.current = true;
    previousConversation.current = chat.selectedId;
    if (following.current && transcript.current)
      transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [
    chat.selectedId,
    lastMessage?.id,
    lastMessage?.text,
    lastMessage?.reasoning,
    lastMessage?.state,
  ]);

  useEffect(() => {
    if (!modelOpen) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !model.current?.contains(event.target))
        setModelOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [modelOpen]);

  const copy = async (text: string) => {
    try {
      await copyText(text);
      setNotice('Response copied');
    } catch {
      setNotice('Could not copy. Select the response text and copy it manually.');
    }
  };

  return (
    <section className={styles.page} aria-label="Chat">
      <aside id="chat-sidebar" className={styles.sidebar} aria-label="Conversations">
        <div className={styles.sidebarHeader}>
          <h2>Chat</h2>
          <button
            type="button"
            className={styles.icon}
            aria-label="Search chats"
            title="Search chats"
            aria-haspopup="dialog"
            aria-expanded={searchOpen}
            onClick={() => {
              setSearchOpen(true);
            }}
          >
            <ChatNavIcon name="search" width={16} height={16} />
          </button>
        </div>
        <div className={styles.newChatRow}>
          <button
            type="button"
            className={styles.newChat}
            onClick={() => {
              dispatch({ type: 'new', id: crypto.randomUUID() });
              setNotice('');
              setArchived(false);
              composer.current?.focus();
            }}
          >
            <ChatNavIcon name="compose" width={16} height={16} />
            New chat
          </button>
        </div>
        <nav className={styles.history} aria-label="Conversation history">
          {(archived ? ['Archived chats'] : ['Pinned', 'Today', 'Yesterday', 'Older']).map(
            (group) => {
              const entries = visible.filter(
                (item) =>
                  archived ||
                  (group === 'Pinned' ? item.pinned : !item.pinned && item.group === group),
              );
              return (
                entries.length > 0 && (
                  <section key={group} aria-label={group}>
                    <h3>
                      <button
                        type="button"
                        aria-expanded={!collapsed[group]}
                        onClick={() =>
                          setCollapsed((previous) => ({ ...previous, [group]: !previous[group] }))
                        }
                      >
                        {group}
                        <ChatNavIcon
                          name="chevron"
                          width={14}
                          height={14}
                          className={collapsed[group] ? styles.collapsedChevron : undefined}
                        />
                      </button>
                    </h3>
                    {!collapsed[group] &&
                      entries.map((item) => (
                        <ChatHistoryRow
                          key={item.id}
                          item={{
                            ...item,
                            generating:
                              (item.generating ??
                                item.messages.some((message) =>
                                  ['queued', 'running', 'cancelling'].includes(message.state ?? ''),
                                )) ||
                              (item.id === chat.selectedId && Boolean(live?.busy)),
                          }}
                          selected={item.id === chat.selectedId}
                          disabled={removing || Boolean(live && !live.remove)}
                          onPin={() => dispatch({ type: 'pin', id: item.id, value: !item.pinned })}
                          onArchive={() =>
                            dispatch({ type: 'archive', id: item.id, value: !item.archived })
                          }
                          onDelete={() => setDeleteTarget({ id: item.id, title: item.title })}
                          onSelect={() => {
                            selectConversation(item.id, Boolean(item.archived));
                            setNotice('');
                          }}
                        />
                      ))}
                  </section>
                )
              );
            },
          )}
          {!visible.length && (
            <p className={styles.emptyHistory}>
              {archived ? 'No archived chats' : 'No matching conversations'}
            </p>
          )}
        </nav>
        <div className={styles.historyFooter}>
          <button
            type="button"
            aria-pressed={archived}
            onClick={() => {
              setArchived(!archived);
            }}
          >
            <ChatNavIcon name="archive" width={16} height={16} />
            {archived ? 'Back to chats' : 'Archived chats'}
          </button>
        </div>
      </aside>
      <div className={styles.conversation}>
        <header className={styles.header}>
          <h1>{conversation?.title ?? 'New chat'}</h1>
        </header>
        <div className={styles.chatBody}>
          <div
            ref={transcript}
            className={styles.messages}
            aria-label="Messages"
            role="region"
            onScroll={(event) => {
              const node = event.currentTarget;
              following.current = node.scrollHeight - node.scrollTop - node.clientHeight < 64;
            }}
          >
            <div className={styles.messageColumn}>
              {!conversation?.messages.length && (
                <p className={styles.emptyChat}>What would you like to discuss?</p>
              )}
              {conversation?.messages.map((message, index) => (
                <article
                  key={message.id}
                  aria-label={`${message.role === 'user' ? 'Your message' : 'Assistant response'} ${index + 1}`}
                  className={`${styles.message} ${message.role === 'user' ? styles.user : ''}`}
                >
                  {message.reasoning && (
                    <details className={styles.thinking}>
                      <summary>
                        <span>{thinkingLabel(message)}</span>
                        <ChevronRight
                          className={styles.thinkingChevron}
                          size={16}
                          aria-hidden="true"
                        />
                      </summary>
                      <ChatMarkdown text={message.reasoning} />
                    </details>
                  )}
                  {message.text &&
                    (message.role === 'assistant' ? (
                      <ChatMarkdown text={message.text} />
                    ) : (
                      <p>{message.text}</p>
                    ))}
                  {message.state && message.state !== 'completed' && (
                    <p role="status">
                      {(
                        {
                          queued: 'Waiting…',
                          running: 'Generating…',
                          cancelling: 'Stopping…',
                          completed: 'Complete',
                          'limit-reached': 'Output limit reached',
                          cancelled: 'Stopped',
                          interrupted: 'Interrupted',
                          failed: 'Response failed',
                        } as Record<string, string>
                      )[message.state] ?? 'Unavailable'}
                    </p>
                  )}
                  {message.role === 'assistant' && (
                    <div className={styles.responseActions}>
                      <button
                        type="button"
                        className={styles.icon}
                        aria-label={`Copy response ${index + 1}`}
                        title="Copy response"
                        onClick={() => {
                          void copy(message.text);
                        }}
                      >
                        <Copy size={16} aria-hidden="true" />
                      </button>
                      {live &&
                        message.attemptId &&
                        !['queued', 'running', 'cancelling'].includes(message.state ?? '') && (
                          <button
                            type="button"
                            className={styles.icon}
                            aria-label={`Retry response ${index + 1}`}
                            title="Retry response"
                            disabled={!live.ready || live.busy}
                            onClick={() => {
                              setNotice('');
                              live.retry(message.attemptId!);
                            }}
                          >
                            <RotateCcw size={16} aria-hidden="true" />
                          </button>
                        )}
                      {message.speeds && (
                        <span className={styles.speeds}>
                          {message.speeds.generatedTokens !== undefined && (
                            <span>
                              {message.speeds.generatedTokens}{' '}
                              {message.speeds.generatedTokens === 1 ? 'token' : 'tokens'}
                            </span>
                          )}
                          {message.speeds.generation !== null && (
                            <span>Generation: {message.speeds.generation.toFixed(2)} tok/s</span>
                          )}
                          {message.speeds.prefill !== null && (
                            <span>
                              Prompt processing: {message.speeds.prefill.toFixed(2)} tok/s
                            </span>
                          )}
                          {message.speeds.acceptance !== undefined && (
                            <span title="Percentage of proposed tokens accepted by the target model.">
                              Acceptance rate:{' '}
                              {message.speeds.acceptance === null
                                ? '—'
                                : `${(message.speeds.acceptance * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`}
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </div>
          <div className={styles.composerColumn}>
            <div className={styles.composer}>
              <ChatComposerInput
                conversationId={chat.selectedId}
                ref={composer}
                aria-label="Message"
                placeholder="Message..."
                value={conversation?.draft ?? live?.draft ?? ''}
                maxLength={12000}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing &&
                    live?.ready &&
                    !live.busy &&
                    conversation?.draft.trim()
                  ) {
                    event.preventDefault();
                    setNotice('');
                    live.send();
                  }
                }}
                onChange={(event) => dispatch({ type: 'draft', text: event.target.value })}
              />
              <div className={styles.composerActions}>
                <button
                  type="button"
                  className={styles.icon}
                  aria-label="Attachments unavailable"
                  title="Attachments are not available yet"
                  disabled
                >
                  <Plus size={16} aria-hidden="true" />
                </button>
                <span className={styles.spacer} />
                <div
                  ref={model}
                  className={styles.modelWrapper}
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) setModelOpen(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      setModelOpen(false);
                      modelButton.current?.focus();
                    }
                  }}
                >
                  <button
                    ref={modelButton}
                    type="button"
                    className={styles.model}
                    aria-label={`Chat model: ${activeModel?.name ?? 'No active model'}`}
                    title={activeModel?.name ?? 'No active model'}
                    aria-expanded={modelOpen}
                    onClick={() => setModelOpen(!modelOpen)}
                  >
                    <span>{activeModel?.name ?? 'No active model'}</span>
                    <ChevronDown size={14} aria-hidden="true" />
                  </button>
                  {modelOpen && (
                    <div className={styles.modelMenu}>
                      <p>
                        {activeModel
                          ? `${demo ? 'Active demo model' : 'Active model'}: ${activeModel.name}`
                          : 'No model is active.'}
                      </p>
                      <button type="button" onClick={onCluster}>
                        Choose model in Cluster
                      </button>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className={`${styles.icon} ${styles.send}`}
                  aria-label={live?.busy ? 'Stop response' : 'Send message'}
                  title={
                    !live
                      ? 'Sending is not available yet'
                      : live.busy
                        ? 'Stop response'
                        : live?.ready
                          ? 'Send message'
                          : 'Load a model to send a message'
                  }
                  disabled={!live || (!live.busy && (!live.ready || !conversation?.draft.trim()))}
                  onClick={() => {
                    setNotice('');
                    if (live?.busy) live.stop();
                    else live?.send();
                  }}
                >
                  {live?.busy ? (
                    <Square size={16} aria-hidden="true" />
                  ) : (
                    <ArrowUp size={16} aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>
            <p role="status" className={styles.notice}>
              {notice ||
                (live?.notice === 'Saved on this device'
                  ? ''
                  : live?.notice ||
                    (demo
                      ? 'Sample conversations · This app session only'
                      : 'Sending is not available yet'))}
            </p>
          </div>
        </div>
      </div>
      {deleteTarget && (
        <Dialog title="Delete chat?" onClose={() => setDeleteTarget(null)}>
          <p>
            Delete <strong>{deleteTarget.title}</strong>?
          </p>
          <p>
            This deletes its messages and draft and cannot be undone. Any active response will stop
            first.
          </p>
          <footer>
            <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                const target = deleteTarget;
                setDeleteTarget(null);
                setRemoving(true);
                setNotice('Deleting chat…');
                void (async () => {
                  try {
                    if (live) {
                      const removed = await live.remove?.(target.id);
                      setNotice(removed ? 'Chat deleted.' : '');
                      if (removed && chat.selectedId === target.id) composer.current?.focus();
                    } else {
                      dispatch({ type: 'delete', id: target.id });
                      if (chat.selectedId === target.id)
                        dispatch({ type: 'new', id: crypto.randomUUID() });
                      setNotice('Chat deleted.');
                      composer.current?.focus();
                    }
                  } catch {
                    setNotice('Could not delete the chat. Your chat is retained.');
                  } finally {
                    setRemoving(false);
                  }
                })();
              }}
            >
              Delete
            </Button>
          </footer>
        </Dialog>
      )}
      {searchOpen && (
        <ChatSearchDialog
          conversations={chat.conversations}
          search={live?.search}
          matches={live?.matches}
          onClose={() => setSearchOpen(false)}
          onSelect={(item) => {
            selectConversation(item.id, Boolean(item.archived));
            const group = item.archived ? 'Archived chats' : item.pinned ? 'Pinned' : item.group;
            setCollapsed((previous) => ({ ...previous, [group]: false }));
            setNotice('');
            setSearchOpen(false);
          }}
        />
      )}
    </section>
  );
}
