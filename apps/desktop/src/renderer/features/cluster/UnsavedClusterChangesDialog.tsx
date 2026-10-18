import { useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { Button } from '../../components/Button';
import styles from './ClusterPage.module.css';

/** Departure is committed only after the selected Save or Discard operation succeeds. */
export function UnsavedClusterChangesDialog({
  modelName,
  saved,
  busy,
  onClose,
  onSave,
  onDiscard,
}: {
  modelName: string;
  saved: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (name: string | null) => Promise<boolean>;
  onDiscard: () => Promise<boolean>;
}) {
  const [name, setName] = useState(modelName.slice(0, 80));
  const [error, setError] = useState('');
  return (
    <Dialog
      title="Unsaved changes"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p>You have unsaved assignment changes. Save them before leaving?</p>
      {!saved && (
        <label className={styles.renameField}>
          Configuration name
          <input
            aria-label="Configuration name"
            value={name}
            maxLength={80}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
      )}
      {error && <p role="alert">{error}</p>}
      <footer>
        <Button
          variant="primary"
          disabled={busy || (!saved && !name.trim())}
          onClick={() => {
            setError('');
            void onSave(saved ? null : name.trim()).then((success) => {
              if (!success) setError('Changes could not be saved. Your edits are still here.');
            });
          }}
        >
          Save changes
        </Button>
        <Button
          disabled={busy}
          onClick={() => {
            setError('');
            void onDiscard().then((success) => {
              if (!success) setError('Changes could not be discarded. Your edits are still here.');
            });
          }}
        >
          Discard changes
        </Button>
      </footer>
    </Dialog>
  );
}
