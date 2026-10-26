import { useEffect, useRef, useState } from 'react';
import type { CacheCommand, CachePreferences, CacheView } from '../../../shared/tensor-cache';
import { Button } from '../../components/Button';
import { ConfigurationNumberInput, ConfigurationSelect } from '../models/ConfigurationControls';
import { Row, Section } from './SettingsPage';
import styles from './SettingsPage.module.css';

/** Device-local preferences. The existing settings controls keep their shared
 * typography, spacing, focus handling and keyboard menu behavior. */
export function StorageSettings() {
  const bridge = window.modelLoomCache;
  const [view, setView] = useState<CacheView>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [limit, setLimit] = useState('10');
  const [reserve, setReserve] = useState('5');
  const pending = useRef(false);
  const mounted = useRef(false);
  async function command(input: CacheCommand) {
    if (!bridge || pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const reply = await bridge.command(input);
      if (!mounted.current) return;
      if (!reply.ok) {
        setError(
          reply.error === 'CACHE_BUSY'
            ? 'The cache is in use. Try again shortly.'
            : 'Cache settings could not be updated. Your last saved settings are still shown.',
        );
        return;
      }
      setView(reply.view);
      setLimit(String(reply.view.settings.limitGiB));
      setReserve(String(reply.view.settings.reserveGiB));
      setError(
        reply.view.error === 'CACHE_BUSY'
          ? 'The cache is in use. Try again shortly.'
          : reply.view.error
            ? 'The cache location is unavailable. Model loading can continue without caching.'
            : '',
      );
    } catch {
      if (mounted.current) setError('Cache information is unavailable. Try again.');
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void Promise.resolve().then(() => {
      if (mounted.current) return command({ action: 'read' });
    });
    return () => {
      mounted.current = false;
    };
    // The preload bridge has a fixed identity for this page's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge]);
  const disabled = !bridge || !view || busy;
  const update = (patch: Partial<CachePreferences>) => {
    if (!view) return;
    const { enabled, limitGiB, reserveGiB, policy } = view.settings;
    void command({ action: 'set', settings: { enabled, limitGiB, reserveGiB, policy, ...patch } });
  };
  const numeric = () => {
    const maximum = Number(limit),
      free = Number(reserve);
    if (
      ![maximum, free].every(
        (value) => Number.isSafeInteger(value) && value >= 1 && value <= 1048576,
      )
    ) {
      setError('Enter a whole number from 1 to 1,048,576 GiB.');
      return;
    }
    if (maximum !== view?.settings.limitGiB || free !== view.settings.reserveGiB)
      update({ limitGiB: maximum, reserveGiB: free });
  };
  const used = view?.usedBytes;
  const usage =
    used === undefined
      ? 'Loading…'
      : used === null
        ? 'Usage unavailable'
        : `${used ? (used / 2 ** 30).toFixed(2) + ' GiB' : '0 B'} of ${view!.settings.limitGiB} GiB used`;
  return (
    <>
      <Section title="Tensor cache">
        <Row
          label="Tensor cache"
          description="Reuse model weights on this PC to speed up repeat loads."
        >
          <input
            type="checkbox"
            role="switch"
            className={styles.switch}
            aria-label="Tensor cache"
            checked={view?.settings.enabled ?? true}
            disabled={disabled}
            onChange={(event) => update({ enabled: event.target.checked })}
          />
        </Row>
        <Row label="Cache location" description="Choose where cached tensors are stored.">
          <span className={styles.cachePath} title={view?.settings.location}>
            {view?.settings.location ?? 'Loading…'}
          </span>
          <Button disabled={disabled} onClick={() => void command({ action: 'choose-location' })}>
            Browse
          </Button>
        </Row>
        <Row
          label="Cache size limit"
          description="Maximum disk space the tensor cache can use on this PC."
        >
          <div
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) numeric();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') numeric();
            }}
          >
            <ConfigurationNumberInput
              id="tensor-cache-limit"
              label="Cache size limit"
              value={limit}
              min={1}
              max={1048576}
              step={1}
              disabled={disabled}
              onChange={setLimit}
            />
          </div>
          <span>GiB</span>
        </Row>
        <Row
          label="Keep disk space free"
          description="Pause cache writes before free disk space falls below this amount."
        >
          <div
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) numeric();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') numeric();
            }}
          >
            <ConfigurationNumberInput
              id="tensor-cache-reserve"
              label="Keep disk space free"
              value={reserve}
              min={1}
              max={1048576}
              step={1}
              disabled={disabled}
              onChange={setReserve}
            />
          </div>
          <span>GiB</span>
        </Row>
        <Row
          label="When cache is full"
          description="Choose what happens when a storage limit is reached."
        >
          <div className={styles.cachePolicy}>
            <ConfigurationSelect
              id="tensor-cache-policy"
              label="When cache is full"
              value={view?.settings.policy ?? 'replace'}
              options={[
                { value: 'replace', label: 'Replace least recently used' },
                { value: 'keep', label: 'Keep existing entries' },
              ]}
              disabled={disabled}
              onChange={(value) => update({ policy: value as 'replace' | 'keep' })}
            />
          </div>
        </Row>
        <Row label="Cache usage" description={usage}>
          <Button disabled={disabled || !used} onClick={() => void command({ action: 'clear' })}>
            Clear unused cache
          </Button>
        </Row>
      </Section>
      <p className={styles.notice}>
        Changes apply to the next model load. Cached files can be recreated. Original model files
        are never removed.
      </p>
      {error && (
        <div className={styles.pending} role="alert">
          <p className={styles.description}>{error}</p>
          <Button disabled={busy} onClick={() => void command({ action: 'read' })}>
            Retry
          </Button>
        </div>
      )}
      {!bridge && <p className={styles.notice}>Tensor caching is not available in this build.</p>}
    </>
  );
}
