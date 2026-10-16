# ModelLoom product requirements

**Status:** Windows development runtime, Chat, model configuration and local API implemented; full M1, distributed and release acceptance remain pending

**Updated:** 2026-10-14

**Scope:** The install-to-chat product experience. Inference speed research remains a separate workstream governed by `AGENTS.md` and the user's later benchmark clarifications.

This is the authoritative product specification, moved from `ModelLoom-Project Prd.md`. Existing P1-P7 requirement numbers are preserved. Later agreed behavior is recorded under P8-P9 and in [ADR-0001](decisions/0001-product-and-ui-baseline.md). [ADR-0002](decisions/0002-lm-studio-runtime-direction.md) supersedes the earlier process-name ban and establishes the LM Studio hosting/audit, crash isolation, upgrade, and shutdown requirements. Technical proposals and unresolved choices are recorded separately in the [decision register](decisions/README.md).

Related specifications: [technical](TECHNICAL-SPEC.md), [integration](INTEGRATION-SPEC.md), [security](SECURITY-SPEC.md), and [UI](UI-SPEC.md). Specifications define behavior and constraints; execution work belongs in [plans](../plans/PLAN.md).

**Cluster configuration implementation, 2026-10-16:**

The implemented Windows development slice uses the verified, unmodified b11306
runtime for the exact Bonsai 64-block profile: context 7680 per slot, four slots,
q8_0 K/V caches, flash attention on, batch 2048/microbatch 512 and one or two
NVIDIA GPUs on this PC.
Other load tuples remain rejected. It does not open production root custody,
change signatures or modify llama.cpp. Auto place refreshes resources and runs the
stock fit estimator, preferring one GPU, then checking both GPU orders and cuts
from the centre outward until the first feasible proposal. Review, Save and Run
remain separate actions. Run captures the saved ID/revision, model, load settings
and ranges, preflights before stopping an active model, and rechecks dirty state
and revision in core. Exact UUID launch and complete stock debug startup checks
bind PCI identities, all 64 blocks, output, cache/state and allowed input fallback.
The UI shows verified active ranges. Quit joins estimator cleanup.
Dated local evidence and its limits are recorded in
[native validation](../docs/research/cluster-placement-native-validation.md).

## Current delivery scope, 2026-10-14

The explicitly enabled Windows development build supports verified local Bonsai
loading and real Chat Send/Stop/Retry, durable history available before loading,
separate thinking/answer, saved rates and thinking duration, and confirmed chat
deletion. The later user approval removes thumbs-up/down and replaces the earlier
feedback-control default. The supplied screen composition and approved later
visual refinements remain authoritative; no unrelated redesign is authorized.

The later accepted [ADR-0006](decisions/0006-model-configuration-and-local-api.md)
adds protected per-model settings, captured request defaults and a key-required
loopback API sharing Chat admission. An explicit Windows development package is
implemented locally. This is partial M1 evidence; current review and packaged
acceptance gaps are recorded in [the local API guide](../docs/LOCAL-API-DEVELOPMENT.md).
Attachments remain unavailable. Worker pairing/discovery/authorization,
distributed inference and in-app Tailscale/Headscale are unimplemented. M1-M5
and J1-J15 remain acceptance targets. Existing Tailscale supplies connectivity
only, not ModelLoom workers.

### Historical renderer-only delivery scope, 2026-10-06

