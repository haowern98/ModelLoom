# ModelLoom core lifecycle

Private, GUI-independent TypeScript core with lifecycle, protected history,
generation admission and Windows development hosts. The explicitly enabled
development desktop now connects the real-engine adapter and closed Chat bridge;
ordinary generation and production activation remain disabled.

**Reconciled 2026-10-10:** Local schema-4 history, native settlement, Send/Stop/
Retry, saved thinking/duration/rates, model-independent history startup and
confirmed deletion are implemented locally. The exact development catalogue
contains one-slot and four-slot reports; the desktop selects four slots. See
[current scope and dated evidence](../../docs/local-generation.md), including the
failed post-startup resource-preflight retry and isolated native cleanup rerun.
Fixture/earlier activation descriptions below retain their original scope;
they do not describe the later desktop connection. Production trust, public API,
workers, distribution and release/platform acceptance remain pending.

`RuntimeSupervisor(deploymentId, adapter, policy)` supervises one active load attempt. `load(selection)` validates opaque deployment/session/operation/package/model IDs and starts a fresh operation. Invalid commands reject with a safe code; startup failures return a failed snapshot. `snapshot()` returns immutable state. `record(event)` accepts admitted request starts, text and completion, while lifecycle events remain internal. `stop()` closes admission immediately, interrupts running records, shares pending cleanup and confirms exit before reporting stopped.

The default policy in `contracts.ts` gives startup 180,000 ms, graceful cleanup 5,000 ms and forced-exit confirmation 2,000 ms. Startup covers launch and readiness together. Cleanup can continue after startup fails; unresolved launch or unconfirmed engine exit keeps new loads blocked. A late returned instance is cleaned up through its captured capability. There is no process-name/PID lookup or automatic replay/restart. An explicit retry needs a fresh operation identity.

`decodeEvent(text)` checks UTF-8 byte length before parsing, with a 1,048,576-byte limit. It validates exact event fields and bounded identifiers, copies accepted data and reports `INVALID_CONTROL` without echoing rejected input. This private contract is not an IPC authentication boundary. `transition(state, event)` ignores stale identities and preserves terminal request records. Partial text becomes interrupted after failure or stop; completed text stays completed. Records survive reload only within this core object's lifetime.

The engine interface is a captured owned-instance capability with readiness, graceful/forced stop and an exit receipt. A successful stop call alone never proves exit. `tests/fake-engine.ts` uses deferred promises without processes. `src/hosts/fixture-engine.ts` launches only the compiled harmless fixture: no model, network listener or externally supplied executable.

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

Ordinary tests exercise validation, stale callbacks, startup/readiness/exit races, partial interruption, hanging/rejected cleanup, late launch and independent deployments with virtual time. Windows native integration tests run separately:

```powershell
pnpm --filter @modelloom/core check:native
pnpm --filter @modelloom/core test:native
```

These commands require Windows x64, MSVC 14.44.35207, its installed LLVM tools, Node 24.21.0, Electron 44.5.1 and node-gyp 12.4.0. Native builds retain the existing Node 24.7.0 headers/import library through Node-API ABI compatibility; the resulting module was tested under Node 24.21.0 and Electron's embedded Node 24.21.0. Build artifacts and the compiler-environment helper go to ignored `out/`. The pinned node-gyp dependency supplies its standard Windows delay-load hook for the same Node-API module in Node and Electron; it does not compile or download an inference runtime. `check:native` checks all four owned C++ sources with formatting and clang-tidy; `test:native` builds with /W4 /WX, emits hosts, then runs the native suites. Non-Windows native invocation fails closed.

The main/headless owner retains unnamed, non-inherited deployment and nested engine Job Objects. A native child enters both jobs atomically at creation, remains suspended until membership is confirmed, and inherits only its input/output pipes. Graceful stop writes one fixed byte; forced stop targets the captured engine job. Exit requires the process handle to be signaled and no active descendants. The utility core is admitted through its captured image/time-checked process handle before receiving launch authority. Unexpected core loss closes the deployment. Independent headless deployments retain their own jobs.

`tests/desktop-entry.cjs` runs a dedicated Electron main/utility harness with no BrowserWindow. Main-to-utility controls use the inherited Electron channel; the test driver uses inherited Node IPC, and headless uses bounded UTF-8 NDJSON pipes. Commands, broker events and utility replies use closed schemas and full selection identity. IDs increase monotonically; replay and post-Quit admission are rejected. Fixture crash controls are development-only. No renderer/preload or current desktop application code is connected.

Local Windows 11 build 26200 evidence on 2026-10-06: 112 ordinary core cases and 17 native/host cases passed, including real native exception, interrupted partial text, explicit reload, hung descendants, abnormal owner/core exits and unrelated deployment survival. Job containment is ownership machinery, not a security sandbox. No packaged app grouping, visible-console presentation, GUI survival, durable history, other-platform support, inference quality or GPU behavior is established.

The subsequent activation slice passed 180 ordinary core cases and 30 native cases locally, alongside 39 unchanged desktop cases. It adds local TUF verification, checked expanded-bundle installation, bounded GGUF metadata inspection, exact resource-report checks, authenticated owned readiness and a private hidden-console stop helper. The detailed APIs, CPU-only adapter limit and live gates are in [runtime activation](../../docs/runtime-activation.md). Production public-root and reviewed-memory catalogues are empty: no actual model can be activated, and no test root or serialized receipt bypasses that gate. The fixture protocol remains development-only; no renderer integration, actual upstream graceful cleanup, GPU support, packaged grouping or inference correctness is claimed. The existing desktop source and UI are untouched. Local results and limits are recorded in [TESTING-SPEC](../../specs/TESTING-SPEC.md).
