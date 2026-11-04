const storageKey = 'modelloom.device-display-names';

export function readDeviceDisplayNames(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(
        Object.entries(value).filter(
          ([id, name]) =>
            (id === 'local' || /^peer:[a-f0-9]{64}$/u.test(id)) &&
            typeof name === 'string' &&
            name.trim().length > 0 &&
            name.length <= 64,
        ),
      );
    }
  } catch {
    // An unavailable or corrupt preference falls back to the reported names.
  }
  return {};
}

/** Aliases are UI preferences keyed by device identity, independent of saved placements. */
export function saveDeviceDisplayName(id: string, name: string): Record<string, string> | null {
  try {
    const names = { ...readDeviceDisplayNames(), [id]: name };
    localStorage.setItem(storageKey, JSON.stringify(names));
    return names;
  } catch {
    return null;
  }
}
