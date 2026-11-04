import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';
import type { Destination } from './navigation';

const destinations: Destination[] = ['Chat', 'Cluster', 'Models', 'API', 'Settings'];

it.each(destinations)(
  'preserves %s artwork and navigation when selection changes',
  async (destination) => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const other = destination === 'Models' ? 'Chat' : 'Models';
    const { rerender } = render(
      <AppShell destination={other} onNavigate={onNavigate} demo={false}>
        Content
      </AppShell>,
    );
    const rail = within(screen.getByRole('complementary', { name: 'Main navigation' }));
    const button = rail.getByRole('button', { name: destination });
    const outline = button.querySelector('svg')?.innerHTML;
    expect(outline).toBeTruthy();
    await user.click(button);
    expect(onNavigate).toHaveBeenCalledWith(destination);

    rerender(
      <AppShell destination={destination} onNavigate={onNavigate} demo={false}>
        Content
      </AppShell>,
    );
    expect(button).toHaveAttribute('aria-current', 'page');
    if (destination === 'Chat' || destination === 'Models')
      expect(button.querySelector('svg')?.innerHTML).not.toBe(outline);
    else expect(button.querySelector('svg')?.innerHTML).toBe(outline);
    expect(button.querySelector('svg')).toHaveAttribute('width', '20');
    expect(button.querySelector('svg')).toHaveAttribute('height', '20');
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');

    rerender(
      <AppShell destination={other} onNavigate={onNavigate} demo={false}>
        Content
      </AppShell>,
    );
    expect(button.querySelector('svg')?.innerHTML).toBe(outline);
    expect(button).not.toHaveAttribute('aria-current');
  },
);

it('keeps only the five available navigation destinations', () => {
  render(
    <AppShell destination="Models" onNavigate={vi.fn()} demo={false}>
      Content
    </AppShell>,
  );
  const rail = within(screen.getByRole('complementary', { name: 'Main navigation' }));
  expect(rail.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(
    destinations,
  );
});
