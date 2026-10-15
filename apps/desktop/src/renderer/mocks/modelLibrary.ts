/** Reference fixture metadata. These values are samples, never discovered capabilities. */
export interface DemoModel {
  readonly id: string;
  readonly name: string;
  readonly identifier: string;
  readonly description: string;
  readonly family: 'qwen' | 'llama' | 'mistral' | 'phi' | 'gemma' | 'unknown';
  readonly quantization: string;
  readonly size: string;
  readonly architecture: string;
  readonly parameters: string;
  readonly context: string;
  readonly ready: boolean;
}

/** Renderer-only state: the active ID denotes a simulation, not an engine session. */
export interface DemoLibrary {
  readonly models: readonly DemoModel[];
  readonly activeModelId: string | null;
}

export type DemoAction =
  | { type: 'start'; modelId: string }
  | { type: 'stop'; modelId: string }
  | { type: 'remove'; modelId: string };

/** Returns a fresh library of the supplied screen's sample entries. */
export function createDemoLibrary(): DemoLibrary {
  return {
    activeModelId: 'qwen',
    models: [
      {
        id: 'qwen',
        name: 'Qwen3.8-27B',
        identifier: 'qwen3.8',
        description: 'Qwen 3.8 27B Instruct',
        family: 'qwen',
        quantization: 'Q4_K_M',
        size: '16.4 GB',
        architecture: 'Qwen3',
        parameters: '27B',
        context: '128K',
        ready: true,
      },
      {
        id: 'llama',
        name: 'Llama 3.1 8B',
        identifier: 'llama-3.1',
        description: 'Llama 3.1 8B Instruct',
        family: 'llama',
        quantization: 'Q4_K_M',
        size: '4.9 GB',
        architecture: 'Llama',
        parameters: '8B',
        context: '128K',
        ready: false,
      },
      {
        id: 'mistral',
        name: 'Mistral 7B Instruct',
        identifier: 'mistral-7b',
        description: 'Mistral 7B Instruct v0.3',
        family: 'mistral',
        quantization: 'Q4_K_M',
        size: '4.1 GB',
        architecture: 'Mistral',
        parameters: '7B',
        context: '32K',
        ready: true,
      },
      {
        id: 'phi',
        name: 'Phi 3 Mini',
        identifier: 'phi-3',
        description: 'Phi-3 Mini Instruct',
        family: 'phi',
        quantization: 'Q4_K_M',
        size: '2.3 GB',
        architecture: 'Phi-3',
        parameters: '3.8B',
        context: '128K',
        ready: false,
      },
      {
        id: 'gemma',
        name: 'Gemma 2 9B',
        identifier: 'gemma-2',
        description: 'Gemma 2 9B Instruct',
        family: 'gemma',
        quantization: 'Q4_K_M',
        size: '2.4 GB',
        architecture: 'Gemma 2',
        parameters: '9B',
        context: '8K',
        ready: false,
      },
    ],
  };
}

/**
 * Applies an immutable simulation transition. Starting replaces the sole active ID;
 * callers must obtain switch confirmation first. Active removal and unknown IDs are ignored.
 * No transition performs filesystem, networking, or inference work.
 */
export function transitionDemoLibrary(state: DemoLibrary, action: DemoAction): DemoLibrary {
  if (!state.models.some((model) => model.id === action.modelId)) return state;
  switch (action.type) {
    case 'start':
      return { ...state, activeModelId: action.modelId };
    case 'stop':
      return state.activeModelId === action.modelId ? { ...state, activeModelId: null } : state;
    case 'remove':
      return state.activeModelId === action.modelId
        ? state
        : { ...state, models: state.models.filter((model) => model.id !== action.modelId) };
  }
}
