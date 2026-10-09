import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Trash2 } from 'lucide-react';
import styles from './ChatPage.module.css';

/** Independent selection/delete controls; measured overflow scrolls only on hover or focus. */
export function ConversationRow({
  id,
  title,
  selected,
  disabled,
  onSelect,
  onDelete,
}: {
  id: string;
  title: string;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const viewport = useRef<HTMLSpanElement>(null),
    text = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);
  useEffect(() => {
    const measure = () =>
      setOverflow(
        Math.max(0, (text.current?.scrollWidth ?? 0) - (viewport.current?.clientWidth ?? 0)),
      );
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    if (viewport.current) observer.observe(viewport.current);
    if (text.current) observer.observe(text.current);
    return () => observer.disconnect();
  }, [title]);
  return (
    <div
      className={`${styles.conversationRow} ${selected ? styles.selectedRow : ''}`}
      data-conversation-id={id}
      style={
        {
          '--title-scroll': `${-overflow}px`,
          '--title-duration': `${Math.max(4, overflow / 30)}s`,
        } as CSSProperties
      }
    >
      <button
        type="button"
        className={styles.conversationButton}
        title={title}
        aria-current={selected ? 'true' : undefined}
        onClick={onSelect}
      >
        <span
          ref={viewport}
          className={styles.titleViewport}
          data-overflow={overflow > 0 ? 'true' : undefined}
        >
          <span ref={text} className={styles.titleText}>
            {title}
          </span>
        </span>
      </button>
      <button
        type="button"
        className={`${styles.icon} ${styles.deleteChat}`}
        aria-label={`Delete chat: ${title}`}
        title="Delete chat"
        disabled={disabled}
        onClick={onDelete}
      >
        <Trash2 size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
