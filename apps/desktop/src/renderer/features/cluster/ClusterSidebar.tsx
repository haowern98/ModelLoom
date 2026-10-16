import { ChatGptSidebarIcon } from '../../components/ChatGptSidebarIcon';
import type { DemoDevice } from '../../mocks/cluster';
import styles from './ClusterSidebar.module.css';

export type ClusterView =
  'overview' | 'devices' | 'connections' | 'requests' | 'add' | 'join' | 'share';

interface ClusterSidebarProps {
  view: ClusterView;
  onNavigate: (view: ClusterView) => void;
  devices: readonly DemoDevice[];
  selectedDeviceId?: string | undefined;
  onSelect: (device: DemoDevice) => void;
  pendingRequests: number;
  local: boolean;
  configurations?: readonly { id: string; name: string }[] | undefined;
  selectedConfigurationId?: string | undefined;
  onConfiguration?: (id: string) => void;
}

const destinations = [
  { view: 'overview', label: 'Overview' },
  { view: 'devices', label: 'Devices' },
  { view: 'connections', label: 'Connections' },
  { view: 'requests', label: 'Requests' },
] as const;

export function ClusterSidebar({
  view,
  onNavigate,
  devices,
  selectedDeviceId,
  onSelect,
  pendingRequests,
  local,
  configurations = [],
  selectedConfigurationId,
  onConfiguration,
}: ClusterSidebarProps) {
  const orderedDevices = [
    ...devices.filter((device) => device.role === 'Coordinator'),
    ...devices.filter((device) => device.role === 'Worker'),
  ];

  return (
    <aside className={styles.sidebar} aria-labelledby="cluster-heading">
      <header className={styles.header}>
        <h1 id="cluster-heading">Cluster</h1>
      </header>
      <div className={styles.content}>
        <nav aria-label="Cluster navigation">
          <button
            type="button"
            aria-current={view === 'add' ? 'page' : undefined}
            onClick={() => onNavigate('add')}
          >
            <ChatGptSidebarIcon icon="add" />
            Add device
          </button>
          <h2 className={styles.groupHeading}>Manage</h2>
          {destinations.map(({ view: destination, label }) => (
            <button
              key={destination}
              type="button"
              aria-current={view === destination ? 'page' : undefined}
              onClick={() => onNavigate(destination)}
            >
              <ChatGptSidebarIcon icon={destination} />
              <span>{label}</span>
              {destination === 'requests' && pendingRequests > 0 && (
                <span
                  className={styles.count}
                  aria-label={`${pendingRequests} pending request${pendingRequests === 1 ? '' : 's'}`}
                >
                  {pendingRequests}
                </span>
              )}
            </button>
          ))}
        </nav>
        <section aria-label="Your devices">
          <h2 className={styles.groupHeading}>Your devices</h2>
          {orderedDevices.map((device) => (
            <button
              key={device.id}
              type="button"
              aria-label={`Inspect ${device.name}`}
              aria-pressed={selectedDeviceId === device.id}
              title={device.name}
              onClick={() => onSelect(device)}
            >
              <ChatGptSidebarIcon icon="device" />
              <span className={styles.deviceText}>
                <span className={styles.deviceName}>{device.name}</span>
                <span className={styles.secondary}>{local ? 'This device' : device.role}</span>
              </span>
            </button>
          ))}
        </section>
        <section aria-label="Configurations">
          <h2 className={styles.groupHeading}>Configurations</h2>
          {configurations.map((configuration) => (
            <button
              key={configuration.id}
              type="button"
              aria-pressed={selectedConfigurationId === configuration.id}
              onClick={() => onConfiguration?.(configuration.id)}
            >
              <span className={styles.deviceName}>{configuration.name}</span>
            </button>
          ))}
        </section>
      </div>
    </aside>
  );
}
