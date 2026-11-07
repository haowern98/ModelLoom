import { useEffect, useReducer, useRef, useState } from 'react';
import type { RuntimeInventory, RuntimeView } from '../../../shared/runtime';
import type { ReactNode } from 'react';
import { Cpu } from '@phosphor-icons/react/dist/csr/Cpu';
import { Database } from '@phosphor-icons/react/dist/csr/Database';
import { Network } from '@phosphor-icons/react/dist/csr/Network';
import { Button } from '../../components/Button';
import { Select } from '@openai/apps-sdk-ui/components/Select';
import { ChatGptSidebarIcon } from '../../components/ChatGptSidebarIcon';
import { Dialog } from '../../components/Dialog';
import { SearchField } from '../../components/SearchField';
import { NetworkSettings } from './NetworkSettings';
import { StorageSettings } from './StorageSettings';
import styles from './SettingsPage.module.css';
import { themes, useAppearance } from '../../app/appearance';
import '../cluster/cluster-sdk-tokens.css';

export type SettingsCategory =
  'Appearance' | 'Runtime' | 'Storage' | 'Network' | 'Diagnostics' | 'Advanced';

const categories = [
  {
    name: 'Appearance',
    icon: 'appearance',
    keywords: 'theme light dark system reduce motion animations',
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
  className,
}: {
  label: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={[styles.row, className].filter(Boolean).join(' ')}>
      <div>
        <p className={styles.label}>{label}</p>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      <div className={styles.controls}>{children}</div>
    </div>
  );
}

function Appearance() {
  const { theme, reduceMotion, setTheme, setReduceMotion } = useAppearance();
  return (
    <>
      <Section title="Theme">
        <Row label="Theme" description="Choose how ModelLoom looks on your device.">
          <div className={styles.segmented} role="group" aria-label="Theme options">
            {themes.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={theme === option}
                onClick={() => setTheme(option)}
              >
                {option}
              </button>
            ))}
          </div>
        </Row>
      </Section>
      <Section title="Accessibility">
        <Row
          label="Reduce motion"
          description="Limit animations in ModelLoom. Your system’s reduced-motion preference always applies."
        >
          <input
            type="checkbox"
            role="switch"
            className={styles.switch}
            aria-label="Reduce motion"
            checked={reduceMotion}
            onChange={(event) => setReduceMotion(event.currentTarget.checked)}
          />
        </Row>
      </Section>
    </>
  );
}

type RuntimeBuild = NonNullable<RuntimeView['activeRuntime']>;
type RuntimeRelease = { build: RuntimeBuild; size: string };

/** Trusted Settings host contract for verified runtime management. */
export interface RuntimeManagement {
  /** Compatible, verified builds ordered newest first within each backend. */
  installed: readonly RuntimeBuild[];
  checkForUpdates(): Promise<readonly RuntimeRelease[]>;
  install(
    build: RuntimeBuild,
    onProgress: (status: string) => void,
  ): Promise<readonly RuntimeBuild[]>;
  select(build: RuntimeBuild): Promise<RuntimeBuild>;
}

function runtimeLabel(runtime: RuntimeBuild) {
  return `llama.cpp · ${runtime.backend === 'vulkan' ? 'Vulkan' : runtime.backend.toUpperCase()} (Windows)`;
}

function runtimeVersion(runtime: RuntimeBuild) {
  const build = /^(b\d+)(?:-(dev\d+))?(?:-|$)/u.exec(runtime.version);
  return build ? [build[1], build[2]].filter(Boolean).join(' · ') : runtime.version;
}

function runtimeKey(runtime: RuntimeBuild) {
  return encodeURIComponent(
    JSON.stringify([runtime.packageId, runtime.version, runtime.artifact, runtime.upstreamCommit]),
  );
}

