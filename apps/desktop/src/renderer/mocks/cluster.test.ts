import { describe, expect, it } from 'vitest';
import {
  autoSamplePlacement,
  completeSamplePlacement,
  createDemoPlacement,
  demoLayerCount,
  hasPlacementChanges,
  parseLayerInputs,
  transitionDemoPlacement,
  validSampleRange,
} from './cluster';

describe('unloaded placement and launch state', () => {
  it('rejects unknown hardware, fractional, reversed and out-of-bounds ranges', () => {
    for (const range of [
      { hardwareId: 'unknown', first: 0, last: 27 },
      { hardwareId: 'studio-cpu', first: 0, last: 27 },
      { hardwareId: 'studio-gpu0', first: 0.5, last: 27 },
      { hardwareId: 'studio-gpu0', first: -1, last: 27 },
      { hardwareId: 'studio-gpu0', first: 28, last: 27 },
      { hardwareId: 'studio-gpu0', first: 0, last: 128 },
      { hardwareId: 'studio-gpu0', first: Number.NaN, last: 27 },
    ])
      expect(validSampleRange(range)).toBe(false);
    expect(validSampleRange({ hardwareId: 'node-gpu', first: 0, last: 32 }, 32)).toBe(false);
  });

  it('checks selected model counts and allows unused GPUs without gaps or overlap', () => {
    for (const modelId of ['qwen', 'llama', 'mistral', 'phi', 'gemma']) {
      const count = demoLayerCount(modelId);
      expect(completeSamplePlacement(autoSamplePlacement(count), count)).toBe(true);
      expect(
        completeSamplePlacement([{ hardwareId: 'node-gpu', first: 0, last: count - 1 }], count),
      ).toBe(true);
    }
    const initial = createDemoPlacement();
    expect(completeSamplePlacement([...initial.applied, initial.applied[0]!])).toBe(false);
    for (const last of [25, 29]) {
      const state = transitionDemoPlacement(initial, {
        type: 'edit',
        input: { hardwareId: 'studio-gpu0', first: '0', last: String(last) },
      });
      expect(transitionDemoPlacement(state, { type: 'run' })).toBe(state);
      expect(state.applied).toEqual(initial.applied);
    }
  });

  it('retains invalid raw edits, and rejects incomplete values before loading', () => {
    const initial = createDemoPlacement();
    for (const input of [
      { hardwareId: 'studio-gpu0', first: '', last: '27' },
      { hardwareId: 'studio-gpu0', first: '0.5', last: '27' },
      { hardwareId: 'studio-gpu0', first: '-1', last: '27' },
      { hardwareId: 'studio-gpu0', first: '28', last: '27' },
    ]) {
      const edited = transitionDemoPlacement(initial, { type: 'edit', input });
      expect(edited.inputs[0]).toEqual(input);
      expect(hasPlacementChanges(edited)).toBe(true);
      expect(parseLayerInputs(edited.inputs, 128)).toBeNull();
      expect(transitionDemoPlacement(edited, { type: 'run' })).toBe(edited);
    }
    expect(
      transitionDemoPlacement(initial, {
        type: 'edit',
        input: { hardwareId: 'unknown', first: '0', last: '127' },
      }),
    ).toBe(initial);
  });

  it('keeps the old session during manual/auto planning, snapshots Run and supports cancellation', () => {
    const initial = createDemoPlacement();
    const manual = transitionDemoPlacement(initial, {
      type: 'choose',
      modelId: 'llama',
      mode: 'manual',
    });
    expect(manual.inputs.every((input) => input.first === '' && input.last === '')).toBe(true);
    expect(manual.appliedModelId).toBe('qwen');
    expect(transitionDemoPlacement(manual, { type: 'run' })).toBe(manual);
    const auto = transitionDemoPlacement(manual, {
      type: 'choose',
      modelId: 'llama',
      mode: 'auto',
    });
    const loading = transitionDemoPlacement(auto, { type: 'run' });
    expect(loading.launch?.modelId).toBe('llama');
    expect(loading.applied).toEqual(initial.applied);
    expect(
      transitionDemoPlacement(loading, {
        type: 'edit',
        input: { hardwareId: 'node-gpu', first: '0', last: '31' },
      }),
    ).toBe(loading);
    expect(transitionDemoPlacement(loading, { type: 'cancel' })).toEqual(auto);
    const loaded = transitionDemoPlacement(loading, { type: 'complete' });
    expect(loaded.appliedModelId).toBe('llama');
    expect(completeSamplePlacement(loaded.applied, 32)).toBe(true);
    expect(hasPlacementChanges(loaded)).toBe(false);
  });

  it('discards to the active allocation or the unloaded auto/manual baseline', () => {
    const initial = createDemoPlacement();
    const manualActive = transitionDemoPlacement(initial, {
      type: 'choose',
      modelId: 'qwen',
      mode: 'manual',
    });
    expect(hasPlacementChanges(manualActive)).toBe(true);
    expect(transitionDemoPlacement(manualActive, { type: 'discard' }).inputs).toEqual(
      initial.inputs,
    );
    const manual = transitionDemoPlacement(initial, {
      type: 'choose',
      modelId: 'llama',
      mode: 'manual',
    });
    const edited = transitionDemoPlacement(manual, {
      type: 'edit',
      input: { hardwareId: 'node-gpu', first: '0', last: '31' },
    });
    expect(transitionDemoPlacement(edited, { type: 'discard' }).inputs).toEqual(manual.inputs);
    const loaded = transitionDemoPlacement(transitionDemoPlacement(edited, { type: 'run' }), {
      type: 'complete',
    });
    const stopped = transitionDemoPlacement(loaded, { type: 'stop' });
    expect(
      transitionDemoPlacement(stopped, { type: 'discard' }).inputs.every(
        (input) => !input.first && !input.last,
      ),
    ).toBe(true);
    expect(transitionDemoPlacement(stopped, { type: 'reset', modelId: 'qwen' })).toEqual(initial);
  });
});
