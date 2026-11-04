import { useEffect, useReducer, useRef, useState } from 'react';
import type { RuntimeInventory, RuntimeView } from '../../../shared/runtime';
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Cpu } from '@phosphor-icons/react/dist/csr/Cpu';
import { Database } from '@phosphor-icons/react/dist/csr/Database';
import { Network } from '@phosphor-icons/react/dist/csr/Network';
import { Button } from '../../components/Button';
import { ChatGptSidebarIcon } from '../../components/ChatGptSidebarIcon';
import { Dialog } from '../../components/Dialog';
import { SearchField } from '../../components/SearchField';
import { NetworkSettings } from './NetworkSettings';
import { StorageSettings } from './StorageSettings';
import styles from './SettingsPage.module.css';

export type SettingsCategory =
  'Appearance' | 'Runtime' | 'Storage' | 'Network' | 'Diagnostics' | 'Advanced';

const categories = [
  {
    name: 'Appearance',
    icon: 'appearance',
    keywords:
      'theme light dark system accent colour density status metrics reduce motion contextual help',
  },
  {
    name: 'Runtime',
    icon: Cpu,
    keywords: 'installed engines packs updates GGUF llama.cpp',
  },
  { name: 'Storage', icon: Database, keywords: 'model cache folder location limits cleanup' },
  { name: 'Network', icon: Network, keywords: 'LAN Tailscale connectivity API access' },
  { name: 'Diagnostics', icon: 'diagnostics', keywords: 'health logs metrics export' },
  { name: 'Advanced', icon: 'advanced', keywords: 'advanced options' },
] as const;

const appearanceUnavailable = 'Appearance changes are not available yet.';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section} aria-label={title}>
      <h2>{title}</h2>
      <div className={styles.group}>{children}</div>
    </section>
  );
}

export function Row({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.row}>
      <div>
        <p className={styles.label}>{label}</p>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      <div className={styles.controls}>{children}</div>
    </div>
  );
}

function PreviewSelect({
  label,
  value,
  reason = appearanceUnavailable,
}: {
  label: string;
  value: string;
  reason?: string;
}) {
  return (
    <span className={styles.select} title={reason}>
      <select aria-label={label} value={value} disabled>
        <option>{value}</option>
      </select>
      <ChevronDown size={14} aria-hidden="true" />
    </span>
  );
}

function PreviewSwitch({
  label,
  checked = false,
  reason = appearanceUnavailable,
}: {
  label: string;
  checked?: boolean;
  reason?: string;
}) {
  return (
    <input
      type="checkbox"
      role="switch"
      className={styles.switch}
      aria-label={label}
      checked={checked}
      disabled
      title={reason}
    />
  );
}

