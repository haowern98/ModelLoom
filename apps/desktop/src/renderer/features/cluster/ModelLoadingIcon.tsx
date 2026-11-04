import { useId } from 'react';

// The ring and square are the exact Apps SDK UI StopOutline paths.
const ring =
  'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10S2 17.523 2 12Z';

export function ModelLoadingIcon({ stage }: { stage: number }) {
  const clip = useId();
  const completed = Math.min(5, Math.max(0, stage)) * 20;
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <defs>
        <clipPath id={clip}>
          <path d={ring} clipRule="evenodd" />
        </clipPath>
      </defs>
      <path d={ring} fillRule="evenodd" fill="#767676" />
      {completed > 0 && (
        <circle
          cx="12"
          cy="12"
          r="9"
          pathLength="100"
          transform="rotate(-90 12 12)"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeDasharray={`${completed} 100`}
          clipPath={`url(#${clip})`}
        />
      )}
      <path d="M9 10a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-4Z" />
    </svg>
  );
}
