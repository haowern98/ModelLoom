import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import styles from './Dialog.module.css';

/** Native modal: browser focus containment, Escape cancellation and focus restoration. */
export function Dialog({
  title,
  onClose,
  children,
  initialFocus,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  initialFocus?: 'cancel';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const trigger = document.activeElement;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    if (initialFocus === 'cancel')
      dialog.querySelector<HTMLElement>('[data-dialog-cancel]')?.focus();
    return () => {
      if (typeof dialog.close === 'function') dialog.close();
      // React may remove the dialog before passive cleanup; restore the live trigger afterwards.
      if (trigger instanceof HTMLElement)
        queueMicrotask(() => {
          if (trigger.isConnected) trigger.focus();
        });
    };
  }, [initialFocus]);
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2 id={id}>{title}</h2>
        <button type="button" aria-label="Close dialog" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className={styles.body}>{children}</div>
    </dialog>
  );
}
