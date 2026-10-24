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
