import { useLayoutEffect, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';

/** Keep native scrolling menus within Codex's available-space and collision bounds. */
export function useDropdownPosition(
  open: boolean,
  trigger: RefObject<HTMLButtonElement | null>,
  menu: RefObject<HTMLDivElement | null>,
  items: readonly unknown[],
) {
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' });
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const button = trigger.current?.getBoundingClientRect();
      const popup = menu.current;
      if (!button || !popup) return;
      const collision = 6;
      const gap = 5;
      const availableWidth = Math.max(0, window.innerWidth - 16);
      const width = Math.min(
        availableWidth,
        Math.max(button.width, 180, popup.getBoundingClientRect().width),
      );
      const height = popup.scrollHeight + popup.offsetHeight - popup.clientHeight;
      const below = Math.max(0, window.innerHeight - button.bottom - gap - collision);
      const above = Math.max(0, button.top - gap - collision);
      const upwards = height > below && above > below;
      const maxHeight = Math.max(0, Math.min(window.innerHeight - 16, upwards ? above : below));
      setPosition({
        position: 'fixed',
        left: Math.max(collision, Math.min(button.left, window.innerWidth - collision - width)),
        top: upwards
          ? Math.max(collision, button.top - gap - Math.min(height, maxHeight))
          : button.bottom + gap,
        minWidth: Math.min(availableWidth, Math.max(button.width, 180)),
        maxWidth: availableWidth,
        maxHeight,
      });
    };
    const scrolled = (event: Event) => {
      if (event.target instanceof Node && menu.current?.contains(event.target)) return;
      place();
    };
    place();
    window.addEventListener('resize', place);
    document.addEventListener('scroll', scrolled, true);
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place);
    if (trigger.current) observer?.observe(trigger.current);
    if (menu.current) observer?.observe(menu.current);
    return () => {
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', scrolled, true);
      observer?.disconnect();
    };
  }, [open, trigger, menu, items]);
  return position;
}
