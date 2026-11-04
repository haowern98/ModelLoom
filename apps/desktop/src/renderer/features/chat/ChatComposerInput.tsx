import { useEffect, useState } from 'react';
import type { ComponentProps, RefObject } from 'react';
import { ChatNavIcon } from '../../components/ChatNavIcon';
import styles from './ChatComposerInput.module.css';

/** Content-sized editor with the inspected Codex multiline expansion affordance. */
export function ChatComposerInput({
  ref,
  conversationId,
  value,
  onKeyDown,
  ...props
}: ComponentProps<'textarea'> & {
  ref: RefObject<HTMLTextAreaElement | null>;
  conversationId: string;
}) {
  const [expansion, setExpansion] = useState({ conversationId, expanded: false });
  const expanded = expansion.conversationId === conversationId && expansion.expanded;
  const [tall, setTall] = useState(false);
  const expandable = expanded || tall || String(value ?? '').includes('\n');

  // Reset the mode without remounting the textarea while a new chat is being saved.
  if (expansion.conversationId !== conversationId) {
    setExpansion({ conversationId, expanded: false });
  }

  useEffect(() => {
    const input = ref.current;
    if (!input || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      setTall(input.scrollHeight >= Number.parseFloat(getComputedStyle(input).lineHeight) * 5);
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, [ref]);

  return (
    <div className={styles.input} data-expanded={expanded} data-expandable={expandable}>
      <textarea
        {...props}
        ref={ref}
        value={value}
        onKeyDown={(event) => {
          if (expanded && !event.ctrlKey && !event.metaKey) return;
          onKeyDown?.(event);
        }}
      />
      {expandable && (
        <button
          type="button"
          className={styles.expand}
          aria-label={expanded ? 'Collapse message editor' : 'Expand message editor'}
          aria-pressed={expanded}
          title={expanded ? 'Collapse' : 'Expand'}
          onClick={() => {
            setExpansion({ conversationId, expanded: !expanded });
            ref.current?.focus();
          }}
        >
          <ChatNavIcon name={expanded ? 'collapse' : 'expand'} width={20} height={20} />
        </button>
      )}
    </div>
  );
}
