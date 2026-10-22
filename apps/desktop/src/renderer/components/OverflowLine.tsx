import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import styles from './OverflowLine.module.css';

/** Fades and reveals only this line's measured overflow, without wrapping or moving adjacent text. */
export function OverflowLine({ text, focusable = false }: { text: string; focusable?: boolean }) {
  const viewport = useRef<HTMLSpanElement>(null);
  const content = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);
  useEffect(() => {
    const measure = () =>
      setOverflow(
        Math.max(0, (content.current?.scrollWidth ?? 0) - (viewport.current?.clientWidth ?? 0)),
      );
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    if (viewport.current) observer.observe(viewport.current);
    if (content.current) observer.observe(content.current);
    return () => observer.disconnect();
  }, [text]);
  return (
    <span
      ref={viewport}
      className={styles.viewport}
      title={text}
      data-overflow={overflow > 0 ? 'true' : undefined}
      tabIndex={focusable && overflow > 0 ? 0 : undefined}
      style={
        {
          '--line-scroll': `${-overflow}px`,
          '--line-duration': `${Math.max(4, overflow / 30)}s`,
        } as CSSProperties
      }
    >
      <span ref={content} className={styles.content}>
        {text}
      </span>
    </span>
  );
}
