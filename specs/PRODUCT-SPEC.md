# ModelLoom product requirements

**Status:** Updated requirements draft for review; implementation is not authorized  
**Date:** 2026-09-30  
**Scope:** The install-to-chat product experience. Inference speed research remains a separate workstream governed by `AGENTS.md` and the user's later benchmark clarifications.

This is the authoritative product specification, moved from `ModelLoom-Project Prd.md`. Existing P1-P7 requirement numbers are preserved. Later agreed behavior is recorded under P8-P9 and in [ADR-0001](decisions/0001-product-and-ui-baseline.md). [ADR-0002](decisions/0002-lm-studio-runtime-direction.md) supersedes the earlier process-name ban and establishes the LM Studio hosting/audit, crash isolation, upgrade, and shutdown requirements. Technical proposals and unresolved choices are recorded separately in the [decision register](decisions/README.md).

Related specifications: [technical](TECHNICAL-SPEC.md), [integration](INTEGRATION-SPEC.md), [security](SECURITY-SPEC.md), and [UI](UI-SPEC.md). Specifications define behavior and constraints; execution work belongs in [plans](../plans/PLAN.md).

## 1. Product goal

ModelLoom lets someone pool computers they own, load an existing GGUF model across them, and chat or serve an API from one polished application. The intended journey is:

**Install on each device → connect devices → choose a model → accept or adjust a split → start → chat or use the API.**

The same product must feel straightforward to a newcomer and give an experienced user explicit control. The interface should make the next useful action obvious without a mandatory tour or setup wizard. A supported workflow must not require terminal commands, separate llama.cpp downloads, manual worker launches, or editing configuration files.

## 2. Users and supported environments

Use **Electron** for the desktop application UI on Windows, Linux, and macOS. A GUI-independent ModelLoom Core manages separately versioned inference runtimes and supports desktop and headless operation through essentially the same core/runtime machinery. LM Studio's current llama.cpp path is the hosting reference; the D01 audit determines precise boundaries and protocols before a ModelLoom-specific hosting design is chosen.

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

### P3. Model library and placement

1. Import a local GGUF or find/download one in the app. Show model identity, file size, location, architecture, quantization, and runtime compatibility before launch.
2. Estimate memory needed for the selected context and selected devices. Clearly distinguish an estimate from measured use.
3. Suggest a split across the selected devices. Experienced users can adjust placement per device and see the expected memory use and participation before starting.
4. Preserve the original GGUF weights and configured sampling behavior. If a model, tensor type, backend, or placement is unsupported, explain the limitation and offer only compatible choices; never silently substitute a model or quantization.
5. Show where the model files and worker caches live, and provide in-app controls to clear them.

### P4. Chat and API

1. Start, stop, and inspect a model from the same app. Provide a built-in chat interface with saved local conversations, generation settings, visible progress, and clear interruption/error states.
2. Provide an OpenAI-compatible local API. Enabling access beyond localhost is an explicit user action with visible address and access settings.
3. Show which model, runtime, and devices served the active session. If a required worker disconnects, stop the affected generation and show the cause; do not present a partial answer as complete.

### P5. Independently managed inference runtimes

1. App releases and inference runtime releases are independent. Users can inspect installed runtimes, install an update, select a version, and roll back without reinstalling ModelLoom.
2. Runtime packages are versioned for operating system and compute backend and record their llama.cpp source revision, ModelLoom build identity, and compatibility metadata. Runtime downloads use a signed manifest and verified package before activation. The app retains the previous working version until the new one is verified.
3. A runtime switch occurs between sessions. The app checks coordinator/worker compatibility before launch and offers a coordinated update or rollback when versions cannot work together.
4. The user never has to launch `llama-server`, `ggml-rpc-server`, or a shell script. During normal Windows desktop use, the managed inference process is presented within ModelLoom's app group. `llama-server`/`llama-server.exe` is acceptable when the group is expanded, and separate PIDs in Details are acceptable. Verify grouping in the packaged app; an unrelated standalone app entry is not the intended presentation. Exact other worker/helper names await D01. No visible console window appears during normal desktop use; a Console Window Host entry alone is not evidence of a visible window. macOS/Linux process visibility is observed and documented without assuming Windows grouping there.
5. Replicate LM Studio's GUI/core/versioned-runtime hosting architecture as closely as technically possible. GUI and core are separate concerns; the same core/runtime machinery operates headlessly; llama.cpp remains an engine underneath the product. Complete the [LM Studio runtime-hosting audit](../plans/LM-STUDIO-RUNTIME-AUDIT.md) before choosing exact process, library, local protocol, package, or hosting details. Runtime native code must be isolated from the GUI/main process, and ordinary runtime crashes must not terminate the GUI. The user's grouped-process screenshot is evidence of presentation, not proof of the full internal process tree or protocol.
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
3. Saved placement changes remain pending until an explicit restart. Show both the active placement and pending placement. Explain interrupted requests before applying changes; do not apply a new split silently during generation.
4. Model-data transfer/cache on approved workers is allowed automatically within the configured storage limits. Show storage locations and provide cleanup controls. This approval does not require a complete GGUF copy on each worker; the required data and transfer mechanism remain a technical decision.
5. LAN and private-network API access require an API key and explicit exposure settings. Localhost is the default scope and requires an API key by default, as approved by the user; any optional exception needs an explicit reviewed policy.

