import { expect, it } from 'vitest';
import { canvasPositions, placeBeside, restoreCanvas } from './canvas-layout';

it('restores a legacy canvas deterministically even when discovery returns peers first', () => {
  const local = { id: 'local', role: 'Coordinator' };
  const remote = { id: 'remote', role: 'Worker' };
  const expected = {
    positions: { local: { column: 0, row: 0 }, remote: { column: 1, row: 0 } },
    links: [{ from: 'local', to: 'remote', edge: 'right' }],
  };
  for (const devices of [
    [local, remote],
    [remote, local],
  ])
    expect(restoreCanvas(devices, { positions: {}, links: [] })).toEqual(expected);
});

it('preserves an existing connection rooted at a worker without adding a reverse edge', () => {
  const layout = {
    positions: { local: { column: 0, row: 0 }, remote: { column: 0, row: -1 } },
    links: [{ from: 'remote', to: 'local', edge: 'bottom' as const }],
  };
  expect(
    restoreCanvas(
      [
        { id: 'local', role: 'Coordinator' },
        { id: 'remote', role: 'Worker' },
      ],
      layout,
    ),
  ).toEqual(layout);
  expect(restoreCanvas([{ id: 'local', role: 'Coordinator' }], layout)).toEqual({
    positions: { local: { column: 0, row: 0 } },
    links: [],
  });
  expect(layout.links).toHaveLength(1);
});

it.each([
  ['top', { column: 0, row: -1 }],
  ['right', { column: 1, row: 0 }],
  ['bottom', { column: 0, row: 1 }],
  ['left', { column: -1, row: 0 }],
] as const)('places a new device at the %s edge', (edge, expected) => {
  expect(placeBeside({ local: { column: 0, row: 0 } }, 'local', edge)).toEqual(expected);
});

it('keeps the chosen direction while avoiding occupied cells', () => {
  expect(
    placeBeside(
      {
        local: { column: 2, row: 2 },
        first: { column: 2, row: 3 },
        second: { column: 2, row: 4 },
      },
      'local',
      'bottom',
    ),
  ).toEqual({ column: 2, row: 5 });
});

it('retains existing positions when a new device becomes available', () => {
  const devices = [
    { id: 'local', role: 'Coordinator' },
    { id: 'remote', role: 'Worker' },
  ];
  const positions = canvasPositions(devices, { local: { column: 0, row: 0 } });
  expect(positions.local).toEqual({ column: 0, row: 0 });
  expect(positions.remote).not.toEqual(positions.local);
  expect(Object.keys(canvasPositions(devices.slice(0, 1), positions))).toEqual(['local']);
});

it('avoids overlap when a disconnected device returns to a reused position', () => {
  const result = canvasPositions(
    [
      { id: 'local', role: 'Coordinator' },
      { id: 'returning', role: 'Worker' },
    ],
    {
      local: { column: 0, row: 0 },
      returning: { column: 0, row: 0 },
    },
  );
  expect(result.returning).not.toEqual(result.local);
});
