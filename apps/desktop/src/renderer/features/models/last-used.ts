/** Formats use times in the viewer's local calendar; future clock skew counts as just now. */
export function formatLastUsed(timestamp: number | undefined, now: number): string {
  if (timestamp === undefined || !Number.isFinite(timestamp) || timestamp < 0) return '—';
  const used = new Date(timestamp);
  const current = new Date(now);
  if (Number.isNaN(used.getTime()) || Number.isNaN(current.getTime())) return '—';
  const today = new Date(current.getFullYear(), current.getMonth(), current.getDate());
  const yesterday = new Date(current.getFullYear(), current.getMonth(), current.getDate() - 1);
  if (timestamp >= today.getTime()) {
    const minutes = Math.floor(Math.max(0, now - timestamp) / 60_000);
    if (minutes === 0) return 'Just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return `${hours} hr${remainder ? ` ${remainder} min` : ''} ago`;
  }
  if (timestamp >= yesterday.getTime()) return 'Yesterday';
  return used.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Supplies an exact local time for the hover tooltip, without inventing missing history. */
export function lastUsedTooltip(timestamp: number | undefined): string {
  if (timestamp === undefined || !Number.isFinite(timestamp) || timestamp < 0) return 'Never used';
  const used = new Date(timestamp);
  if (Number.isNaN(used.getTime())) return 'Never used';
  return used.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}
