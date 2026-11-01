import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ClusterCanvas } from './ClusterCanvas';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture(fitOnMount = false) {
  let height = 600;
  let viewportHeight = 1000;
  let notify!: (targets: Element[]) => void;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        notify = (targets) =>
          callback(
            targets.map((target) => ({ target }) as ResizeObserverEntry),
            this,
          );
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.getAttribute('aria-label') === 'Cluster canvas' ? viewportHeight : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.style.transform.startsWith('translate(') ? height : 40;
  });
  render(
    <ClusterCanvas singleDevice fitOnMount={fitOnMount} onClear={() => {}}>
      <div data-canvas-device="local" style={{ gridColumn: 1, gridRow: 1 }}>
        <div data-layer-editor-motion style={{ height: 0 }} />
      </div>
    </ClusterCanvas>,
  );
  const viewport = screen.getByRole('region', { name: 'Cluster canvas' });
  const world = viewport.querySelector<HTMLElement>('[style*="transform"]')!;
  const editor = world.querySelector<HTMLElement>('[data-layer-editor-motion]')!;
  return {
    viewport,
    world,
    editor,
    notify,
    resizeEditor(next: number) {
      height = 600 + next;
      editor.style.height = `${next}px`;
      act(() => notify([world]));
    },
    resizeViewport() {
      viewportHeight = 1200;
      act(() => notify([viewport]));
    },
    resizeContent(next: number) {
      height = next;
      act(() => notify([world]));
    },
  };
}

it.each([false, true])(
  'anchors editor opening and closing, including Fit to view (initial fit: %s)',
  (initialFit) => {
    const canvas = fixture(initialFit);
    const before = canvas.world.style.transform;
    canvas.resizeEditor(200);
    expect(canvas.world.style.transform).toBe(before);
    fireEvent.click(screen.getByRole('button', { name: 'Fit to view' }));
    const fitted = canvas.world.style.transform;
    expect(fitted).not.toBe(before);
    canvas.resizeEditor(0);
    expect(canvas.world.style.transform).toBe(fitted);
  },
);

it('still recenters for viewport, ordinary content and device layout changes', () => {
  const canvas = fixture();
  let previous = canvas.world.style.transform;
  canvas.resizeViewport();
  expect(canvas.world.style.transform).not.toBe(previous);
  previous = canvas.world.style.transform;
  canvas.resizeContent(700);
  expect(canvas.world.style.transform).not.toBe(previous);
  previous = canvas.world.style.transform;
  canvas.world.querySelector<HTMLElement>('[data-canvas-device]')!.style.gridRow = '2';
  canvas.resizeEditor(200);
  expect(canvas.world.style.transform).not.toBe(previous);
});
