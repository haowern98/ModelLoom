# Native Speculative Decoding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the selected runtime's native speculative methods to ModelLoom's existing per-model settings, shared Chat/API runtime and distributed residency transport.

**Architecture:** Typed saved settings become an immutable, capability-checked load intent. The existing runtime owner resolves compatible companion assets and discovered devices, admits the full memory footprint and launches one owned llama-server deployment. Native code owns proposal generation, verification, sampling and rollback.

**Tech Stack:** Existing strict TypeScript core, React/Electron editor, protected SQLite configuration store, verified versioned llama.cpp packages and existing native ownership/peer adapters. Add no product dependency for this feature without a concrete reviewed need.

**Spec:** [Native speculative decoding app integration](../specs/2026-10-29-native-speculative-decoding-design.md).

**Scope update, 29 October 2026:** the [GGUF library](../../gguf-library.md), content-based head classification and saved-entry reconciliation have since been implemented under separate approval. Reuse that delivery; do not recreate import-purpose selection. The remaining native inference integration below is still proposed, with unchecked tasks. Recording this plan in Git does not authorize runtime activation or GPU benchmarking.

## Global constraints

**Implementation approval and UX update:** the user has now said PROCEED for the agreed app integration. Method, companion and proposal settings live in model configuration. CPU/GPU assignment lives only in Cluster and is retained by named allocations; model configuration shows a read-only summary and a Cluster shortcut. This supersedes the device-preference and target-only allocation statements below. Work happens in the existing isolated `feat/speculative-decoding` worktree. Native GPU execution and changes to installed runtimes remain outside this approval.

**Current admission finding:** the pinned `llama-fit-params` estimates only the target. Speculative activation must not consume that estimate as evidence for a full speculative deployment. Implement and test persistence, editing, immutable capture and an explicit admission error first. Enabling native methods still requires a verified combined estimator, compatibility checks and the separately agreed native correctness contract. Do not claim this intermediate delivery accelerates inference.

- Remaining inference integration is planning only. Library implementation/deployment and this Git checkpoint were separately authorized. This plan does not authorize native-engine execution, GPU experiments, runtime changes or publication.
- User confirmed all supported native methods on 29 October 2026, replacing the no-draft product restriction for this feature. Preserve no quality loss, target settings and sampler authority.
- Existing model records migrate to Off. Settings apply on explicit load/reload; Save does not change active or queued inference.
- Preserve the current six-section editor, one active target, owned lifecycle and the unchanged residency bridge. Exclude research helpers, AWC/DSD, custom suffix retrieval, experimental CUDA DLLs, automatic training/conversion/downloads and a general runtime updater rewrite.
- Availability is an intersection of verified runtime syntax, asset compatibility, complete resource evidence and validated execution profile. Do not call a method supported merely because it appears in help text.
- At most one native neural proposer plus one native retrieval method in this design. All individual methods in the capability profile are selectable; only validated combinations are enabled.
- Device identities come from discovery and existing peer mapping. No GPU UUIDs, model filenames or two-PC assumptions in production logic.
- Current branch is `feat/rpc-input-residency` with substantial pre-existing staged work. Preserve it. Before implementation inspect merged branch/worktree state and choose an isolated `feat/speculative-decoding` checkout from the correct base; do not reset, stash or switch the dirty app tree without authorization.
- Agent tools cannot select Luna/max; retain planning and editing locally rather than substituting another model. Independent security/implementation review must use an explicitly available approved route.
- Tests are written and observed failing before code changes. Commit only when authorized, using explicit paths and focused purpose groups. Follow the user's current commit-size instructions; the earlier two-file cap was lifted for this checkpoint. Do not automatically execute commit snippets from a generic skill.

## Interfaces and file responsibilities

Create `packages/core/src/speculative-decoding/contracts.ts` for a strict `SpeculativeDefaults` record: `version: 1`, `enabled: boolean`, `proposer: NeuralProposalSelection | null`, `retrieval: RetrievalSelection | null`. Neural selection contains a closed method ID, `assetId: string | null`, an explicit embedded-MTP source choice, device preference and `maxDraftTokens: number | null` (null means verified native default). Retrieval selection contains a closed method ID and its typed method-specific options. No generic option dictionary, CLI text or renderer-supplied paths. Both null is valid only while disabled. Represent embedded and companion assets as discriminated variants so contradictory choices cannot decode.

