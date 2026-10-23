import type { DemoDevice } from '../../mocks/cluster';
/** Placement between remote cards is not evidence of a direct transport. */
export function connectionTelemetry(from: DemoDevice | undefined, to: DemoDevice | undefined) {
  if (!from || !to) return undefined;
  if (from.role === 'Coordinator' && to.role === 'Worker') return to.telemetry;
  if (to.role === 'Coordinator' && from.role === 'Worker') return from.telemetry;
  return undefined;
}
