import type { CanvasEdge } from './canvas-layout';

export interface CanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
const opposite: Record<CanvasEdge, CanvasEdge> = {
  top: 'bottom',
  right: 'left',
  bottom: 'top',
  left: 'right',
};
function endpoint(rect: CanvasRect, edge: CanvasEdge) {
  return {
    x: edge === 'left' ? rect.x : edge === 'right' ? rect.x + rect.width : rect.x + rect.width / 2,
    y:
      edge === 'top' ? rect.y : edge === 'bottom' ? rect.y + rect.height : rect.y + rect.height / 2,
  };
}

/** Route through the grid's gutters when another card blocks the direct corridor. */
export function canvasConnectionPath(
  source: CanvasRect,
  target: CanvasRect,
  edge: CanvasEdge,
  obstacles: readonly CanvasRect[],
): string {
  const from = endpoint(source, edge),
    to = endpoint(target, opposite[edge]);
  const vertical = edge === 'top' || edge === 'bottom';
  const blocked = obstacles.some(
    (rect) =>
      rect.x < Math.max(from.x, to.x) + 1 &&
      rect.x + rect.width > Math.min(from.x, to.x) - 1 &&
      rect.y < Math.max(from.y, to.y) + 1 &&
      rect.y + rect.height > Math.min(from.y, to.y) - 1,
  );
  const start = `M ${from.x} ${from.y}`;
  if (blocked) {
    const all = [source, target, ...obstacles];
    const sign = edge === 'top' || edge === 'left' ? -1 : 1;
    if (vertical) {
      const x = Math.min(...all.map((rect) => rect.x)) - 32;
      // Grid rows begin together but can contain cards with different GPU counts.
      // Escape below the entire row before moving sideways past neighboring cards.
      const rowBottom = (card: CanvasRect) =>
        Math.max(
          ...all
            .filter((rect) => Math.abs(rect.y - card.y) < 1)
            .map((rect) => rect.y + rect.height),
        );
      const first = edge === 'bottom' ? rowBottom(source) + 32 : from.y - 32,
        last = edge === 'top' ? rowBottom(target) + 32 : to.y - 32;
      return `${start} L ${from.x} ${first} L ${x} ${first} L ${x} ${last} L ${to.x} ${last} L ${to.x} ${to.y}`;
    }
    const y = Math.min(...all.map((rect) => rect.y)) - 32;
    const first = from.x + sign * 32,
      last = to.x - sign * 32;
    return `${start} L ${first} ${from.y} L ${first} ${y} L ${last} ${y} L ${last} ${to.y} L ${to.x} ${to.y}`;
  }
  const x = (from.x + to.x) / 2,
    y = (from.y + to.y) / 2;
  return `${start} C ${vertical ? from.x : x} ${vertical ? y : from.y}, ${vertical ? to.x : x} ${vertical ? y : to.y}, ${to.x} ${to.y}`;
}
