import styles from './Brand.module.css';

export function Brand() {
  return (
    <span className={styles.brand}>
      <svg viewBox="0 0 28 28" width="23" height="23" aria-hidden="true">
        <path d="M5 7c0-5 7-5 7 0v14c0 5-7 5-7 0z" fill="#078aff" />
        <path d="M12 8c0-4 5-5 6-1l3 15c1 4-4 6-5 2z" fill="#409dff" />
        <path d="M20 4c2 0 3 1 3 3l2 13c0 2-2 4-3 2L18 7c0-2 0-3 2-3" fill="#92c8ff" />
        <path d="M10 8v13" stroke="#151c35" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span>ModelLoom</span>
    </span>
  );
}
