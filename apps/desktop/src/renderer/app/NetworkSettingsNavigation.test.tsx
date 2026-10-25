import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';

const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
beforeEach(() =>
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() }),
);
afterEach(() => {
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
});

it('opens Connections Add device directly from Network settings on repeated visits', async () => {
  const user = userEvent.setup();
  render(<App />);
  for (let visit = 0; visit < 2; visit++) {
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Network' }));
    await user.click(screen.getByRole('button', { name: 'Open Connections' }));
    const connections = await screen.findByRole('region', { name: 'Connections' });
    expect(within(connections).getByRole('tab', { name: 'Add device' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(within(connections).getByRole('tab', { name: 'Share this PC' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  }
});
