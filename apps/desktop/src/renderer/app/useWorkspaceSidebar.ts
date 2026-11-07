import { useAppearance } from './appearance';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { animate, useMotionValue, useReducedMotion, useTransform } from 'motion/react';

const minimum = 238;
const maximum = 468;
const widthKey = 'modelloom.workspace-sidebar-width';

function readWidth() {
  try {
    const value = Number(localStorage.getItem(widthKey));
    if (Number.isFinite(value) && value >= minimum && value <= maximum) return value;
  } catch {
    // Storage may be unavailable in a restricted renderer.
  }
  return minimum;
}

export function useWorkspaceSidebar(enabled: boolean) {
  const { reducedMotion } = useAppearance();
  const [preferredWidth, setPreferredWidth] = useState(readWidth);
  const [expanded, setExpanded] = useState(true);
  const [viewport, setViewport] = useState(() => window.innerWidth);
  const drag = useRef<{ x: number; width: number; next: number } | null>(null);
  useEffect(() => {
    const update = () => setViewport(window.innerWidth);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Reserve space for the 52px rail, the 4px outer gap and 240px of content.
  const limit = Math.max(minimum, Math.min(maximum, viewport - 296));
  const clamp = (width: number) => Math.round(Math.max(minimum, Math.min(limit, width)));
  const width = clamp(preferredWidth);
  const systemReducedMotion = useReducedMotion();
  const reduceMotion = reducedMotion || systemReducedMotion;
  const progress = useMotionValue(1);
  const previouslyEnabled = useRef(enabled);
  useLayoutEffect(() => {
    const wasEnabled = previouslyEnabled.current;
    previouslyEnabled.current = enabled;
    const target = expanded ? 1 : 0;
    if (!enabled || !wasEnabled || reduceMotion) {
      progress.jump(target);
      return;
    }
    const animation = animate(progress, target, {
      type: 'spring',
      duration: 0.3,
      bounce: 0.1,
    });
    return () => animation.stop();
  }, [enabled, expanded, progress, reduceMotion]);
  const fraction = useTransform(progress, (value) => Math.min(1, Math.max(0, value)));
  const animatedWidth = useTransform(() => `${width * fraction.get()}px`);
  const visibility = useTransform(fraction, (value) => (value === 0 ? 'hidden' : 'visible'));
  const save = (value: number) => {
    setPreferredWidth(value);
    try {
      localStorage.setItem(widthKey, String(value));
    } catch {
      // The current window can still use the new width.
    }
  };
  return {
    expanded,
    animatedWidth,
    fraction,
    visibility,
    toggle: () => setExpanded((value) => !value),
    handle: {
      'aria-valuemin': minimum,
      'aria-valuemax': limit,
      'aria-valuenow': width,
      onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
        const next = { ArrowLeft: width - 10, ArrowRight: width + 10, Home: minimum, End: limit }[
          event.key as 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End'
        ];
        if (typeof next !== 'number') return;
        event.preventDefault();
        save(clamp(next));
      },
      onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
        if (event.button !== 0 || !event.isPrimary) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width, next: width };
      },
      onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
        if (!drag.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        drag.current.next = clamp(drag.current.width + event.clientX - drag.current.x);
        setPreferredWidth(drag.current.next);
      },
      onLostPointerCapture() {
        if (!drag.current) return;
        save(drag.current.next);
        drag.current = null;
      },
    },
  };
}
