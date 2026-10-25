export type ClusterCanvasEdge = 'top' | 'right' | 'bottom' | 'left';
export interface ClusterCanvasPosition {
  readonly column: number;
  readonly row: number;
}
export interface ClusterCanvasLink {
  readonly from: string;
  readonly to: string;
  readonly edge: ClusterCanvasEdge;
}
/** Presentation only. These identities and edges never authorize peers or order inference. */
export interface ClusterCanvasLayout {
  readonly positions: Readonly<Record<string, ClusterCanvasPosition>>;
  readonly links: readonly ClusterCanvasLink[];
}
const invalid = (): never => {
  throw Error('INVALID_CLUSTER_CONFIGURATION');
};
function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid();
  return input as Record<string, unknown>;
}
function exact(input: unknown, keys: readonly string[]): Record<string, unknown> {
  const value = object(input);
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    return invalid();
  return value;
}
function coordinate(input: unknown): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || Math.abs(input) > 32)
    return invalid();
  return input;
}
/** Bound canvas size and detach caller data before persisting it with the placement revision. */
export function decodeClusterCanvasLayout(input: unknown): ClusterCanvasLayout {
  const value = exact(input, ['positions', 'links']);
  const raw = object(value.positions);
  if (Object.keys(raw).length > 32 || !Array.isArray(value.links) || value.links.length > 31)
    return invalid();
  const positions: Record<string, ClusterCanvasPosition> = {};
  const occupied = new Set<string>();
  for (const [id, position] of Object.entries(raw)) {
    if (!/^(local|peer:[a-f0-9]{64})$/u.test(id)) return invalid();
    const fields = exact(position, ['column', 'row']);
    const column = coordinate(fields.column),
      row = coordinate(fields.row);
    const cell = `${column}:${row}`;
    if (occupied.has(cell)) return invalid();
    occupied.add(cell);
    positions[id] = Object.freeze({ column, row });
  }
  const parents = new Map<string, string>();
  const links = value.links.map((input: unknown): ClusterCanvasLink => {
    const link = exact(input, ['from', 'to', 'edge']);
    if (
      typeof link.from !== 'string' ||
      typeof link.to !== 'string' ||
      !Object.hasOwn(positions, link.from) ||
      !Object.hasOwn(positions, link.to) ||
      link.from === link.to ||
      parents.has(link.to) ||
      typeof link.edge !== 'string' ||
      !['top', 'right', 'bottom', 'left'].includes(link.edge)
    )
      return invalid();
    parents.set(link.to, link.from);
    return Object.freeze({ from: link.from, to: link.to, edge: link.edge as ClusterCanvasEdge });
  });
  for (const id of parents.keys()) {
    const visited = new Set<string>();
    let next: string | undefined = id;
    while (next !== undefined) {
      if (visited.has(next)) return invalid();
      visited.add(next);
      next = parents.get(next);
    }
  }
  return Object.freeze({ positions: Object.freeze(positions), links: Object.freeze(links) });
}
