import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { OverflowLine } from '../../components/OverflowLine';
import { ChatNavIcon } from '../../components/ChatNavIcon';
import { ChatGptTrashIcon } from '../../components/ChatGptTrashIcon';
import { useDropdownPosition } from '../../components/useDropdownPosition';
import type { DemoConversation } from '../../mocks/chat';
import styles from './ChatHistoryRow.module.css';

/** Independent row actions leave selection and any background response intact. */
export function ChatHistoryRow({
  item,
  selected,
  disabled,
  onSelect,
  onPin,
  onArchive,
  onDelete,
}: {
  item: DemoConversation;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onPin: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const position = useDropdownPosition(open, trigger, menu, item.messages);
  const generating =
    item.generating ??
    item.messages.some((message) =>
      ['queued', 'running', 'cancelling'].includes(message.state ?? ''),
    );
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (open && position.visibility !== 'hidden')
      menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [open, position.visibility]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menu.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const actions = [
    {
      label: item.pinned ? 'Unpin' : 'Pin',
      icon: item.pinned ? ('unpin' as const) : ('pin' as const),
      run: onPin,
    },
    { label: item.archived ? 'Unarchive' : 'Archive', icon: 'archive' as const, run: onArchive },
    { label: 'Delete chat', icon: null, run: onDelete },
  ];
  return (
    <div
      className={styles.row}
      data-conversation-id={item.id}
      data-selected={selected || undefined}
      data-menu-open={open || undefined}
    >
      <button
        className={styles.select}
        type="button"
        title={item.title}
        aria-current={selected ? 'true' : undefined}
        onClick={onSelect}
      >
        <OverflowLine text={item.title} />
      </button>
      <div className={styles.indicator}>
        {generating ? (
          <span className={styles.spinner} role="img" aria-label={`Generating: ${item.title}`} />
        ) : item.pinned ? (
          <ChatNavIcon name="pin" width={16} height={16} />
        ) : null}
      </div>
      <div className={styles.actions}>
        <button
          ref={trigger}
          type="button"
          aria-label={`Chat actions: ${item.title}`}
          title="Chat actions"
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => setOpen(!open)}
        >
          <ChatNavIcon name="more" width={16} height={16} />
        </button>
        <button
          type="button"
          aria-label={`${item.pinned ? 'Unpin' : 'Pin'} chat: ${item.title}`}
          title={item.pinned ? 'Unpin chat' : 'Pin chat'}
          disabled={disabled}
          onClick={onPin}
        >
          <ChatNavIcon name={item.pinned ? 'unpin' : 'pin'} width={16} height={16} />
        </button>
        <button
          type="button"
          aria-label={`${item.archived ? 'Unarchive' : 'Archive'} chat: ${item.title}`}
          title={item.archived ? 'Unarchive chat' : 'Archive chat'}
          disabled={disabled}
          onClick={onArchive}
        >
          <ChatNavIcon name="archive" width={16} height={16} />
        </button>
      </div>
      {open &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            aria-label={`Chat actions: ${item.title}`}
            className={styles.menu}
            style={position}
            onBlur={(event) => {
              if (
                !event.currentTarget.contains(event.relatedTarget) &&
                event.relatedTarget !== trigger.current
              )
                setOpen(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close();
              }
              if (event.key === 'Tab') {
                setOpen(false);
                trigger.current?.focus();
              }
              if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const items = [
                  ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
                ];
                const current = items.findIndex((item) => item === document.activeElement);
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? items.length - 1
                      : (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) %
                        items.length;
                items[next]?.focus();
              }
            }}
          >
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                role="menuitem"
                disabled={disabled}
                onClick={() => {
                  close();
                  action.run();
                }}
              >
                {action.icon ? (
                  <ChatNavIcon name={action.icon} width={16} height={16} />
                ) : (
                  <ChatGptTrashIcon />
                )}
                {action.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
