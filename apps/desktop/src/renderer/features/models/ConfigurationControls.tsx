import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CaretUp } from '@phosphor-icons/react/dist/csr/CaretUp';
import { CaretDown } from '@phosphor-icons/react/dist/csr/CaretDown';
import styles from './ConfigurationControls.module.css';
import { useDropdownPosition } from '../../components/useDropdownPosition';

function decimalPlaces(value: number): number {
  const [coefficient = '', exponent = '0'] = String(value).split('e');
  return Math.max(0, (coefficient.split('.')[1]?.length ?? 0) - Number(exponent));
}

/** Cluster's menu interaction and visual treatment within the existing settings column. */
export function ConfigurationSelect({
  id,
  label,
  value,
  options,
  disabled = false,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly { value: string; label: string; disabled?: boolean }[];
  disabled?: boolean;
  onChange?: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const position = useDropdownPosition(open, trigger, menu, options);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const selected = menu.current?.querySelector<HTMLButtonElement>(
      '[aria-selected="true"]:not(:disabled)',
    );
    (
      selected ?? menu.current?.querySelector<HTMLButtonElement>('[role="option"]:not(:disabled)')
    )?.focus();
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !anchor.current?.contains(event.target) &&
        !menu.current?.contains(event.target)
      )
        setOpen(false);
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
      className={styles.select}
      onBlur={(event) => {
        if (
          !event.currentTarget.contains(event.relatedTarget) &&
          !menu.current?.contains(event.relatedTarget)
        )
          setOpen(false);
      }}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === 'Tab' && open) close();
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
            ...(menu.current?.querySelectorAll<HTMLButtonElement>(
              '[role="option"]:not(:disabled)',
            ) ?? []),
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
        id={id}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className={styles.selectTrigger}
        disabled={disabled}
        value={value}
        onClick={() => setOpen(!open)}
      >
        <span>{options.find((option) => option.value === value)?.label}</span>
        <CaretDown size={14} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={menuId}
            role="listbox"
            aria-label={label}
            className={styles.selectMenu}
            style={position}
          >
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={option.value === value}
                disabled={option.disabled}
                className={styles.selectOption}
                onClick={() => {
                  onChange?.(option.value);
                  close();
                }}
              >
                {option.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** Preserve typed drafts; layer-style arrows apply the setting's own bounds and step. */
export function ConfigurationNumberInput({
  id,
  label,
  value,
  min,
  max,
  step,
  disabled = false,
  inactive,
  invalid,
  describedBy,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  min: number;
  max?: number | undefined;
  step: number;
  disabled?: boolean;
  inactive?: string | undefined;
  invalid?: boolean;
  describedBy?: string | undefined;
  placeholder?: string | undefined;
  onChange: (value: string) => void;
}) {
  const current = Number(value);
  const valid =
    value.trim() !== '' &&
    Number.isFinite(current) &&
    current >= min &&
    (max === undefined || current <= max) &&
    (step !== 1 || Number.isSafeInteger(current));
  const next = (direction: number) => {
    if (disabled || !valid) return undefined;
    const sum = current + direction * step;
    // Remove arithmetic noise without rounding away a typed value's decimal places.
    const stepped =
      step === 1
        ? sum
        : Number(sum.toFixed(Math.min(100, Math.max(decimalPlaces(current), decimalPlaces(step)))));
    const candidate = Math.min(max ?? Infinity, Math.max(min, stepped));
    return Number.isFinite(candidate) &&
      candidate !== current &&
      (step !== 1 || Number.isSafeInteger(candidate))
      ? candidate
      : undefined;
  };
  const change = (direction: number) => {
    const candidate = next(direction);
    if (candidate !== undefined) onChange(String(candidate));
  };
  return (
    <span className={styles.numberField}>
      <input
        id={id}
        aria-label={label}
        className={styles.numberInput}
        type={disabled && inactive ? 'text' : 'number'}
        inputMode={step === 1 ? 'numeric' : 'decimal'}
        min={min}
        max={max}
        step="any"
        value={disabled && inactive ? inactive : value}
        disabled={disabled}
        aria-invalid={Boolean(invalid)}
        aria-describedby={describedBy}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            change(event.key === 'ArrowUp' ? 1 : -1);
          }
        }}
      />
      <span className={styles.stepper}>
        <button
          type="button"
          aria-label={`Increase ${label.toLowerCase()}`}
          disabled={next(1) === undefined}
          onClick={() => change(1)}
        >
          <CaretUp size={12} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={`Decrease ${label.toLowerCase()}`}
          disabled={next(-1) === undefined}
          onClick={() => change(-1)}
        >
          <CaretDown size={12} aria-hidden="true" />
        </button>
      </span>
    </span>
  );
}
