export type CanvasEdge = 'top' | 'right' | 'bottom' | 'left';
export interface CanvasPosition {
  column: number;
  row: number;
}
export interface CanvasLink {
  from: string;
  to: string;
  edge: CanvasEdge;
}
const direction: Record<CanvasEdge, CanvasPosition> = {
  top: { column: 0, row: -1 },
  right: { column: 1, row: 0 },
  bottom: { column: 0, row: 1 },
  left: { column: -1, row: 0 },
};

/** Canvas coordinates describe presentation, never networking or execution order. */
export function placeBeside(
  positions: Readonly<Record<string, CanvasPosition>>,
  anchor: string,
  edge: CanvasEdge,
): CanvasPosition {
  const origin = positions[anchor];
  if (!origin) throw Error('Canvas anchor is unavailable');
  const delta = direction[edge];
  const occupied = Object.values(positions);
  for (let distance = 1; distance <= occupied.length + 1; distance++) {
    const next = {
      column: origin.column + delta.column * distance,
      row: origin.row + delta.row * distance,
    };
    if (!occupied.some((position) => position.column === next.column && position.row === next.row))
      return next;
  }
  throw Error('Canvas placement is unavailable');
}

export function canvasPositions(
  devices: readonly { id: string; role: string }[],
  saved: Readonly<Record<string, CanvasPosition>>,
): Record<string, CanvasPosition> {
  const positions: Record<string, CanvasPosition> = {};
  for (const device of devices) {
    if (!saved[device.id]) continue;
    const next = { ...saved[device.id]! };
    while (
      Object.values(positions).some(
        (position) => position.column === next.column && position.row === next.row,
      )
    )
      next.row++;
    positions[device.id] = next;
  }
  let worker = 0;
  for (const device of devices) {
    const index = worker;
    if (device.role !== 'Coordinator') worker++;
    if (positions[device.id]) continue;
    const next =
      device.role === 'Coordinator'
        ? { column: devices.length === 1 ? 0 : 1, row: 0 }
        : { column: index % 3, row: 1 + Math.floor(index / 3) };
    while (
      Object.values(positions).some(
        (position) => position.column === next.column && position.row === next.row,
      )
    )
      next.row++;
    positions[device.id] = next;
  }
  return positions;
}
