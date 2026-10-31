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

An active neural proposer also exposes **Acceptance rate** after prompt processing: cumulative native `draft_n_accepted / draft_n`, across MTP, standalone drafts, EAGLE, DSpark and DFlash. Unknown or zero proposed counts display `—`; a positive proposal count with no accepted tokens displays `0%`. The loaded deployment controls visibility, so speculation-off responses and older saved responses do not acquire a metric from later configuration changes. The last reported rate persists with the response. This diagnostic alone does not measure a speedup.

RPC lifecycle diagnostics include a connection ID, role, setup phase, fixed error codes, elapsed time and close direction. The client and worker share an opaque trace ID; the local gateway has a separate ID and records its original opening error. An eight-event rolling metadata context is emitted on errors into the existing bounded runtime log. No packet payloads, model text, credentials or addresses are retained. Forwarding, retry and lease policies are unchanged.

Slot failures emit `slots.read-failed` for HTTP/transport, JSON, ownership and schema failures, and `slots.monitor-failed` for the exact monitor invariant or proof deadline. A per-load monitor ID links both records. The monitor retains at most eight scalar snapshots, each capped at eight observed slots and reservations, sampled on state changes or every five seconds. Failure output is capped at 4,096 characters and uses the bounded runtime log; raw `/slots` responses, prompts, generated text and credentials are excluded. Poll cadence, observation deadlines, cancellation proofs, admission and shutdown rules remain unchanged. These diagnostics do not establish or repair the initiating cause of earlier `EXECUTION_FAILED` incidents.

The Cluster device menu floats outside its scrolling panel, stays within the viewport and preserves keyboard navigation. The Model configuration row uses the Layer assignment gutters, with a 4 px gap below the visible device pill.

The peer-control failure path now normalizes local overlay dial failures into transport errors, preserving its bounded retry policy. An inventory-probe failure alone no longer removes an approved peer while an admitted RPC stream remains open. The stream's authenticated heartbeat and independent worker lease still close lost sessions; explicit revocation, sharing changes and invalid authenticated responses do not receive transport grace. New admissions still obtain fresh authenticated inventory/status rather than trusting retained display facts.

The normal application-data `peers/connection-failures.json` retains the latest 64 inventory, heartbeat and RPC-close events. Only fixed error codes, stage, decision and timestamps are recorded, without prompts, credentials, addresses or arbitrary error text. Logging failures cannot prevent runtime cleanup. This corrects a reproduced failure-handling defect; it does not establish the initiating error in earlier incidents, which was not retained, or validate remote MTP model execution. The stale MTP summary after saving Off remains a separate unresolved report.

## PowerShell diagnostics

Normal development launches emit timestamped `[ModelLoom]` diagnostics in their terminal. The normal profile also retains up to 512 KiB in `.modelloom/logs/runtime.log`; each PC records its own events. Follow it in PowerShell with:

```powershell
Get-Content "$HOME\.modelloom\logs\runtime.log" -Tail 80 -Wait
```

Events include load/preflight stages, selected native loader/CUDA/assertion errors, native readiness, explicit stop requests, force-stop reasons, native exit codes (decimal and hex), peer-control failures and worker-helper/stream closure. Core utility output uses drained pipes instead of being discarded; only owned diagnostic prefixes are forwarded. Prompts, generated text, API credentials and arbitrary utility output are excluded. Log writes are asynchronous and bounded; a closed terminal or failed diagnostic write cannot change engine ownership. No previously discarded native failure output can be recovered by enabling logging afterward.

The API page's **Runtime logs** card reads this shared main-owned history independently of the API server and active model. Chat and API request lifecycle events contain only request identities and closed outcomes. The nested viewer has All/Errors filters, icon-only Copy/Clear controls, a 360 px default height and a bounded resize range. It follows the latest events until the user scrolls up. Copy includes the retained entries in the selected filter; Clear clears the shared viewer history without deleting the diagnostic file. Copy/Clear results use the existing green success or red error popup, which dismisses after five seconds unless hovered or focused. No success text is inserted into the toolbar. Peer failures display their code first; Copy and the diagnostic file retain the original detail.

Main retains no more than 2,048 viewer entries or 512 KiB of serialized entries. The closed read/clear bridge repeats these bounds, validates sources, timestamps and severity, and is restricted to the current main frame. Revision-based reads avoid transferring unchanged history; the renderer polls only while the card is mounted, ignores reads predating Clear, and virtualizes the visible rows with a small overscan. Engine unloads do not clear main's history. Each PC shows its own runtime and peer events; the card does not add remote native stderr to the existing RPC protocol.
