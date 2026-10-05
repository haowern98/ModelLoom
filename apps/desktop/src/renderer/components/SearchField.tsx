import { Search } from 'lucide-react';
import styles from './SearchField.module.css';

interface SearchFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

export function SearchField({ label, value, onChange }: SearchFieldProps) {
  return (
    <label className={styles.field}>
      <Search size={16} aria-hidden="true" />
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
