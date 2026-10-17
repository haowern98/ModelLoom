import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';
import type { Destination } from './navigation';

const destinations: Destination[] = ['Chat', 'Cluster', 'Models', 'API', 'Settings'];

it.each(destinations)(
  'switches %s between outline and filled artwork without changing navigation',
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
    expect(button.querySelector('svg')?.innerHTML).not.toBe(outline);
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

it('keeps ChatGPT dots while More is open and closes the menu on Escape', async () => {
  const user = userEvent.setup();
  render(
    <AppShell destination="Models" onNavigate={vi.fn()} demo={false}>
      Content
    </AppShell>,
  );
  const more = screen.getByRole('button', { name: 'More navigation' });
  const outline = more.querySelector('svg')?.innerHTML;
  await user.click(more);
  expect(more).toHaveAttribute('aria-expanded', 'true');
  expect(more.querySelector('svg')?.innerHTML).toBe(outline);
  await user.keyboard('{Escape}');
  expect(more).toHaveAttribute('aria-expanded', 'false');
  expect(more.querySelector('svg')?.innerHTML).toBe(outline);
});
