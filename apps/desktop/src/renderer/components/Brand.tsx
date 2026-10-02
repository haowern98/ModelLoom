import type { DemoModel } from '../mocks/modelLibrary';
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

/** Decorative marks reconstructed from the reference; display names remain readable text. */
export function ModelLogo({ family }: { family: DemoModel['family'] }) {
  switch (family) {
    case 'qwen':
      return (
        <svg className={styles.logo} viewBox="0 0 48 48" aria-hidden="true">
          <defs>
            <linearGradient id="qwen" x1="0" y1="0" x2="1" y2="1">
              <stop stopColor="#a5abff" />
              <stop offset="1" stopColor="#593dff" />
            </linearGradient>
          </defs>
          <path
            d="m17 3 7 8 11-2 3 10 7 6-7 7-2 11-11-1-8 4-7-10-8-5 5-10 2-10z"
            fill="url(#qwen)"
          />
          <path
            d="m14 12 21 1-11 22-10-23 22 21H12l12-22"
            fill="none"
            stroke="#eff0ff"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'llama':
      return (
        <svg className={styles.logo} viewBox="0 0 50 48" aria-hidden="true">
          <path
            d="M4 31C4 17 11 7 17 11c8 5 12 25 20 25 12 0 9-27 2-26-7 0-11 13-17 23C10 50 4 37 4 31Z"
            fill="none"
            stroke="#008bff"
            strokeWidth="5"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'mistral':
      return (
        <svg className={styles.logo} viewBox="0 0 48 48" aria-hidden="true">
          <path d="M3 4h9v9h9v9h7v-9h9V4h9v42H35V30H14v16H3z" fill="#ff9b15" />
          <path d="M3 4h9v9H3zm34 0h9v9h-9z" fill="#ffe438" />
          <path d="M3 30h11v16H3zm32 0h11v16H35z" fill="#ff432d" />
          <path d="M3 22h43v9H3z" fill="#ff7510" />
        </svg>
      );
    case 'phi':
      return (
        <svg className={styles.logo} viewBox="0 0 48 48" aria-hidden="true">
          <path d="M4 4h19v19H4z" fill="#f35325" />
          <path d="M25 4h19v19H25z" fill="#81bc06" />
          <path d="M4 25h19v19H4z" fill="#05a6f0" />
          <path d="M25 25h19v19H25z" fill="#ffba08" />
        </svg>
      );
    case 'gemma':
      return (
        <svg className={styles.logo} viewBox="0 0 48 48" aria-hidden="true">
          <defs>
            <linearGradient id="gemma" x1="0" y1="0" x2="1" y2="1">
              <stop stopColor="#a276df" />
              <stop offset=".5" stopColor="#87bdff" />
              <stop offset="1" stopColor="#2187ea" />
            </linearGradient>
          </defs>
          <path
            d="M24 2c2 14 8 19 22 22-14 2-20 8-22 22C21 32 16 26 2 24 16 21 21 16 24 2Z"
            fill="url(#gemma)"
          />
        </svg>
      );
  }
}
