import { useId } from 'react';
import { Network } from '@phosphor-icons/react/dist/csr/Network';
import type { DemoDevice, demoLinks } from '../../mocks/cluster';
import { ClusterJoiningPanel, PendingRequests } from './ClusterJoiningPanel';
import type { JoiningProps } from './ClusterJoiningPanel';
import styles from './ClusterViews.module.css';
import settings from '../settings/SettingsPage.module.css';
import { DeviceInventory } from './DeviceInventory';

export type ClusterView = 'devices' | 'connections' | 'add' | 'join' | 'share';
type Link = (typeof demoLinks)[number];

interface ClusterViewsProps extends JoiningProps {
  view: ClusterView;
  devices: readonly DemoDevice[];
  links: readonly Link[];
  local: boolean;
  onLink: (link: Link) => void;
  onConnectionAction: (action: 'add' | 'join' | 'share') => void;
  targetDeviceId?: string | undefined;
}

const tabs = [
  { kind: 'join', label: 'Join cluster' },
  { kind: 'share', label: 'Share this PC' },
  { kind: 'add', label: 'Add device' },
] as const;

/** Keeps connection direction, sharing and requests inside the same Settings-style workspace. */
export function ClusterViews(props: ClusterViewsProps) {
  const { view, devices, links, demo, local, onLink, onConnectionAction } = props;
  const id = useId();
  const kind = view === 'add' || view === 'join' ? view : 'share';
  const title = view === 'devices' ? 'Devices' : 'Connections';
  return (
    <section className={`${settings.details} ${styles.settingsPage}`} aria-label={title}>
      <div className={settings.column}>
        <header className={settings.header}>
          <h1>{title}</h1>
        </header>
        {view === 'devices' ? (
          <DeviceInventory
            devices={devices}
            demo={demo}
            local={local}
            targetDeviceId={props.targetDeviceId}
          />
        ) : (
          <>
            <div className={styles.tabs} role="tablist" aria-label="Connection options">
              {tabs.map((tab, index) => (
                <button
                  key={tab.kind}
                  id={`${id}-${tab.kind}`}
                  type="button"
                  role="tab"
                  aria-selected={kind === tab.kind}
                  aria-controls={`${id}-content`}
                  tabIndex={kind === tab.kind ? 0 : -1}
                  onClick={() => onConnectionAction(tab.kind)}
                  onKeyDown={(event) => {
                    const next =
                      event.key === 'ArrowRight'
                        ? (index + 1) % tabs.length
                        : event.key === 'ArrowLeft'
                          ? (index + tabs.length - 1) % tabs.length
                          : event.key === 'Home'
                            ? 0
                            : event.key === 'End'
                              ? tabs.length - 1
                              : null;
                    if (next === null) return;
                    event.preventDefault();
                    onConnectionAction(tabs[next]!.kind);
                    document.getElementById(`${id}-${tabs[next]!.kind}`)?.focus();
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div
              id={`${id}-content`}
              role="tabpanel"
              aria-labelledby={`${id}-${kind}`}
              className={styles.joining}
            >
              <ClusterJoiningPanel {...props} kind={kind} expanded key={kind} />
              {kind === 'share' && <PendingRequests {...props} settingsLayout />}
              {kind === 'add' && demo && links.length > 0 && (
                <section className={settings.section} aria-label="Sample connections">
                  <h2>Sample connections</h2>
                  <div className={settings.group}>
                    {links.map((link) => {
                      const from = devices.find((device) => device.id === link.from);
                      const to = devices.find((device) => device.id === link.to);
                      if (!from || !to) return null;
                      return (
                        <button
                          type="button"
                          key={`${link.from}:${link.to}`}
                          className={`${settings.row} ${styles.connection}`}
                          aria-label={`Inspect connection ${from.name} to ${to.name}`}
                          onClick={() => onLink(link)}
                        >
                          <div className={styles.connectionIdentity}>
                            <Network size={16} aria-hidden="true" />
                            <span>
                              <strong>
                                {from.name} → {to.name}
                              </strong>
                              <small>Path unknown · connection not verified</small>
                            </span>
                          </div>
                          <span className={styles.latency}>{link.latencyMs} ms · sample</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
