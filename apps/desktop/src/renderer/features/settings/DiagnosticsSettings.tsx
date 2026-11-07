import { useState } from 'react';
import { version } from '../../../../package.json';
import type { RuntimeLogEntry } from '../../../shared/runtime-logs';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { copyText } from '../../components/copyText';
import { useRuntimeLogs } from '../api/useRuntimeLogs';
import { Row, Section } from './SettingsPage';
import styles from './SettingsPage.module.css';

const rpcPhases = [
  'status',
  'overlay',
  'tls',
  'upgrade',
  'gateway-open',
  'worker-start',
  'lease',
  'forwarding',
];
const rpcEvents = ['begin', 'ready', 'end', 'close', 'error', 'owner-close'];
const runtimeStages = {
  'load.preflight': 'Preflight',
  'load.begin': 'Load started',
  'load.memory-admitted': 'Memory admitted',
  'native.launch': 'Engine launch',
  'native.captured': 'Engine process started',
  'native.ready': 'Engine ready',
} as const;

type Failure = {
  at: string;
  title: string;
  code: string;
  stage?: string;
  events: string[];
};

function rpcEvent(message: string) {
  if (!message.startsWith('rpc.lifecycle ')) return;
  try {
    const parsed: unknown = JSON.parse(message.slice('rpc.lifecycle '.length));
    if (!parsed || typeof parsed !== 'object') return;
    const { connection, role, phase, event, code } = parsed as Record<string, unknown>;
    if (
      typeof connection === 'string' &&
      /^[a-f0-9-]{36}$/u.test(connection) &&
      typeof role === 'string' &&
      ['client', 'gateway', 'worker'].includes(role) &&
      typeof phase === 'string' &&
      rpcPhases.includes(phase) &&
      typeof event === 'string' &&
      rpcEvents.includes(event)
    ) {
      return {
        key: `${connection}:${role}`,
        phase,
        event,
        code: typeof code === 'string' && /^[A-Z_][A-Z0-9_]{0,63}$/u.test(code) ? code : 'UNKNOWN',
      };
    }
  } catch {
    // A malformed log entry cannot contribute to the support report.
  }
}

/** Project known event fields only. Raw log messages never enter the report. */
function recentFailure(entries: readonly RuntimeLogEntry[]): Failure | undefined {
  const rpc = new Map<string, string[]>();
  let loadStages: string[] = [];
  let failure: Failure | undefined;
  for (const { at, source, message } of entries) {
    if (source === 'peer') {
      const entry = rpcEvent(message);
      if (!entry) continue;
      const events = [...(rpc.get(entry.key) ?? []).slice(-5), `${entry.phase} · ${entry.event}`];
      rpc.set(entry.key, events);
      if (entry.event === 'error') {
        failure = {
          at,
          title: `Peer connection failed during RPC ${entry.phase}`,
          code: entry.code,
          events,
        };
      }
    } else if (source === 'runtime') {
      const stage = message.split(' ', 1)[0] ?? '';
      if (stage === 'load.preflight') loadStages = [];
      if (stage === 'load.begin' && loadStages.at(-1) !== runtimeStages['load.preflight'])
        loadStages = [];
      if (Object.hasOwn(runtimeStages, stage)) {
        loadStages.push(runtimeStages[stage as keyof typeof runtimeStages]);
      }
      const code = /^load\.failed code=([A-Z_]{1,64})$/u.exec(message)?.[1];
      if (code) {
        const last = loadStages.at(-1);
        failure = {
          at,
          title: 'Model load failed',
          code,
          ...(last ? { stage: last } : {}),
          events: [...loadStages.slice(-5), 'Load failed'],
        };
        loadStages = [];
      }
    } else if (source === 'chat' || source === 'api') {
      const outcome = /^request\.(failed|interrupted) id=\S+ reason=([A-Z_]{1,64})$/u.exec(message);
      const code = outcome?.[2];
      if (code) {
        const status = outcome[1] === 'interrupted' ? 'interrupted' : 'failed';
        failure = {
          at,
          title: `${source === 'chat' ? 'Chat' : 'API'} generation ${status}`,
          code,
          events: [`Generation ${status}`],
        };
      }
    }
  }
  return failure;
}

function platformName() {
  if (/^Win/u.test(navigator.platform)) return 'Windows';
  if (/^Mac/u.test(navigator.platform)) return 'macOS';
  if (/^Linux/u.test(navigator.platform)) return 'Linux';
  return 'Unknown';
}

export function DiagnosticsSettings({ onApi }: { onApi: () => void }) {
  const { entries, readStatus } = useRuntimeLogs();
  const failure = recentFailure(entries);
  const [report, setReport] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const preview = () => {
    setCopyStatus('');
    setReport(
      [
        `ModelLoom ${version}`,
        `OS: ${platformName()}`,
        '',
        ...(failure
          ? [
              failure.title,
              `Time (UTC): ${failure.at}`,
              `Code: ${failure.code}`,
              'Related events:',
              ...failure.events.map((event) => `- ${event}`),
            ]
          : ['No supported failures in the available runtime logs.']),
      ].join('\n'),
    );
  };

  return (
    <>
      <Section title="Recent failures">
        <Row
          label={
            failure?.title ??
            (readStatus === 'loading'
              ? 'Checking runtime logs…'
              : readStatus === 'unavailable'
                ? 'Runtime logs unavailable'
                : 'No recent failures found')
          }
          {...(failure
            ? {
                description: [failure.code, failure.stage, new Date(failure.at).toLocaleString()]
                  .filter(Boolean)
                  .join(' · '),
              }
            : {})}
        >
          <Button onClick={onApi}>Runtime logs in API</Button>
        </Row>
      </Section>
      <Section title="Support report">
        <Row
          label="Troubleshooting summary"
          description="Preview app and system information and the latest failure before sharing."
        >
          <Button onClick={preview} disabled={readStatus !== 'ready'}>
            Preview report
          </Button>
        </Row>
      </Section>
      {report !== null && (
        <Dialog title="Support report" onClose={() => setReport(null)}>
          <pre className={styles.supportReport} tabIndex={0} aria-label="Support report contents">
            {report}
          </pre>
          <Button
            onClick={() =>
              void copyText(report).then(
                () => setCopyStatus('Support report copied.'),
                () => setCopyStatus('Could not copy the support report.'),
              )
            }
          >
            Copy support report
          </Button>
          <p className={styles.description} role="status">
            {copyStatus}
          </p>
        </Dialog>
      )}
    </>
  );
}
