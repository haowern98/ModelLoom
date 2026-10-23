import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CanvasPlacementLinks } from './CanvasPlacementLinks';
import { demoDevices } from '../../mocks/cluster';
beforeEach(() => {
  Object.defineProperty(SVGElement.prototype, 'getTotalLength', {
    configurable: true,
    value: vi.fn(function (this: SVGElement) {
      if (!this.getAttribute('d')) throw new DOMException('Empty path');
      return 100;
    }),
  });
  Object.defineProperty(SVGElement.prototype, 'getPointAtLength', {
    configurable: true,
    value: vi.fn(() => ({ x: 30, y: 45 })),
  });
});
afterEach(() => {
  Reflect.deleteProperty(SVGElement.prototype, 'getTotalLength');
  Reflect.deleteProperty(SVGElement.prototype, 'getPointAtLength');
});
it('opens the endpoints of a placement line through an accessible button', () => {
  const onSelect = vi.fn();
  const link = { from: demoDevices[0]!.id, to: demoDevices[1]!.id, edge: 'right' as const };
  render(
    <div>
      <div data-canvas-device={link.from}>
        <article />
      </div>
      <div data-canvas-device={link.to}>
        <article />
      </div>
      <CanvasPlacementLinks links={[link]} devices={demoDevices} onSelect={onSelect} />
    </div>,
  );
  const button = screen.getByRole('button', { name: /Connection details between/ });
  expect(button).toHaveStyle({ left: '30px', top: '45px' });
  expect(button).toHaveTextContent('\u2014');
  fireEvent.click(button);
  expect(onSelect).toHaveBeenCalledWith(link);
});

it('omits a marker when SVG geometry cannot be measured', () => {
  Object.defineProperty(SVGElement.prototype, 'getTotalLength', {
    configurable: true,
    value: () => {
      throw new DOMException('Path is not renderable');
    },
  });
  const link = { from: demoDevices[0]!.id, to: demoDevices[1]!.id, edge: 'right' as const };
  render(
    <div>
      <div data-canvas-device={link.from}>
        <article />
      </div>
      <div data-canvas-device={link.to}>
        <article />
      </div>
      <CanvasPlacementLinks links={[link]} devices={demoDevices} onSelect={vi.fn()} />
    </div>,
  );
  expect(
    screen.queryByRole('button', { name: /Connection details between/ }),
  ).not.toBeInTheDocument();
});
