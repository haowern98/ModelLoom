# Native speculative decoding app integration

Status: proposed design, 29 October 2026. The user requested planning only and explicitly selected all supported native methods, replacing the product restriction on draft models for this feature. The unchanged-quality requirement remains. Implementation, builds, GPU runs, deployment and publication are not authorized by this document.

Scope update, 29 October 2026: the [GGUF model library](../../gguf-library.md) has since been implemented and deployed under separate user approval. The shared importer, content classification and saved-entry repair are delivered. Speculative inference settings, native method activation and performance validation below remain proposed work. This document grants no execution authority; current user instructions govern each next step.

## Product behavior

Enable llama.cpp's existing speculative decoding through ModelLoom's current owned runtime, model configuration and peer transport. Chat and the local API share the same active configuration. Default to Off, including existing saved models after migration. A proposer is an auxiliary part of the one active target deployment, not a second independently active chat model.

The existing Models configuration section becomes functional. Preserve its surrounding layout, Save/Reset behavior and separation between pending settings and the active session. Saving does not load models, allocate GPUs or interrupt generation. Speculation changes apply on the next explicitly requested load/reload through the current replacement-confirmation flow.

| Control              | Proposed behavior                                                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enabled              | Off by default; retain valid edited values while disabled                                                                                            |
| Neural proposer      | None, MTP, standalone draft, DFlash, DSpark or EAGLE-3, as supported by the verified runtime                                                         |
| Companion model      | Select a registered local asset when required; MTP may use embedded heads or a separate compatible companion                                         |
| Proposer device      | Runtime default, CPU or an eligible discovered device; expose stable identities rather than hardcoded machine roles                                  |
| Maximum draft tokens | Runtime default or an explicit value within the validated profile's bounds                                                                           |
| CPU retrieval        | None, ngram-simple, ngram-map-k, ngram-map-k4v, ngram-mod or ngram-cache, where supported                                                            |
| Retrieval details    | Method-specific match length, continuation length and hit threshold where available; explicit runtime defaults rather than invented universal values |

At least one proposer or retrieval method is required when enabled. Start with at most one neural proposer plus one retrieval method; combinations are enabled only when the selected native profile supports them. Multiple simultaneous neural drafters and arbitrary combinations of retrieval implementations are outside this first design. The user has confirmed method families; the control choices above remain recommendations for review.

Expose unavailable options with a concise reason: unsupported runtime, missing companion, incompatible model/tokenizer, unsupported placement, insufficient resources or unvalidated numerical configuration. Do not silently change methods, placement, target settings or sampling. Disabling speculation returns to the normal native target path.

## Runtime and compatibility

Use typed flags on the existing llama-server process. Keep the app's residency codec, authenticated peer admission, one-target ownership and shutdown machinery. No custom verifier, new decoding scheduler, research suffix helper, AWC controller or experimental CUDA DLL is imported.

The initial integration has three separate checks:

1. A verified package profile lists native method names, supported flag spellings, defaults, bounds, combinations and platform/backend requirements. Unknown flags or future method strings are not forwarded.
2. Bounded inspection and sealed file identities establish target/companion metadata and the assets used at launch. A matching filename, architecture name or vocabulary count alone does not establish compatibility. Tokenizer remapping is accepted only if the selected native method explicitly supports and validates it; no custom text-remapping helper is added.
3. An execution profile establishes the supported model/backend/sampling/concurrency/verification-width combination. Metadata or successful loading is not inference-correctness evidence.

Runtime selection stays independent of Electron. Revalidate capabilities, assets, estimates and active settings whenever the package changes. Preserve unsupported saved selections for editing, explain them and block the requested speculative load until corrected. Do not replace the runtime automatically. Package signing and existing peer runtime-compatibility checks remain authoritative; different releases are not made interoperable by this feature.

Current code pins `createConfigurationProfile` and `runPlacementEstimator` to upstream commit `4f31296a907d73f3409f720429bcf31111615d77`. Therefore the first implementation must add explicit versioned capability/estimator adapters within the existing package verification boundary. A runtime's help text can confirm syntax but cannot grant trusted capabilities or prove resource/correctness support. This is not a runtime updater rewrite.

## Companion assets

Reuse the implemented shared native GGUF picker, private model-source records, digest identities and file seals. The renderer selects an asset ID and displays bounded metadata; it never supplies an executable argument or filesystem path. All entries appear under All. Full models, including standalone drafters and targets with embedded MTP, appear under Models. Specialized EAGLE-3, DFlash, DSpark and extracted MTP companions appear under Speculative heads using content-based classification. Do not ask the user to select an import purpose or invent target metadata for a companion. Runtime pairing and activation remain separate work.

Persist companion references by verified content identity. Detect deletion, moved/replaced files and stale identities before activation. A missing companion must not damage the target's settings or prevent loading with speculation Off. Keep files sealed while native code uses them. Referenced asset removal must explain the dependency and require the settings to be changed before use; removing an index entry does not delete the user's GGUF.

Local companion imports are the first delivery path. Automatic downloads, conversions and training are outside scope. `ngram-cache` file-backed statistics, if exposed, also use an explicit native picker and owner-held ID; they do not grant general access to chat history or other users' caches. Cross-chat retrieval-corpus policy is not added implicitly.

## Settings and immutable activation

Add a versioned speculation record alongside load/generation preferences, with an explicit v1-to-v2 model-record migration that sets Off. Keep the configuration database schema version distinct from the JSON record schema. Strict decoding rejects unknown methods, bad identities, negative/out-of-range token budgets and invalid enabled combinations. Disabled settings remain syntactically bounded; asset availability is required only for enabled activation.

