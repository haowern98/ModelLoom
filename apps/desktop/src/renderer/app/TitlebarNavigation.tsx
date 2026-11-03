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

interface SidebarToggle {
  expanded: boolean;
  controls: string;
  toggle: () => void;
}

/** Codex Windows title-bar geometry; these controls never enter the drag region. */
export function TitlebarNavigation({
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  sidebar,
}: TitlebarHistory & { sidebar?: SidebarToggle | undefined }) {
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
      {sidebar && (
        <Tooltip.Root
          delayDuration={300}
          open={tooltip === 'sidebar'}
          onOpenChange={(open) => setTooltip(open ? 'sidebar' : null)}
        >
          <Tooltip.Trigger>
            <button
              type="button"
              aria-label={sidebar.expanded ? 'Hide sidebar' : 'Show sidebar'}
              aria-expanded={sidebar.expanded}
              aria-controls={sidebar.controls}
              onClick={sidebar.toggle}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                aria-hidden="true"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d={
                    sidebar.expanded
                      ? 'M11.5 2.30762C13.1707 2.30762 14.5254 3.66235 14.5254 5.33301V10.666C14.5254 12.3367 13.1707 13.6914 11.5 13.6914H4.5C2.82934 13.6914 1.47461 12.3367 1.47461 10.666V5.33301C1.47461 3.66235 2.82934 2.30762 4.5 2.30762H11.5ZM6.52539 12.6416H11.5C12.5908 12.6416 13.4746 11.7568 13.4746 10.666V5.33301C13.4746 4.24225 12.5908 3.3584 11.5 3.3584H6.52539V12.6416ZM4.5 3.3584C3.40924 3.3584 2.52539 4.24225 2.52539 5.33301V10.666C2.52539 11.7568 3.40924 12.6416 4.5 12.6416H5.47461V3.3584H4.5Z'
                      : 'M11.5 2.30762C13.1707 2.30762 14.5254 3.66235 14.5254 5.33301V10.666C14.5254 12.3367 13.1707 13.6914 11.5 13.6914H4.5C2.82934 13.6914 1.47461 12.3367 1.47461 10.666V5.33301C1.47461 3.66235 2.82934 2.30762 4.5 2.30762H11.5ZM4.5 3.3584C3.40924 3.3584 2.52539 4.24225 2.52539 5.33301V10.666C2.52539 11.7568 3.40924 12.6416 4.5 12.6416H11.5C12.5908 12.6416 13.4746 11.7568 13.4746 10.666V5.33301C13.4746 4.24225 12.5908 3.3584 11.5 3.3584H4.5Z'
                  }
                />
                {!sidebar.expanded && (
                  <path d="M4.66699 4.80859C4.95683 4.80873 5.19238 5.04412 5.19238 5.33398V10.667C5.19238 10.9569 4.95683 11.1923 4.66699 11.1924C4.37704 11.1924 4.1416 10.9569 4.1416 10.667V5.33398C4.1416 5.04403 4.37704 4.80859 4.66699 4.80859Z" />
                )}
              </svg>
            </button>
          </Tooltip.Trigger>
          <Tooltip.Content
            side="bottom"
            data-cluster-sdk=""
            data-theme="dark"
            className={styles.tooltip}
          >
            Toggle sidebar
          </Tooltip.Content>
        </Tooltip.Root>
      )}
    </nav>
  );
}
