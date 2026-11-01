import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useCardAllocation } from './useCardAllocation';

const ids = ['local:gpu0', 'local:gpu1', 'ptss:gpu0'];
const ranges = [
  { hardwareId: ids[0]!, first: 0, last: 21 },
  { hardwareId: ids[1]!, first: 22, last: 42 },
  { hardwareId: ids[2]!, first: 43, last: 63 },
];

function setup() {
  const commit = vi.fn();
  const hook = renderHook(
    ({ context, disabled }) =>
      useCardAllocation({
        ranges,
        ids,
        total: 64,
        context,
        disabled,
        commit,
      }),
    { initialProps: { context: 'original', disabled: false } },
  );
  return { ...hook, commit };
}

it('previews an offset range across devices, cancels atomically, and commits once on Done', () => {
  const { result, commit } = setup();
  act(() => result.current.allocation.resize(ids[1]!, 56));
  expect(result.current.ranges).toEqual([
    ranges[0],
    { hardwareId: ids[1], first: 22, last: 56 },
    { hardwareId: ids[2], first: 57, last: 63 },
  ]);
  expect(result.current.allocation.editor).toMatchObject({
    first: '22',
    last: '56',
    focusInput: false,
  });
  expect(commit).not.toHaveBeenCalled();
  act(() => result.current.allocation.cancel());
  expect(result.current.ranges).toEqual(ranges);
  expect(result.current.editing).toBe(false);
  expect(commit).not.toHaveBeenCalled();
  act(() => result.current.allocation.resize(ids[0]!, 10));
  const preview = result.current.ranges;
  expect(preview[1]).toMatchObject({ first: 11, last: 42 });
  act(() => expect(result.current.allocation.done()).toBe(true));
  expect(commit).toHaveBeenCalledExactlyOnceWith(preview);
  expect(result.current.editing).toBe(false);
});

it('blocks invalid fields and preserves overlap feedback when a manual start crosses an earlier GPU', () => {
  const { result, commit } = setup();
  act(() => result.current.allocation.open(ids[1]!));
  act(() => result.current.allocation.fields('22', '-'));
  act(() => expect(result.current.allocation.done()).toBe(false));
  expect(commit).not.toHaveBeenCalled();
  expect(result.current.ranges).toEqual(ranges);
  act(() => result.current.allocation.fields('13', '56'));
  expect(result.current.allocation.message).toContain('multiple GPUs');
  expect(result.current.ranges.find((range) => range.hardwareId === ids[2])).toEqual({
    hardwareId: ids[2],
    first: 57,
    last: 63,
  });
});

it.each(['slider', 'fields'] as const)(
  'fills an unassigned next GPU through %s, then commits both ranges',
  (method) => {
    const commit = vi.fn();
    const { result } = renderHook(() =>
      useCardAllocation({
        ranges: [],
        ids: ids.slice(0, 2),
        total: 64,
        context: 'empty',
        disabled: false,
        commit,
      }),
    );
    if (method === 'slider') act(() => result.current.allocation.resize(ids[0]!, 38));
    else {
      act(() => result.current.allocation.open(ids[0]!));
      act(() => result.current.allocation.fields('0', '38'));
    }
    const expected = [
      { hardwareId: ids[0], first: 0, last: 38 },
      { hardwareId: ids[1], first: 39, last: 63 },
    ];
    expect(result.current.ranges).toEqual(expected);
    expect(commit).not.toHaveBeenCalled();
    act(() => expect(result.current.allocation.done()).toBe(true));
    expect(commit).toHaveBeenCalledExactlyOnceWith(expected);
  },
);

it('typed endpoints preserve later boundaries across three GPUs, including the remote GPU', () => {
  const { result, commit } = setup();
  act(() => result.current.allocation.open(ids[0]!));
  act(() => result.current.allocation.fields('0', '10'));
  expect(result.current.ranges).toEqual([
    { hardwareId: ids[0], first: 0, last: 10 },
    { hardwareId: ids[1], first: 11, last: 42 },
    ranges[2],
  ]);
  act(() => result.current.allocation.cancel());
  expect(result.current.ranges).toEqual(ranges);
  expect(commit).not.toHaveBeenCalled();
  act(() => result.current.allocation.open(ids[1]!));
  act(() => result.current.allocation.fields('22', '56'));
  const expected = [
    ranges[0],
    { hardwareId: ids[1], first: 22, last: 56 },
    { hardwareId: ids[2], first: 57, last: 63 },
  ];
  expect(result.current.ranges).toEqual(expected);
  act(() => {
    result.current.allocation.done();
  });
  expect(commit).toHaveBeenCalledExactlyOnceWith(expected);
});

it('restores consumed GPUs when an endpoint is moved back, and keeps sliders and fields in sync', () => {
  const { result } = setup();
  act(() => result.current.allocation.resize(ids[0]!, 49));
  expect(result.current.ranges).toEqual([
    { hardwareId: ids[0], first: 0, last: 49 },
    { hardwareId: ids[2], first: 50, last: 63 },
  ]);
  act(() => result.current.allocation.fields('0', '10'));
  expect(result.current.ranges).toEqual([
    { hardwareId: ids[0], first: 0, last: 10 },
    { hardwareId: ids[1], first: 11, last: 42 },
    ranges[2],
  ]);
  act(() => result.current.allocation.resize(ids[0]!, 21));
  expect(result.current.ranges).toEqual(ranges);
});

it('assigns every layer across initially empty GPUs on multiple PCs, including an odd total', () => {
  const commit = vi.fn();
  const { result } = renderHook(() =>
    useCardAllocation({ ranges: [], ids, total: 113, context: 'odd', disabled: false, commit }),
  );
  act(() => result.current.allocation.open(ids[0]!));
  act(() => result.current.allocation.fields('0', '38'));
  const expected = [
    { hardwareId: ids[0], first: 0, last: 38 },
    { hardwareId: ids[1], first: 39, last: 75 },
    { hardwareId: ids[2], first: 76, last: 112 },
  ];
  expect(result.current.ranges).toEqual(expected);
  act(() => {
    result.current.allocation.done();
  });
  expect(commit).toHaveBeenCalledExactlyOnceWith(expected);
});

it('invalidates a preview when selection or inventory changes and blocks edits while busy', () => {
  const { result, rerender, commit } = setup();
  act(() => result.current.allocation.resize(ids[0]!, 10));
  rerender({ context: 'another model or inventory', disabled: false });
  expect(result.current.ranges).toEqual(ranges);
  act(() => expect(result.current.allocation.done()).toBe(false));
  expect(commit).not.toHaveBeenCalled();
  act(() => result.current.allocation.resize(ids[1]!, 56));
  const preview = result.current.ranges;
  rerender({ context: 'another model or inventory', disabled: true });
  act(() => {
    result.current.allocation.resize(ids[0]!, 0);
    result.current.allocation.fields('0', '1');
    expect(result.current.allocation.done()).toBe(false);
  });
  expect(result.current.ranges).toEqual(preview);
  expect(commit).not.toHaveBeenCalled();
  act(() => result.current.allocation.cancel());
  expect(result.current.ranges).toEqual(ranges);
});

it('does not accept an unassigned GPU with incomplete fields', () => {
  const commit = vi.fn();
  const { result } = renderHook(() =>
    useCardAllocation({
      ranges: [],
      ids,
      total: 113,
      context: 'empty',
      disabled: false,
      commit,
    }),
  );
  act(() => result.current.allocation.open(ids[2]!));
  act(() => result.current.allocation.fields('bad', ''));
  act(() => expect(result.current.allocation.done()).toBe(false));
  expect(commit).not.toHaveBeenCalled();
});
