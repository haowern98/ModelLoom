import type { ReactNode } from 'react';
import { ChatGptRailIcon } from '../components/ChatGptRailIcon';
import type { Destination } from './navigation';
import styles from './AppShell.module.css';
import { TitlebarNavigation } from './TitlebarNavigation';
import type { TitlebarHistory } from './TitlebarNavigation';

interface AppShellProps {
  destination: Destination;
  onNavigate: (destination: Destination) => void;
  demo: boolean;
  children: ReactNode;
  history?: TitlebarHistory;
}

export function AppShell({ destination, onNavigate, demo, children, history }: AppShellProps) {
  const splitPanel =
    destination === 'Chat' || destination === 'Settings' || destination === 'Cluster';
  return (
    <div className={styles.shell}>
      <div className={styles.titlebar}>
        {history && <TitlebarNavigation {...history} />}
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
            <ChatGptRailIcon icon="cluster" />
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
            <ChatGptRailIcon icon="api" />
          </button>
        </div>
        <div className={styles.railBottom}>
          <button
            type="button"
            aria-label="Settings"
            aria-current={destination === 'Settings' ? 'page' : undefined}
            title="Settings"
            onClick={() => onNavigate('Settings')}
          >
            <ChatGptRailIcon icon="settings" />
          </button>
        </div>
      </aside>
      <section
        className={`${styles.foreground} ${splitPanel ? styles.chatForeground : ''}`}
        aria-label="ModelLoom workspace"
      >
        <main className={`${styles.main} ${splitPanel ? styles.chatMain : ''}`}>{children}</main>
      </section>
    </div>
  );
}
