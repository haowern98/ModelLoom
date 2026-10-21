import type { DeviceInventory } from '../../shared/runtime';
/** Screen-reference fixtures only; no values represent discovered hardware or valid GGUF placement. */
export interface DemoHardware {
  readonly id: string;
  readonly label: string;
  readonly name: string;
  readonly detail: string;
  readonly memoryGb: number;
  readonly kind: 'cpu' | 'gpu' | 'unified';
  /** Trusted execution identity, when this row represents discovered hardware. */
  readonly assignmentId?: string;
}

export interface DemoDevice {
  readonly id: string;
  readonly name: string;
  readonly role: 'Coordinator' | 'Worker';
  readonly os: string;
  readonly address: string;
  readonly hardware: readonly DemoHardware[];
  readonly inventory?: DeviceInventory;
}

export const demoDevices: readonly DemoDevice[] = [
  {
    id: 'studio',
    name: 'studio-desktop',
    role: 'Coordinator',
    os: 'Windows 11',
    address: '192.168.1.10',
    hardware: [
      {
        id: 'studio-cpu',
        label: 'CPU',
        name: 'AMD Ryzen 9 7950X',
        detail: '16 cores · 32 threads',
        memoryGb: 0,
        kind: 'cpu',
      },
      {
        id: 'studio-gpu0',
        label: 'GPU 0',
        name: 'RTX 4070 SUPER',
        detail: '12 GB VRAM',
        memoryGb: 12,
        kind: 'gpu',
      },
      {
        id: 'studio-gpu1',
        label: 'GPU 1',
        name: 'RTX 3060',
        detail: '12 GB VRAM',
        memoryGb: 12,
        kind: 'gpu',
      },
    ],
  },
  {
    id: 'workstation',
    name: 'ml-workstation',
    role: 'Worker',
    os: 'Ubuntu 22.04',
    address: '192.168.1.11',
    hardware: [
      {
        id: 'workstation-cpu',
        label: 'CPU',
        name: 'Intel Core i9-13900K',
        detail: '24 cores · 32 threads',
        memoryGb: 0,
        kind: 'cpu',
      },
      {
        id: 'workstation-gpu',
        label: 'GPU 0',
        name: 'RTX 3060',
        detail: '12 GB VRAM',
        memoryGb: 12,
        kind: 'gpu',
      },
    ],
  },
  {
    id: 'mac',
    name: 'mac-studio',
    role: 'Worker',
    os: 'macOS 14',
    address: '192.168.1.12',
    hardware: [
      {
        id: 'mac-cpu',
        label: 'CPU',
        name: 'Apple M2 Ultra (CPU)',
        detail: '24 cores',
        memoryGb: 0,
        kind: 'cpu',
      },
      {
        id: 'mac-unified',
        label: 'Apple Silicon (M2 Ultra)',
        name: '24-core CPU · 76-core GPU',
        detail: '192 GB unified memory',
        memoryGb: 192,
        kind: 'unified',
      },
    ],
  },
  {
    id: 'node',
    name: 'inference-node',
    role: 'Worker',
    os: 'Ubuntu 22.04',
    address: '192.168.1.13',
    hardware: [
      {
        id: 'node-cpu',
        label: 'CPU',
        name: 'AMD EPYC 7302P',
        detail: '16 cores · 32 threads',
        memoryGb: 0,
        kind: 'cpu',
      },
      {
        id: 'node-gpu',
        label: 'GPU 0',
        name: 'RTX 3090',
        detail: '24 GB VRAM',
        memoryGb: 24,
        kind: 'gpu',
      },
    ],
  },
];

export const demoLinks = [
  {
    from: 'studio',
    to: 'workstation',
    latencyMs: 12,
    path: 'M 50 30 C 25 4, 25 40, 16 58',
    x: 25,
    y: 35,
  },
  { from: 'studio', to: 'mac', latencyMs: 8, path: 'M 50 38 L 50 58', x: 50, y: 41 },
  { from: 'studio', to: 'node', latencyMs: 20, path: 'M 50 30 C 75 4, 75 40, 84 58', x: 75, y: 35 },
  { from: 'workstation', to: 'mac', latencyMs: 15, path: 'M 16 76 L 50 76', x: 33, y: 76 },
  { from: 'mac', to: 'node', latencyMs: 18, path: 'M 50 76 L 84 76', x: 67, y: 76 },
] as const;

