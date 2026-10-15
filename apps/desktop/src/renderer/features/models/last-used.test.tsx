import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoLibrary } from '../../mocks/modelLibrary';
import { ModelsPage } from './ModelsPage';
import { formatLastUsed, lastUsedTooltip } from './last-used';

const local = (year: number, month: number, day: number, hour = 12, minute = 0, second = 0) =>
  new Date(year, month - 1, day, hour, minute, second).getTime();

afterEach(() => vi.useRealTimers());

describe('Last used formatting', () => {
  const now = local(2026, 10, 15, 15);
  it.each([undefined, NaN, Infinity, -1, 9e20])('does not invent history for %s', (value) => {
    expect(formatLastUsed(value, now)).toBe('—');
  });
  it.each([
    [0, 'Just now'],
    [59_999, 'Just now'],
    [60_000, '1 min ago'],
    [59 * 60_000, '59 min ago'],
    [60 * 60_000, '1 hr ago'],
    [135 * 60_000, '2 hr 15 min ago'],
  ])('formats elapsed time %s', (elapsed, expected) => {
    expect(formatLastUsed(now - elapsed, now)).toBe(expected);
  });
  it('handles small future clock skew without negative durations', () => {
    expect(formatLastUsed(now + 30_000, now)).toBe('Just now');
  });
  it.each([
    [local(2026, 10, 15, 0), local(2026, 10, 14, 23, 59)],
    [local(2026, 11, 1, 0), local(2026, 10, 31, 8)],
    [local(2027, 1, 1, 0), local(2026, 12, 31, 8)],
  ])('uses the local previous calendar day across boundaries', (current, used) => {
    expect(formatLastUsed(used, current)).toBe('Yesterday');
  });
  it('shows an exact older date and exact local tooltip with seconds', () => {
    const used = local(2026, 10, 13, 9, 8, 7);
    expect(formatLastUsed(used, now)).toBe('13 Oct 2026');
    expect(lastUsedTooltip(used)).toContain('13 Oct 2026');
    expect(lastUsedTooltip(used)).toContain('09:08:07');
    expect(lastUsedTooltip(undefined)).toBe('Never used');
  });
});

describe('Models last used clock', () => {
  it('updates without a new model snapshot, keeps exact tooltip, and clears its timer', () => {
    vi.useFakeTimers();
    const now = local(2026, 10, 15, 15);
    vi.setSystemTime(now);
    const sample = createDemoLibrary().models[0]!;
    const props = {
      library: { models: [{ ...sample, lastUsedAt: now - 59_000 }], activeModelId: null },
      demo: false,
      onRemove: vi.fn(),
      onDetails: vi.fn(),
      onConfigure: vi.fn(),
      onInfo: vi.fn(),
    };
    const { unmount } = render(<ModelsPage {...props} />);
    expect(screen.getByLabelText('Last used: Just now').title).toBe(lastUsedTooltip(now - 59_000));
    void act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByLabelText('Last used: 1 min ago')).toBeInTheDocument();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('hides last use while indexing and retains unknown history for unused models', () => {
    const model = createDemoLibrary().models[0]!;
    render(
      <ModelsPage
        library={{ models: [model], activeModelId: null }}
        demo={false}
        indexing="new.gguf"
        onRemove={vi.fn()}
        onDetails={vi.fn()}
        onConfigure={vi.fn()}
        onInfo={vi.fn()}
      />,
    );
    expect(screen.getAllByLabelText('Last used: unknown')).toHaveLength(1);
    expect(screen.getByText('Indexing…')).toBeInTheDocument();
  });
});
