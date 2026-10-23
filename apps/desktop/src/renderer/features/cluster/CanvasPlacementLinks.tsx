import { useLayoutEffect, useRef, useState } from 'react';
import type { CanvasLink } from './canvas-layout';
import { canvasConnectionPath } from './canvas-connection';
import type { CanvasRect } from './canvas-connection';
import styles from './CanvasPlacementLinks.module.css';

/** These lines explain canvas placement only, not peer routes or measured links. */
export function CanvasPlacementLinks({ links }: { links: readonly CanvasLink[] }) {
  const svg = useRef<SVGSVGElement>(null);
  const [paths, setPaths] = useState<readonly string[]>([]);
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
    <svg ref={svg} className={styles.links} role="img" aria-label="Canvas layout connections">
      <title>Canvas placement only. Inference follows layer assignments.</title>
      {links.map((link, index) => (
        <path key={link.to} data-from={link.from} data-to={link.to} d={paths[index] ?? ''} />
      ))}
    </svg>
  );
}
