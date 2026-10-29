# Speculative decoding settings and placement

The feature branch implements saved settings, Cluster placement and native speculative execution for the pinned development runtime. Selected methods pass companion validation, combined memory admission and positive native initialization before becoming ready. Failed initialization stops the deployment instead of silently continuing target-only.

Model configuration owns the neural method, companion identity, maximum draft tokens and optional native n-gram retrieval method. Neural methods are MTP, a standalone draft model, DFlash, DSpark and EAGLE-3. This list describes saved intent, not a statement of runtime or model compatibility. Companion choices come from the existing GGUF library and use digest identities, never renderer-provided file paths or command-line arguments. Classification identifies a companion's kind; it does not prove a compatible pairing.

Cluster owns the companion execution-device preference: Automatic, this PC's CPU or a discovered executable GPU. Peer GPU identities use the existing fingerprint-qualified device mapping. Remote CPUs are not offered as if they were supported. Named allocations retain this choice independently of the per-model method settings. Missing devices and companions remain visibly unavailable. Retrieval alone has no GPU assignment control.

Saving model settings or a Cluster allocation does not reload or change an active deployment. Active and queued Chat/API requests retain the captured settings. Changes use the existing Save, discard, undo and Run flows; there is no second speculative runtime or separate Save button. The model editor has a read-only device summary and a shortcut to the Cluster workload inspector.

Model configuration JSON version 1 decodes as version 2 with speculation Off. The database schema is unchanged; a subsequent Save persists the canonical version 2 record. Old history and old Cluster captures remain readable. Pending neural choices may be retained while disabled and cannot become active when the user selects retrieval alone.

## Native integration

The stock `llama-fit-params` remains target-only. The signed development bundle additionally contains `modelloom-speculative-estimator.exe` and two uniquely named estimator DLLs. They use the pinned source with an additive estimator-only API, no-allocation target/proposer contexts and final graph reservations. CUDA kernels, model numerical code, the server executable and the residency protocol are unchanged. The owned console helper has a bounded 128-argument envelope for the additional typed native flags.

Activation performs these checks:

- Resolve imported companion digest identities and retain target/companion file seals through native exit. Compare vocabulary contents and head shapes; native initialization checks effective tokenizer and model requirements.
- Estimate combined target/proposer weights, context, graph buffers and explicit output/feature workspaces. Keep the existing host/allocator safety envelope and resample resources before launching.
- Reserve the union of target/proposer devices, including proposer-only peers, and compile one consistent process-wide local/RPC ordinal map.
- Verify target placement and positive speculative initialization. Chat and API use the same deployment, verifier, sampler and shutdown owner.

Embedded MTP follows the target placement. DFlash, DSpark and EAGLE-3 borrow target tensors and currently follow the target output GPU; the UI offers Automatic for these shared-weight heads. Standalone drafts and separate MTP heads can select CPU or discovered GPUs. Unsupported placements fail before native creation.

Native `ngram-simple` and `ngram-mod` are wired, including a neural-plus-retrieval selection. `ngram-map-k`, `ngram-map-k4v` and `ngram-cache` remain unavailable because their cross-request maps lack a proven memory bound. Their saved identities remain readable and show an explicit reason; no estimate is invented.

Controlled native smoke tests exercised target-only, a standalone draft, a separate MTP head and DFlash with the cached Bonsai target. All produced the same 64-token greedy output hash. This finite smoke result does not establish a speed gain, single-GPU equivalence for every model or nonzero-temperature distributional correctness. EAGLE-3 and DSpark loading still need compatible local assets for model-level acceptance. General product correctness and release gates remain separate from this development integration.

## Live rates and reported issues

Chat requests enable the pinned runtime's streaming timing and prompt-progress fields. Generation rates include thinking and use native accepted-output accounting. Prefill rates exclude cached input. Live measurements are limited to roughly four updates per second and remain saved after cancellation or interruption. Optional malformed timing metadata does not invalidate otherwise valid text. No new GPU inference was run to validate this display change.

The Cluster device menu floats outside its scrolling panel, stays within the viewport and preserves keyboard navigation. The Model configuration row uses the Layer assignment gutters, with a 4 px gap below the visible device pill.

Reported intermittent peer disconnects and a stale MTP summary after saving Off remain unresolved. The disconnect investigation found that background peer-control failures can remove required devices and stop an active model; the initiating error in the reported incidents was not retained. These reports do not establish that the residency codec or speculative method caused the failures.
