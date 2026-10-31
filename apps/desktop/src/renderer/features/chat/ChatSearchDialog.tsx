import { useEffect, useId, useRef, useState } from 'react';
import { ChatNavIcon } from '../../components/ChatNavIcon';
import { OverflowLine } from '../../components/OverflowLine';
import type { DemoConversation } from '../../mocks/chat';
import styles from './ChatSearchDialog.module.css';

/** Search is read-only until a result is explicitly opened; native modality contains focus. */
export function ChatSearchDialog({
  conversations,
  matches,
  search,
  onSelect,
  onClose,
}: {
  conversations: readonly DemoConversation[];
  matches?: readonly string[] | undefined;
  search?: ((query: string) => void) | undefined;
  onSelect: (conversation: DemoConversation) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    input = useRef<HTMLInputElement>(null),
    list = useRef<HTMLDivElement>(null);
  const id = useId();
  const [query, setQuery] = useState(''),
    [activeId, setActiveId] = useState<string>();
  const normalized = query.trim().toLowerCase();
  const entries = conversations.filter(
    (item) =>
      !normalized ||
      (search
        ? matches?.includes(item.id)
        : (item.title + ' ' + item.messages.map((message) => message.text).join(' '))
            .toLowerCase()
            .includes(normalized)),
  );
  const activeIndex = Math.max(
    0,
    entries.findIndex((item) => item.id === activeId),
  );
  const selected = entries[activeIndex];
  const searching = Boolean(normalized && search && matches === undefined);
  useEffect(() => {
    const current = dialog.current;
    if (!current) return;
    const trigger = document.activeElement;
    if (typeof current.showModal === 'function') current.showModal();
    else current.setAttribute('open', '');
    input.current?.focus();
    return () => {
      if (typeof current.close === 'function') current.close();
      if (trigger instanceof HTMLElement)
        queueMicrotask(() => {
          if (trigger.isConnected) trigger.focus();
        });
    };
  }, []);
  useEffect(() => {
    search?.(query);
  }, [query, search]);
  useEffect(() => () => search?.(''), [search]);
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [selected?.id]);
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-label="Search chats"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          onClose();
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Tab') {
          const controls = [
            ...event.currentTarget.querySelectorAll<HTMLElement>('input, button:not(:disabled)'),
          ];
          const first = controls[0],
            last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
          return;
        }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && entries.length) {
          event.preventDefault();
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? entries.length - 1
                : (activeIndex + (event.key === 'ArrowUp' ? -1 : 1) + entries.length) %
                  entries.length;
          setActiveId(entries[next]!.id);
        }
        if (event.key === 'Enter' && selected) {
          event.preventDefault();
          onSelect(selected);
        }
      }}
    >
      <div className={styles.content}>
        <div className={styles.inputRow}>
          <input
            ref={input}
            type="search"
            aria-label="Search chats"
            placeholder="Search chats"
            autoComplete="off"
            spellCheck={false}
            aria-controls={id}
            aria-activedescendant={selected ? id + '-' + activeIndex : undefined}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveId(undefined);
            }}
          />
        </div>
        <h2 className={styles.heading}>Chats</h2>
        <div
          ref={list}
          id={id}
          role="listbox"
          aria-label="Chats"
          aria-busy={searching}
          className={styles.results}
        >
          {entries.map((item, index) => (
            <button
              key={item.id}
              id={id + '-' + index}
              type="button"
              role="option"
              aria-label={item.title}
              aria-selected={index === activeIndex}
              className={styles.result}
              onMouseMove={() => setActiveId(item.id)}
              onFocus={() => setActiveId(item.id)}
              onClick={() => onSelect(item)}
            >
              <ChatNavIcon name="chat" width={16} height={16} />
              <OverflowLine text={item.title} />
            </button>
          ))}
        </div>
        {!entries.length && (
          <p className={styles.empty} role="status">
            {searching ? 'Searching…' : normalized ? 'No matching chats' : 'No chats yet'}
          </p>
        )}
      </div>
    </dialog>
  );
}
