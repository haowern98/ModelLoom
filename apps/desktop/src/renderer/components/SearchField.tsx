import { Search } from 'lucide-react';
import type { ReactNode } from 'react';
import styles from './SearchField.module.css';

interface SearchFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  icon?: ReactNode;
}

export function SearchField({ label, value, onChange, icon }: SearchFieldProps) {
  return (
    <label className={styles.field}>
      {icon ?? <Search size={16} aria-hidden="true" />}
      <input
        type="search"
        aria-label={label}
        placeholder={`${label}...`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
