# ModelLoom technical specification

**Status:** Desktop foundation approved and implemented; remaining architecture proposals need review
**Updated:** 2026-10-06

**Product source:** [PRODUCT-SPEC.md](PRODUCT-SPEC.md)

## 1. Purpose and decision status

The later [ADR-0003](decisions/0003-lm-studio-behavior-reference.md) extends LM Studio's reference role to applicable non-networking architecture and behavior, including concurrency and runtime compatibility. Use documented/observed behavior first, preserve approved ModelLoom requirements, and record evidence-backed deviations. Networking remains under D02-D03; proprietary internals and signing mechanisms cannot be assumed.

Translate P1-P9 into component responsibilities and non-functional requirements. Product behavior remains authoritative in the product specification. Contracts belong in [INTEGRATION-SPEC.md](INTEGRATION-SPEC.md), security in [SECURITY-SPEC.md](SECURITY-SPEC.md), and presentation in [UI-SPEC.md](UI-SPEC.md). Execution steps belong in [PLAN.md](../plans/PLAN.md).

Electron, existing dense llama.cpp-compatible GGUFs, the three connection modes, independent runtime releases, and the product/UI baseline are established requirements. [ADR-0002](decisions/0002-lm-studio-runtime-direction.md) adds the accepted LM Studio hosting direction, grouped llama-server naming, crash isolation, shared headless core/runtime machinery, and owned shutdown. The desktop choices are now approved as recorded below; the remaining language/tooling and component proposals still need review. [ADR-0004](decisions/0004-runtime-lifecycle-proposal.md) accepts the initial Windows development exception and shared TypeScript hosting direction. D01 remains open overall; live package activation and release/platform evidence retain their gates. No native runtime has been implemented.

On 2026-10-01 the user approved implementation of the desktop foundation: Electron, React, strict TypeScript, pnpm, Vite/Electron Forge, CSS Modules/shared tokens, ESLint/Prettier, Vitest/Testing Library and Playwright. `apps/desktop/` now implements the shared shell, compact Models library, session-only per-model configuration, Cluster planning/launch demo and session-only Chat presentation with explicitly marked demo data. The API screen now adds renderer-only server/access presentation, example tabs and an empty log viewer; Settings now adds a renderer-only Appearance/Runtime preview, category search/navigation and an empty runtime-inventory dialog; its controls remain unavailable and no theme, runtime, persistence or IPC integration is added. API lifecycle, exposure and credential controls are disabled, with no listener, key generation, log source, persistent state or new IPC. Integration snippets are illustrative placeholders, not finalized API-contract evidence. Chat keeps Send and attachments unavailable as selected by the user, with no generation, storage or IPC integration. Models row actions expose sample details, configuration and protected demo-entry removal, while launching remains in Cluster. Configuration holds separate pending/saved values in renderer memory, validates before saving, and executes neither templates nor arguments. It adds no persistent storage, IPC, engine or active-session configuration path. This settles D10's desktop choices only. Core TypeScript and the initial hosting direction are accepted under ADR-0004. Exact build/tool pins, supported platform floors, networking, bootstrap verification, signed updates and distributed correctness retain their affected review/evidence gates. A preload is deferred because this milestone uses native window controls and has no privileged renderer operations.

### Implemented renderer boundary, 2026-10-05