/** The reference's 128 layers are an illustration, independent of any selected model's architecture. */
export const sampleLayerCount = 128;
export interface SampleRange {
  readonly hardwareId: string;
  readonly first: number;
  readonly last: number;
}
const referenceRanges: readonly SampleRange[] = [
  { hardwareId: 'studio-gpu0', first: 0, last: 27 },
  { hardwareId: 'studio-gpu1', first: 28, last: 47 },
  { hardwareId: 'workstation-gpu', first: 48, last: 71 },
  { hardwareId: 'mac-unified', first: 72, last: 95 },
  { hardwareId: 'node-gpu', first: 96, last: 127 },
];

/** Synthetic layer counts for UI validation, not parsed GGUF architecture metadata. */
export function demoLayerCount(modelId: string): number {
  return (
    ({ qwen: 128, llama: 32, mistral: 32, phi: 32, gemma: 42 } as Record<string, number>)[
      modelId
    ] ?? 128
  );
}

/** Keep incomplete/invalid text in the proposal so navigation cannot silently restore old values. */
export interface LayerInput {
  readonly hardwareId: string;
  readonly first: string;
  readonly last: string;
}

interface DemoLaunch {
  readonly modelId: string;
  readonly ranges: readonly SampleRange[];
}

export interface DemoPlacement {
  readonly modelId: string | null;
  readonly mode: 'auto' | 'manual';
  readonly inputs: readonly LayerInput[];
  readonly baseline: readonly LayerInput[];
  readonly past: readonly (readonly LayerInput[])[];
  readonly future: readonly (readonly LayerInput[])[];
  readonly appliedModelId: string | null;
  readonly applied: readonly SampleRange[];
  readonly launch: DemoLaunch | null;
}

export type PlacementAction =
  | { type: 'choose'; modelId: string; mode: 'auto' | 'manual' }
  | { type: 'edit'; input: LayerInput }
  | { type: 'reset'; modelId: string | null }
  | { type: 'run' | 'complete' | 'cancel' | 'stop' | 'discard' | 'undo' | 'redo' | 'auto-place' };

function placementInputs(ranges: readonly SampleRange[]): readonly LayerInput[] {
  return referenceRanges.map(({ hardwareId }) => {
    const range = ranges.find((entry) => entry.hardwareId === hardwareId);
    return {
      hardwareId,
      first: range ? String(range.first) : '',
      last: range ? String(range.last) : '',
    };
  });
}

/** Scales the reference's split for the demo only; no optimizer or memory-fit check runs. */
export function autoSamplePlacement(layerCount: number): readonly SampleRange[] {
  return referenceRanges
    .map((range) => ({
      ...range,
      first: Math.floor((range.first / sampleLayerCount) * layerCount),
      last: Math.floor(((range.last + 1) / sampleLayerCount) * layerCount) - 1,
    }))
    .filter((range) => range.first <= range.last);
}

export function createDemoPlacement(modelId: string | null = 'qwen'): DemoPlacement {
  const applied = modelId ? autoSamplePlacement(demoLayerCount(modelId)) : [];
  const inputs = placementInputs(applied);
  return {
    modelId,
    mode: 'auto',
    inputs,
    baseline: inputs,
    past: [],
    future: [],
    appliedModelId: modelId,
    applied,
    launch: null,
  };
}

export function validSampleRange(range: SampleRange, layerCount = sampleLayerCount): boolean {
  return (
    referenceRanges.some((entry) => entry.hardwareId === range.hardwareId) &&
    Number.isInteger(range.first) &&
    Number.isInteger(range.last) &&
    range.first >= 0 &&
    range.last < layerCount &&
    range.first <= range.last
  );
}

/** Validates only the illustrative allocation, never memory fitness or inference compatibility. */
export function completeSamplePlacement(
  ranges: readonly SampleRange[],
  layerCount = sampleLayerCount,
): boolean {
  if (
    !ranges.length ||
    !ranges.every((range) => validSampleRange(range, layerCount)) ||
    new Set(ranges.map((range) => range.hardwareId)).size !== ranges.length
  )
    return false;
  let next = 0;
  for (const range of [...ranges].sort((a, b) => a.first - b.first)) {
    if (range.first !== next) return false;
    next = range.last + 1;
  }
  return next === layerCount;
}

