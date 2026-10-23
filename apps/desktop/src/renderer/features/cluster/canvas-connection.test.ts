import { expect, it } from 'vitest';
import { canvasConnectionPath } from './canvas-connection';

it('routes a repeated-side connection around an intervening device', () => {
  const middle = { x: 200, y: 0, width: 100, height: 100 };
  const path = canvasConnectionPath(
    { x: 0, y: 0, width: 100, height: 100 },
    { x: 400, y: 0, width: 100, height: 100 },
    'right',
    [middle],
  );
  const values = path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  const points = Array.from({ length: values.length / 2 }, (_, index) => ({
    x: values[index * 2]!,
    y: values[index * 2 + 1]!,
  }));
  expect(points[0]).toEqual({ x: 100, y: 50 });
  expect(points.at(-1)).toEqual({ x: 400, y: 50 });
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]!,
      b = points[index]!;
    const crosses =
      a.y === b.y
        ? a.y > middle.y &&
          a.y < middle.y + middle.height &&
          Math.min(a.x, b.x) < middle.x + middle.width &&
          Math.max(a.x, b.x) > middle.x
        : a.x > middle.x &&
          a.x < middle.x + middle.width &&
          Math.min(a.y, b.y) < middle.y + middle.height &&
          Math.max(a.y, b.y) > middle.y;
    expect(crosses).toBe(false);
  }
});

it('uses the full row height when a vertical detour passes a taller neighboring card', () => {
  const path = canvasConnectionPath(
    { x: 594, y: 0, width: 498, height: 100 },
    { x: 594, y: 1192, width: 498, height: 100 },
    'bottom',
    [
      { x: 594, y: 596, width: 498, height: 100 },
      { x: 0, y: 0, width: 498, height: 500 },
    ],
  );
  expect(path).toContain('L 843 532 L -32 532');
});
