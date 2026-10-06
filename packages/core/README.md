# ModelLoom core lifecycle

Private, GUI-independent TypeScript core with an in-memory engine fixture. It has no native launcher, renderer connection or emitted distribution artifact.

`RuntimeSupervisor(deploymentId, adapter, policy)` supervises one active load attempt. `load(selection)` validates opaque deployment/session/operation/package/model IDs and starts a fresh operation. Invalid commands reject with a safe code; startup failures return a failed snapshot. `snapshot()` returns immutable state. `record(event)` accepts admitted request starts, text and completion, while lifecycle events remain internal. `stop()` closes admission immediately, interrupts running records, shares pending cleanup and confirms exit before reporting stopped.

The default policy in `contracts.ts` gives startup 180,000 ms, graceful cleanup 5,000 ms and forced-exit confirmation 2,000 ms. Startup covers launch and readiness together. Cleanup can continue after startup fails; unresolved launch or unconfirmed engine exit keeps new loads blocked. A late returned instance is cleaned up through its captured capability. There is no process-name/PID lookup or automatic replay/restart. An explicit retry needs a fresh operation identity.

`decodeEvent(text)` checks UTF-8 byte length before parsing, with a 1,048,576-byte limit. It validates exact event fields and bounded identifiers, copies accepted data and reports `INVALID_CONTROL` without echoing rejected input. This private contract is not an IPC authentication boundary. `transition(state, event)` ignores stale identities and preserves terminal request records. Partial text becomes interrupted after failure or stop; completed text stays completed. Records survive reload only within this core object's lifetime.

The engine interface is a captured owned-instance capability with readiness, graceful/forced stop and an exit receipt. A successful stop call alone never proves exit. Only `tests/fake-engine.ts` implements this interface here; it contains deferred promises and opens no processes or listeners.

Run from the repository root:

```powershell
pnpm --filter @modelloom/core test
pnpm --filter @modelloom/core typecheck
pnpm exec eslint packages/core
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
```

Tests exercise validation, stale callbacks, startup/readiness/exit races, partial interruption, hanging/rejected cleanup, late launch and independent deployments with virtual time. They do not prove native containment, GPU behavior, GUI crash survival, persistence, concurrency capacity or inference quality.

Real engine activation remains gated by signed bootstrap verification, exact build/dependency identity, context/resource preflight and a demonstrated graceful-stop contract. Desktop/headless hosts and Windows ownership adapters are later slices under [ADR-0004](../../specs/decisions/0004-runtime-lifecycle-proposal.md). The existing desktop source and UI are untouched.
