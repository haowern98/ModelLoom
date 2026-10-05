import { useEffect, useRef, useState } from 'react';
import type { Dispatch } from 'react';
import {
  ArrowUp,
  ChevronDown,
  Copy,
  Plus,
  Search,
  SquarePen,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import { SearchField } from '../../components/SearchField';
import { copyText } from '../../components/copyText';
import type { ChatAction, DemoChat } from '../../mocks/chat';
import type { DemoModel } from '../../mocks/modelLibrary';
import styles from './ChatPage.module.css';

interface ChatPageProps {
  demo: boolean;
  chat: DemoChat;
  dispatch: Dispatch<ChatAction>;
  activeModel: DemoModel | undefined;
  onCluster: () => void;
}

/** Safe, local conversation presentation; model text is rendered as text, never HTML. */
export function ChatPage({ demo, chat, dispatch, activeModel, onCluster }: ChatPageProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [modelOpen, setModelOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const composer = useRef<HTMLTextAreaElement>(null);
  const search = useRef<HTMLDivElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const model = useRef<HTMLDivElement>(null);
  const modelButton = useRef<HTMLButtonElement>(null);
  const conversation = chat.conversations.find((item) => item.id === chat.selectedId);
  const visible = chat.conversations.filter((item) =>
    `${item.title} ${item.messages.map((message) => message.text).join(' ')}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );

  useEffect(() => {
    if (searchOpen) search.current?.querySelector('input')?.focus();
  }, [searchOpen]);

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
          {(['Today', 'Yesterday'] as const).map((group) => {
            const entries = visible.filter((item) => item.group === group);
            return (
              entries.length > 0 && (
                <section key={group} aria-label={group}>
                  <h2>{group}</h2>
                  {entries.map((item) => (
                    <button
                      type="button"
                      className={styles.conversationButton}
                      key={item.id}
                      title={item.title}
                      aria-current={item.id === chat.selectedId ? 'true' : undefined}
                      onClick={() => {
                        dispatch({ type: 'select', id: item.id });
                        setNotice('');
                      }}
                    >
                      {item.title}
                    </button>
                  ))}
                </section>
              )
            );
          })}
          {!visible.length && <p className={styles.emptyHistory}>No matching conversations</p>}
        </nav>
      </aside>
      <div className={styles.conversation}>
        <header className={styles.header}>
          <h1>{conversation?.title ?? 'New chat'}</h1>
        </header>
        <div className={styles.messages} aria-label="Messages" role="region">
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
                <p>{message.text}</p>
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
                    {(['up', 'down'] as const).map((value) => (
                      <button
                        type="button"
                        className={styles.icon}
                        key={value}
                        aria-label={`${value === 'up' ? 'Good' : 'Bad'} response ${index + 1}`}
                        title={value === 'up' ? 'Good response' : 'Bad response'}
                        aria-pressed={message.feedback === value}
                        onClick={() => dispatch({ type: 'feedback', messageId: message.id, value })}
                      >
                        {value === 'up' ? (
                          <ThumbsUp size={16} aria-hidden="true" />
                        ) : (
                          <ThumbsDown size={16} aria-hidden="true" />
                        )}
                      </button>
                    ))}
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
              value={conversation?.draft ?? ''}
              maxLength={12000}
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
                aria-label="Send message"
                title="Sending is not available yet"
                disabled
              >
                <ArrowUp size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
          <p role="status" className={styles.notice}>
            {notice ||
              (demo
                ? 'Sample conversations · This app session only'
                : 'Sending is not available yet')}
          </p>
        </div>
      </div>
    </section>
  );
}
