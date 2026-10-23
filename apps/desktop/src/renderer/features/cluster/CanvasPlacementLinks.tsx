import type { DemoDevice } from '../../mocks/cluster';
import { connectionTelemetry } from './connection-telemetry';
import { useLayoutEffect, useRef, useState } from 'react';
import type { CanvasLink } from './canvas-layout';
import { canvasConnectionPath } from './canvas-connection';
import type { CanvasRect } from './canvas-connection';
import styles from './CanvasPlacementLinks.module.css';

/** Placement lines expose observations only for an authenticated local peer connection. */
export function CanvasPlacementLinks({
  links,
  devices,
  onSelect,
}: {
  links: readonly CanvasLink[];
  devices: readonly DemoDevice[];
  onSelect: (link: CanvasLink) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [paths, setPaths] = useState<readonly string[]>([]);
  const [midpoints, setMidpoints] = useState<readonly ({ x: number; y: number } | null)[]>([]);
  useLayoutEffect(() => {
    setMidpoints(
      Array.from(svg.current?.querySelectorAll('path') ?? []).map((path) => {
        if (
          !path.getAttribute('d')?.trim() ||
          typeof path.getTotalLength !== 'function' ||
          typeof path.getPointAtLength !== 'function'
        )
          return null;
        try {
          const point = path.getPointAtLength(path.getTotalLength() / 2);
          return Number.isFinite(point.x) && Number.isFinite(point.y)
            ? { x: point.x, y: point.y }
            : null;
        } catch {
          // A card can disappear between layout and SVG geometry measurement.
          return null;
        }
      }),
    );
  }, [paths]);
  useLayoutEffect(() => {
    const world = svg.current?.parentElement;
    if (!world) return;
    const measure = () => {
      const bounds = world.getBoundingClientRect();
      const scale = bounds.width / world.offsetWidth || 1;
      const cards = new Map<string, CanvasRect>();
      for (const slot of world.querySelectorAll<HTMLElement>('[data-canvas-device]')) {
        const rect = slot.querySelector('article')?.getBoundingClientRect();
        if (rect && slot.dataset.canvasDevice)
          cards.set(slot.dataset.canvasDevice, {
            x: (rect.left - bounds.left) / scale,
            y: (rect.top - bounds.top) / scale,
            width: rect.width / scale,
            height: rect.height / scale,
          });
      }
      setPaths(
        links.map((link) => {
          const source = cards.get(link.from),
            target = cards.get(link.to);
          if (!source || !target) return '';
          return canvasConnectionPath(
            source,
            target,
            link.edge,
            [...cards.entries()]
              .filter(([id]) => id !== link.from && id !== link.to)
              .map(([, rect]) => rect),
          );
        }),
      );
    };
    measure();
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(world);
    for (const card of world.querySelectorAll('[data-canvas-device] article'))
      observer?.observe(card);
    return () => observer?.disconnect();
  }, [links]);
  return (
    <>
      <svg ref={svg} className={styles.links} role="img" aria-label="Canvas layout connections">
        <title>Canvas placement only. Inference follows layer assignments.</title>
        {links.map((link, index) => (
          <path key={link.to} data-from={link.from} data-to={link.to} d={paths[index] ?? ''} />
        ))}
      </svg>
      {links.map((link, index) => {
        const from = devices.find((device) => device.id === link.from);
        const to = devices.find((device) => device.id === link.to);
        const telemetry = connectionTelemetry(from, to);
        const point = midpoints[index];
        if (!point || !paths[index]) return null;
        return (
          <button
            key={`${link.from}:${link.to}`}
            type="button"
            className={styles.measurement}
            style={{ left: point.x, top: point.y }}
            aria-label={`Connection details between ${from?.name ?? link.from} and ${to?.name ?? link.to}`}
            title={
              telemetry?.state === 'unavailable' && telemetry.latencyMs != null
                ? 'Last measured latency'
                : 'Control connection round-trip, including connection setup.'
            }
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onSelect(link)}
          >
            {telemetry?.latencyMs != null ? `${telemetry.latencyMs.toFixed(1)} ms` : '\u2014'}
          </button>
        );
      })}
    </>
  );
}
