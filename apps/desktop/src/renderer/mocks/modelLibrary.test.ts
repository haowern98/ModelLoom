import { describe, expect, it } from 'vitest';
import { createDemoLibrary, transitionDemoLibrary } from './modelLibrary';

describe('demo library ownership', () => {
  it('starts exactly one selected model without changing metadata', () => {
    const initial = createDemoLibrary();
    const next = transitionDemoLibrary(initial, { type: 'start', modelId: 'llama' });
    expect(initial.activeModelId).toBe('qwen');
    expect(next.activeModelId).toBe('llama');
    expect(next.models).toEqual(initial.models);
  });

  it('stops only the active model', () => {
    const initial = createDemoLibrary();
    expect(transitionDemoLibrary(initial, { type: 'stop', modelId: 'llama' })).toEqual(initial);
    expect(
      transitionDemoLibrary(initial, { type: 'stop', modelId: 'qwen' }).activeModelId,
    ).toBeNull();
  });

  it('protects an active model from removal', () => {
    const initial = createDemoLibrary();
    expect(transitionDemoLibrary(initial, { type: 'remove', modelId: 'qwen' })).toEqual(initial);
    const stopped = transitionDemoLibrary(initial, { type: 'stop', modelId: 'qwen' });
    expect(transitionDemoLibrary(stopped, { type: 'remove', modelId: 'qwen' }).models).toHaveLength(
      4,
    );
  });

  it('ignores unknown IDs rather than inventing a running model', () => {
    const initial = createDemoLibrary();
    expect(transitionDemoLibrary(initial, { type: 'start', modelId: 'missing' })).toEqual(initial);
  });
});
