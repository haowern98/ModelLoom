import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DeviceCard } from './DeviceCard';
import { demoDevices } from '../../mocks/cluster';
it('never infers per-device full offload from model readiness alone', () => {
  const props = {
    device: demoDevices[1]!,
    ranges: [],
    appliedRanges: [],
    layerCount: 64,
    loading: false,
    proposed: false,
    active: false,
    selected: false,
    showAddHint: false,
    onAdd: vi.fn(),
    onDetails: vi.fn(),
    onRename: vi.fn(),
    onEdit: vi.fn(),
    localReady: false,
  };
  const { rerender } = render(<DeviceCard {...props} />);
  expect(screen.getByText('Unassigned')).toBeInTheDocument();
  rerender(<DeviceCard {...props} localReady />);
  expect(screen.queryByText('Full GPU offload')).not.toBeInTheDocument();
  expect(screen.getByText('Unassigned')).toBeInTheDocument();
  rerender(
    <DeviceCard
      {...props}
      ranges={[{ hardwareId: 'workstation-gpu', first: 48, last: 63 }]}
      proposed
      active
    />,
  );
  expect(screen.getByText('Planned layers 48 – 63')).toBeInTheDocument();
  expect(screen.queryByText('In use')).not.toBeInTheDocument();
  rerender(<DeviceCard {...props} layerCount={0} />);
  expect(screen.getByRole('slider')).toHaveAttribute('data-disabled');
  expect(screen.getByRole('button', { name: /Load a model to assign layers/u })).toBeDisabled();
  expect(screen.queryByText('Choose a model to assign layers.')).not.toBeInTheDocument();
});

it('keeps a zero-only disabled layer area without a selection and restores editing before a model runs', () => {
  const device = demoDevices[1]!;
  const hardwareId = device.hardware.find((hardware) => hardware.kind !== 'cpu')!.id;
  const allocation = {
    editor: null,
    message: '',
    open: vi.fn(),
    resize: vi.fn(),
    fields: vi.fn(),
    done: vi.fn(() => true),
    cancel: vi.fn(),
  };
  const props = {
    device,
    ranges: [],
    appliedRanges: [],
    layerCount: 0,
    modelSelected: false,
    allocation,
    loading: false,
    proposed: false,
    active: true,
    selected: false,
    showAddHint: false,
    onAdd: vi.fn(),
    onDetails: vi.fn(),
    onRename: vi.fn(),
    onEdit: vi.fn(),
  };
  const view = render(<DeviceCard {...props} />);
  const slider = screen.getByRole('slider');
  expect(slider).toHaveAttribute('data-disabled');
  expect(slider).toHaveAttribute('aria-valuenow', '0');
  expect(view.container.querySelector('.layer-slider-marks')).toHaveTextContent(/^0$/u);
  expect(view.container.querySelector('.layer-slider-interval')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Load a model to assign layers/u })).toBeDisabled();
  fireEvent.keyDown(slider, { key: 'ArrowRight' });
  fireEvent.keyDown(slider, { key: 'End' });
  expect(allocation.resize).not.toHaveBeenCalled();
  expect(allocation.open).not.toHaveBeenCalled();

  view.rerender(<DeviceCard {...props} modelSelected />);
  expect(view.container.querySelector('[data-model-missing]')).toHaveAttribute(
    'data-model-missing',
    'false',
  );
  expect(
    screen.queryByRole('button', { name: /Load a model to assign layers/u }),
  ).not.toBeInTheDocument();

  view.rerender(<DeviceCard {...props} modelSelected layerCount={24} />);
  const enabled = screen.getByRole('slider');
  expect(enabled).not.toHaveAttribute('data-disabled');
  expect(enabled).toHaveAttribute('aria-valuemax', '23');
  fireEvent.keyDown(enabled, { key: 'ArrowRight' });
  expect(allocation.resize).toHaveBeenCalledWith(hardwareId, 1);
  fireEvent.click(screen.getByRole('button', { name: /Edit layers for/u }));
  expect(allocation.open).toHaveBeenCalledWith(hardwareId);
  expect(screen.queryByText('Choose a model to assign layers.')).not.toBeInTheDocument();

  view.rerender(
    <DeviceCard
      {...props}
      modelSelected
      layerCount={24}
      allocation={{
        ...allocation,
        editor: { hardwareId, first: '0', last: '23', error: '', focusInput: false },
      }}
    />,
  );
  expect(
    screen.getByText(/Done updates the configuration draft for all devices/u),
  ).toBeInTheDocument();
});

