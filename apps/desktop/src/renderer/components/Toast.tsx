import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { CircleCheck, CircleAlert, Info, X } from 'lucide-react';
import styles from './Toast.module.css';

export interface ToastMessage {
  id: number;
  kind: 'success' | 'error' | 'information';
  message: string;
  origin: HTMLElement | null;
}

/** Mount with a new key for each event; hover and keyboard focus pause its remaining lifetime. */
export function Toast({
  notification,
  fallbackRef,
  onDismiss,
}: {
  notification: ToastMessage;
  fallbackRef: RefObject<HTMLButtonElement | null>;
  onDismiss: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const remaining = useRef(5000);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const dismiss = useCallback(() => {
    const restore = root.current?.contains(document.activeElement);
    onDismiss();
    if (restore) {
      queueMicrotask(() => {
        const origin = notification.origin;
        if (origin?.isConnected) origin.focus();
        else fallbackRef.current?.focus();
      });
    }
  }, [notification.origin, fallbackRef, onDismiss]);
  useEffect(() => {
    if (hovered || focused) return;
    const started = Date.now();
    const timer = window.setTimeout(dismiss, remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [hovered, focused, dismiss]);
  const Icon =
    notification.kind === 'success'
      ? CircleCheck
      : notification.kind === 'error'
        ? CircleAlert
        : Info;
  return (
    <div
      ref={root}
      className={`${styles.toast} ${styles[notification.kind]}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <Icon size={20} aria-hidden="true" />
      <span role={notification.kind === 'error' ? 'alert' : 'status'} aria-atomic="true">
        {notification.message}
      </span>
      <button
        type="button"
        className={styles.close}
        aria-label="Dismiss notification"
        onClick={dismiss}
      >
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  );
}
