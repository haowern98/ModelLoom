import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { ModelLogo } from '../../components/Brand';
import type { DemoModel } from '../../mocks/modelLibrary';
import styles from './ClusterPage.module.css';

/** Library selection plans a model only; the caller opens placement choices before committing. */
export function ClusterModelPicker({
  models,
  selectedModel,
  activeModelId,
  disabled,
  onChoose,
}: {
  models: readonly DemoModel[];
  selectedModel: DemoModel | undefined;
  activeModelId: string | undefined;
  disabled: boolean;
  onChoose: (model: DemoModel) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    anchor.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !anchor.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div
      ref={anchor}
      className={styles.modelPicker}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          close();
        }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          if (!open) {
            setOpen(true);
            return;
          }
          const items = [
            ...(anchor.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
          ];
          const current = items.findIndex((item) => item === document.activeElement);
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? items.length - 1
                : (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
          items[next]?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className={styles.model}
        aria-label={selectedModel ? `Selected demo model: ${selectedModel.name}` : 'Choose model'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={selectedModel?.name ?? 'Choose model'}
        disabled={disabled || !models.length}
        onClick={() => setOpen(!open)}
      >
        <span className={styles.modelName}>{selectedModel?.name ?? 'Choose model'}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label="Model library" className={styles.modelMenu}>
          {models.map((model) => (
            <button
              key={model.id}
              type="button"
              role="menuitem"
              aria-current={model.id === selectedModel?.id ? 'true' : undefined}
              className={styles.modelOption}
              onClick={() => {
                close();
                onChoose(model);
              }}
            >
              <ModelLogo family={model.family} />
              <span>
                <strong>{model.name}</strong>
                <small>
                  {model.size} · GGUF · {model.quantization}
                </small>
              </span>
              {model.id === activeModelId && <small>Running</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