it('moves one add control to the nearest edge and keeps a pinned edge stable', () => {
  vi.useFakeTimers();
  const props = {
    device: demoDevices[1]!,
    ranges: [],
    appliedRanges: [],
    layerCount: 0,
    loading: false,
    proposed: false,
    active: false,
    selected: false,
    onAdd: vi.fn(),
    onDetails: vi.fn(),
    onRename: vi.fn(),
    onEdit: vi.fn(),
    showAddHint: true,
  };
  const view = render(<DeviceCard {...props} />);
  const card = screen.getByRole('article');
  vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({
    left: 100,
    top: 100,
    right: 500,
    bottom: 300,
    width: 400,
    height: 200,
    x: 100,
    y: 100,
    toJSON: () => ({}),
  });
  const add = screen.getByRole('button', { name: /Add device near/u });
  expect(add).toHaveAttribute('data-visible', 'false');
  expect(screen.getByText('Hover near an edge to add a device.')).toBeInTheDocument();
  fireEvent(card, new MouseEvent('pointermove', { bubbles: true, clientX: 300, clientY: 102 }));
  expect(add).toHaveAttribute('data-edge', 'top');
  expect(add).toHaveAttribute('data-visible', 'true');
  fireEvent.click(add);
  expect(props.onAdd).toHaveBeenCalledWith('top');
  fireEvent(card, new MouseEvent('pointermove', { bubbles: true, clientX: 101, clientY: 200 }));
  expect(add).toHaveAttribute('data-edge', 'top');
  expect(add).toHaveAttribute('data-visible', 'false');
  act(() => {
    vi.advanceTimersByTime(75);
  });
  expect(add).toHaveAttribute('data-edge', 'left');
  expect(add).toHaveAttribute('data-visible', 'true');
  fireEvent(card, new MouseEvent('pointermove', { bubbles: true, clientX: 300, clientY: 298 }));
  act(() => {
    vi.advanceTimersByTime(40);
  });
  fireEvent(card, new MouseEvent('pointermove', { bubbles: true, clientX: 498, clientY: 200 }));
  act(() => {
    vi.advanceTimersByTime(74);
  });
  expect(add).toHaveAttribute('data-edge', 'left');
  expect(add).toHaveAttribute('data-visible', 'false');
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(add).toHaveAttribute('data-edge', 'right');
  expect(add).toHaveAttribute('data-visible', 'true');
  expect(screen.getAllByRole('button', { name: /Add device near/u })).toHaveLength(1);
  view.rerender(<DeviceCard {...props} addEdge="bottom" />);
  fireEvent(card, new MouseEvent('pointermove', { bubbles: true, clientX: 498, clientY: 200 }));
  expect(add).toHaveAttribute('data-edge', 'bottom');
  fireEvent.pointerLeave(card);
  expect(add).toHaveAttribute('data-visible', 'true');
  view.rerender(<DeviceCard {...props} />);
  fireEvent(card, new MouseEvent('pointermove', { bubbles: true, clientX: 300, clientY: 102 }));
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});
it('reveals the add control for keyboard focus and chooses cardinal edges with arrows', () => {
  const onAdd = vi.fn();
  render(
    <DeviceCard
      device={demoDevices[1]!}
      ranges={[]}
      appliedRanges={[]}
      layerCount={0}
      loading={false}
      proposed={false}
      active={false}
      selected={false}
      onAdd={onAdd}
      onDetails={vi.fn()}
      onRename={vi.fn()}
      onEdit={vi.fn()}
    />,
  );
  const add = screen.getByRole('button', { name: /Add device near/u });
  fireEvent.focus(add);
  expect(add).toHaveAttribute('data-visible', 'true');
  expect(add).toHaveAttribute('data-edge', 'right');
  fireEvent.keyDown(add, { key: 'ArrowDown' });
  expect(add).toHaveAttribute('data-edge', 'bottom');
  fireEvent.click(add);
  expect(onAdd).toHaveBeenCalledWith('bottom');
  fireEvent.blur(add);
  expect(add).toHaveAttribute('data-visible', 'false');
});

it('keeps the focused add control visible after activation during a fade and picker close', () => {
  vi.useFakeTimers();
  try {
    const props = {
      device: demoDevices[1]!,
      ranges: [],
      appliedRanges: [],
      layerCount: 0,
      loading: false,
      proposed: false,
      active: false,
      selected: false,
      onAdd: vi.fn(),
      onDetails: vi.fn(),
      onRename: vi.fn(),
      onEdit: vi.fn(),
    };
    const view = render(<DeviceCard {...props} />);
    const card = screen.getByRole('article');
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 100,
      right: 500,
      bottom: 300,
      width: 400,
      height: 200,
      x: 100,
      y: 100,
      toJSON: () => ({}),
    });
    const add = screen.getByRole('button', { name: /Add device near/u });
    fireEvent.focus(add);
    fireEvent(card, new MouseEvent('pointermove', { bubbles: true, clientX: 498, clientY: 200 }));
    fireEvent(card, new MouseEvent('pointermove', { bubbles: true, clientX: 300, clientY: 102 }));
    expect(add).toHaveAttribute('data-visible', 'false');
    fireEvent.click(add);
    expect(props.onAdd).toHaveBeenCalledWith('right');
    view.rerender(<DeviceCard {...props} addEdge="right" />);
    view.rerender(<DeviceCard {...props} />);
    expect(add).toHaveAttribute('data-visible', 'true');
    expect(vi.getTimerCount()).toBe(0);
    view.unmount();
  } finally {
    vi.useRealTimers();
  }
});
