import { Slider as RadixSlider } from 'radix-ui';
import { Stack } from '@openai/apps-sdk-ui/components/Icon';
import styles from './DeviceCard.module.css';

// Custom interval rendering, matching the SDK's Radix track/thumb anatomy and tokens.
// See OPENAI-UI-LICENSE.txt for the source styling license.
export function LayerRangeSlider({
  label,
  range,
  total,
  disabled,
  onChange,
}: {
  label: string;
  range: { first: number; count: number };
  total: number;
  disabled: boolean;
  onChange: (last: number) => void;
}) {
  const maximum = total - 1;
  const denominator = Math.max(1, maximum);
  const last = Math.min(maximum, range.first + Math.max(1, range.count) - 1);
  const position = (value: number) => `calc(7px + (100% - 14px) * ${value / denominator})`;
  const marks = [
    ...new Set([
      0,
      Math.round(maximum / 4),
      Math.round(maximum / 2),
      Math.round((maximum * 3) / 4),
      maximum,
    ]),
  ];
  return (
    <div className={styles.slider}>
      <div className="layer-slider-label">
        <span className="layer-label">
          <Stack aria-hidden="true" />
          Assigned layers
        </span>
        <output className="layer-slider-count" aria-label={`${label} assigned layer count`}>
          {range.count} <span>layers</span>
        </output>
      </div>
      <RadixSlider.Root
        className="layer-slider-root"
        min={0}
        max={Math.max(1, maximum)}
        step={1}
        value={[last]}
        disabled={disabled || range.first >= total || total <= 1}
        onValueChange={([value]) => onChange(Math.max(range.first, value ?? range.first))}
      >
        <RadixSlider.Track className="layer-slider-track">
          {range.count > 0 && (
            <span
              className="layer-slider-interval"
              aria-hidden="true"
              style={{
                left: range.first === 0 ? 0 : position(range.first),
                right: total === 1 ? 0 : `calc(100% - ${position(last)})`,
              }}
            />
          )}
        </RadixSlider.Track>
        <RadixSlider.Thumb
          className="layer-slider-thumb"
          aria-label={`${label} ending layer`}
          aria-valuemin={Math.min(range.first, maximum)}
          aria-valuemax={maximum}
          aria-valuetext={
            range.count
              ? `Layers ${range.first} through ${last}, ${range.count} layers assigned`
              : 'Unassigned'
          }
        />
      </RadixSlider.Root>
      <div className="layer-slider-marks" aria-hidden="true">
        {marks.map((value, index) => (
          <span
            key={value}
            style={{
              left: position(value),
              transform:
                index === 0
                  ? 'none'
                  : index === marks.length - 1
                    ? 'translateX(-100%)'
                    : 'translateX(-50%)',
            }}
          >
            {value}
          </span>
        ))}
      </div>
    </div>
  );
}
