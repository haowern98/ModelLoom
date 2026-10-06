import type { Selection } from './contracts.js';

/** Confirmed owned-instance exit; calling a stop method alone is not confirmation. */
export interface EngineExit {
  readonly code: number | null;
  readonly signal: string | null;
}
/**
 * Captured capability for one owned instance, never a name/PID lookup.
 * @remarks The adapter must correlate selection and provide a fulfilling exit receipt.
 * Stop methods may reject or hang; the supervisor enforces deadlines and retains unconfirmed ownership.
 * Real containment, package trust and authentication are future adapter requirements.
 */
export interface OwnedEngine {
  readonly selection: Selection;
  readonly exited: Promise<EngineExit>;
  waitReady(signal: AbortSignal): Promise<void>;
  requestStop(): Promise<void>;
  forceStop(): Promise<void>;
}
/**
 * Launches exactly the selected instance. Cancellation must settle launch or return the captured
 * instance for cleanup; a late result remains the adapter's owned instance, not a newer deployment.
 * No production implementation exists in this slice.
 */
export interface EngineAdapter {
  launch(selection: Selection, signal: AbortSignal): Promise<OwnedEngine>;
}
