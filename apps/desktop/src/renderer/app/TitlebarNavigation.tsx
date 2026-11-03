import { useEffect, useState } from 'react';
import { Tooltip } from '@openai/apps-sdk-ui/components/Tooltip';
import { ChatGptHistoryIcon } from '../components/ChatGptHistoryIcon';
import '../features/cluster/cluster-sdk-tokens.css';
import styles from './TitlebarNavigation.module.css';

export interface TitlebarHistory {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
}

/** Codex Windows title-bar geometry; these controls never enter the drag region. */
export function TitlebarNavigation({
  canGoBack,
  canGoForward,
  onBack,
  onForward,
}: TitlebarHistory) {
  const [tooltip, setTooltip] = useState<string | null>(null);
  useEffect(() => {
    const blocked = () =>
      document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]') !== null;
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        event.altKey ||
        event.shiftKey ||
        blocked()
      )
        return;
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key !== '[' && event.key !== ']') return;
      event.preventDefault();
      if (event.key === '[' && canGoBack) onBack();
      if (event.key === ']' && canGoForward) onForward();
    };
    const mouseup = (event: MouseEvent) => {
      if (event.defaultPrevented || blocked() || ![3, 4].includes(event.button)) return;
      event.preventDefault();
      if (event.button === 3 && canGoBack) onBack();
      if (event.button === 4 && canGoForward) onForward();
    };
    const auxclick = (event: MouseEvent) => {
      if ([3, 4].includes(event.button)) event.preventDefault();
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('mouseup', mouseup, true);
    window.addEventListener('auxclick', auxclick, true);
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('mouseup', mouseup, true);
      window.removeEventListener('auxclick', auxclick, true);
    };
  }, [canGoBack, canGoForward, onBack, onForward]);
  return (
    <nav className={styles.history} aria-label="Navigation history">
      {(
        [
          { label: 'Back', shortcut: 'Ctrl+[', disabled: !canGoBack, onClick: onBack },
          { label: 'Forward', shortcut: 'Ctrl+]', disabled: !canGoForward, onClick: onForward },
        ] as const
      ).map(({ label, shortcut, disabled, onClick }) => (
        <Tooltip.Root
          key={label}
          delayDuration={300}
          open={tooltip === label}
          onOpenChange={(open) => setTooltip(open ? label : null)}
        >
          <Tooltip.Trigger>
            <span className={styles.trigger}>
              <button
                type="button"
                aria-label={label}
                aria-keyshortcuts={label === 'Back' ? 'Control+[' : 'Control+]'}
                disabled={disabled}
                onClick={onClick}
              >
                <ChatGptHistoryIcon kind="undo" />
              </button>
            </span>
          </Tooltip.Trigger>
          <Tooltip.Content
            side="bottom"
            data-cluster-sdk=""
            data-theme="dark"
            className={styles.tooltip}
          >
            {label} <kbd>{shortcut}</kbd>
          </Tooltip.Content>
        </Tooltip.Root>
      ))}
    </nav>
  );
}
