import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { LayerNumberInput } from './LayerNumberInput';

function Editor({ initial = '0', disabled = false }: { initial?: string; disabled?: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <LayerNumberInput
      id="layer"
      label="First layer for GPU 0"
      value={value}
      maximum={63}
      disabled={disabled}
      invalid={false}
      onChange={setValue}
    />
  );
}

it('shows both step controls continuously and increments or decrements within the model bounds', async () => {
  const user = userEvent.setup();
  render(<Editor />);
  const input = screen.getByRole('spinbutton');
  const up = screen.getByRole('button', { name: 'Increase first layer for gpu 0' });
  const down = screen.getByRole('button', { name: 'Decrease first layer for gpu 0' });
  expect(up).toBeVisible();
  expect(down).toBeVisible();
  expect(down).toBeDisabled();
  await user.click(up);
  expect(input).toHaveValue('1');
  await user.click(down);
  expect(input).toHaveValue('0');
  await user.clear(input);
  await user.type(input, '63');
  expect(up).toBeDisabled();
  await user.keyboard('{ArrowUp}');
  expect(input).toHaveValue('63');
  await user.keyboard('{ArrowDown}');
  expect(input).toHaveValue('62');
  expect(input).toHaveAttribute('aria-valuenow', '62');
});

it('retains incomplete or invalid raw drafts without clamping or reporting a typing error', async () => {
  const user = userEvent.setup();
  render(<Editor />);
  const input = screen.getByRole('spinbutton');
  await user.clear(input);
  await user.type(input, '99.5');
  await user.keyboard('{ArrowDown}');
  expect(input).toHaveValue('99.5');
  expect(input).toHaveAttribute('aria-invalid', 'false');
  expect(input).not.toHaveAttribute('aria-valuenow');
  expect(screen.getByRole('button', { name: /Increase/ })).toBeDisabled();
  await user.clear(input);
  expect(input).toHaveValue('');
  expect(screen.getByRole('button', { name: /Decrease/ })).toBeDisabled();
});

it('disables the field and both step controls while editing is unavailable', () => {
  render(<Editor initial="12" disabled />);
  expect(screen.getByRole('spinbutton')).toBeDisabled();
  for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
});
