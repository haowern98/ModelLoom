import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import type { MotionStyle } from 'motion/react';
import { ChatGptRailIcon } from '../components/ChatGptRailIcon';
import type { Destination } from './navigation';
import styles from './AppShell.module.css';
import { TitlebarNavigation } from './TitlebarNavigation';
import type { TitlebarHistory } from './TitlebarNavigation';
import { useWorkspaceSidebar } from './useWorkspaceSidebar';

interface AppShellProps {
  destination: Destination;
  onNavigate: (destination: Destination) => void;
  demo: boolean;
  children: ReactNode;
  history?: TitlebarHistory;
}

export function AppShell({ destination, onNavigate, demo, children, history }: AppShellProps) {
  const resizable = destination === 'Chat' || destination === 'Cluster';
  const sidebar = useWorkspaceSidebar(resizable);
  const collapsed = resizable && !sidebar.expanded;
  const sidebarId = destination === 'Chat' ? 'chat-sidebar' : 'cluster-sidebar';
  const splitPanel =
    destination === 'Chat' || destination === 'Settings' || destination === 'Cluster';
  return (
    <div className={styles.shell}>
      <div className={styles.titlebar} data-sidebar-toggle={resizable}>
        {history && (
          <TitlebarNavigation
            {...history}
            sidebar={
              resizable
                ? { expanded: sidebar.expanded, controls: sidebarId, toggle: sidebar.toggle }
                : undefined
            }
          />
        )}
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
      <motion.section
        className={`${styles.foreground} ${splitPanel ? styles.chatForeground : ''}`}
        aria-label="ModelLoom workspace"
        data-sidebar-collapsed={collapsed}
        style={
          resizable
            ? ({
                '--animated-sidebar-width': sidebar.animatedWidth,
                '--sidebar-opacity': sidebar.fraction,
                '--sidebar-visibility': sidebar.visibility,
              } as MotionStyle)
            : {}
        }
      >
        <main className={`${styles.main} ${splitPanel ? styles.chatMain : ''}`}>{children}</main>
        {resizable && !collapsed && (
          <div
            className={styles.sidebarHandle}
            role="separator"
            aria-label="Resize sidebar"
            aria-orientation="vertical"
            aria-controls={sidebarId}
            tabIndex={0}
            {...sidebar.handle}
          />
        )}
      </motion.section>
    </div>
  );
}
