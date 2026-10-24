import { expect, it } from 'vitest';
import { canvasPositions, placeBeside } from './canvas-layout';

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