Create `profiles.ts` for package-bound `SpeculativeCapabilities`: artifact identity, methods, combinations, native defaults/bounds, asset requirements, supported devices/concurrency and execution evidence reference. Availability responses contain bounded IDs/labels/reason codes only. Prefer the existing verified artifact profile mechanism over changing the signed inventory format.

Create `assets.ts` for role-specific metadata and compatible registered assets. `resolve.ts` produces a trusted `ResolvedSpeculativeLoad` containing the method list, sealed asset identities, resolved device identities, native defaults, estimate identity and canonical fingerprint. Only trusted owners obtain paths. `arguments.ts` compiles that resolved value into allowlisted native flags; Off produces no speculative method flags.

Extend existing model-configuration records with `speculation`, increment the JSON record schema to v2 and explicitly migrate v1. Thread this field into active snapshots and current load capture. Extend Cluster effective loads and fingerprints, not named placement records. Implement diagnostics in the existing owner/readiness flow; create a small `readiness.ts` parser only if needed to keep launch code focused.

## Task 1: Confirm policy and introduce safe saved settings

**Files:** new `speculative-decoding/contracts.ts` and adjacent tests; existing `model-configuration/{contracts,store,wire,controller,resolve}.ts` and adjacent tests; `cluster/contracts.ts`; affected specifications listed in the design.

- [ ] Record the reviewed design decision and targeted supersession of no-draft/disabled-only clauses. Keep speculative methods subject to D12 correctness rather than closing D12 globally.
- [ ] Add failing tests named `migratesV1ToSpeculationOff`, `rejectsUnknownSpeculationFields`, `rejectsEnabledWithoutSource`, `retainsBoundedDisabledSelection`, `speculationSaveRequiresReload` and `queuedRequestKeepsActiveSpeculation`.
- [ ] Run the core test command below for these files and confirm the failures arise from missing behavior.
- [ ] Implement strict settings decoding, explicit migration, Save/Reset defaults and active-versus-pending comparison. Keep record and database schema migrations distinct and transactional. Proposer removal cannot corrupt another model's saved record.
- [ ] Carry requested/effective speculation and package identity in active/history provenance with a backward decoder for old captures. Generation sampling overrides remain unchanged.
- [ ] Run targeted tests. Confirm old settings, old history, old placement records and Off launches remain valid without rewriting unrelated values.

## Task 2: Resolve supported methods and companion assets

**Files:** new `speculative-decoding/{profiles,assets}.ts` and adjacent tests; existing `runtime/gguf.ts`, `model-configuration/model-source.ts`, `model-configuration/development-profile.ts`, `hosts/development-desktop.ts`; `apps/desktop/src/main/runtime-controller.ts` and import/preload handlers.

- [ ] Add failing tests for `runtimeSwitchRevalidatesMethods`, `helpTextCannotGrantCapability`, `embeddedMtpNeedsVerifiedHeads`, `headOnlyCompanionIsNotTarget`, `vocabularyCountIsNotCompatibility`, `changedCompanionFailsRevalidation` and `missingCompanionDoesNotBlockOff`.
- [ ] Implement the package-bound method table for the first verified artifact. Bind all native flag mappings/defaults to its exact source/artifact evidence; leave unsupported artifacts unavailable. Include EAGLE-3 only where that package supports it.
- [ ] Reuse the delivered shared GGUF picker, content classifications, digest identities and private source records when connecting native speculation settings. Full standalone drafters remain under Models and specialized companions under Speculative heads. File-backed statistics, if exposed, still require separate bounded import support. A renderer cannot register arbitrary paths through the configuration command.
- [ ] Validate model-specific sidecar requirements and native tokenizer compatibility; use no bespoke tokenizer-remapping helper. Preserve file seals through native use and avoid target-only context/layer assumptions for head-only assets.
- [ ] Check Save/read availability without loading a model; repeat full identity checks at activation. Test missing/moved/replaced assets and dependent asset removal.
- [ ] Run the targeted unit and desktop main tests. Document which runtime/method combinations have syntax evidence and which still need execution/resource evidence.

## Task 3: Admit the complete speculative deployment

