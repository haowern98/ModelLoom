import { Network } from '@phosphor-icons/react/dist/csr/Network';
import { Button } from '../../components/Button';
import type { DemoDevice, demoLinks } from '../../mocks/cluster';
import { ClusterJoiningPanel, PendingRequests } from './ClusterJoiningPanel';
import type { JoiningProps } from './ClusterJoiningPanel';
import styles from './ClusterViews.module.css';
import settings from '../settings/SettingsPage.module.css';
import { DeviceInventory } from './DeviceInventory';

export type ClusterView = 'devices' | 'connections' | 'requests' | 'add' | 'join' | 'share';
type Link = (typeof demoLinks)[number];

interface ClusterViewsProps extends JoiningProps {
  view: ClusterView;
  devices: readonly DemoDevice[];
  links: readonly Link[];
  local: boolean;
  onLink: (link: Link) => void;
  onConnectionAction: (action: 'add' | 'join' | 'share') => void;
}

const titles: Record<ClusterView, string> = {
  devices: 'Devices',
  connections: 'Connections',
  requests: 'Requests',
  add: 'Add device',
  join: 'Join cluster',
  share: 'Share this PC',
};

/** Presents supplied local data or explicitly labelled samples without performing networking. */
export function ClusterViews(props: ClusterViewsProps) {
  const { view, devices, links, demo, local, onLink, onConnectionAction } = props;
  const settingsLayout = view === 'devices' || view === 'connections' || view === 'requests';
  return (
    <section
      className={settingsLayout ? `${settings.details} ${styles.settingsPage}` : styles.page}
      aria-label={titles[view]}
    >
      <div className={settingsLayout ? settings.column : undefined}>
        <header
          className={
            settingsLayout
              ? `${settings.header} ${styles.settingsHeader} ${view === 'connections' ? styles.connectionsHeader : ''}`
              : styles.header
          }
        >
          <div>
            <h1>{titles[view]}</h1>
            {view === 'connections' && (
              <p className={styles.subtitle}>
                {demo
                  ? 'Sample connections · these values are not measurements.'
                  : 'Network connections will appear here.'}
              </p>
            )}
          </div>
          {view === 'connections' && (
            <div className={styles.actions}>
              <Button onClick={() => onConnectionAction('join')}>Join cluster</Button>
              <Button onClick={() => onConnectionAction('share')}>Share this PC</Button>
              <Button onClick={() => onConnectionAction('add')}>Add device</Button>
            </div>
          )}
        </header>
        {view === 'devices' && <DeviceInventory devices={devices} demo={demo} local={local} />}
        {view === 'connections' && (
          <>
            {demo && links.length > 0 && (
              <div className={settings.group}>
                {demo &&
                  links.map((link) => {
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
            )}
            {(!demo || !links.length) && (
              <div className={settings.group}>
                <div className={settings.row}>
                  <p className={settings.description}>
                    {demo ? 'No sample connections.' : 'No verified network connections.'}
                  </p>
                </div>
              </div>
            )}
          </>
        )}
        {view === 'requests' &&
          (demo ? (
            <PendingRequests {...props} settingsLayout />
          ) : (
            <section className={settings.section}>
              <h2>Participation requests</h2>
              <div className={settings.group}>
                <div className={settings.row}>
                  <p className={settings.description}>
                    Incoming invitations and requests require networking integration. No request
                    source is connected.
                  </p>
                </div>
              </div>
            </section>
          ))}
        {(view === 'add' || view === 'join' || view === 'share') && (
          <div className={styles.joining} key={view}>
            <ClusterJoiningPanel {...props} kind={view} expanded />
          </div>
        )}
      </div>
    </section>
  );
}
