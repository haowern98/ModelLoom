import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Minus, Plus, Scan } from 'lucide-react';
import styles from './ClusterPage.module.css';

interface Viewport {
  x: number;
  y: number;
  scale: number;
}

/** Pan/zoom affects presentation only. The inspector is outside this transformed surface. */
export function ClusterCanvas({ children, onClear }: { children: ReactNode; onClear: () => void }) {
  const viewport = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  const touched = useRef(false);
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const [view, setView] = useState<Viewport>({ x: 16, y: 16, scale: 1 });
  const [dragging, setDragging] = useState(false);
  const instructions = useId();

  const fitView = useCallback(() => {
    const element = viewport.current;
    const content = world.current;
    if (!element || !content || !element.clientWidth || !element.clientHeight) return;
    // Leave room for the fixed controls below the fitted diagram.
    const bottomSpace = (controls.current?.offsetHeight ?? 40) + 28;
    const scale = Math.max(
      0.25,
      Math.min(
        1,
        (element.clientWidth - 40) / content.offsetWidth,
        (element.clientHeight - 20 - bottomSpace) / content.offsetHeight,
      ),
    );
    setView({ x: (element.clientWidth - content.offsetWidth * scale) / 2, y: 20, scale });
  }, []);

  const zoom = (factor: number) => {
    const element = viewport.current;
    if (!element) return;
    touched.current = true;
    const x = element.clientWidth / 2;
    const y = element.clientHeight / 2;
    setView((previous) => {
      const scale = Math.max(0.25, Math.min(2, previous.scale * factor));
      const ratio = scale / previous.scale;
      return { scale, x: x - (x - previous.x) * ratio, y: y - (y - previous.y) * ratio };
    });
  };

  const fit = () => {
    touched.current = true;
    fitView();
  };

  useEffect(() => {
    const element = viewport.current;
    const content = world.current;
    if (!element || !content) return;
    const autoFit = () => {
      if (!touched.current) fitView();
    };
    autoFit();
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(autoFit);
    observer?.observe(element);
    observer?.observe(content);
    const wheel = (event: WheelEvent) => {
      if (event.target instanceof Node && controls.current?.contains(event.target)) return;
      event.preventDefault();
      touched.current = true;
      const bounds = element.getBoundingClientRect();
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      setView((previous) => {
        const scale = Math.max(
          0.25,
          Math.min(2, previous.scale * Math.exp(-Math.max(-500, Math.min(500, delta)) * 0.0015)),
        );
        const ratio = scale / previous.scale;
        return { scale, x: x - (x - previous.x) * ratio, y: y - (y - previous.y) * ratio };
      });
    };
    // React wheel listeners are passive; a native listener prevents page scrolling while zooming.
    element.addEventListener('wheel', wheel, { passive: false });
    return () => {
      observer?.disconnect();
      element.removeEventListener('wheel', wheel);
    };
  }, [fitView]);

  return (
    <div
      ref={viewport}
      role="region"
      aria-label="Cluster canvas"
      aria-describedby={instructions}
      tabIndex={0}
      className={`${styles.graphScroll} ${dragging ? styles.dragging : ''}`}
      onPointerDown={(event) => {
        if (
          event.button !== 0 ||
          !event.isPrimary ||
          (event.target instanceof Element &&
            (controls.current?.contains(event.target) ||
              event.target.closest('article, button, input, a, select, textarea')))
        )
          return;
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start || start.id !== event.pointerId) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (!start.moved && Math.hypot(dx, dy) < 3) return;
        touched.current = true;
        start.moved = true;
        setView((previous) => ({ ...previous, x: previous.x + dx, y: previous.y + dy }));
        start.x = event.clientX;
        start.y = event.clientY;
      }}
      onPointerUp={(event) => {
        if (drag.current?.id !== event.pointerId) return;
        if (!drag.current.moved) onClear();
        drag.current = null;
        setDragging(false);
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onLostPointerCapture={() => {
        drag.current = null;
        setDragging(false);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDragging(false);
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        const directions: Record<string, [number, number]> = {
          ArrowLeft: [-40, 0],
          ArrowRight: [40, 0],
          ArrowUp: [0, -40],
          ArrowDown: [0, 40],
        };
        const direction = directions[event.key];
        if (direction) {
          event.preventDefault();
          touched.current = true;
          const [x, y] = direction;
          setView((previous) => ({ ...previous, x: previous.x + x, y: previous.y + y }));
        } else if (['+', '=', '-'].includes(event.key)) {
          event.preventDefault();
          zoom(event.key === '-' ? 1 / 1.15 : 1.15);
        } else if (event.key === '0') {
          event.preventDefault();
          fit();
        }
      }}
    >
      <span id={instructions} className={styles.srOnly}>
        Drag empty canvas with the left mouse button to pan. Scroll to zoom. Keyboard: arrow keys to
        pan, plus and minus to zoom, zero to fit.
      </span>
      <div
        ref={world}
        className={styles.canvas}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      >
        {children}
      </div>
      <div
        ref={controls}
        className={styles.canvasControls}
        role="group"
        aria-label="Canvas controls"
      >
        <div className={styles.zoomControls}>
          <button
            type="button"
            aria-label="Zoom out"
            title="Zoom out"
            disabled={view.scale <= 0.25}
            onClick={() => zoom(1 / 1.15)}
          >
            <Minus aria-hidden="true" />
          </button>
          <span className={styles.zoomLevel} aria-label="Zoom level">
            {Math.round(view.scale * 100)}%
          </span>
          <button
            type="button"
            aria-label="Zoom in"
            title="Zoom in"
            disabled={view.scale >= 2}
            onClick={() => zoom(1.15)}
          >
            <Plus aria-hidden="true" />
          </button>
        </div>
        <button type="button" title="Fit to view" onClick={fit}>
          <Scan aria-hidden="true" /> Fit to view
        </button>
      </div>
    </div>
  );
}
