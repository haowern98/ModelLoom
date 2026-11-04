import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Copy, Eye } from 'lucide-react';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { useApi } from './useApi';
import { RuntimeLogCard } from './RuntimeLogCard';
import { copyText } from '../../components/copyText';
import type { DemoModel } from '../../mocks/modelLibrary';
import { apiExample, exampleLanguages } from './examples';
import type { ExampleLanguage } from './examples';
import styles from './ApiPage.module.css';

interface ApiPageProps {
  activeModel: DemoModel | undefined;
  demo: boolean;
  onCluster: () => void;
}

const serverUnavailable = 'Server integration is not connected.';
const keyUnavailable = 'Key management becomes available with server integration.';

/** Existing API presentation delegates server and key operations through the closed bridge. */
export function ApiPage({ activeModel, demo, onCluster }: ApiPageProps) {
  const [language, setLanguage] = useState<ExampleLanguage>('Python');
  const { status, notice, setNotice, secret, pending, mask, command } = useApi();
  const [replaceKey, setReplaceKey] = useState(false);
  const running = status?.phase === 'running';
  const busy = pending !== null || status?.phase === 'starting' || status?.phase === 'stopping';
  const endpoint = status?.address ?? `http://127.0.0.1:${status?.configuredPort ?? 8000}/v1`;
  const example = apiExample(language, endpoint, status?.model?.id);
  const statistics = [
    ['Uptime', status?.uptimeMs == null ? '—' : `${Math.floor(status.uptimeMs / 1000)} s`],
    ['Requests', status ? String(status.requests) : '—'],
    [
      'Response time',
      status?.responseTimeMs == null ? '—' : `${Math.round(status.responseTimeMs)} ms`,
    ],
  ];
  const copy = async (text: string, message: string) => {
    try {
      await copyText(text);
      setNotice(message);
    } catch {
      setNotice('Could not copy. Select the text and copy it manually.');
    }
  };

  const selectLanguage = (next: ExampleLanguage) => {
    setLanguage(next);
    setNotice('');
  };
  const navigateTabs = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % exampleLanguages.length;
    else if (event.key === 'ArrowLeft')
      nextIndex = (index + exampleLanguages.length - 1) % exampleLanguages.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = exampleLanguages.length - 1;
    else return;
    const next = exampleLanguages[nextIndex];
    if (!next) return;
    event.preventDefault();
    selectLanguage(next);
    document.getElementById(`api-example-tab-${nextIndex}`)?.focus();
  };
  const copyExample = async () => {
    try {
      await copyText(example);
      setNotice('Example copied');
    } catch {
      setNotice('Could not copy. Select the example text and copy it manually.');
    }
  };

  return (
    <section className={styles.page} aria-labelledby="api-heading">
      <header className={styles.header}>
        <h1 id="api-heading">API</h1>
      </header>

      <section className={styles.section} aria-labelledby="api-server-heading">
        <h2 id="api-server-heading">Server</h2>
        <div className={styles.group}>
          <div className={styles.row}>
            <span className={styles.label}>Status</span>
            <div className={styles.controls}>
              <span className={styles.muted}>
                {status
                  ? status.phase.charAt(0).toUpperCase() + status.phase.slice(1)
                  : 'Unavailable'}
              </span>
              <Button
                className={styles.primary}
                disabled={!status || busy || (!running && !status.keyPresent)}
                title={
                  !status
                    ? serverUnavailable
                    : !running && !status.keyPresent
                      ? 'Generate an API key first.'
                      : undefined
                }
                onClick={() => void command(running ? 'stop' : 'start')}
              >
                {pending === 'start'
                  ? 'Starting…'
                  : pending === 'stop'
                    ? 'Stopping…'
                    : running
                      ? 'Stop server'
                      : 'Start server'}
              </Button>
            </div>
          </div>
          <div className={`${styles.row} ${styles.endpointRow}`}>
            <div>
              <span className={styles.label}>Endpoint</span>
              <p className={styles.description}>
                {status?.address
                  ? 'Listening address'
                  : status
                    ? 'Configured address'
                    : 'Example address'}
              </p>
            </div>
            <div
              className={styles.field}
              role="group"
              aria-label={status ? 'API endpoint' : 'Example endpoint'}
            >
              <code>{endpoint}</code>
              <Button
                variant="icon"
                className={styles.icon}
                disabled={!status?.address}
                aria-label="Copy endpoint"
                title={status?.address ? 'Copy listening address' : serverUnavailable}
                onClick={() => void copy(endpoint, 'Endpoint copied')}
              >
                <Copy size={16} aria-hidden="true" />
              </Button>
            </div>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Active model</span>
            <div className={styles.controls}>
              <span className={styles.model} title={status?.model?.id ?? activeModel?.name}>
                {status?.model
                  ? (activeModel?.name ?? 'Loaded model')
                  : demo && activeModel
                    ? `${activeModel.name} (demo)`
                    : 'Not loaded'}
              </span>
              <Button className={styles.utility} onClick={onCluster}>
                Choose in Cluster
              </Button>
            </div>
          </div>
          <div className={styles.statistics}>
            {statistics.map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong aria-label={`${label}: ${value === '—' ? 'unavailable' : value}`}>
                  {value}
                </strong>
              </div>
            ))}
          </div>
          <p className={styles.caption}>
            {status?.error === 'RUNTIME_RECOVERY_REQUIRED'
              ? 'API cleanup could not be confirmed. Stop the shared model before retrying.'
              : running
                ? 'Response time averages completed API requests, including wait time.'
                : 'No API server is running.'}
          </p>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="api-access-heading">
        <h2 id="api-access-heading">Access</h2>
        <div className={styles.group}>
          <div className={styles.row}>
            <div>
              <span className={styles.label}>Network access</span>
              <p className={styles.description}>
                Only this PC can connect when the server is available.
              </p>
            </div>
            <div className={styles.segment} role="group" aria-label="Network access">
              <button
                type="button"
                disabled
                aria-pressed="true"
                title="The server accepts connections from this PC only."
              >
                Local only
              </button>
              <button
                type="button"
                disabled
                aria-pressed="false"
                title="Network serving requires an approved protected connection and is unavailable."
              >
                Network
              </button>
            </div>
          </div>
          <div className={`${styles.row} ${styles.keyRow}`}>
            <div>
              <div className={styles.labelLine}>
                <span className={styles.label}>API key</span>
                <span className={styles.badge}>Required</span>
              </div>
              <p className={styles.description}>Keys are required for API access.</p>
            </div>
            <div className={styles.keyControls}>
              <div
                className={styles.field}
                role="group"
                aria-label="API key status"
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) mask();
                }}
              >
                <span className={styles.muted}>
                  {secret ??
                    (status
                      ? status.keyPresent
                        ? '••••••••••••••••'
                        : 'No key created'
                      : 'Unavailable')}
                </span>
                <Button
                  variant="icon"
                  className={styles.icon}
                  // Disabling this focused button during reveal would mask its own pending reply.
                  disabled={!status?.keyPresent || (busy && pending !== 'revealKey')}
                  aria-label={secret ? 'Hide API key' : 'Reveal API key'}
                  title={status?.keyPresent ? 'Reveal for up to 30 seconds' : keyUnavailable}
                  onClick={() => {
                    if (secret) mask();
                    else void command('revealKey');
                  }}
                >
                  <Eye size={16} aria-hidden="true" />
                </Button>
                <Button
                  variant="icon"
                  className={styles.icon}
                  disabled={!status?.keyPresent || busy}
                  aria-label="Copy API key"
                  title={status?.keyPresent ? 'Copy API key' : keyUnavailable}
                  onClick={() => void command('copyKey')}
                >
                  <Copy size={16} aria-hidden="true" />
                </Button>
              </div>
              <Button
                className={styles.utility}
                disabled={!status || busy}
                title={!status ? keyUnavailable : undefined}
                onClick={() => {
                  mask();
                  if (status?.keyPresent) setReplaceKey(true);
                  else void command('generateKey');
                }}
              >
                {pending === 'generateKey'
                  ? 'Generating…'
                  : status?.keyPresent
                    ? 'Regenerate key'
                    : 'Generate key'}
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="api-integration-heading">
        <h2 id="api-integration-heading">Integration</h2>
        <div className={`${styles.group} ${styles.viewerGroup}`}>
          <div className={styles.viewerToolbar}>
            <div className={styles.tabs} role="tablist" aria-label="Example language">
              {exampleLanguages.map((item, index) => (
                <button
                  key={item}
                  id={`api-example-tab-${index}`}
                  type="button"
                  role="tab"
                  aria-selected={language === item}
                  aria-controls="api-example-panel"
                  tabIndex={language === item ? 0 : -1}
                  onClick={() => selectLanguage(item)}
                  onKeyDown={(event) => navigateTabs(event, index)}
                >
                  {item}
                </button>
              ))}
            </div>
            <Button
              variant="icon"
              className={styles.icon}
              aria-label="Copy example"
              title="Copy example"
              onClick={() => void copyExample()}
            >
              <Copy size={16} aria-hidden="true" />
            </Button>
          </div>
          <pre
            id="api-example-panel"
            className={styles.code}
            role="tabpanel"
            aria-labelledby={`api-example-tab-${exampleLanguages.indexOf(language)}`}
            tabIndex={0}
          >
            <code>{example}</code>
          </pre>
          <p className={styles.description}>
            {status
              ? status.model
                ? 'Text Chat Completions. SDK versions are listed in the development guide.'
                : 'Load a model in Cluster to populate its API identifier.'
              : 'Example only. Server integration is not connected.'}
          </p>
          <p className={styles.notice} role="status">
            {notice}
          </p>
        </div>
      </section>

      <RuntimeLogCard />
      {replaceKey && (
        <Dialog title="Generate replacement key?" onClose={() => setReplaceKey(false)}>
          <p>Existing clients will need the new key. Active API requests will be cancelled.</p>
          <footer>
            <Button onClick={() => setReplaceKey(false)}>Cancel</Button>
            <Button
              onClick={() => {
                setReplaceKey(false);
                void command('generateKey');
              }}
            >
              Regenerate key
            </Button>
          </footer>
        </Dialog>
      )}
    </section>
  );
}