**Files:** new `speculative-decoding/resolve.ts` and tests; existing `cluster/{contracts,effective-load,run-plan}.ts`, `hosts/{placement-estimator,development-desktop,real-engine}.ts`, `runtime/{gpu-resources,preflight}.ts` and reservation call sites.

- [ ] Add failing tests for `speculationChangesLoadFingerprint`, `namedPlacementDoesNotCaptureSpeculation`, `targetEstimateCannotAdmitDraft`, `sharedTargetAndDraftCountMemoryOnce`, `proposerOnlyDeviceIsReserved`, `unavailableRemoteDraftIsExplained` and `saveDuringPreparationInvalidatesIntent`.
- [ ] Resolve the runtime-default proposer device into an actual captured device plan; offer CPU, local or peer devices only where the method's native profile supports them. Treat native shared-head constraints explicitly. Keep target allocation fixed.
- [ ] Extend the exact native estimate path to cover target/proposer weights, state, verification outputs/rollback/scratch, concurrency, host loading peaks and retrieval RAM. If the current helper cannot estimate it, implement a narrow estimator adapter within an isolated build/package workflow or keep the combination unavailable. Never invent an estimate or use a fixed multiplier.
- [ ] Include every resolved asset/device/profile/default in load identity and evidence invalidation. Reserve devices used only by the proposer and release them on cancel/failure/Quit. Preserve existing replacement confirmation and current-session behavior until admission completes.
- [ ] Run focused planning/resource tests. Verify insufficient resources cannot silently alter context, slots, precision, target placement or draft method.

## Task 4: Compile arguments and prove native activation

**Files:** new `speculative-decoding/arguments.ts` and tests; existing `hosts/{runtime-arguments,real-engine,utility,development-desktop}.ts`, `cluster/effective-load.ts`; bounded readiness parser/diagnostic contracts and associated tests.

- [ ] Add failing tests for `offLaunchPreservesExistingArguments`, `compiledMethodsMatchVerifiedPackage`, `draftDeviceUsesCapturedIdentity`, `nativeFallbackIsNotSuccessfulActivation`, `failedDraftLoadReleasesAllReservations` and `workerLossInterruptsWholeDeployment`.
- [ ] Map typed methods to versioned native flags, resolved companion paths and device names through the current owner. No arbitrary arguments or runtime environment override API is added. Keep bridge bytes and native verifier code unchanged.
- [ ] Require startup evidence of initialized selected methods. Capture effective settings, package/companion identities and proposer devices for diagnostics. Do not infer successful activation from process readiness alone.
- [ ] Keep one target/model alias shared by Chat/API. Confirm process ownership, partial output, cancellation, reload and full Quit account for proposer state without another runtime supervisor.
- [ ] Use mocked/fixture owners first. Actual engine/estimator builds and live probes are a later explicitly authorized validation stage, not part of this planning turn.

## Task 5: Enable the existing settings section

**Files:** `apps/desktop/src/renderer/features/models/{configuration,live-configuration,ModelConfigurationPage}.ts`/`.tsx` and related tests; configuration wire/shared/main tests; a small section component may be extracted if it keeps the page focused.

- [ ] Add failing tests for `existingModelsDefaultOff`, `showsOnlyCompatibleCompanions`, `unavailableMethodHasReason`, `cpuAndDiscoveredGpusHaveNoMachineRoles`, `neuralAndRetrievalSelectionRoundTrips`, `saveMarksReloadWithoutStartingEngine`, `resetPreservesActiveSession` and `runtimeChangeRetainsUnsupportedSavedSelection`.
- [ ] Add the reviewed controls from the design inside the existing Speculative decoding section. Use native/runtime defaults visibly; no automatic fastest-method selector or unsupported Auto optimization.
- [ ] Distinguish embedded MTP from companion selection. Route Import through the native picker and select registered asset IDs. Display native retrieval method names with plain descriptions rather than calling them a novel suffix engine.
- [ ] Keep draft values isolated until the core acknowledges Save. Show effective/active versus pending status and existing reload messaging. Do not expose paths, credentials, raw flags or acceptance estimates.
- [ ] Preserve existing Chat generation/prompt metrics. Native acceptance counts may appear in existing diagnostics only when the runtime supplies valid scoped data; unavailable means unavailable.
- [ ] Run focused renderer/main tests with the repository's single-worker desktop configuration. Check keyboard navigation, disabled reasons, narrow layout and Save/Reset against existing design conventions.

