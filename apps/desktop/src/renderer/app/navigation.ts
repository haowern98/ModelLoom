import type { ClusterView } from '../features/cluster/ClusterSidebar';
import type { SettingsCategory } from '../features/settings/SettingsPage';

export type Destination = 'Models' | 'Cluster' | 'Chat' | 'API' | 'Settings';

/** Navigation identifiers only; restoring a location never replays product actions. */
export interface NavigationLocation {
  destination: Destination;
  settingsCategory: SettingsCategory;
  clusterView: ClusterView;
  deviceId: string | null;
  configurationModelId: string | null;
  chatId: string | null;
  chatArchived: boolean;
}
