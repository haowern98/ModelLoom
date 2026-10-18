import { useEffect, useRef, useState } from 'react';
import { Ellipsis, Settings } from 'lucide-react';
import type { DemoModel } from '../../mocks/modelLibrary';
import styles from './ModelRow.module.css';
import { formatLastUsed, lastUsedTooltip } from './last-used';

interface ModelRowProps {
  model: DemoModel;
  active: boolean;
  onRemove: () => void;
  onDetails: () => void;
  onConfigure: () => void;
  indexing?: boolean;
  unavailable?: boolean;
  now?: number;
}

export function ModelRow({
  model,
  active,
  onRemove,
  onDetails,
  onConfigure,
  indexing = false,
  unavailable = false,
  now,
}: ModelRowProps) {
  const [initialNow] = useState(Date.now);
  const lastUsed = formatLastUsed(model.lastUsedAt, now ?? initialNow);
  const [menuOpen, setMenuOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !anchorRef.current?.contains(event.target))
        setMenuOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [menuOpen]);

  const openAction = (action: () => void) => {
    setMenuOpen(false);
    triggerRef.current?.focus();
    action();
  };

  return (
    <article aria-label={model.name} aria-busy={indexing || undefined} className={styles.row}>
      <div className={styles.identity}>
        <div className={styles.modelText}>
          <div className={styles.nameRow}>
            <h2 title={model.name}>{model.name}</h2>
            {!indexing && (
              <div className={styles.chips} role="group" aria-label={`Metadata for ${model.name}`}>
                <span title="File size">{model.size}</span>
                <span title="File format">GGUF</span>
                <span title="Quantization">{model.quantization}</span>
              </div>
            )}
          </div>
          {indexing ? (
            <p role="status" className={styles.indexing}>
              <span className={styles.spinner} aria-hidden="true" />
              Indexing…
            </p>
          ) : (
            <p title={unavailable ? model.description : model.identifier}>
              {unavailable ? model.description : model.identifier}
            </p>
          )}
        </div>
      </div>
      {!indexing && (
        <span
          className={styles.lastUsed}
          aria-label={`Last used: ${lastUsed === '—' ? 'unknown' : lastUsed}`}
          title={lastUsedTooltip(model.lastUsedAt)}
        >
          {lastUsed}
        </span>
      )}
      {!indexing && (
        <div className={styles.actions}>
          <div
            ref={anchorRef}
            className={styles.menuAnchor}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setMenuOpen(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && menuOpen) {
                event.stopPropagation();
                setMenuOpen(false);
                triggerRef.current?.focus();
              }
            }}
          >
            <button
              ref={triggerRef}
              type="button"
              className={styles.iconButton}
              aria-label={`Actions for ${model.name}`}
              title={`Actions for ${model.name}`}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <Ellipsis size={18} aria-hidden="true" />
            </button>
            {menuOpen && (
              <div className={styles.menu} role="group" aria-label={`Options for ${model.name}`}>
                <button type="button" onClick={() => openAction(onDetails)}>
                  Model details
                </button>
                <button
                  type="button"
                  disabled={active}
                  title={
                    active ? 'Stop this model in Cluster before removing its entry' : undefined
                  }
                  onClick={() => openAction(onRemove)}
                >
                  Remove model entry
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={`Configure ${model.name}`}
            title={`Configure ${model.name}`}
            onClick={onConfigure}
            disabled={unavailable}
          >
            <Settings size={18} aria-hidden="true" />
          </button>
        </div>
      )}
    </article>
  );
}
