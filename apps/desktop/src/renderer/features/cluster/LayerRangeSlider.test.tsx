import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { LayerRangeSlider } from './LayerRangeSlider';

it('shows an offset interval on the global model axis and edits its ending layer', () => {
  const change = vi.fn();
  const { container, rerender } = render(
    <LayerRangeSlider
      label="Remote GPU"
      range={{ first: 22, count: 35 }}
      total={113}
      disabled={false}
      onChange={change}
    />,
  );
  const slider = screen.getByRole('slider', { name: 'Remote GPU ending layer' });
  expect(slider).toHaveAttribute('aria-valuemin', '22');
  expect(slider).toHaveAttribute('aria-valuemax', '112');
  expect(slider).toHaveAttribute('aria-valuenow', '56');
  expect(slider).toHaveAttribute('aria-valuetext', 'Layers 22 through 56, 35 layers assigned');
  expect(container.querySelector('.layer-slider-interval')).not.toHaveStyle({ left: '0px' });
  fireEvent.keyDown(slider, { key: 'ArrowRight' });
  expect(change).toHaveBeenLastCalledWith(57);
  fireEvent.keyDown(slider, { key: 'Home' });
  expect(change).toHaveBeenLastCalledWith(22);
  rerender(
    <LayerRangeSlider
      label="Remote GPU"
      range={{ first: 0, count: 11 }}
      total={64}
      disabled={false}
      onChange={change}
    />,
  );
  expect(container.querySelector('.layer-slider-interval')).toHaveStyle({ left: '0px' });
  expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '10');
});
