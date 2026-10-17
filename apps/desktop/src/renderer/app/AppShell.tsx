import { useState } from 'react';
import type { ReactNode } from 'react';
import { Download, MessagesSquare } from 'lucide-react';
import { Network } from '@phosphor-icons/react/dist/csr/Network';
import { HardDrives } from '@phosphor-icons/react/dist/csr/HardDrives';
import { GearSix } from '@phosphor-icons/react/dist/csr/GearSix';
import { ChatGptRailIcon } from '../components/ChatGptRailIcon';
import type { Destination } from './navigation';
import styles from './AppShell.module.css';

interface AppShellProps {
  destination: Destination;
  onNavigate: (destination: Destination) => void;
  demo: boolean;
  children: ReactNode;
}

const navigationIconProps = { size: 20, 'aria-hidden': true } as const;

export function AppShell({ destination, onNavigate, demo, children }: AppShellProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const splitPanel =
    destination === 'Chat' || destination === 'Settings' || destination === 'Cluster';
  return (
    <div className={styles.shell}>
      <div className={styles.titlebar}>
        {demo && (
          <span
            className={styles.demo}
            title="All model states and metrics are simulated. No inference or API server runs."
          >
            Demo data
          </span>
        )}
      </div>
      <aside className={styles.rail} aria-label="Main navigation">
        <div className={styles.railTop}>
          <button
            type="button"
            aria-label="Chat"
            aria-current={destination === 'Chat' ? 'page' : undefined}
            title="Chat"
            onClick={() => onNavigate('Chat')}
          >
            <ChatGptRailIcon icon="home" selected={destination === 'Chat'} />
          </button>
          <button
            type="button"
            aria-label="Cluster"
            aria-current={destination === 'Cluster' ? 'page' : undefined}
            title="Cluster"
            onClick={() => onNavigate('Cluster')}
          >
            <Network
              {...navigationIconProps}
              weight={destination === 'Cluster' ? 'fill' : 'regular'}
            />
          </button>
          <button
            type="button"
            aria-label="Models"
            aria-current={destination === 'Models' ? 'page' : undefined}
            title="Models"
            onClick={() => onNavigate('Models')}
          >
            <ChatGptRailIcon icon="books" selected={destination === 'Models'} />
          </button>
          <button
            type="button"
            aria-label="API"
            aria-current={destination === 'API' ? 'page' : undefined}
            title="API"
            onClick={() => onNavigate('API')}
          >
            <HardDrives
              {...navigationIconProps}
              weight={destination === 'API' ? 'fill' : 'regular'}
            />
          </button>
          <button
            type="button"
            aria-label="Settings"
            aria-current={destination === 'Settings' ? 'page' : undefined}
            title="Settings"
            onClick={() => onNavigate('Settings')}
          >
            <GearSix
              {...navigationIconProps}
              weight={destination === 'Settings' ? 'fill' : 'regular'}
            />
          </button>
          <div
            className={styles.overflow}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setMoreOpen(false);
            }}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setMoreOpen(false);
            }}
          >
            <button
              type="button"
              aria-label="More navigation"
              title="More"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen(!moreOpen)}
            >
              <ChatGptRailIcon icon="more" />
            </button>
            {moreOpen && (
              <div className={styles.moreMenu} aria-label="Additional screens">
                <button
                  type="button"
                  onClick={() => {
                    onNavigate('Chat');
                    setMoreOpen(false);
                  }}
                >
                  <MessagesSquare size={16} />
                  Chat
                </button>
              </div>
            )}
          </div>
        </div>
        <div className={styles.railBottom}>
          <button
            type="button"
            className={styles.download}
            disabled
            aria-label="Downloads — not available yet"
            title="Downloads comes with model integration"
          >
            <Download size={16} />
          </button>
          <button
            type="button"
            className={styles.avatar}
            disabled
            aria-label="Local profile — not available yet"
            title="Local profile"
          >
            WW
          </button>
        </div>
      </aside>
      <section
        className={`${styles.foreground} ${styles.neutralForeground} ${splitPanel ? styles.chatForeground : ''}`}
        aria-label="ModelLoom workspace"
      >
        <main className={`${styles.main} ${splitPanel ? styles.chatMain : ''}`}>{children}</main>
      </section>
    </div>
  );
}