/** Blank pairs are unused GPUs; a partial or invalid pair blocks launch. */
export function parseLayerInputs(
  inputs: readonly LayerInput[],
  layerCount: number,
): readonly SampleRange[] | null {
  const ranges: SampleRange[] = [];
  for (const input of inputs) {
    if (!input.first.trim() && !input.last.trim()) continue;
    const range = {
      hardwareId: input.hardwareId,
      first: Number(input.first),
      last: Number(input.last),
    };
    if (!input.first.trim() || !input.last.trim() || !validSampleRange(range, layerCount))
      return null;
    ranges.push(range);
  }
  return ranges;
}

export function hasPlacementChanges(state: DemoPlacement): boolean {
  return state.inputs.some(
    (input, index) =>
      input.first !== state.baseline[index]?.first || input.last !== state.baseline[index]?.last,
  );
}

function replaceDraft(state: DemoPlacement, inputs: readonly LayerInput[]): DemoPlacement {
  if (
    inputs.every(
      (input, index) =>
        input.hardwareId === state.inputs[index]?.hardwareId &&
        input.first === state.inputs[index]?.first &&
        input.last === state.inputs[index]?.last,
    ) &&
    inputs.length === state.inputs.length
  )
    return state;
  return { ...state, inputs, past: [...state.past, state.inputs], future: [] };
}

/** Planning leaves the active session untouched. Run snapshots valid input after UI confirmation;
 * completion alone applies it. Cancellation retains both the old session and the proposal. */
export function transitionDemoPlacement(
  state: DemoPlacement,
  action: PlacementAction,
): DemoPlacement {
  switch (action.type) {
    case 'choose': {
      if (state.launch) return state;
      const inputs = placementInputs(
        action.mode === 'auto' ? autoSamplePlacement(demoLayerCount(action.modelId)) : [],
      );
      return {
        ...state,
        modelId: action.modelId,
        mode: action.mode,
        inputs,
        past: [],
        future: [],
        baseline: state.appliedModelId === action.modelId ? placementInputs(state.applied) : inputs,
      };
    }
    case 'edit':
      if (
        state.launch ||
        !state.modelId ||
        !state.inputs.some((input) => input.hardwareId === action.input.hardwareId)
      )
        return state;
      return replaceDraft(
        state,
        state.inputs.map((input) =>
          input.hardwareId === action.input.hardwareId ? action.input : input,
        ),
      );
    case 'auto-place':
      if (state.launch || !state.modelId) return state;
      return replaceDraft(
        state,
        placementInputs(autoSamplePlacement(demoLayerCount(state.modelId))),
      );
    case 'undo': {
      const inputs = state.past.at(-1);
      if (state.launch || !state.modelId || !inputs) return state;
      return {
        ...state,
        inputs,
        past: state.past.slice(0, -1),
        future: [state.inputs, ...state.future],
      };
    }
    case 'redo': {
      const inputs = state.future[0];
      if (state.launch || !state.modelId || !inputs) return state;
      return {
        ...state,
        inputs,
        past: [...state.past, state.inputs],
        future: state.future.slice(1),
      };
    }
    case 'run': {
      if (!state.modelId || state.launch) return state;
      const ranges = parseLayerInputs(state.inputs, demoLayerCount(state.modelId));
      return ranges && completeSamplePlacement(ranges, demoLayerCount(state.modelId))
        ? { ...state, launch: { modelId: state.modelId, ranges } }
        : state;
    }
    case 'complete': {
      if (!state.launch) return state;
      const inputs = placementInputs(state.launch.ranges);
      return {
        ...state,
        appliedModelId: state.launch.modelId,
        applied: state.launch.ranges,
        inputs,
        baseline: inputs,
        past: [],
        future: [],
        launch: null,
      };
    }
    case 'cancel':
      return { ...state, launch: null };
    case 'stop':
      return {
        ...state,
        appliedModelId: null,
        applied: [],
        launch: null,
        baseline: placementInputs(
          state.mode === 'auto' && state.modelId
            ? autoSamplePlacement(demoLayerCount(state.modelId))
            : [],
        ),
      };
    case 'discard': {
      if (state.launch) return state;
      const inputs =
        state.appliedModelId === state.modelId ? placementInputs(state.applied) : state.baseline;
      return { ...state, inputs, baseline: inputs, past: [], future: [] };
    }
    case 'reset':
      return createDemoPlacement(action.modelId);
  }
}
