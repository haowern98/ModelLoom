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
export interface CanvasArrangement {
  positions: Readonly<Record<string, CanvasPosition>>;
  links: readonly CanvasLink[];
}

/** Older saved placements have no geometry; restore real devices without demo IDs or sizing. */
export function restoreCanvas(
  devices: readonly { id: string; role: string }[],
  arrangement: CanvasArrangement,
): CanvasArrangement {
  const positions: Record<string, CanvasPosition> = {};
  const ordered = [...devices].sort((a, b) =>
    a.role === b.role ? a.id.localeCompare(b.id) : a.role === 'Coordinator' ? -1 : 1,
  );
  for (const device of ordered) {
    const saved = arrangement.positions[device.id];
    if (saved) positions[device.id] = { ...saved };
  }
  const anchor = ordered.find((device) => device.role === 'Coordinator') ?? ordered[0];
  if (!anchor) return { positions, links: [] };
  positions[anchor.id] ??= { column: 0, row: 0 };
  for (const device of ordered) {
    if (!positions[device.id]) positions[device.id] = placeBeside(positions, anchor.id, 'right');
  }
  const links = arrangement.links.filter((link) => positions[link.from] && positions[link.to]);
  for (const device of ordered) {
    if (device.id === anchor.id || links.some((link) => link.to === device.id)) continue;
    const connected = new Set([anchor.id]);
    for (let pass = 0; pass < ordered.length; pass++) {
      for (const link of links) {
        if (connected.has(link.from)) connected.add(link.to);
        if (connected.has(link.to)) connected.add(link.from);
      }
    }
    if (connected.has(device.id)) continue;
    const from = positions[anchor.id]!,
      to = positions[device.id]!;
    const dx = to.column - from.column,
      dy = to.row - from.row;
    const edge: CanvasEdge =
      Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'top' : 'bottom';
    links.push({ from: anchor.id, to: device.id, edge });
  }
  return { positions, links };
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
