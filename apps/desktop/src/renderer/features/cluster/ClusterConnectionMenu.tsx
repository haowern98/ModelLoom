import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, LogIn, Monitor, Plus } from 'lucide-react';
import { connectionLabels } from '../../mocks/clusterJoining';
import type { ConnectionAction } from '../../mocks/clusterJoining';
import styles from './ClusterPage.module.css';

const actions = ['add', 'join', 'share'] as const;
const icons = { add: Plus, join: LogIn, share: Monitor };

/** One fixed-label trigger opens all three connection panel contexts. */
export function ClusterConnectionMenu({
  onChoose,
}: {
  onChoose: (action: ConnectionAction) => void;
}) {
  const [action, setAction] = useState<ConnectionAction>('add');
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    anchor.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !anchor.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  return (
    <div
      ref={anchor}
      className={styles.connectionMenu}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Tab' && open) {
          setOpen(false);
          trigger.current?.focus();
        }
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          if (!open) {
            setOpen(true);
            return;
          }
          const items = [
            ...(anchor.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
          ];
          const current = items.findIndex((item) => item === document.activeElement);
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? items.length - 1
                : (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
          items[next]?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className={styles.addDevice}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
      >
        Add
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Connection actions"
          className={styles.connectionOptions}
        >
          {actions.map((next) => {
            const ActionIcon = icons[next];
            return (
              <button
                key={next}
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-current={next === action ? 'true' : undefined}
                onClick={() => {
                  setOpen(false);
                  setAction(next);
                  trigger.current?.focus();
                  onChoose(next);
                }}
              >
                <ActionIcon size={16} aria-hidden="true" />
                {connectionLabels[next]}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