## Task 6: Validate the product path and document support limits

**Files:** feature documentation and `specs/TESTING-SPEC.md`; targeted Chat/API, cancellation, history, configuration, native peer and resource tests. Add a native fixture suite under the existing native-test configuration when its contract is approved.

- [ ] Run scoped suites, typechecks and lint for changed code. Run the existing relevant core/desktop regression suites once after integration; broaden only for new changes or failures.
- [ ] Agree the exact live assets, runtime hashes, methods, devices, sampling, contexts/concurrency, numeric comparisons and stopping rules before GPU execution. Do not copy the private patched CUDA backend into app installations.
- [ ] Validate one local target and a distributed target through the real residency path; cover CPU and GPU proposers where supported, all selectable method families, a neural-plus-retrieval combination, multiple slots, EOS/stop, rejection/recovery, cancellation, reload/Off and worker failure. A missing compatible asset or unsupported native combination stays visibly unavailable and is recorded as an incomplete acceptance row, not an invented pass.
- [ ] Compare greedy and configured nonzero-temperature behavior to a target-only reference on identical prefixes; include raw logits and state recovery where needed. Keep finite token matching distinct from distributional/single-GPU acceptance. Do not lower quality to obtain a pass.
- [ ] Measure repeated alternating 512+ output runs only under the approved test contract; include all generation work and communication, report prompt processing separately and retain early-EOS outcomes. This integration has no universal speed gate and imports no earlier speed claim.
- [ ] Record package/model/asset/topology/method/settings/actual initialization plus cleanup evidence. Stop mining immediately before authorized GPU tests and restore it on both test hosts on every exit; retain memory, deadline and process guards.
- [ ] Update method availability documentation and the existing API contract to say that management-owner speculation is shared by Chat/API; caller-level draft paths/method overrides remain rejected. Production release, cross-platform evidence, independent runtime updates and broad D12 correctness stay separate gates.

## Verification commands for implementation

These commands are planned, not executed in the documentation-only turn. Run from the named directory using the repository's installed tools; pass the exact changed test paths where indicated.

| Directory       | Command                                                                              | Pass condition                                                                                  |
| --------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `packages/core` | `pnpm exec vitest run --config vitest.config.ts <changed-test-paths>`                | Targeted contracts/migration/arguments/resource tests pass after an observed failing test       |
| `apps/desktop`  | `pnpm exec vitest run --config vitest.config.ts <changed-test-paths>`                | Existing configured single-worker renderer/main tests pass                                      |
| repository      | `pnpm typecheck`                                                                     | Both existing TypeScript checks succeed                                                         |
| repository      | `pnpm exec eslint <changed-ts-and-tsx-paths>`                                        | Scoped lint succeeds                                                                            |
| `packages/core` | `pnpm exec vitest run --config vitest.native.config.ts <approved-native-test-paths>` | Only after native assets/build/test authorization; real peer/lifecycle checks pass              |
| repository      | `npm run electron dev`                                                               | Only the approved interactive launcher, after authorized implementation and live-test readiness |

Native test filenames do not exist yet and must be supplied by the owning implementation task; do not run placeholder commands. Do not start a second packaged app, private chat UI or research helper for product acceptance.

## Review focus and completion

- Legacy data and runtime downgrade: migration keeps Off and preserves old history; an unsupported saved choice explains the failure without silently changing it.
- Asset identity across async loading: replaced files, companion removal and stale settings cannot launch with another asset or device plan.
- Resource contention: sharing a GPU or using a proposer-only peer/device cannot bypass combined memory admission or leak a reservation.
- Numerical boundaries and concurrency: the private four-row experiment does not qualify another runtime, model, larger width or multiple slots.
- Effective activation: native fallback/partial initialization is not a successful requested load; Off recovery and owned cleanup remain usable.

Author self-review maps these cases to tasks 1 through 6. The current implementation plan is a review proposal; native estimator capability, compatible assets and runtime correctness evidence are explicit delivery prerequisites. No implementation or performance result is claimed. Review the design, then obtain PROCEED for the agreed implementation scope before beginning Task 1. Do not treat approval of the plan as permission for publication or a GPU benchmark.