function RuntimeBuilds({
  installed,
  selected,
  active,
}: {
  installed: readonly RuntimeBuild[];
  selected: RuntimeView['selectedRuntime'];
  active: RuntimeView['activeRuntime'];
}) {
  const [expanded, setExpanded] = useState<RuntimeBuild['backend'][]>([]);
  const selectedKey = selected && runtimeKey(selected);
  const activeKey = active && runtimeKey(active);

  return (
    <div className={styles.runtimePacks}>
      {[...new Set(installed.map((build) => build.backend))].map((backend) => {
        const versions = installed.filter((build) => build.backend === backend);
        const open = expanded.includes(backend);
        const visible = versions.filter((build, index) => {
          const key = runtimeKey(build);
          return open || index === 0 || key === selectedKey || key === activeKey;
        });

        return (
          <section className={styles.runtimePack} key={backend}>
            <div className={styles.runtimePackRow}>
              <div>
                <h3>llama.cpp · {backend.toUpperCase()}</h3>
                <p>
                  {versions.length} {versions.length === 1 ? 'version' : 'versions'} installed
                </p>
              </div>
              {(open || visible.length < versions.length) && (
                <Button
                  aria-expanded={open}
                  onClick={() =>
                    setExpanded(
                      open ? expanded.filter((value) => value !== backend) : [...expanded, backend],
                    )
                  }
                >
                  {open ? 'Hide older versions' : 'Show older versions'}
                </Button>
              )}
            </div>
            {visible.map((build) => {
              const key = runtimeKey(build);
              return (
                <div key={key} className={styles.runtimePackRow}>
                  <div>
                    <h4>{runtimeVersion(build)}</h4>
                    <p>
                      {build.packageId === 'llama-cuda-development-b11307-validation'
                        ? 'Bonsai validation build'
                        : 'Compatible'}
                    </p>
                  </div>
                  <div className={styles.runtimeBadges}>
                    {key === selectedKey && <span>Selected</span>}
                    {key === activeKey && <span>In use</span>}
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

function RuntimeOption({ label }: { label: string }) {
  return (
    <span data-runtime-option title={label}>
      {label}
    </span>
  );
}

export function RuntimeSettings({
  activeRuntime,
  selectedRuntime,
  management,
}: {
  activeRuntime: RuntimeView['activeRuntime'];
  selectedRuntime: RuntimeView['selectedRuntime'];
  management?: RuntimeManagement;
}) {
  const { resolvedTheme } = useAppearance();
  const [manageOpen, setManageOpen] = useState(false);
  const [inventory, setInventory] = useState<RuntimeInventory | null>(null);
  const [attempt, retry] = useReducer((value: number) => value + 1, 0);
  const [managedSelection, setManagedSelection] = useState<RuntimeBuild>();
  const [managedInstalled, setManagedInstalled] = useState(management?.installed);
  const [offers, setOffers] = useState<readonly RuntimeRelease[]>([]);
  const [updateStatus, setUpdateStatus] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const bridge = window.modelLoomRuntime;
    if (management || !bridge) return;
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
  }, [attempt, management]);

  const status = management
    ? 'ready'
    : (inventory?.status ?? (window.modelLoomRuntime ? 'loading' : 'unavailable'));
  const selected =
    managedSelection ?? (inventory?.status === 'ready' ? inventory.selected : selectedRuntime);
  const choices = inventory?.status === 'ready' ? (inventory.choices ?? []) : [];
  const installed = (
    managedInstalled ??
    (choices.length ? choices.map((choice) => choice.build) : undefined) ??
    (inventory?.status === 'ready' && inventory.installed ? [inventory.selected] : [])
  ).filter((build) => build.backend !== 'cpu');
  const selectedKey = selected ? runtimeKey(selected) : '';
  const description = {
    loading: 'Checking installed runtimes…',
    unavailable: 'Runtime inventory is not connected.',
    error: 'Could not verify the runtime inventory.',
    ready:
      installed.length === 0
        ? 'No verified runtime installed.'
        : `${installed.length} verified ${installed.length === 1 ? 'version' : 'versions'} installed.`,
  }[status];

  async function runUpdate(action: () => Promise<void>, failure: string) {
    setBusy(true);
    try {
      await action();
    } catch {
      setUpdateStatus(failure);
    } finally {
      setBusy(false);
    }
  }

  function select(build: RuntimeBuild) {
    if (runtimeKey(build) === selectedKey) return;
    void runUpdate(async () => {
      if (management) setManagedSelection(await management.select(build));
      else {
        const choice = choices.find((choice) => runtimeKey(choice.build) === runtimeKey(build));
        const bridge = window.modelLoomRuntime;
        if (!choice || !bridge) throw Error('Runtime unavailable');
        const reply = await bridge.command({ action: 'select-runtime', build: choice.id });
        if (!reply.selectedRuntime) throw Error('Runtime unavailable');
        setManagedSelection(reply.selectedRuntime);
        if (reply.runtimeInventory) setInventory(reply.runtimeInventory);
      }
      setUpdateStatus('Selected for the next model load.');
    }, 'Could not select this runtime. Try again.');
  }

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
          <Button
            disabled={!management || busy}
            title={management ? undefined : 'Runtime updates are unavailable.'}
            onClick={() => {
              if (!management) return;
              setUpdateStatus('Checking for updates…');
              void runUpdate(async () => {
                const releases = await management.checkForUpdates();
                setOffers(releases);
                setUpdateStatus(releases.length ? 'Update available.' : 'Up to date.');
              }, 'Could not check for updates. Try again.');
            }}
          >
            Check for updates
          </Button>
          <Button onClick={() => setManageOpen(true)}>Manage installed runtimes</Button>
        </Row>
        {updateStatus && (
          <p className={styles.runtimeUpdateStatus} role="status">
            {updateStatus}
          </p>
        )}
        {offers.map(({ build, size }) => {
          const key = runtimeKey(build);
          const isInstalled = installed.some((version) => runtimeKey(version) === key);
          return (
            <Row
              key={key}
              label={`${runtimeLabel(build)} · ${runtimeVersion(build)}`}
              description={size}
            >
              {isInstalled ? (
                <Button disabled={busy || selectedKey === key} onClick={() => select(build)}>
                  {selectedKey === key ? 'Selected' : 'Use on next load'}
                </Button>
              ) : (
                <Button
                  disabled={busy}
                  onClick={() => {
                    if (!management) return;
                    setUpdateStatus('Downloading runtime…');
                    void runUpdate(async () => {
                      setManagedInstalled(await management.install(build, setUpdateStatus));
                      setUpdateStatus('Runtime installed.');
                    }, 'Could not install this runtime. Try again.');
                  }}
                >
                  Download and install
                </Button>
              )}
            </Row>
          );
        })}
      </Section>
      <Section title="Runtime selection">
        <Row
          className={styles.runtimeRow ?? ''}
          label="GGUF"
          description="Applies on the next load or reload."
        >
          <div data-runtime-sdk data-theme={resolvedTheme} className={styles.runtimePicker}>
            <Select
              id="gguf-runtime"
              size="md"
              pill={false}
              dropdownIconType="chevronDown"
              block={false}
              disabled={busy || installed.length === 0}
              value={selectedKey}
              placeholder={
                selected
                  ? `${runtimeLabel(selected)} · ${runtimeVersion(selected)}`
                  : status === 'loading'
                    ? 'Checking…'
                    : 'Unavailable'
              }
              options={installed.map((build) => ({
                value: runtimeKey(build),
                label: `${runtimeLabel(build)} · ${runtimeVersion(build)}`,
              }))}
              onChange={(option) => {
                const build = installed.find((build) => runtimeKey(build) === option.value);
                if (build) select(build);
              }}
              triggerClassName={styles.runtimeSelect ?? ''}
              optionClassName={styles.runtimeOption ?? ''}
              OptionView={RuntimeOption}
              listMinWidth={300}
              align="end"
              TriggerView={({ label }) => (
                <>
                  <span className={styles.visuallyHidden}>GGUF runtime: </span>
                  {label}
                </>
              )}
            />
          </div>
        </Row>
        <Row label="Active runtime" description="Runtime used by the loaded model.">
          <span className={styles.muted}>
            {activeRuntime
              ? `${runtimeLabel(activeRuntime)} · ${runtimeVersion(activeRuntime)}`
              : 'No model loaded'}
          </span>
        </Row>
      </Section>
      {manageOpen && (
        <Dialog
          title="Installed runtimes"
          className={styles.runtimeDialog ?? ''}
          onClose={() => setManageOpen(false)}
        >
          {installed.length ? (
            <RuntimeBuilds installed={installed} selected={selected} active={activeRuntime} />
          ) : (
            <p>{description}</p>
          )}
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
            <RuntimeSettings activeRuntime={activeRuntime} selectedRuntime={selectedRuntime} />
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
