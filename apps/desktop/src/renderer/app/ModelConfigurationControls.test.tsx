import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { numericSettings } from '../features/models/configuration';
import { App } from './App';

async function openConfiguration() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: 'Configure Qwen3.8-27B' }));
  return user;
}

describe('Model configuration consistent controls', () => {
  it('selects an overflow option through its custom menu and restores trigger focus', async () => {
    const user = await openConfiguration();
    const trigger = screen.getByRole('combobox', { name: 'Context Overflow' });
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger).toHaveValue('stop');
    expect(trigger).toHaveTextContent('Stop at Limit');
    await user.click(trigger);
    expect(screen.getByRole('listbox')).toBeVisible();
    expect(screen.getByRole('option', { name: 'Stop at Limit' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.click(screen.getByRole('option', { name: 'Rolling Window' }));
    expect(trigger).toHaveValue('rolling');
    expect(trigger).toHaveTextContent('Rolling Window');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: 'Method' })).toBeDisabled();
  });

  it('supports menu keyboard navigation, Escape and outside dismissal', async () => {
    const user = await openConfiguration();
    const trigger = screen.getByRole('combobox', { name: 'Context Overflow' });
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('listbox')).toBeVisible();
    await user.keyboard('{End}');
    expect(screen.getByRole('option', { name: 'Rolling Window' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('option', { name: 'Truncate Middle' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveValue('stop');
    await user.click(trigger);
    await user.click(screen.getByRole('heading', { name: 'Model configuration' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('provides layer-style arrows for every number without changing decimal steps or sliders', async () => {
    const user = await openConfiguration();
    for (const { label } of Object.values(numericSettings)) {
      expect(
        screen.getByRole('button', { name: `Increase ${label.toLowerCase()}` }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: `Decrease ${label.toLowerCase()}` }),
      ).toBeInTheDocument();
    }
    const temperature = screen.getByRole('spinbutton', { name: 'Temperature' });
    expect(temperature).toHaveAttribute('type', 'number');
    await user.click(screen.getByRole('button', { name: 'Increase temperature' }));
    expect(temperature).toHaveValue(0.81);
    expect(screen.getByRole('slider', { name: 'Temperature slider' })).toHaveValue('0.81');
    await user.click(screen.getByRole('button', { name: 'Decrease temperature' }));
    expect(temperature).toHaveValue(0.8);
    const threads = screen.getByRole('spinbutton', { name: 'CPU Thread Pool Size' });
    const before = Number((threads as HTMLInputElement).value);
    await user.click(screen.getByRole('button', { name: 'Increase cpu thread pool size' }));
    expect(threads).toHaveValue(before + 1);
    expect(screen.getByRole('button', { name: 'Increase rope frequency base' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Decrease rope frequency base' })).toBeDisabled();
  });

  it('preserves safe integers, decimal precision and scientific notation when stepping', async () => {
    const user = await openConfiguration();
    await user.click(screen.getByRole('checkbox', { name: 'Enable RoPE Frequency Base' }));
    const base = screen.getByRole('spinbutton', { name: 'RoPE Frequency Base' });
    fireEvent.change(base, { target: { value: '9007199254740990' } });
    const increaseBase = screen.getByRole('button', { name: 'Increase rope frequency base' });
    expect.soft(increaseBase).toBeEnabled();
    await user.click(increaseBase);
    expect.soft(base).toHaveValue(9007199254740991);
    const temperature = screen.getByRole('spinbutton', { name: 'Temperature' });
    fireEvent.change(temperature, { target: { value: '0.1234567890123456' } });
    await user.click(screen.getByRole('button', { name: 'Increase temperature' }));
    expect.soft(temperature).toHaveValue(0.1334567890123456);
    fireEvent.change(temperature, { target: { value: '1e-7' } });
    await user.click(screen.getByRole('button', { name: 'Increase temperature' }));
    expect(temperature).toHaveValue(0.0100001);
  });

  it('disables bounded arrows while leaving typed drafts and Save validation intact', async () => {
    const user = await openConfiguration();
    const temperature = screen.getByRole('spinbutton', { name: 'Temperature' });
    await user.clear(temperature);
    await user.type(temperature, '2');
    expect(screen.getByRole('button', { name: 'Increase temperature' })).toBeDisabled();
    await user.clear(temperature);
    await user.type(temperature, '0');
    expect(screen.getByRole('button', { name: 'Decrease temperature' })).toBeDisabled();
    await user.clear(temperature);
    await user.type(temperature, '2.345');
    expect(temperature).toHaveValue(2.345);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(temperature).toHaveValue(2.345);
    expect(temperature).toHaveAttribute('aria-invalid', 'true');
    expect(temperature).toHaveFocus();
  });
});