### P9. Agreed screens and visual fidelity

1. Provide five main screens: **Models, Cluster, Chat, API, and Settings**. Use the supplied ModelLoom images as the visual source of truth, preserved under [UI references](references/ui/README.md).
2. Match the reference layouts, proportions, spacing, typography, colors, icons, cards, controls, and persistent status bar at the corresponding reference window sizes. Do not redesign the screens under the guise of implementation cleanup.
3. Where a screen has a sidebar and right-hand content panel, the right-hand panel is darker and visually above the sidebar, with rounded exposed corners. The additional ChatGPT image clarifies layering only; it does not replace the ModelLoom screen designs.
4. Display actual model metadata, hardware, connection paths, API addresses, and measurements. Reference numbers and sample chat text are illustrative, not runtime facts or promises about supported inference strategies.
5. API server/access controls live on the API screen. Cluster connectivity, LAN, Tailscale, and Headscale settings live in Settings -> Network and are accessible from relevant Cluster actions.
6. Response thumbs-up/down are stored locally against the response, without remote feedback submission. Attachment formats/capabilities, Home/Storage/Metrics destinations, and inconsistent reference navigation icons still require an explicit scope/design decision. Preserve the visual references; do not silently remove controls or invent extra capabilities.
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

1. **Clean install:** On supported Windows, Linux, and Apple Silicon macOS devices, install ModelLoom and reach a first local response without separately installing llama.cpp or using a terminal. In normal Windows desktop use, inspect the packaged app's Task Manager presentation and confirm the managed engine belongs to the ModelLoom app group; llama-server beneath the expanded group and separate PIDs in Details are allowed. Record names/tree on macOS/Linux and the headless deployment separately. Confirm no visible desktop console window.
   A first-time user can find the next action from the interface without a tour, manual, or mandatory wizard.
2. **Two-device LAN:** Discover or enter a second device, approve it, import a GGUF, accept a suggested split, and complete a chat. The UI shows both devices participating.
3. **Private-network cluster:** Repeat across a Tailscale network and an existing Headscale network. The app verifies the selected path and does not expose RPC publicly. Connection failure produces a specific recovery instruction.
4. **Expert placement:** Adjust the device split manually, see a preflight fit check, start the model, and see the actual placement used.
5. **Chat and API:** Chat in the app and call the opt-in API. Verify local-only defaults and visible access settings.
6. **Runtime lifecycle:** Update the runtime without updating the app, confirm the cluster's version compatibility, then roll back and load the same GGUF. User model files, chats, and placement preferences survive both changes.
7. **Worker failure:** Disconnect a required worker mid-generation. The UI reports interruption and recovery options without claiming the response completed.
8. **Headless worker:** Start and recover a Linux worker without a desktop session; inspect and stop it from the coordinator UI.

9. **Shared model and queue:** Submit Chat and API requests to the same active model. Verify queued/busy/cancelled states, bounded overload handling, and no hidden model switch.
10. **Placement restart:** Save a changed split during a session. Confirm active placement stays unchanged until an explicitly requested restart and that interruption is explained.
11. **Model storage:** Exercise permitted model-data transfer/cache on an approved worker, inspect locations and limits, and clear an idle cache without deleting unrelated files or the user's original model.
12. **Visual fidelity:** Compare each of the five screens against its preserved reference at the matching window size. Review the darker foreground panel, rounded corners, and accessible operation. Any intentional deviation needs user approval and a recorded reason.
13. **Runtime crash isolation:** During generation, exercise controlled termination and an ordinary native runtime-crash case separately. The GUI and unaffected core remain usable, the partial answer is marked interrupted/failed, affected queue work is resolved explicitly, and controlled restart/reload works without a hidden request replay.
14. **Owned-process shutdown:** Fully quit during idle, generation, queued work, loading, and runtime transition. Confirm the app's owned runtime/core/helpers exit, including a non-responsive engine and abnormal desktop exit case. An independently launched headless deployment and unrelated process remain untouched. Verify the same cleanup intent on Windows/Linux/macOS without assuming identical termination mechanisms.
15. **Core/runtime reuse:** Exercise desktop and independently launched headless operation using the same reviewed core/runtime machinery. Select/update/roll back runtime versions without reinstalling the GUI, then verify the same GGUF/settings and lifecycle evidence. Record versions and remaining parity gaps versus the audited LM Studio reference.