Carry the saved speculation record through `ActiveLoadSnapshot`, captured Cluster load, resolved effective load and its fingerprint. Named Cluster configurations remain placement-only: speculation belongs to the per-model settings record. Saving a speculation edit marks reload pending; it never changes the active request snapshot or an already queued request.

Core resolves asset paths, physical device identities, package-specific flags and immutable activation receipts. Native startup must confirm the selected proposer actually initialized; silent native fallback is not a successful activation. Store requested and effective method/package/asset/device details in bounded diagnostics and history provenance without leaking private paths. Unsupported receipt fields and absent acceptance metrics remain unavailable rather than becoming zeros or estimates.

HTTP clients continue using the existing model alias and generation override contract. Do not accept draft paths, device identities, arbitrary native flags or a per-request method switch through the public API. The model-management owner configures speculation once for both Chat and API.

## Devices and resource admission

Target layer placement remains the user's existing Cluster allocation. A proposer may share a target device if memory admission passes, use another discovered GPU, or use CPU when the native method supports it. The runtime-default option is resolved and recorded before activation; it is not permission to select a different device after a failure. Remote proposer placement is offered only where the runtime, head-sharing requirements and peer device mapping have explicit support. Local-only support must be identified honestly rather than presented as a universal CPU/GPU choice.

Estimate the complete deployment: target and companion weights, both KV/recurrent states, verification outputs, scratch, rollback buffers, host loading peaks and CPU retrieval memory. Count shared weights once only when the native profile establishes actual sharing. Include concurrency and devices used only by the proposer in reservation, admission, cleanup and invalidation. A target-only estimate is never reused as a complete speculative estimate. If the existing estimator cannot describe a combination, add a bounded native estimator adapter or leave that combination unavailable; do not use a guessed memory multiplier.

Preserve context, target weights/quantization, target device allocation, KV precision and configured sampling. No silent context reduction, slot reduction, CPU offload or weight substitution to make a draft fit. Do not hardcode the two-PC fixture or require a spare GPU.

## Correctness, lifecycle and evidence

Keep the native verifier and sampler authoritative. Validate rejection at each supported position, accepted-prefix state retention, cancellation/recovery, EOS/stop handling, context limits and multiple slots. MTP/DFlash hybrid state and speculative rollback need their own checks. Preserve target probability/sampling behavior; same-seed token matching is useful finite evidence but not proof of distributional equivalence.

Prior private experiments validated only bounded configurations, including a four-row CUDA correction outside installed runtimes; they do not qualify stock app runtimes, all widths, four-slot operation or other model families. Do not ship those patches automatically or impose a universal three-proposal cap because one hardware fixture favored it. Bounds come from each validated execution profile. A failing combination stays unavailable with its evidence retained.

GPU inference and benchmark execution require a separate current test contract after implementation authorization. Proposed live acceptance compares Off and enabled methods on the same target/model/settings/topology, through the app's real residency transport, including ordinary Chat/API, repeated-turn editing and two-or-more-slot controls. A speed comparison uses repeated alternating runs with at least 512 output tokens each, whole-generation timing and no concealed early-EOS exclusions. Mining restoration, memory/deadline guards and owned cleanup apply as in prior authorized testing. No new GPU test is authorized by this plan.

Functional integration and speed are different outcomes. Do not advertise every method as faster. Keep existing generation/prompt-processing metrics; retain native proposed/accepted counts in diagnostics when available. No fabricated acceptance percentage, mandatory output cap or general speed promise is added.

Shutdown, failed loading and worker loss release the whole owned target/proposer deployment and its reservations. They preserve partial output and keep the GUI usable. Restarting in Off mode must work after a failed speculative activation. No termination by executable name and no second manual app or browser adapter.

## Source map and authority

- Configuration: `packages/core/src/model-configuration/{contracts,wire,store,controller,resolve,development-profile}.ts`.
- Activation: `packages/core/src/cluster/{contracts,effective-load,run-plan}.ts`, `packages/core/src/hosts/{runtime-arguments,placement-estimator,real-engine,development-desktop,utility}.ts`.
- Metadata/assets: `packages/core/src/runtime/gguf.ts`, `packages/core/src/model-configuration/model-source.ts`, `apps/desktop/src/main/runtime-controller.ts` and the existing import/preload handlers.
- Editor: `apps/desktop/src/renderer/features/models/{configuration,live-configuration,ModelConfigurationPage}.ts`/`.tsx`; shared configuration types and their strict decoders.
- Package compatibility: existing verified inventory and setting profiles, extended by typed speculation profiles rather than renderer input.
- Native reference: [llama.cpp speculative decoding documentation](https://github.com/ggml-org/llama.cpp/blob/master/docs/speculative.md). Current upstream method/flag listings are discovery evidence; implementation must bind them to an exact verified artifact.

Before implementation, reconcile the user-approved scope with AGENTS.md, PRODUCT-SPEC P3/P8, TECHNICAL-SPEC T20, INTEGRATION-SPEC, UI-SPEC, TESTING-SPEC, API-SPEC, ADR-0001/0003/0006 and decision D12. Preserve their historical decisions and supersede only the no-draft/disabled-speculation clauses affected here. Other security, platform and acceptance decisions remain open.

## Review decisions

The confirmed decision is support for all supported native method families. Review the proposed one-proposer-plus-one-retrieval UI, companion import flow, reload semantics and capability-based availability before implementation. A capability may remain unavailable until its native estimator and correctness evidence exist; that is a visible support limit, not permission to report all methods delivered. No coding begins without a new PROCEED for the reviewed integration scope.
