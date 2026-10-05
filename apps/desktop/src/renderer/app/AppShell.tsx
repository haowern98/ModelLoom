import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  Home,
  Network,
  LibraryBig,
  Database,
  ChartNoAxesCombined,
  Settings,
  Ellipsis,
  Download,
  MessagesSquare,
  Server,
} from 'lucide-react';
import type { Destination } from './navigation';
import styles from './AppShell.module.css';

interface AppShellProps {
  destination: Destination;
  onNavigate: (destination: Destination) => void;
  demo: boolean;
  children: ReactNode;
}

const navigationIconProps = { size: 20, strokeWidth: 1.75 };

export function AppShell({ destination, onNavigate, demo, children }: AppShellProps) {
  const [moreOpen, setMoreOpen] = useState(false);
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
            className={styles.home}
            aria-label="Chat"
            aria-current={destination === 'Chat' ? 'page' : undefined}
            title="Chat"
            onClick={() => onNavigate('Chat')}
          >
            <Home {...navigationIconProps} />
          </button>
          <button
            type="button"
            aria-label="Cluster"
            aria-current={destination === 'Cluster' ? 'page' : undefined}
            title="Cluster"
            onClick={() => onNavigate('Cluster')}
          >
            <Network {...navigationIconProps} />
          </button>
          <button
            type="button"
            aria-label="Models"
            aria-current={destination === 'Models' ? 'page' : undefined}
            title="Models"
            onClick={() => onNavigate('Models')}
          >
            <LibraryBig {...navigationIconProps} />
          </button>
          <button
            type="button"
            aria-label="API"
            aria-current={destination === 'API' ? 'page' : undefined}
            title="API"
            onClick={() => onNavigate('API')}
          >
            <Server {...navigationIconProps} />
          </button>
          <button
            type="button"
            disabled
            aria-label="Storage — not available yet"
            title="Storage comes with storage integration"
          >
            <Database {...navigationIconProps} />
          </button>
          <button
            type="button"
            disabled
            aria-label="Metrics — not available yet"
            title="Metrics comes with runtime integration"
          >
            <ChartNoAxesCombined {...navigationIconProps} />
          </button>
          <button
            type="button"
            aria-label="Settings"
            aria-current={destination === 'Settings' ? 'page' : undefined}
            title="Settings"
            onClick={() => onNavigate('Settings')}
          >
            <Settings {...navigationIconProps} />
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
              <Ellipsis {...navigationIconProps} />
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
        className={`${styles.foreground} ${destination === 'Cluster' || destination === 'Models' || destination === 'Chat' || destination === 'API' ? styles.neutralForeground : ''} ${destination === 'Chat' ? styles.chatForeground : ''}`}
        aria-label="ModelLoom workspace"
      >
        <main className={`${styles.main} ${destination === 'Chat' ? styles.chatMain : ''}`}>
          {children}
        </main>
      </section>
    </div>
  );
}
