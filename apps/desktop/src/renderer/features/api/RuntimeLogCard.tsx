import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Copy, Trash2 } from 'lucide-react';
import { Button } from '../../components/Button';
import { Toast } from '../../components/Toast';
import type { ToastMessage } from '../../components/Toast';
import { copyText } from '../../components/copyText';
import { useRuntimeLogs } from './useRuntimeLogs';
import type { RuntimeLogEntry } from '../../../shared/runtime-logs';
import styles from './RuntimeLogCard.module.css';

const rowHeight = 22;
const sourceLabels = {
  app: 'App',
  runtime: 'Runtime',
  core: 'Core',
  peer: 'RPC',
  worker: 'Worker',
  chat: 'Chat',
  api: 'API',
};
const format = (entry: RuntimeLogEntry) =>
  `${new Date(entry.at).toLocaleTimeString('en-GB', { hour12: false })}  [${sourceLabels[entry.source]}] ${entry.message}`;
function displayMessage(entry: RuntimeLogEntry): string {
  if (entry.source !== 'peer') return entry.message;
  try {
    const parsed: unknown = JSON.parse(entry.message);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return entry.message;
    const stage: unknown = Reflect.get(parsed, 'stage'),
      decision: unknown = Reflect.get(parsed, 'decision'),
      code: unknown = Reflect.get(parsed, 'code');
    if (
      typeof stage !== 'string' ||
      !/^[a-z-]{1,32}$/u.test(stage) ||
      typeof decision !== 'string' ||
      !['retry', 'disconnect', 'close'].includes(decision) ||
      typeof code !== 'string' ||
      !/^[A-Z_]{1,64}$/u.test(code)
    )
      return entry.message;
    const details = ['cause', 'transport']
      .map((key): unknown => Reflect.get(parsed, key))
      .filter(
        (value): value is string => typeof value === 'string' && /^[A-Z_]{1,64}$/u.test(value),
      );
    return `${code}: ${stage}.${decision}${details.length ? ` (${details.join(', ')})` : ''}`;
  } catch {
    return entry.message;
  }
}
export function RuntimeLogCard() {
  const { entries, busy, clear } = useRuntimeLogs();
  const [notification, setNotification] = useState<ToastMessage | null>(null);
  const notificationId = useRef(0),
    fallback = useRef<HTMLButtonElement>(null);
  const dismissNotification = useCallback(() => setNotification(null), []);
  const notify = (kind: ToastMessage['kind'], message: string, origin: HTMLElement | null) =>
    setNotification({ id: ++notificationId.current, kind, message, origin });
  const [filter, setFilter] = useState<'all' | 'error'>('all');
  const [scrollTop, setScrollTop] = useState(0),
    [height, setHeight] = useState(360);
  const viewport = useRef<HTMLDivElement>(null),
    following = useRef(true);
  const rows = useMemo(
    () => (filter === 'all' ? entries : entries.filter((entry) => entry.level === 'error')),
    [entries, filter],
  );
  useLayoutEffect(() => {
    const viewer = viewport.current;
    if (!viewer) return;
    const update = () => setHeight(viewer.clientHeight || 360);
    update();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    observer?.observe(viewer);
    return () => observer?.disconnect();
  }, []);
  useLayoutEffect(() => {
    const viewer = viewport.current;
    if (viewer) {
      const maximum = Math.max(0, viewer.scrollHeight - viewer.clientHeight);
      viewer.scrollTop = following.current ? maximum : Math.min(viewer.scrollTop, maximum);
      setScrollTop(viewer.scrollTop);
    }
  }, [rows, height]);
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - 5);
  const visible = rows.slice(first, first + Math.ceil(height / rowHeight) + 10);
  const copy = async () => {
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    try {
      await copyText(rows.map(format).join('\n'));
      notify('success', 'Logs copied', origin);
    } catch {
      notify('error', 'Could not copy logs', origin);
    }
  };
  const clearLogs = async () => {
    const cleared = await clear();
    if (cleared !== undefined)
      notify(
        cleared ? 'success' : 'error',
        cleared ? 'Logs cleared' : 'Could not clear logs',
        fallback.current,
      );
  };
  return (
    <section className={styles.section} aria-labelledby="runtime-logs-heading">
      {notification && (
        <Toast
          key={notification.id}
          notification={notification}
          fallbackRef={fallback}
          onDismiss={dismissNotification}
        />
      )}
      <h2 id="runtime-logs-heading">Runtime logs</h2>
      <div className={styles.card}>
        <div className={styles.toolbar}>
          <div className={styles.filters} role="group" aria-label="Filter runtime logs">
            <button
              ref={fallback}
              type="button"
              aria-pressed={filter === 'all'}
              onClick={() => {
                following.current = true;
                setFilter('all');
              }}
            >
              All
            </button>
            <button
              type="button"
              aria-pressed={filter === 'error'}
              onClick={() => {
                following.current = true;
                setFilter('error');
              }}
            >
              Errors
            </button>
          </div>
          <div className={styles.actions}>
            <Button
              variant="icon"
              className={styles.action}
              aria-label="Copy runtime logs"
              title="Copy runtime logs"
              disabled={!rows.length}
              onClick={() => void copy()}
            >
              <Copy size={18} aria-hidden="true" />
            </Button>
            <Button
              variant="icon"
              className={styles.action}
              aria-label="Clear runtime logs"
              title="Clear this viewer"
              disabled={!entries.length || busy}
              onClick={() => void clearLogs()}
            >
              <Trash2 size={18} aria-hidden="true" />
            </Button>
          </div>
        </div>
        <div
          ref={viewport}
          className={styles.viewer}
          role="log"
          aria-label="Runtime log viewer"
          aria-live="off"
          tabIndex={0}
          onScroll={(event) => {
            const viewer = event.currentTarget;
            following.current = viewer.scrollHeight - viewer.scrollTop - viewer.clientHeight < 24;
            setScrollTop(viewer.scrollTop);
          }}
        >
          {!rows.length ? (
            <span className={styles.empty}>
              {filter === 'error' ? 'No errors.' : 'Waiting for runtime events.'}
            </span>
          ) : (
            <div className={styles.canvas} style={{ height: rows.length * rowHeight }}>
              {visible.map((entry, index) => (
                <div
                  data-testid="runtime-log-row"
                  className={styles.logRow}
                  key={entry.id}
                  style={{ top: (first + index) * rowHeight }}
                >
                  <span className={styles.time}>
                    {new Date(entry.at).toLocaleTimeString('en-GB', { hour12: false })}
                  </span>
                  <span className={styles.source}>[{sourceLabels[entry.source]}]</span>
                  <span>{displayMessage(entry)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
