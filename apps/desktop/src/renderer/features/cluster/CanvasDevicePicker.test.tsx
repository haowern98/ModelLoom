import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { CanvasDevicePicker } from './CanvasDevicePicker';
import { demoDevices } from '../../mocks/cluster';

it('shows only the add card when no PCs are available', async () => {
  const onAdd = vi.fn();
  render(<CanvasDevicePicker devices={[]} onChoose={vi.fn()} onAdd={onAdd} />);
  expect(screen.getAllByRole('button')).toHaveLength(1);
  await userEvent.click(screen.getByRole('button', { name: 'Add device in Connections' }));
  expect(onAdd).toHaveBeenCalledOnce();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});

it('offers approved PC cards before the add card and selects the clicked PC', async () => {
  const onChoose = vi.fn();
  const device = demoDevices[1]!;
  render(<CanvasDevicePicker devices={[device]} onChoose={onChoose} onAdd={vi.fn()} />);
  const buttons = screen.getAllByRole('button');
  expect(buttons[0]).toHaveAccessibleName(`Add ${device.name} to canvas`);
  expect(buttons[1]).toHaveAccessibleName('Add device in Connections');
  await userEvent.click(buttons[0]!);
  expect(onChoose).toHaveBeenCalledWith(device);
});