function Appearance() {
  return (
    <>
      <Section title="Theme">
        <Row label="Theme" description="Choose how ModelLoom looks on your device.">
          <div className={styles.segmented} aria-label="Theme options">
            {['Light', 'Dark', 'System'].map((theme) => (
              <button
                key={theme}
                type="button"
                disabled
                aria-pressed={theme === 'Dark'}
                title={appearanceUnavailable}
              >
                {theme}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Accent colour" description="Choose the accent colour for interactive elements.">
          <PreviewSelect label="Accent colour" value="Neutral" />
        </Row>
      </Section>
      <Section title="Interface">
        <Row label="Density" description="Adjust the spacing and size of UI elements.">
          <PreviewSelect label="Density" value="Comfortable" />
        </Row>
        <Row label="Show status" description="Display connection and model status.">
          <PreviewSwitch label="Show status" checked />
        </Row>
        <Row label="Show metrics" description="Display available performance information.">
          <PreviewSwitch label="Show metrics" />
        </Row>
      </Section>
      <Section title="Accessibility">
        <Row label="Reduce motion" description="Limit interface animations.">
          <PreviewSwitch label="Reduce motion" />
        </Row>
        <Row label="Contextual help" description="Show explanations beside settings.">
          <PreviewSwitch label="Contextual help" checked />
        </Row>
      </Section>
      <p className={styles.notice}>Appearance preview · Changes are not available yet.</p>
    </>
  );
}

function runtimeLabel(runtime: NonNullable<RuntimeView['activeRuntime']>) {
  return `llama.cpp · ${runtime.backend.toUpperCase()} (Windows)`;
}

function runtimeOption(runtime: NonNullable<RuntimeView['activeRuntime']>) {
  const build = /^(b\d+)(?:-(dev\d+))?(?:-|$)/u.exec(runtime.version);
  const version = build ? [build[1], build[2]].filter(Boolean).join(' · ') : runtime.version;
  return `${runtimeLabel(runtime)} · ${version}`;
}

function Runtime({
  activeRuntime,
  selectedRuntime,
}: {
  activeRuntime: RuntimeView['activeRuntime'];
  selectedRuntime: RuntimeView['selectedRuntime'];
}) {
  const [manageOpen, setManageOpen] = useState(false);
  const [inventory, setInventory] = useState<RuntimeInventory | null>(null);
  const [attempt, retry] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    const bridge = window.modelLoomRuntime;
    if (!bridge) return;
    let current = true;
    void bridge.command({ action: 'runtime-inventory' }).then(
      (reply) => {
        if (current) setInventory(reply.runtimeInventory ?? { status: 'unavailable' });
      },
      () => {
        if (current) setInventory({ status: 'error' });
      },
    );
    return () => {
      current = false;
    };
  }, [attempt, activeRuntime?.version]);

  const status = inventory?.status ?? (window.modelLoomRuntime ? 'loading' : 'unavailable');
  const selected = inventory?.status === 'ready' ? inventory.selected : selectedRuntime;
  const installed = inventory?.status === 'ready' && inventory.installed;
  const description = {
    loading: 'Checking installed runtimes…',
    unavailable: 'Runtime inventory is not connected.',
    error: 'Could not verify the runtime inventory.',
    ready: installed ? '1 verified version installed.' : 'No verified runtime installed.',
  }[status];

  return (
    <>
      <Section title="Installed runtimes">
        <Row label="Runtime packs" description={description}>
          {status === 'error' && (
            <Button
              onClick={() => {
                setInventory(null);
                retry();
              }}
            >
              Retry
            </Button>
          )}
          <Button disabled title="Runtime updates are unavailable.">
            Check for updates
          </Button>
          <Button onClick={() => setManageOpen(true)}>Manage installed runtimes</Button>
        </Row>
      </Section>
      <Section title="Runtime selection">
        <Row
          label="GGUF"
          description={
            selected
              ? 'This is the only verified runtime available for the next model load.'
              : 'Runtime used to load GGUF models.'
          }
        >
          <PreviewSelect
            label="GGUF runtime"
            value={
              selected
                ? runtimeOption(selected)
                : window.modelLoomRuntime && selectedRuntime === undefined
                  ? 'Checking…'
                  : 'Unavailable'
            }
            reason={selected ? 'Only one verified runtime is available.' : description}
          />
        </Row>
        <Row label="Active runtime" description="Runtime used by the loaded model.">
          <span className={styles.muted}>
            {activeRuntime ? runtimeOption(activeRuntime) : 'No model loaded'}
          </span>
        </Row>
      </Section>
      {manageOpen && (
        <Dialog title="Installed runtimes" onClose={() => setManageOpen(false)}>
          {selected && installed ? (
            <section className={styles.runtimePack} aria-label={runtimeLabel(selected)}>
              <h3>{runtimeLabel(selected)}</h3>
              <p>
                {selected.version} · Selected
                {activeRuntime?.packageId === selected.packageId &&
                  activeRuntime.version === selected.version &&
                  ' · In use'}
              </p>
              <dl>
                <div>
                  <dt>Package</dt>
                  <dd>{selected.packageId}</dd>
                </div>
                <div>
                  <dt>Build</dt>
                  <dd>{selected.artifact}</dd>
                </div>
                <div>
                  <dt>Upstream commit</dt>
                  <dd>{selected.upstreamCommit}</dd>
                </div>
              </dl>
            </section>
          ) : (
            <p>{description}</p>
          )}
          <footer>
            <Button onClick={() => setManageOpen(false)}>Close</Button>
          </footer>
        </Dialog>
      )}
    </>
  );
}

const pendingDescriptions = {
  Storage:
    'Model and cache locations, storage usage and cleanup will be available with storage integration.',
  Network:
    'Cluster connectivity and connection preferences will be available with networking integration.',
  Diagnostics:
    'Health information, logs and diagnostic exports will be available with runtime integration.',
  Advanced: 'Advanced settings will appear after their options and behaviour have been reviewed.',
};

/** Local settings presentation; unavailable controls never change global appearance or start integrations. */
export function SettingsPage({
  category,
  onCategory,
  onApi,
  onConnections,
  activeRuntime,
  selectedRuntime,
}: {
  category: SettingsCategory;
  onCategory: (category: SettingsCategory) => void;
  onApi: () => void;
  onConnections?: () => void;
  activeRuntime?: RuntimeView['activeRuntime'];
  selectedRuntime?: RuntimeView['selectedRuntime'];
}) {
  const [query, setQuery] = useState('');
  const details = useRef<HTMLDivElement>(null);
  const visible = categories.filter((item) =>
    `${item.name} ${item.keywords}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <section className={styles.page} aria-label="Settings">
      <aside className={styles.sidebar} aria-label="Settings navigation">
        <header className={styles.sidebarHeader}>
          <h2>Settings</h2>
        </header>
        <div
          className={styles.search}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setQuery('');
          }}
        >
          <SearchField
            label="Search settings"
            value={query}
            onChange={setQuery}
            icon={<ChatGptSidebarIcon icon="search" />}
          />
        </div>
        <nav className={styles.categories} aria-label="Settings categories">
          <p className={styles.categoryLabel}>Preferences</p>
          {visible.map((item) => (
            <button
              key={item.name}
              type="button"
              aria-current={category === item.name ? 'page' : undefined}
              onClick={() => {
                onCategory(item.name);
                if (details.current) details.current.scrollTop = 0;
              }}
            >
              {typeof item.icon === 'string' ? (
                <ChatGptSidebarIcon icon={item.icon} />
              ) : (
                <item.icon size={16} weight="regular" aria-hidden="true" />
              )}
              {item.name}
            </button>
          ))}
          {!visible.length && (
            <p className={styles.empty} role="status">
              No matching settings
            </p>
          )}
        </nav>
      </aside>
      <div
        ref={details}
        className={styles.details}
        role="region"
        aria-label="Settings details"
        tabIndex={0}
      >
        <article className={styles.column} aria-label={`${category} settings`}>
          <header className={styles.header}>
            <h1>{category}</h1>
          </header>
          {category === 'Appearance' ? (
            <Appearance />
          ) : category === 'Runtime' ? (
            <Runtime activeRuntime={activeRuntime} selectedRuntime={selectedRuntime} />
          ) : category === 'Network' ? (
            <NetworkSettings onApi={onApi} {...(onConnections ? { onConnections } : {})} />
          ) : category === 'Storage' ? (
            <StorageSettings />
          ) : (
            <Section title={category}>
              <div className={styles.pending}>
                <p className={styles.label}>{category} settings are not available yet.</p>
                <p className={styles.description}>{pendingDescriptions[category]}</p>
              </div>
            </Section>
          )}
        </article>
      </div>
    </section>
  );
}