The 2026-10-05 documentation reconciliation fixed the existing UI without authorizing changes. [UI-SPEC's current baseline](UI-SPEC.md#current-ui-baseline-2026-10-05) records the implemented shell, Models/configuration, Cluster, Chat and API presentation. The separately authorized 2026-10-06 Settings renderer preview adds category navigation/search and Appearance/Runtime presentation with unavailable controls; production settings, Explore/catalogue, Storage and Metrics remain deferred. The proposed two-column Models layout and Downloaded/Imported/Browse tabs are not the current design.

Working interactions are local demo behaviour: library filtering/details/removal, validated session defaults, simulated placement/model lifecycle, joining previews, conversation drafts/feedback and explicit text copying. Chat Send/attachments and real API lifecycle/exposure/key/log controls remain unavailable. No runtime, network enrollment, persistent history or actual API service is implied. P1-P9 and J1-J15 below remain production requirements, not a report that they are implemented. Preserve the UI baseline when planning integrations; future visual changes need separate authorization.

## 1. Product goal

ModelLoom lets someone pool computers they own, load an existing GGUF model across them, and chat or serve an API from one polished application. The intended journey is:

**Install on each device → connect devices → choose a model → accept or adjust a split → start → chat or use the API.**

The same product must feel straightforward to a newcomer and give an experienced user explicit control. The interface should make the next useful action obvious without a mandatory tour or setup wizard. A supported workflow must not require terminal commands, separate llama.cpp downloads, manual worker launches, or editing configuration files.

## 2. Users and supported environments

Use **Electron** for the desktop application UI on Windows, Linux, and macOS. A GUI-independent ModelLoom Core manages separately versioned inference runtimes and supports desktop and headless operation through essentially the same core/runtime machinery. LM Studio's current llama.cpp path is the hosting reference; [ADR-0004](decisions/0004-runtime-lifecycle-proposal.md) accepts the initial Windows development hosting direction and shared TypeScript core. D01 remains open overall; real runtime activation and platform/release evidence keep their gates.

- **Home user:** pools two or more personal machines on a LAN or private network.
- **Experienced user:** chooses participating devices, connection path, model settings, and placement, and can inspect why a run failed.
- **Host operator:** runs a worker without an open desktop session, including on Linux.

Ship a platform-appropriate single app installer/package for Windows, Linux, and macOS. Each installation can act as coordinator, worker, or both. A usable default inference runtime ships with the app; models are separate downloads or imports. Support NVIDIA CUDA on Windows/Linux and Apple Silicon Metal on macOS, with a clearly reported fallback when a particular backend, model, or tensor type is unsupported. The product must not assume one fixed model or hardware layout.

## 3. Core requirements

### P1. Install and device management

1. One ModelLoom installation per device supplies the UI, coordinator, worker controls, and an initial compatible runtime. A headless worker mode can start, stop, recover, and expose logs without a desktop session.
2. The app detects available CPU/GPU devices, usable memory, operating system, runtime version, and worker health. It asks the user which devices to approve for a cluster.
3. The cluster screen shows each device's role, connection path, readiness, assigned model work, and actionable errors. Workers can be stopped or removed from the app.

### P2. Connect over LAN or a private network

1. Offer LAN discovery and simple in-app connection controls for Tailscale or an existing Headscale network. Manual private-address entry is available for experts. Normal Tailscale setup must not require the user to find and install a separate networking app; any required client component is supplied or managed by ModelLoom.
2. Show the actual path in use, including direct versus relayed private-network connection, and test reachability before model loading. Show measured connection quality without treating a connected badge as a speed guarantee. If a direct connection cannot be established, explain the blocker in the UI.
3. Joining a cluster requires visible approval. Worker traffic is limited to approved peers and is never exposed by default on the public internet. API access is configured separately from worker access.
4. The Headscale option connects to a control server the user already operates; hosting a Headscale server inside ModelLoom is outside this release.
5. Either desktop installation can initiate the connection. Add device invites another PC to contribute to this PC's cluster; Join cluster asks a coordinator to accept this PC as a contributor. The request direction determines the resulting roles. Share this PC enables participation requests and local hardware selection without automatically approving requests or starting inference. Show incoming invitations and join requests in Cluster overview with explicit Approve/Decline and the resulting coordinator/contributor roles. The approved UI demo simulates these actions in session memory only; discovery, delivery, identity approval and role changes remain networking integration work.

### P3. Model library and placement

1. Import a local GGUF or find/download one in the app. Show model identity, file size, location, architecture, quantization, and runtime compatibility before launch.
2. Estimate memory needed for the selected context and selected devices. Clearly distinguish an estimate from measured use.
3. Suggest a split across the selected devices. Experienced users can adjust placement per device and see the expected memory use and participation before starting.
4. Preserve the original GGUF weights and configured sampling behavior. If a model, tensor type, backend, or placement is unsupported, explain the limitation and offer only compatible choices; never silently substitute a model or quantization.
5. Show where the model files and worker caches live, and provide in-app controls to clear them.
6. Models is a compact library with identity, size, format, quantization and recorded last use; expose detailed metadata and per-model configuration through row actions. Unknown last use is shown as unknown. Planning, validation and Run/Stop live in Cluster. The approved configuration demo edits and validates per-model defaults for the current app session only, with no engine or active-session effects; real settings application remains integration work.
7. Importing another model retains every indexed library entry, including across restart. Re-importing identical content updates its file location without duplicating it or erasing its settings and recorded use. Library membership is separate from the selected and active runtime model.
8. When Limit Response Length is off, new requests have no reply-length token cap. The loaded context capacity still applies, with no silent history truncation. Enabling the setting applies the saved positive limit; an explicit API request limit overrides that default. Previously captured attempts retain their settings for Retry.
9. Auto-place proposes assignments without starting inference. Play on an empty allocation opens the existing automatic/manual assignment choice. Automatic assignment only prepares layers; manual assignment opens the editor. Once assignments are prepared, the same Play button loads the current allocation without requiring a named configuration. Save is optional for named reuse. Switching models never loads or saves; each model retains its unsaved draft and history. Undo back to an empty allocation restores the assignment choice on the next Play. Validation, memory warnings, explicit active-session replacement and owned cleanup still apply.
10. Cluster Save stores model identity and GPU assignments, without copying model settings. Every Run resolves that model's current saved settings and rechecks the allocation and memory requirements. Model-setting changes do not mark placement as edited, alter an active load, or change an admitted request.

### P4. Chat and API

1. Start, stop, and inspect a model from the same app. Provide a built-in chat interface with saved local conversations, generation settings, visible progress, and clear interruption/error states.
2. Provide an OpenAI-compatible local API. Enabling access beyond localhost is an explicit user action with visible address and access settings.
3. Show which model, runtime, and devices served the active session. If a required worker disconnects, stop the affected generation and show the cause; do not present a partial answer as complete.

### P5. Independently managed inference runtimes

1. App releases and inference runtime releases are independent. Users can inspect installed runtimes, install an update, select a version, and roll back without reinstalling ModelLoom.
2. Runtime packages are versioned for operating system and compute backend and record their llama.cpp source revision, ModelLoom build identity, and compatibility metadata. Runtime downloads use a signed manifest and verified package before activation. The app retains the previous working version until the new one is verified.
3. A runtime switch occurs between sessions. The app checks coordinator/worker compatibility before launch and offers a coordinated update or rollback when versions cannot work together.
4. The user never has to launch `llama-server`, `ggml-rpc-server`, or a shell script. The 2026-10-14 decision preserves the original `llama-server.exe` filename and allows the managed engine outside ModelLoom's Task Manager app group. Do not rename launch copies for grouping. Separate PIDs are acceptable; verify actual runtime identities and owned cleanup in the packaged app. Exact other worker/helper names await D01. No visible console window appears during normal desktop use; a Console Window Host entry alone is not evidence of a visible window. macOS/Linux process visibility is observed and documented without assuming Windows grouping there.
5. Replicate LM Studio's GUI/core/versioned-runtime hosting architecture as closely as technically possible. GUI and core are separate concerns; the same core/runtime machinery operates headlessly; llama.cpp remains an engine underneath the product. Follow the accepted [ADR-0004](decisions/0004-runtime-lifecycle-proposal.md) initial Windows development exception. Continue the [runtime-hosting audit](../plans/LM-STUDIO-RUNTIME-AUDIT.md) for remaining platform, lifecycle, update and release evidence; no live activation or acceptance is implied. Runtime native code must be isolated from the GUI/main process, and ordinary runtime crashes must not terminate the GUI. The user's grouped-process screenshot is evidence of presentation, not proof of the full internal process tree or protocol.
6. Make llama.cpp upgrades a normal Settings -> Runtime operation: install/select/update a verified platform/backend runtime, check cluster compatibility, activate between sessions, and retain the working version for rollback. No Electron rebuild/reinstall, end-user compilation, or manual engine launch is required. The same runtime-management capabilities are available to independently launched headless cores.
7. Full desktop Quit stops admission, cancels/resolves queued and active work, requests graceful shutdown of its owned core/runtime/helpers, escalates after a bounded deadline if necessary, and confirms their exit. Abnormal exit cleanup must prevent orphan desktop-owned runtimes. Independently launched headless deployments have separate ownership and lifecycle; do not terminate unrelated local deployments or remote worker services on desktop Quit. Window X performs full Quit, while minimize is distinct; precise cleanup mechanisms must be reviewed before implementation.

### P6. Troubleshooting and reliability

1. Before launch, check device reachability, runtime compatibility, model availability, memory fit, and the selected network path. Show one clear next action for a blocking problem.
2. During use, show worker status, model load state, API state, and a concise activity log. Provide an exportable diagnostic bundle that excludes model files, prompts, API credentials, and network secrets by default.
3. If a runtime update fails to start or load the previously working model, offer rollback from the app and retain the previous package.
4. If llama-server crashes, keep the GUI and unaffected core machinery usable, terminate/interrupt affected requests honestly, show the failure and recovery action, and bound restart attempts. Engine-crash isolation is an acceptance requirement, not a guarantee against operating-system or GPU-driver failure.

### P7. Interface quality

1. Make the main actions—add a device, choose a model, start, and chat—easy to find and use in context. Do not require a tour or step-by-step wizard. Detailed placement and network controls remain available in the first public release.
2. Keep model, device, connection, and runtime status visible in ordinary language. Offer short inline explanations and technical detail only where they help the user make a decision or fix a problem.
3. Apply consistent interaction and accessibility checks across Windows, Linux, and macOS, including keyboard operation, readable status text, and clear error recovery.

### P8. Agreed model and request lifecycle

Follow [ADR-0003](decisions/0003-lm-studio-behavior-reference.md): use LM Studio as the reference for applicable non-networking behavior. Preserve ModelLoom's approved UI, distributed inference, security, and quality constraints. Networking remains ModelLoom-specific.

1. The first release has one active model, shared by built-in Chat and the API. Selecting another library item does not silently replace the active model. Switching explains required interruption and requires the user's explicit action.
2. Chat and API share the active model's bounded request admission and follow LM Studio's configurable parallel-request/continuous-batching behavior where supported. One active model does not imply one active request. Show queued/busy states and provide cancellation. D09 investigates concurrency, pending capacity, fairness, timeouts, and overload behavior against versioned LM Studio evidence before scheduler implementation; its documented concurrency default of four is a reference to validate, not a verified cluster resource limit.
3. The 2026-10-17 revision separates Run, named Save and per-model settings. Retain assignment edits as durable raw drafts and validate them on Save or Run. Named configurations store model identity and exact GPU ranges; model settings remain in their separate per-model record. Auto-place proposes assignments, while Run uses the current allocation and current saved model settings without requiring a named Save. Selection and Save never alter the active session. Recheck current applicability before Run; explain interrupted requests and require confirmation before replacing an active session. Never silently change placement during generation.
4. Model-data transfer/cache on approved workers is allowed automatically within the configured storage limits. Show storage locations and provide cleanup controls. This approval does not require a complete GGUF copy on each worker; the required data and transfer mechanism remain a technical decision.
5. LAN and private-network API access require an API key and explicit exposure settings. Localhost is the default scope and requires an API key by default, as approved by the user; any optional exception needs an explicit reviewed policy.

### P9. Agreed screens and visual fidelity

1. Provide five main screens: **Models, Cluster, Chat, API, and Settings**. Use the supplied ModelLoom images as the visual source of truth, preserved under [UI references](references/ui/README.md).
2. Match the reference layouts, proportions, spacing, typography, colors, icons, cards, and controls at the corresponding reference window sizes, with the approved revisions in UI-SPEC applied. The user removed the persistent bottom status bar; content uses the freed space. Do not redesign the screens under the guise of implementation cleanup.
3. Where a screen has a sidebar and right-hand content panel, the right-hand panel is darker and visually above the sidebar, with rounded exposed corners. The later explicitly approved Chat and API revisions in UI-SPEC supersede their original compositions: Chat has a straight fine inner divider and rounded outer workspace; API has a centred stack of four sections. These are specific accepted revisions, not permission for further redesign.
4. Display actual model metadata, hardware, connection paths, API addresses, and measurements. Reference numbers and sample chat text are illustrative, not runtime facts or promises about supported inference strategies.
5. API server/access controls live on the API screen. Cluster connectivity, LAN, Tailscale, and Headscale settings live in Settings -> Network and are accessible from relevant Cluster actions.
6. The original local thumbs-up/down default is superseded by the user's 2026-10-09 approval to remove both controls. Copy and live Retry remain; measured response speeds display inline without extra icons or a dot. Home opens Chat and API has a direct Server icon after Models; More contains Chat only. Attachment formats/capabilities and future Storage/Metrics/profile/download behaviour remain unresolved; their current unavailable treatment is fixed. Preserve the visual references and separately approved revisions; do not silently remove other controls or invent extra capabilities.
7. Non-happy-path states follow the reference styling and remain actionable. The five images do not define light-theme visuals, small-window layouts, exact font assets, or every modal; those need reviewed extensions before implementation of the affected interaction.

## 4. Security and privacy requirements

- Keep worker RPC on approved LAN or private-network paths; never make it public by default. Pairing in the UI must correspond to actual network access restrictions, not just a label.
- Protect stored credentials and network tokens using platform facilities. Do not put secrets in logs or diagnostic exports.
- Keep chat history and model files local unless the user explicitly chooses a transfer or remote storage location.
- Make API exposure and credentials explicit. A private network connection does not itself authorize API access.
- Require authentication when the API is exposed beyond localhost. The final authentication and transport design must satisfy [SECURITY-SPEC.md](SECURITY-SPEC.md) before network API implementation.
- Validate downloaded runtime packages before activation and preserve a working rollback version.
- After the app, runtime, and GGUF are present, local and LAN inference work without an internet connection. Update checks must not block local inference; first-time private-network enrollment may require its control service.

Upstream llama.cpp [describes its RPC backend as a fragile, insecure proof of concept](https://github.com/ggml-org/llama.cpp/blob/master/tools/rpc/README.md). The product must therefore enforce the access boundary rather than treating the stock RPC port as safe on an open network.

## 5. Release acceptance journeys

1. **Clean install:** On supported Windows, Linux, and Apple Silicon macOS devices, install ModelLoom and reach a first local response without separately installing llama.cpp or using a terminal. In normal Windows desktop use, inspect the packaged app's process presentation and confirm the managed engine retains its original llama-server.exe name; its own Task Manager row outside ModelLoom and separate PIDs are allowed. Record names/tree on macOS/Linux and the headless deployment separately. Confirm no visible desktop console window.
   A first-time user can find the next action from the interface without a tour, manual, or mandatory wizard.
2. **Two-device LAN:** Discover or enter a second device, approve it, import a GGUF, accept a suggested split, and complete a chat. The UI shows both devices participating.
3. **Private-network cluster:** Repeat across a Tailscale network and an existing Headscale network. The app verifies the selected path and does not expose RPC publicly. Connection failure produces a specific recovery instruction.
4. **Expert placement:** Adjust the device split manually, see a preflight fit check, start the model, and see the actual placement used.
5. **Chat and API:** Chat in the app and call the opt-in API. Verify local-only defaults and visible access settings.
6. **Runtime lifecycle:** Update the runtime without updating the app, confirm the cluster's version compatibility, then roll back and load the same GGUF. User model files, chats, and placement preferences survive both changes.
7. **Worker failure:** Disconnect a required worker mid-generation. The UI reports interruption and recovery options without claiming the response completed.
8. **Headless worker:** Start and recover a Linux worker without a desktop session; inspect and stop it from the coordinator UI.

9. **Shared model and queue:** Submit Chat and API requests to the same active model. Verify queued/busy/cancelled states, bounded overload handling, and no hidden model switch.
10. **Placement restart:** Edit an autosaved draft during a session, then explicitly Save the validated configuration. Confirm active placement stays unchanged until an explicitly requested and confirmed restart, with fresh device/resource checks and interruption explained.
11. **Model storage:** Exercise permitted model-data transfer/cache on an approved worker, inspect locations and limits, and clear an idle cache without deleting unrelated files or the user's original model.
12. **Visual fidelity:** Compare each of the five screens against its preserved reference at the matching window size. Review the darker foreground panel, rounded corners, and accessible operation. Any intentional deviation needs user approval and a recorded reason.
13. **Runtime crash isolation:** During generation, exercise controlled termination and an ordinary native runtime-crash case separately. The GUI and unaffected core remain usable, the partial answer is marked interrupted/failed, affected queue work is resolved explicitly, and controlled restart/reload works without a hidden request replay.
14. **Owned-process shutdown:** Fully quit during idle, generation, queued work, loading, and runtime transition. Confirm the app's owned runtime/core/helpers exit, including a non-responsive engine and abnormal desktop exit case. An independently launched headless deployment and unrelated process remain untouched. Verify the same cleanup intent on Windows/Linux/macOS without assuming identical termination mechanisms.
15. **Core/runtime reuse:** Exercise desktop and independently launched headless operation using the same reviewed core/runtime machinery. Select/update/roll back runtime versions without reinstalling the GUI, then verify the same GGUF/settings and lifecycle evidence. Record versions and remaining parity gaps versus the audited LM Studio reference.

The product must be exercised with mixed Windows, Linux, and Apple Silicon devices and a multi-node topology. These acceptance journeys validate usability and basic distributed function; they do not establish the separate six-node performance target. The numbered journeys are referred to as J1-J15 in the other documents.

## 6. Delivery sequence

1. **Foundation:** Following the accepted ADR-0004 phased development gate and the affected trust/build/resource approvals, deliver an installable app, GUI-independent core, isolated managed engine, bundled default runtime, local GGUF/chat/API, runtime identity, crash reporting, and owned-process shutdown.
2. **Cluster:** Worker pairing, LAN connection, model placement suggestion, manual split, health and errors.
3. **Private networks:** In-app Tailscale and Headscale connection controls with verified reachability and access restrictions.
4. **Runtime lifecycle:** Independent downloads, compatibility checks, coordinated selection, and rollback.
5. **Cross-platform release:** Windows/Linux/macOS packaging, headless operation, mixed-device and multi-node acceptance journeys.

Beginner guidance and expert controls are required in the first public release, even if the underlying work is delivered in stages.

## 7. Explicit boundaries and unresolved design choices

- Initial product delivery does not claim a particular token-per-second result. The exactness and speed contracts remain in `AGENTS.md` and the user's later clarifications; no product feature may change model quality to improve speed.
- The first release supports existing dense llama.cpp-compatible GGUF models. Other inference backends, built-in Headscale server hosting, model training, and draft-model features are outside this PRD.
- D01 is an LM Studio architecture replication audit, not an unconstrained choice of alternative hosting models. Establish current GUI/core/runtime boundaries, exact observed trees, process/library use, local communication, package layout/version selection, crash/restart and GUI survival, desktop/headless reuse, update/rollback, shutdown ownership, and OS process presentation. Inspect current installations by platform when authorized; the accepted ADR-0004 direction permits limited initial Windows development, while D01 remains open overall and live activation, security and platform/release acceptance retain their gates.
- Decide whether private-network connectivity uses an embedded component or one supplied and managed by ModelLoom. This choice must preserve the one-app installation journey. A Tailscale account or an existing Headscale server can remain external.
- Define model-file distribution/cache policy and the exact API authentication mechanism before implementation. These decisions must be visible in the UI and tested in the acceptance journeys.
- The approved defaults select Hugging Face GGUF downloads, localhost keys by default and window X as full Quit. The original local-feedback default is superseded by the later approval to remove thumbs-up/down. The implemented navigation mapping is recorded in UI-SPEC. Settle attachment formats/capabilities, deferred destination behaviour and remaining visual assets; do not reopen the fixed current layout by treating those integration choices as a redesign authorization. See ADR-0003.
- Determine queue limits, supported OpenAI-compatible endpoints, persistence format, runtime package trust/compatibility, exact OS version floors, and UI assets through the relevant specifications and decisions. Do not infer these from screenshot example values.

## 8. Process and acceptance evidence

Use spec-anchored development: revise specifications alongside approved software changes and link behavior tests to requirement IDs. The lecture guidance calls for product/technical/integration specifications, separate execution plans, tests, and review (Lecture 7, pages 8 and 14-20). Apply permission boundaries, systematic failure/adversarial testing, and traceable validation (Lecture 6, pages 6-12 and 17-34).

An acceptance result records the app/runtime revisions, model identity, selected settings, devices, platform, scenario, observed result, and non-sensitive evidence. Do not mark a journey complete solely from a mock screen, simulated worker, build, or CI badge. Local component/browser and unsigned packaged Windows UI checks have been run, as recorded in TESTING-SPEC. No full production J1-J15 journey is established by the demo. The current reconciliation does not rerun tests or extend the prior evidence to runtime, networking, persistence, security enforcement or other platforms.

## Imported models and editable settings, approved 2026-10-16

The Windows development build accepts compatible imported GGUF models through
the verified, unchanged stock runtime instead of restricting imports to the
Bonsai digest. Estimated RAM or VRAM shortage opens the shared app dialog with
Cancel and Load anyway. Loading anyway preserves the selected weights,
quantization, context and sampling; a native allocation failure remains a
recoverable failure with confirmed owned cleanup.

Supported model configuration controls save real defaults. Generation defaults
apply to new requests; load and advanced launch settings apply on the next
load. The 2026-10-17 correction makes saved Cluster configurations retain placement
only and resolve current model settings at Run. Unsupported controls remain unavailable, including
arbitrary command-line overrides, unimplemented context-overflow transformations
and unvalidated speculative decoding. Detailed boundaries and acceptance cases
are in the 2026-10-16 sections of INTEGRATION-SPEC and TESTING-SPEC. These changes
do not establish production activation or universal inference equivalence.

## References

- [LM Studio 0.4](https://lmstudio.ai/blog/0.4.0) documents GUI/core separation and standalone llmster. [Runtime management](https://lmstudio.ai/docs/cli/runtime/runtime) documents independent runtime download/selection/update/removal. These establish the direction but do not expose every proprietary internal boundary or a rollback/crash-survival guarantee.
- [Observed Bionic Task Manager grouping](references/runtime/README.md) records the user's screenshot and its limits. Issue reports [#502](https://github.com/lmstudio-ai/lms/issues/502) and [#373](https://github.com/lmstudio-ai/mlx-engine/issues/373) are supporting observations, not verified platform-wide architecture specifications.
- [llama.cpp shared-library build option](https://github.com/ggml-org/llama.cpp/blob/master/CMakeLists.txt) supports investigating a library-hosted engine; cross-platform packaging remains to be validated.
- [Tailscale tsnet](https://tailscale.com/docs/features/tsnet) and [Headscale](https://headscale.net/stable/) are integration references, not proof that one packaging approach has been selected.
- [Tailscale connection types](https://tailscale.com/docs/reference/connection-types) distinguish direct and relayed paths; the app must report the path observed during use.
