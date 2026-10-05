export type ConnectionAction = 'add' | 'join' | 'share';
export type ConnectionMode = 'LAN' | 'Tailscale' | 'Headscale';

export const connectionLabels = { add: 'Add device', join: 'Join cluster', share: 'Share this PC' };

/** Illustration data only: these names are neither discovered nor authenticated peers. */
export const joiningExamples = {
  add: [
    { id: 'office', name: 'office-pc', detail: 'Windows 11 · RTX 4060 Ti · 16 GB VRAM' },
    { id: 'render-mac', name: 'render-mac', detail: 'macOS · Apple M2 Ultra' },
  ],
  join: [
    { id: 'render', name: 'render-coordinator', detail: 'Linux · Coordinator' },
    { id: 'studio', name: 'studio-coordinator', detail: 'Windows 11 · Coordinator' },
  ],
};

export const incomingExamples = [
  { id: 'invitation', kind: 'invitation', name: 'render-coordinator' },
  { id: 'join-request', kind: 'join request', name: 'office-pc' },
] as const;

export interface DemoJoining {
  sharing: boolean;
  gpu: boolean;
  cpu: boolean;
  outgoing: Record<string, boolean>;
  manual: Record<string, string>;
  decisions: Record<string, 'approved' | 'declined'>;
}

export type JoiningAction =
  | { type: 'sharing'; enabled: boolean }
  | { type: 'hardware'; hardware: 'gpu' | 'cpu'; enabled: boolean }
  | { type: 'request'; key: string }
  | { type: 'manual'; key: string; address: string }
  | { type: 'decide'; id: string; decision: 'approved' | 'declined' };

export function createDemoJoining(): DemoJoining {
  return { sharing: false, gpu: true, cpu: false, outgoing: {}, manual: {}, decisions: {} };
}

/** Session-only UI transitions. Decisions never authorize a peer or change placement/runtime state. */
export function transitionDemoJoining(state: DemoJoining, action: JoiningAction): DemoJoining {
  switch (action.type) {
    case 'sharing':
      return { ...state, sharing: action.enabled };
    case 'hardware':
      return { ...state, [action.hardware]: action.enabled };
    case 'request':
      return { ...state, outgoing: { ...state.outgoing, [action.key]: true } };
    case 'manual':
      return { ...state, manual: { ...state.manual, [action.key]: action.address } };
    case 'decide':
      return { ...state, decisions: { ...state.decisions, [action.id]: action.decision } };
  }
}
