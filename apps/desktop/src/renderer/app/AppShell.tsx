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
  Monitor,
  Radio,
  Zap,
  ExternalLink,
  MessagesSquare,
  Server,
} from 'lucide-react';
import type { Destination } from './navigation';
import styles from './AppShell.module.css';

interface AppShellProps {
  destination: Destination;
  onNavigate: (destination: Destination) => void;
  demo: boolean;
  modelRunning: boolean;
  children: ReactNode;
}

export function AppShell({ destination, onNavigate, demo, modelRunning, children }: AppShellProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  return (
    <div className={styles.shell}>
      <div className={styles.titlebar} aria-hidden="true" />
      <aside className={styles.rail} aria-label="Main navigation">
        <div className={styles.railTop}>
          <button
            type="button"
            className={styles.home}
            disabled
            aria-label="Home — not available yet"
            title="Home — navigation is being finalized"
          >
            <Home size={22} />
          </button>
          <button
            type="button"
            aria-label="Cluster"
            aria-current={destination === 'Cluster' ? 'page' : undefined}
            title="Cluster"
            onClick={() => onNavigate('Cluster')}
          >
            <Network size={21} />
          </button>
          <button
            type="button"
            aria-label="Models"
            aria-current={destination === 'Models' ? 'page' : undefined}
            title="Models"
            onClick={() => onNavigate('Models')}
          >
            <LibraryBig size={22} />
          </button>
          <button
            type="button"
            disabled
            aria-label="Storage — not available yet"
            title="Storage comes with storage integration"
          >
            <Database size={20} />
          </button>
          <button
            type="button"
            disabled
            aria-label="Metrics — not available yet"
            title="Metrics comes with runtime integration"
          >
            <ChartNoAxesCombined size={21} />
          </button>
          <button
            type="button"
            aria-label="Settings"
            aria-current={destination === 'Settings' ? 'page' : undefined}
            title="Settings"
            onClick={() => onNavigate('Settings')}
          >
            <Settings size={21} />
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
              <Ellipsis size={23} />
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
                <button
                  type="button"
                  onClick={() => {
                    onNavigate('API');
                    setMoreOpen(false);
                  }}
                >
                  <Server size={16} />
                  API
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
      <section className={styles.foreground} aria-label="ModelLoom workspace">
        <main className={styles.main}>{children}</main>
        <footer
          className={styles.statusBar}
          aria-label={demo ? 'Sample cluster status; no live connections' : 'Cluster status'}
        >
          <span className={styles.health}>
            <i />
            {demo ? 'Cluster healthy' : 'No cluster connected'}
          </span>
          <span className={styles.divider} />
          <span>
            <Monitor size={14} />
            {demo ? '4 machines' : '0 machines'}
          </span>
          <span>
            <span className={styles.gpuIcon}>▣</span>
            {demo ? '4 GPUs (60 GB VRAM)' : 'No GPUs connected'}
          </span>
          <span>
            <Network size={14} />
            {demo ? 'Direct connections' : 'No connections'}
          </span>
          <span>
            <Zap size={14} />
            {demo ? '92 ms avg latency' : 'Latency unavailable'}
          </span>
          <span className={styles.spacer} />
          <span className={styles.divider} />
          <span className={styles.api}>
            <Radio size={15} />
            {demo && modelRunning ? 'API server running' : 'API server stopped'}
          </span>
          {demo && (
            <span
              className={styles.demo}
              title="All model states and metrics are simulated. No inference or API server runs."
            >
              Demo data
            </span>
          )}
          <button type="button" onClick={() => onNavigate('API')}>
            Open API
            <ExternalLink size={12} />
          </button>
        </footer>
      </section>
    </div>
  );
}
