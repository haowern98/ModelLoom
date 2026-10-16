import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { ChatGptTrashIcon } from './ChatGptTrashIcon';
import styles from './SidebarItemRow.module.css';

/** Independent selection/delete controls; measured overflow scrolls only on hover or focus. */
export function SidebarItemRow({
  id,
  title,
  selected,
  disabled,
  onSelect,
  onDelete,
  kind = 'chat',
}: {
  id: string;
  title: string;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onDelete: () => void;
  kind?: 'chat' | 'configuration';
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
      data-conversation-id={kind === 'chat' ? id : undefined}
      data-configuration-id={kind === 'configuration' ? id : undefined}
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
        data-sidebar-row-button
        title={title}
        aria-current={kind === 'chat' && selected ? 'true' : undefined}
        aria-pressed={kind === 'configuration' ? selected : undefined}
        onClick={onSelect}
      >
        <span
          ref={viewport}
          className={styles.titleViewport}
          data-sidebar-title
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
        data-sidebar-row-button
        aria-label={`Delete ${kind}: ${title}`}
        title={`Delete ${kind}`}
        disabled={disabled}
        onClick={onDelete}
      >
        <ChatGptTrashIcon />
      </button>
    </div>
  );
}
