import type { Ref } from 'react';
import { CaretUp } from '@phosphor-icons/react/dist/csr/CaretUp';
import { CaretDown } from '@phosphor-icons/react/dist/csr/CaretDown';
import styles from './ClusterPage.module.css';

/** Keeps typed drafts intact; only step controls enforce the model's layer bounds. */
export function LayerNumberInput({
  id,
  label,
  value,
  maximum,
  disabled,
  invalid,
  describedBy,
  inputRef,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  maximum: number;
  disabled: boolean;
  invalid: boolean;
  describedBy?: string | undefined;
  inputRef?: Ref<HTMLInputElement>;
  placeholder?: string | undefined;
  onChange: (value: string) => void;
}) {
  const number = value.trim() === '' ? NaN : Number(value);
  const valid = Number.isInteger(number) && number >= 0 && number <= maximum;
  const canIncrease = !disabled && valid && number < maximum;
  const canDecrease = !disabled && valid && number > 0;
  const step = (direction: number) => {
    if (direction > 0 ? canIncrease : canDecrease) onChange(String(number + direction));
  };
  return (
    <span className={styles.layerNumberField}>
      <input
        ref={inputRef}
        id={id}
        aria-label={label}
        role="spinbutton"
        aria-valuemin={0}
        aria-valuemax={maximum >= 0 ? maximum : undefined}
        aria-valuenow={valid ? number : undefined}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        disabled={disabled}
        type="text"
        inputMode="numeric"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            step(event.key === 'ArrowUp' ? 1 : -1);
          }
        }}
      />
      <span className={styles.layerStepper}>
        <button
          type="button"
          aria-label={`Increase ${label.toLowerCase()}`}
          disabled={!canIncrease}
          onClick={() => step(1)}
        >
          <CaretUp size={12} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={`Decrease ${label.toLowerCase()}`}
          disabled={!canDecrease}
          onClick={() => step(-1)}
        >
          <CaretDown size={12} aria-hidden="true" />
        </button>
      </span>
    </span>
  );
}
