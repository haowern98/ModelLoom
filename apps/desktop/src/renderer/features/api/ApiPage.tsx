import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Copy, Eye, Trash2 } from 'lucide-react';
import { Button } from '../../components/Button';
import { copyText } from '../../components/copyText';
import type { DemoModel } from '../../mocks/modelLibrary';
import { apiExamples, exampleLanguages } from './examples';
import type { ExampleLanguage } from './examples';
import styles from './ApiPage.module.css';

interface ApiPageProps {
  activeModel: DemoModel | undefined;
  demo: boolean;
  onCluster: () => void;
}

const serverUnavailable = 'Server integration is not connected.';
const keyUnavailable = 'Key management becomes available with server integration.';

/** Renderer-only API presentation. It never binds a port, creates credentials or runs examples. */
export function ApiPage({ activeModel, demo, onCluster }: ApiPageProps) {
  const [language, setLanguage] = useState<ExampleLanguage>('Python');
  const [notice, setNotice] = useState('');

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
      await copyText(apiExamples[language]);
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
              <span className={styles.muted}>Stopped</span>
              <Button className={styles.primary} disabled title={serverUnavailable}>
                Start server
              </Button>
            </div>
          </div>
          <div className={`${styles.row} ${styles.endpointRow}`}>
            <div>
              <span className={styles.label}>Endpoint</span>
              <p className={styles.description}>Example address</p>
            </div>
            <div className={styles.field} role="group" aria-label="Example endpoint">
              <code>http://127.0.0.1:8000/v1</code>
              <Button
                variant="icon"
                className={styles.icon}
                disabled
                aria-label="Copy endpoint"
                title={serverUnavailable}
              >
                <Copy size={16} aria-hidden="true" />
              </Button>
            </div>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Active model</span>
            <div className={styles.controls}>
              <span className={styles.model} title={activeModel?.name}>
                {demo && activeModel ? `${activeModel.name} (demo)` : 'Not loaded'}
              </span>
              <Button className={styles.utility} onClick={onCluster}>
                Choose in Cluster
              </Button>
            </div>
          </div>
          <div className={styles.statistics}>
            {['Uptime', 'Requests', 'Response time'].map((label) => (
              <div key={label}>
                <span>{label}</span>
                <strong aria-label={`${label}: unavailable`}>—</strong>
              </div>
            ))}
          </div>
          <p className={styles.caption}>No API server is running.</p>
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
              <button type="button" disabled aria-pressed="true" title={serverUnavailable}>
                Local only
              </button>
              <button type="button" disabled aria-pressed="false" title={serverUnavailable}>
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
              <div className={styles.field} role="group" aria-label="API key status">
                <span className={styles.muted}>No key created</span>
                <Button
                  variant="icon"
                  className={styles.icon}
                  disabled
                  aria-label="Reveal API key"
                  title={keyUnavailable}
                >
                  <Eye size={16} aria-hidden="true" />
                </Button>
                <Button
                  variant="icon"
                  className={styles.icon}
                  disabled
                  aria-label="Copy API key"
                  title={keyUnavailable}
                >
                  <Copy size={16} aria-hidden="true" />
                </Button>
              </div>
              <Button className={styles.utility} disabled title={keyUnavailable}>
                Generate key
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
            <code>{apiExamples[language]}</code>
          </pre>
          <p className={styles.description}>Example only. Server integration is not connected.</p>
          <p className={styles.notice} role="status">
            {notice}
          </p>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="api-logs-heading">
        <h2 id="api-logs-heading">Server logs</h2>
        <div className={`${styles.group} ${styles.viewerGroup}`}>
          <div className={`${styles.viewerToolbar} ${styles.logToolbar}`}>
            <Button
              className={styles.utility}
              disabled
              aria-label="Copy server logs"
              title="There are no server logs to copy."
            >
              <Copy size={16} aria-hidden="true" />
              Copy
            </Button>
            <Button
              className={styles.utility}
              disabled
              aria-label="Clear server logs"
              title="There are no server logs to clear."
            >
              <Trash2 size={16} aria-hidden="true" />
              Clear
            </Button>
          </div>
          <pre
            className={`${styles.code} ${styles.logs}`}
            tabIndex={0}
            aria-label="Server log viewer"
          >
            No server logs yet.
          </pre>
          <p className={styles.description}>
            Logs appear here when server integration is available.
          </p>
        </div>
      </section>
    </section>
  );
}
