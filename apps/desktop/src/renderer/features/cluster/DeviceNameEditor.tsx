import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import type { DemoDevice } from '../../mocks/cluster';
import styles from './ClusterPage.module.css';

/** Edits only a friendly display name; device identity and placement are unchanged. */
export function DeviceNameEditor({
  device,
  onSave,
  onCancel,
}: {
  device: DemoDevice;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(device.name);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    // Focus after the surrounding panel takes its initial keyboard focus.
    queueMicrotask(() => {
      input.current?.focus();
      input.current?.select();
    });
  }, []);
  return (
    <form
      className={styles.nameEditor}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          event.preventDefault();
          onCancel();
        }
      }}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const next = name.trim();
        if (!next || next.length > 64) {
          setError(next ? 'Use 64 characters or fewer.' : 'Enter a device name.');
          input.current?.focus();
          return;
        }
        onSave(next);
      }}
    >
      <label className={styles.renameField} htmlFor={id}>
        Device name
        <input
          ref={input}
          id={id}
          value={name}
          maxLength={64}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => {
            setName(event.target.value);
            setError('');
          }}
        />
      </label>
      {error && (
        <p className={styles.error} id={`${id}-error`}>
          {error}
        </p>
      )}
      <div className={styles.nameActions}>
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="submit" className={styles.whiteAction}>
          Save name
        </Button>
      </div>
    </form>
  );
}