The current [UI baseline](UI-SPEC.md#current-ui-baseline-2026-10-05) is fixed; this reconciliation changes documentation only. App owns shared library/active-model, placement/load simulation, configuration, joining and conversation reducers/state. Feature components render that state and hold only their local view state. Screen navigation preserves shared session state; reload/full restart clears it. No database, control core, worker service, native engine or privileged renderer bridge exists in this milestone.

Cluster alone changes the shared simulated active model after validated simulated loading; replacing or restarting an active session requires interruption confirmation. Chat/API model controls navigate to Cluster. Per-model Save defaults edits renderer defaults only and does not apply them to a session. Model removal affects fixture entries only, not disk files. API tabs/copy do not bind or call an endpoint. Chat/API use the same explicit text-copy helper with the existing sandbox-compatible fallback and success/failure feedback. No real secrets or logs are generated.

The approved desktop tooling portion of D10 is implemented. The source-layout table below still describes future core/worker/contracts/runtime paths; naming them is not evidence they exist. Windows uses a 1280x720 initial window with a 1000x620 minimum. Local system/Arial containment and packaged Windows evidence do not settle OS floors or Linux/macOS release support.

## 2. Proposed languages and tooling

| Layer                     | Recommendation                                                                                     | Constraint                                                                                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Desktop and control logic | TypeScript with strict checking                                                                    | Validate external values at runtime as well as compile time.                                                                                                                         |
| UI                        | React with TypeScript, HTML, CSS Modules, and shared CSS variables                                 | Approved for the desktop foundation. Match the supplied screens; framework choice does not permit redesign.                                                                          |
| Native runtime            | Versioned platform/backend llama.cpp packages built from a pinned C/C++/ggml source revision       | Reuse supported CUDA/Metal/CPU backends. ADR-0004 accepts a bounded native ownership adapter for initial Windows development; do not invent a wrapper solely to rename llama-server. |
| Networking component      | Go only if selected integration needs it                                                           | `tsnet` is a Go library; D02 must settle the integration before adding a language or helper.                                                                                         |
| Build and verification    | One JS workspace manager, CMake/native platform toolchains, automated formatting/linting and tests | D10 selects supported versions, compiler standard, package manager, and test tools. Do not publish speculative setup commands as working instructions.                               |

TypeScript strict mode strengthens checking; it is not a network or IPC validation mechanism. [TypeScript documentation](https://www.typescriptlang.org/tsconfig/strict). `tsnet` can embed a Tailscale node in a Go program; this does not establish our cross-platform packaging or Headscale integration. [Tailscale documentation](https://tailscale.com/docs/features/tsnet).

## 3. Proposed component boundaries

Required functional shape, following LM Studio's current llama.cpp direction:

```text
ModelLoom Electron GUI
        | app/core protocol
ModelLoom Core (desktop or independent headless deployment)
        | engine protocol
Versioned llama.cpp runtime
        | supported native backends
CUDA / Metal / CPU
```

ADR-0004 now accepts initial hosting: shared TypeScript core in a desktop Node utility or independent bundled-Node headless host; Electron main-to-core message ports; authenticated deployment-private engine HTTP/streaming; a narrow host launch broker; Windows deployment Job Objects with separate engine containment. The first plan implements fixture-backed contracts/lifecycle only, without these live transports or native activation. No complete wire schema, release ABI or cross-platform cleanup evidence is implied.

The subsequent authorized Windows fixture-host slice now exercises the shared supervisor in a dedicated Electron main/utility harness and independent Node headless entry. Main/headless retain native job/process handles; utility launch authority follows captured core admission. Native fixture jobs are assigned atomically at creation before resume. Closed inherited controls are bounded to 1 MiB. These development entries neither connect the existing desktop app nor establish verified runtime packages, production IPC/engine authentication or live inference. Local scope and limitations are recorded in TESTING-SPEC.

| Component                              | Responsibility                                                                                                                                       | Must not own                                                                                                |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Desktop renderer                       | Five screens, accessible interactions, presentation of subscribed state                                                                              | Direct filesystem/process access, unrestricted IPC, worker authorization decisions, update trust decisions. |
| Desktop main and narrow preload bridge | Application lifecycle, approved privileged actions, validated communication with renderer                                                            | Arbitrary commands or file paths supplied by untrusted content.                                             |
| ModelLoom Core                         | GUI-independent model/session/device control, request coordination, owned runtime supervision, storage/diagnostics, desktop/headless reuse           | DOM rendering, Electron-only lifecycle dependencies, or a duplicate headless runtime manager.               |
| Headless entry point and worker role   | Independently operate the same core/runtime machinery, with worker/service lifecycle, local device participation, control and logs without a desktop | A requirement to run Electron or keep a user logged into a graphical desktop.                               |
| Versioned inference runtime            | GGUF loading, backend execution, supported placement, generation and native capability reporting under core control                                  | Product UI or independent authority to accept peers/download unverified updates.                            |
| Contracts                              | Logical messages, validation schemas, version rules, stable errors                                                                                   | Secret defaults, hidden fallback behavior, or an unreviewed wire protocol.                                  |
| Networking integration                 | LAN reachability/discovery and the selected private-network component behind reviewed access restrictions                                            | Public raw RPC exposure or automatic API authorization.                                                     |

These are ownership boundaries. D01 is the LM Studio architecture replication audit, and D02-D03 determine transport and pairing. Isolate native inference outside the GUI/main process; a library loaded into the GUI itself cannot satisfy ordinary native-crash isolation. ADR-0004 selects separate llama-server and the initial ownership direction from the existing Windows evidence. Remaining native/platform evidence continues under D01; exact proprietary internals are not a prerequisite for this limited slice. Windows app grouping, names, runtime/core survival, and absence of visible console windows need actual packaged-build verification. The accepted llama-server name does not finalize all helper/RPC names or establish macOS/Linux grouping.

## 4. Proposed source layout

| Path                                                         | Purpose                                                                                                                                                                                       |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/desktop/`                                              | Electron main/preload/renderer; renderer features Models, Cluster, Chat, API, Settings.                                                                                                       |
| `apps/worker/`                                               | Provisional headless worker-role entry point into the same core/runtime machinery; its exact location is settled by the host implementation plan under ADR-0004.                              |
| `packages/contracts/`                                        | Validated app, worker, engine, and API-facing contracts.                                                                                                                                      |
| `packages/control-core/`                                     | Shared device, networking, model/request, runtime, storage, and diagnostic logic.                                                                                                             |
| `engine/`                                                    | Only native integration/adapters and tests justified by the reviewed audit/distributed requirements; the versioned llama-server package does not require a new custom engine host by default. |
| `third_party/llama.cpp/`                                     | Pinned upstream dependency if the selected fetch/submodule arrangement uses a checkout here.                                                                                                  |
| `tests/integration/`, `tests/acceptance/`, `tests/fixtures/` | Cross-component tests, J1-J15 journeys, and small synthetic inputs.                                                                                                                           |
| `packaging/desktop/`, `packaging/runtime/`                   | Separate app and native-runtime packaging.                                                                                                                                                    |
| `scripts/`, `.github/workflows/`                             | Necessary development utilities and automated verification.                                                                                                                                   |

Unit tests live beside the component they test. Create directories when needed. This draft does not authorize creating the source layout or select the upstream acquisition method.

## 5. Lifecycle and request requirements

- T01 (P3-P4, P8): Maintain one active model identity with its runtime, context/sampling settings, selected devices, and applied placement. A library selection, pending placement, or installed runtime update cannot silently change it.
- T02 (P8): Route Chat and API through one bounded coordination policy using LM Studio's configurable concurrent predictions/continuous batching as the reference under [ADR-0003](decisions/0003-lm-studio-behavior-reference.md). One active model can serve multiple isolated requests. D09 verifies concurrency, queue ownership/capacity, wait bounds, fairness, overload, cancellation, and restart semantics; do not invent a serial-only default or duplicate engine scheduling without evidence. Validate cluster memory/context and unchanged-quality behavior before selecting actual limits. Pending requests must not be silently served by a newly switched model.
- T03 (P4, P6): Distinguish stopped, preparation/loading, ready, generating, stopping, interrupted, and failed states. The exact event names belong to the reviewed contract. A partially generated answer cannot become completed after worker failure.
- T04 (P8): Keep the editable pending proposal and applied placement separate. The 2026-10-04 Cluster revision removes a separate UI save requirement; Run snapshots and validates the selected proposal for initial loading. Apply pending changes through a user-requested restart after preflight; stop/cancel or otherwise resolve active and queued requests according to the approved policy.
- T05 (P1, P6): Bound retries and process restart attempts. Report exhausted recovery with a useful action. A restart must not duplicate a request, replay an interrupted generation secretly, create orphan workers, or race a shutdown/runtime switch.
- T06 (P1, P4): Reconcile state after lost event connections and process restarts. A stale running badge is not proof of a live model, API, or worker.

## 6. Models, placement, and storage

- T07 (P3): Read actual GGUF identity, architecture, quantization, file size, supported context metadata, and runtime capabilities. Unsupported combinations fail preflight with a reason; do not guess compatibility from a model display name.
- T08 (P3): Estimate weights, context/KV-related memory, and runtime/backend overhead for selected placement. Label estimates and report actual measurements separately. Do not sum Apple unified memory and discrete VRAM as interchangeable capacity.
- T09 (P3, P8): Automatically transfer/cache only required model data within approved device and storage boundaries. D04 establishes whether data is tensors, files, or another supported form, integrity checks, quota enforcement, interrupted-transfer recovery, and eviction rules.
- T10 (P3-P4): Store conversations, settings, placements, model metadata, and runtime inventory locally. D04 selects persistence format, migration, crash recovery, locking, and deletion behavior. No database technology is assumed yet.
- T11 (P3, P6): Clearing caches must preserve original user model files, active required data, unrelated files, and the retained rollback package unless the UI explicitly requests and safely handles the corresponding removal.

## 7. Networking and platform requirements

The [2026-10-01 source investigation](../docs/research/NETWORKING-AND-RUNTIME-UPDATES.md) supports tsnet as a candidate bundled Go network component. Its address is userspace-local to the embedded stack, so native runtime sockets need a reviewed forwarding path; it does not supply an automatic OS route. Custom control-server configuration supports investigating Headscale, with exact version/platform behavior still untested. Source feasibility does not accept D02 or bypass D01 hosting review.

- T12 (P2): LAN works for colocated devices without private-network enrollment. Discovery is a convenience, not authentication. Manual private-address entry remains available.
- T13 (P2): Offer Tailscale and existing Headscale enrollment/control in the app using embedded or managed components. Report actual direct/relayed/unknown path and reachability. A failed path cannot silently fall back to an unapproved public route.
- T14 (P1-P2): Linux worker operation needs no desktop session. Service installation, permissions, startup/recovery, OS credential access, and shutdown must be reviewed and tested under the selected packaging design.
- T15 (P1, P7): Support Windows/Linux NVIDIA CUDA and Apple Silicon macOS Metal. D10 specifies OS/architecture floors and CPU fallback behavior. List supported combinations from actual runtime metadata; no compatibility promise based solely on the UI mockups.
- T16 (P2, P6): Connectivity and performance are distinct. Show measured path information with units and freshness, and report unknown when unavailable. Tailscale/Headscale connectivity does not guarantee throughput or RTT.

## 8. Runtime lifecycle and correctness

- T17 (P5): App and runtime package versions are independent. Installed/selected/active runtime identities are separate; provide supported in-app/headless-core install/select/update/rollback operations without Electron rebuild/reinstall or end-user compilation. Activate only between sessions after signature, integrity, platform/backend, and cluster compatibility checks.
- T18 (P5-P6): Keep the last working package until the candidate starts and loads the previously working model successfully. A failed activation preserves user state and offers rollback. Coordinate cluster transitions so a partially updated cluster cannot serve as if compatible.
- T19 (P5): Runtime metadata includes source revision, build identity, platform/backend, and compatibility. D11 defines manifest schema and trust policy. D01 establishes LM Studio package layout/version selection and process presentation from actual evidence. Upstream shared-library support is a feasibility input, not an instruction to load llama.cpp into Electron. [llama.cpp build configuration](https://github.com/ggml-org/llama.cpp/blob/master/CMakeLists.txt).
- T20 (P3, P8): Preserve weights, quantization, context semantics, and configured sampling. Do not accept a performance feature without the approved single-GPU quality/reference contract under D12. Only draft-free speculative methods may be considered, and they must have no quality loss.
- T21 (P5-P6): Contain ordinary runtime termination/native crashes. Keep the GUI and unaffected core usable, invalidate the affected session, mark partial output interrupted/failed, resolve affected queued work, and offer bounded controlled restart/reload. Native-crash and simple process-termination tests are separate; neither proves protection from OS/GPU-driver failure.
- T22 (P5): In normal Windows desktop operation, verify managed llama-server within ModelLoom's app group; the raw name and separate Details PID are allowed. Do not promise invisibility, infer grouping from parenthood alone, or require Windows presentation on macOS/Linux. Observe helper/RPC names and independently launched headless visibility under D01.
- T23 (P5-P6): Track ownership of desktop core/runtime/helpers. Full Quit stops admission, cancels/resolves work, requests graceful shutdown, escalates on a bounded deadline, and confirms all owned exits. Review abnormal-exit cleanup, hanging processes, startup/update/restart races, and process-handle/PID reuse under D01. Never terminate by name or kill unrelated independent headless/remote deployments. Release distributed assignments through a reviewed teardown policy.
- T24 (P1, P5): Desktop and independent headless deployments use essentially the same core/runtime mechanisms for launch, version management, compatibility, recovery, and shutdown. Record deployment ownership explicitly; headless reuse is not merely duplicating a sidecar launcher. Use the accepted ADR-0004 Windows development exception; D01 remains open overall and live activation, trust and platform/release evidence remain separately gated.

## 9. Non-functional acceptance

| Area                     | Required evidence                                                                                                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reliability              | Cancellation, worker loss, model-load failure, stale state, quota exhaustion, restart, failed-update recovery, native engine crash and owned exit tests; J7-J11, J13-J15.                          |
| Security/privacy         | Trust boundaries, forbidden peers/clients, malicious content, tampered packages, path escape, secret-free diagnostics, and owned-process/engine-endpoint checks; S01-S17.                          |
| Usability/accessibility  | Reference comparison for all five screens, keyboard/focus/scaling/reduced-motion checks, readable error recovery; J12.                                                                             |
| Portability              | Clean-install evidence, Windows app grouping, observed macOS/Linux names/tree, mixed-device multi-node journeys, CUDA/Metal reporting, headless reuse and OS-specific cleanup; J1-J4, J8, J13-J15. |
| Maintainability          | Strict checking, consistent formatting, focused boundaries, documented contracts, pinned dependencies, tests linked to requirement IDs, and independent review where warranted.                    |
| Offline behavior         | With app/runtime/GGUF present, local and LAN inference works offline and failed update checks do not block it; J1, J2.                                                                             |
| Performance/resource use | Bounded queues/retries/cache limits and documented metric definitions. Numeric responsiveness, memory, and speed acceptance limits require reviewed evidence; none are invented here.              |

An automated build is not platform GUI evidence, mock worker tests are not mixed-device acceptance, and product acceptance is not a speed benchmark. Record exact versions/configuration, results, and limitations in the plan's evidence log.

### Windows activation implementation status, 2026-10-06

The subsequent accepted activation slice implements local TUF package verification, checked expanded-bundle installation, bounded GGUF metadata inspection, exact context/resource-report validation and an owned hidden-console helper in the shared core. Node 24.21.0 is the privileged/headless and CI host pin; Electron 44.5.1 remains unchanged. The gated real-engine adapter uses retained native jobs/handles, fixed arguments and authenticated owned readiness. Public-root and validated-planner catalogues are empty, so production loading remains disabled. Its first coded admission path is CPU/zero GPU layers. The later authorized resource slice adds read-only Windows RAM/NVIDIA driver/VRAM discovery and pure per-device CUDA checks; validated planner evidence and exact CUDA launch-device mapping remain pending. These components do not connect preview controls, complete distributed/platform journeys, or establish inference equivalence. [Runtime activation](../docs/runtime-activation.md) records exact APIs and remaining gates.
