import { useEffect, useRef, useState } from 'react';
import type { Dispatch } from 'react';
import {
  ArrowUp,
  Square,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  Brain,
  Copy,
  Plus,
  Search,
  SquarePen,
} from 'lucide-react';
import { SearchField } from '../../components/SearchField';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { ConversationRow } from './ConversationRow';
import { copyText } from '../../components/copyText';
import type { ChatAction, ChatMessage, DemoChat } from '../../mocks/chat';
import type { DemoModel } from '../../mocks/modelLibrary';
import styles from './ChatPage.module.css';

interface ChatPageProps {
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

/** Safe, local conversation presentation; model text is rendered as text, never HTML. */
export function ChatPage({ demo, chat, dispatch, activeModel, onCluster, live }: ChatPageProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [modelOpen, setModelOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [previousLiveNotice, setPreviousLiveNotice] = useState(live?.notice);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [removing, setRemoving] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const previousConversation = useRef(chat.selectedId);
  const search = useRef<HTMLDivElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const model = useRef<HTMLDivElement>(null);
  const modelButton = useRef<HTMLButtonElement>(null);
  const conversation = chat.conversations.find((item) => item.id === chat.selectedId);
  const lastMessage = conversation?.messages[conversation.messages.length - 1];
  const searchChats = live?.search;
  const visible = chat.conversations.filter((item) =>
    live?.search && query.trim()
      ? live.matches?.includes(item.id)
      : `${item.title} ${item.messages.map((message) => message.text).join(' ')}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
  );

  // Copy/Delete feedback belongs to the current live status, never a later operation.
  if (previousLiveNotice !== live?.notice) {
    setPreviousLiveNotice(live?.notice);
    setNotice('');
  }

  useEffect(() => {
    if (searchOpen) search.current?.querySelector('input')?.focus();
  }, [searchOpen]);
  useEffect(() => {
    searchChats?.(query);
  }, [query, searchChats]);

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
      <aside className={styles.sidebar} aria-label="Conversations">
        <div className={styles.sidebarHeader}>
          <button
            type="button"
            className={styles.newChat}
            onClick={() => {
              dispatch({ type: 'new', id: crypto.randomUUID() });
              setQuery('');
              setNotice('');
              composer.current?.focus();
            }}
          >
            <SquarePen size={16} aria-hidden="true" />
            New chat
          </button>
          <button
            ref={searchButton}
            type="button"
            className={styles.icon}
            aria-label="Search conversations"
            title="Search conversations"
            aria-expanded={searchOpen}
            onClick={() => {
              setSearchOpen(!searchOpen);
              setQuery('');
            }}
          >
            <Search size={16} aria-hidden="true" />
          </button>
        </div>
        {searchOpen && (
          <div
            ref={search}
            className={styles.search}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setSearchOpen(false);
                setQuery('');
                searchButton.current?.focus();
              }
            }}
          >
            <SearchField label="Search chats" value={query} onChange={setQuery} />
          </div>
        )}
        <nav className={styles.history} aria-label="Conversation history">
          {(['Today', 'Yesterday', 'Older'] as const).map((group) => {
            const entries = visible.filter((item) => item.group === group);
            return (
              entries.length > 0 && (
                <section key={group} aria-label={group}>
                  <h2>{group}</h2>
                  {entries.map((item) => (
                    <ConversationRow
                      key={item.id}
                      id={item.id}
                      title={item.title}
                      selected={item.id === chat.selectedId}
                      disabled={removing || Boolean(live && !live.remove)}
                      onDelete={() => setDeleteTarget({ id: item.id, title: item.title })}
                      onSelect={() => {
                        dispatch({ type: 'select', id: item.id });
                        setNotice('');
                      }}
                    />
                  ))}
                </section>
              )
            );
          })}
          {!visible.length && (
            <p className={styles.emptyHistory}>
              {live?.search && query.trim() && live.matches === undefined
                ? 'Searching…'
                : 'No matching conversations'}
            </p>
          )}
        </nav>
      </aside>
      <div className={styles.conversation}>
        <header className={styles.header}>
          <h1>{conversation?.title ?? 'New chat'}</h1>
        </header>
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
                      <Brain size={16} aria-hidden="true" />
                      <span>{thinkingLabel(message)}</span>
                      <ChevronRight
                        className={styles.thinkingChevron}
                        size={16}
                        aria-hidden="true"
                      />
                    </summary>
                    <p>{message.reasoning}</p>
                  </details>
                )}
                {message.text && <p>{message.text}</p>}
                {message.state && (
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
                        {message.speeds.generation !== null && (
                          <span>
                            Generation:{' '}
                            {message.speeds.generation.toLocaleString('en-US', {
                              maximumFractionDigits: 1,
                            })}{' '}
                            tok/s
                          </span>
                        )}
                        {message.speeds.prefill !== null && (
                          <span>
                            Prompt processing:{' '}
                            {message.speeds.prefill.toLocaleString('en-US', {
                              maximumFractionDigits: 1,
                            })}{' '}
                            tok/s
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
            <textarea
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
              live?.notice ||
              (demo
                ? 'Sample conversations · This app session only'
                : 'Sending is not available yet')}
          </p>
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
    </section>
  );
}
