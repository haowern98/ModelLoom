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

it('measures device and GPU lines independently and clears overflow when the text fits', () => {
  const longName = 'A device with a name longer than the available card width';
  const gpu = demoDevices[1]!.hardware.find((hardware) => hardware.kind !== 'cpu')!;
  const gpuLine = `${gpu.name} · ${gpu.memoryGb.toFixed(1)} GiB`;
  let width = 100;
  const clientWidth = vi
    .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
    .mockImplementation(() => width);
  const scrollWidth = vi
    .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
    .mockImplementation(function (this: HTMLElement) {
      return (this.textContent?.length ?? 0) * 8;
    });
  try {
    const device = { ...demoDevices[1]!, name: 'ptss', hardware: [gpu] };
    const view = render(
      <CanvasDevicePicker devices={[device]} onChoose={vi.fn()} onAdd={vi.fn()} />,
    );
    const viewport = (text: string) => screen.getByText(text).parentElement!;
    expect(viewport('ptss')).not.toHaveAttribute('data-overflow');
    expect(viewport(gpuLine)).toHaveAttribute('data-overflow', 'true');
    view.rerender(
      <CanvasDevicePicker
        devices={[{ ...device, name: longName }]}
        onChoose={vi.fn()}
        onAdd={vi.fn()}
      />,
    );
    expect(viewport(longName)).toHaveAttribute('data-overflow', 'true');
    width = 1000;
    view.rerender(<CanvasDevicePicker devices={[device]} onChoose={vi.fn()} onAdd={vi.fn()} />);
    expect(viewport('ptss')).not.toHaveAttribute('data-overflow');
  } finally {
    clientWidth.mockRestore();
    scrollWidth.mockRestore();
  }
});