The product must be exercised with mixed Windows, Linux, and Apple Silicon devices and a multi-node topology. These acceptance journeys validate usability and basic distributed function; they do not establish the separate six-node performance target. The numbered journeys are referred to as J1-J15 in the other documents.

## 6. Delivery sequence

1. **Foundation:** After the LM Studio hosting audit is complete and reviewed, deliver an installable app, GUI-independent core, isolated managed engine, bundled default runtime, local GGUF/chat/API, runtime identity, crash reporting, and owned-process shutdown.
2. **Cluster:** Worker pairing, LAN connection, model placement suggestion, manual split, health and errors.
3. **Private networks:** In-app Tailscale and Headscale connection controls with verified reachability and access restrictions.
4. **Runtime lifecycle:** Independent downloads, compatibility checks, coordinated selection, and rollback.
5. **Cross-platform release:** Windows/Linux/macOS packaging, headless operation, mixed-device and multi-node acceptance journeys.

Beginner guidance and expert controls are required in the first public release, even if the underlying work is delivered in stages.

## 7. Explicit boundaries and unresolved design choices

- Initial product delivery does not claim a particular token-per-second result. The exactness and speed contracts remain in `AGENTS.md` and the user's later clarifications; no product feature may change model quality to improve speed.
- The first release supports existing dense llama.cpp-compatible GGUF models. Other inference backends, built-in Headscale server hosting, model training, and draft-model features are outside this PRD.
- D01 is an LM Studio architecture replication audit, not an unconstrained choice of alternative hosting models. Establish current GUI/core/runtime boundaries, exact observed trees, process/library use, local communication, package layout/version selection, crash/restart and GUI survival, desktop/headless reuse, update/rollback, shutdown ownership, and OS process presentation. Inspect current installations by platform when authorized; do not finalize ModelLoom-specific hosting until the audit is complete and reviewed.
- Decide whether private-network connectivity uses an embedded component or one supplied and managed by ModelLoom. This choice must preserve the one-app installation journey. A Tailscale account or an existing Headscale server can remain external.
- Define model-file distribution/cache policy and the exact API authentication mechanism before implementation. These decisions must be visible in the UI and tested in the acceptance journeys.
- The later approved defaults select Hugging Face GGUF downloads, localhost keys by default, local response feedback, and window X as full Quit. Settle attachment formats/capabilities, extra navigation destinations, and original visual assets; the earlier table supplied no concrete defaults for those choices. See ADR-0003.
- Determine queue limits, supported OpenAI-compatible endpoints, persistence format, runtime package trust/compatibility, exact OS version floors, and UI assets through the relevant specifications and decisions. Do not infer these from screenshot example values.

## 8. Process and acceptance evidence

Use spec-anchored development: revise specifications alongside approved software changes and link behavior tests to requirement IDs. The lecture guidance calls for product/technical/integration specifications, separate execution plans, tests, and review (Lecture 7, pages 8 and 14-20). Apply permission boundaries, systematic failure/adversarial testing, and traceable validation (Lecture 6, pages 6-12 and 17-34).

An acceptance result records the app/runtime revisions, model identity, selected settings, devices, platform, scenario, observed result, and non-sensitive evidence. Do not mark a journey complete solely from a mock screen, simulated worker, build, or CI badge. No implementation acceptance journey has been run in this workspace.

## References

- [LM Studio 0.4](https://lmstudio.ai/blog/0.4.0) documents GUI/core separation and standalone llmster. [Runtime management](https://lmstudio.ai/docs/cli/runtime/runtime) documents independent runtime download/selection/update/removal. These establish the direction but do not expose every proprietary internal boundary or a rollback/crash-survival guarantee.
- [Observed Bionic Task Manager grouping](references/runtime/README.md) records the user's screenshot and its limits. Issue reports [#502](https://github.com/lmstudio-ai/lms/issues/502) and [#373](https://github.com/lmstudio-ai/mlx-engine/issues/373) are supporting observations, not verified platform-wide architecture specifications.
- [llama.cpp shared-library build option](https://github.com/ggml-org/llama.cpp/blob/master/CMakeLists.txt) supports investigating a library-hosted engine; cross-platform packaging remains to be validated.
- [Tailscale tsnet](https://tailscale.com/docs/features/tsnet) and [Headscale](https://headscale.net/stable/) are integration references, not proof that one packaging approach has been selected.
- [Tailscale connection types](https://tailscale.com/docs/reference/connection-types) distinguish direct and relayed paths; the app must report the path observed during use.
