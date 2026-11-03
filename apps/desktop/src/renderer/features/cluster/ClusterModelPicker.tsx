import { useEffect, useId, useRef, useState } from 'react';
import { CaretDown as ChevronDown } from '@phosphor-icons/react/dist/csr/CaretDown';
import type { DemoModel } from '../../mocks/modelLibrary';
import styles from './ClusterPage.module.css';
import { useDropdownPosition } from '../../components/useDropdownPosition';

/** Library selection plans a model only; the caller opens placement choices before committing. */
export function ClusterModelPicker({
  models,
  selectedModel,
  activeModelId,
  disabled,
  onChoose,
  onClear,
  local = false,
}: {
  models: readonly DemoModel[];
  selectedModel: DemoModel | undefined;
  activeModelId: string | undefined;
  disabled: boolean;
  onChoose: (model: DemoModel) => void;
  onClear?: () => void;
  local?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const position = useDropdownPosition(open, trigger, menu, models);
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
        aria-label={
          selectedModel
            ? `Selected ${local ? 'local' : 'demo'} model: ${selectedModel.name}`
            : 'Choose model'
        }
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
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label="Model library"
          className={styles.modelMenu}
          style={position}
        >
          {onClear && (
            <>
              <button
                type="button"
                role="menuitem"
                aria-current={selectedModel ? undefined : 'true'}
                className={styles.modelOption}
                onClick={() => {
                  close();
                  if (selectedModel) onClear();
                }}
              >
                No model
              </button>
              <div role="separator" className={styles.modelMenuDivider} />
            </>
          )}
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
