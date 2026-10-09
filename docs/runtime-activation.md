# Windows runtime activation

The shared core contains a gated Windows x64 activation adapter and an explicit development desktop connection for the exact tested Bonsai configuration. Ordinary builds and packaged production activation remain closed. The independent headless fixture harness remains available; separate development CLI diagnostics exercise the real runtime. This work implements parts of ADR-0004 and S15-S17; release acceptance remains pending.

**Reconciled 2026-10-10:** The development desktop also connects durable Chat
and model-independent history startup under ADR-0005. The report catalogue now
contains exact one-slot and four-slot development reports; the desktop selects
four slots. The one-slot observations below retain their original configuration.
The four-slot report, live Chat, later resource-preflight failure and evidence
limits are recorded in [local Chat development](local-generation.md). No public
API, workers, production trust, downloads/updates or release acceptance is added.

## Package authority

`createRuntimeVerifier` loads only a public root whose asset name and SHA-256 are reviewed build inputs in `runtime-package/trust-policy.ts`. The root policy requires a 2-of-3 root role. That catalogue is empty, so production verification rejects with `MISSING_TRUST_ROOT`. There is no caller-selected root or unsigned fallback.

The user approved [separate development custody](runtime-development-custody.md). The public development root is pinned in a distinct, normally disabled build policy. `createDevelopmentRuntimeVerifier` requires an explicitly enabled development build; ordinary host builds reset the flag. The production factory rejects a development-marked root. Development capabilities use a distinct realm, fixture receipts never promote, and private keys remain in the external publisher store. Only the standalone publisher can perform approved DPAPI signing operations; neither desktop nor runtime imports it.

The pinned `tuf-js` 6.0.0 client verifies signatures, versions, expiry, root rotation and the signed inventory's hash and length through a local-only repository adapter. Metadata is bounded to 1 MiB; network downloads and delegations are disabled. Successful verification records a clock floor and cached metadata version floors. Rotated roots are replayed from the original pinned root, rather than trusted directly from cache. Missing repository metadata, rollback, expired metadata and a backwards clock fail closed.

The inventory describes win32/x64, CPU or CUDA, protocol 1, the upstream commit, exact build identity, backend requirements, entry point, control helper and every executable dependency. It admits at most 256 files and 8 GiB of content. Absolute paths, traversal, alternate data streams, case collisions, Windows device names and malformed field sets are rejected.

Verifier capabilities and installation receipts are in-process objects tracked by private weak maps. Their serialized contents grant no authority. `createFixtureVerifier` can only issue fixture capabilities, including when it verifies valid test signatures. Installing a fixture never promotes it to live authority. Receipts expire at the earliest signed metadata expiry; a long model hash cannot bypass the final pre-launch expiry check.

## Installation and configuration

`installExpanded` consumes an already expanded bundle. It checks the full file tree, signed lengths and hashes, then copies into a fresh version directory restricted to the current Windows user and SYSTEM. Existing versions are preserved. ZIP extraction, download, automatic update and rollback selection are outside this slice.

`revalidateInstalled` repeats dependency hashing while retaining native file and ancestor handles. Those handles reject replacement, writes, deletion, hard links and reparse-point paths through process creation and the owned session. A caller must release the returned lock after confirmed exit. Job Objects and protected directories do not sandbox inference or protect against a compromised same-user account.

`inspectGGUF` bounds GGUF v3 metadata inspection and hashes the selected model. It validates architecture/context metadata, arithmetic, UTF-8 and parser limits; it does not validate the tensor body or prove a model can load. The adapter does not substitute weights or lower context, cache settings or sampling to fit memory.

The configuration contract accepts exactly model SHA-256, per-slot context, slot count, GPU-layer count, K/V cache types, seed and temperature, plus a full physical GPU UUID for single-GPU CUDA placement. Other settings are rejected instead of silently dropped. Per-slot context multiplied by slots must fit the native signed 32-bit context argument. The fixed arguments disable automatic fitting, Web UI, agent/MCP integration and automatic multimodal-projector discovery.

`checkResources` validates a planner report against the exact model, artifact, backend and configuration. All memory amounts are bytes and include weights, KV cache, scratch allocations and a separate `serverCaches` allowance. The user selected prompt reuse enabled by default, then approved a smaller cache/checkpoint allowance for the 24 GB system on 2026-10-07. Fixed arguments now set a 768 MiB prompt-cache cap and two checkpoints per slot, superseding the earlier 8192 MiB/32 policy. Cache reports must match both limits and budget prompt reuse, checkpoints across the selected slots and cache overhead; omitted allocations fail closed. Limits are not eager RAM reservations. Unknown or uncertain requirements produce `NEEDS_RESOURCE_EVIDENCE`; a shortage produces `INSUFFICIENT_RESOURCES`. Only reviewed build inputs grant report authority. A shortage never silently changes caching, context or model settings.

The production reviewed-report catalogue remains empty. Exact development reports
bind the Bonsai hash, CUDA artifact, physical UUID and selected settings. The
earlier one-slot report requires 6,618 MiB physical RAM and 4,365 MiB VRAM; the
later four-slot report requires 7,524 MiB RAM and 5,579 MiB VRAM. These admission
estimates combine pinned planning, cache bounds and bounded native observations;
they are not allocation guarantees or measured steady-state RAM. Both require a
development package capability and explicit development build. The adapter admits
only inspected commit `4f31296a907d73f3409f720429bcf31111615d77`; CPU remains
unprovisioned. Exact CUDA placement, compatible driver, fresh resource discovery
and final expiry checks remain enforced. See the [one-slot Bonsai evidence](runtime-bonsai-validation.md)
and [later four-slot/Chat evidence](local-generation.md).

### Read-only Windows resource discovery

`discoverResources` samples available physical RAM and queries the installed NVIDIA tool using fixed `--query-gpu` and CSV arguments. The executable directory comes from `GetSystemDirectoryW`; the driver's required `ProgramFiles` value comes from the OS known-folder API. The query uses no shell, inherited PATH, user options, model, CUDA inference workload or driver-setting changes. NVIDIA documents [selective queries, UUID/PCI identity and memory fields](https://docs.nvidia.com/deploy/nvidia-smi/); Microsoft documents [system-directory resolution](https://learn.microsoft.com/en-us/windows/win32/api/sysinfoapi/nf-sysinfoapi-getsystemdirectoryw) and [known folders](https://learn.microsoft.com/en-us/windows/win32/shell/known-folders).

Each call queries afresh with a two-second timeout, a 64 KiB combined stdout/stderr limit and a 64-device limit. Timeout, overflow and cancellation terminate only the captured diagnostic child and wait for its closed pipes; unconfirmed cleanup fails after two further seconds. No executable-name or later PID search is used. Failed discovery produces unknown GPU data, not cached capacity or zero VRAM. Malformed rows, invalid UTF-8, duplicate identities, overflow and impossible free/total amounts are rejected. `[N/A]` memory stays unknown. WDDM free memory is a management snapshot, not a reserved Windows allocation budget or a guarantee that loading will succeed.

`checkCudaResources` retains the existing exact model/build/configuration checks and requires a validated `deviceVram` budget in bytes for every selected physical UUID. The sum must match the report's weights/KV/scratch VRAM, and each GPU must fit its own budget; another GPU cannot compensate for a shortage. Missing devices, unknown memory, active MIG partitioning or incomplete placement produce `NEEDS_RESOURCE_EVIDENCE`. The inventory's `minimumDriver` means the installed NVIDIA driver version, not the CUDA toolkit/banner version; a lower numeric version produces `INCOMPATIBLE_DRIVER`. RAM/VRAM shortage still produces `INSUFFICIENT_RESOURCES`. Context, quantization, cache types, slots, seed and temperature are never changed to fit.

Run `pnpm --filter @modelloom/core probe:resources` under the pinned host for a development-only JSON snapshot. It builds the local broker/hosts and exits nonzero when RAM or NVIDIA discovery is unknown. It cannot load a model or turn a caller-provided estimate into approved planner evidence. The native CUDA launch accepts exactly one validated full UUID, sets `CUDA_VISIBLE_DEVICES` only in the owned child and addresses it as CUDA0 with split-mode none. Ambient CUDA/LLAMA overrides remain excluded. Native tests verify selected visibility, invalid-input rejection and independent-child survival.

## Owned readiness and shutdown

The native broker atomically places the control helper in the deployment and nested engine jobs before resuming it. `ModelLoom-runtime-host.exe` creates a private hidden console, launches the server into the same containment and emits one fixed startup receipt. The broker captures that server's process handle after checking image, creation time and job membership. The environment includes only the verified dependency directory, Windows system directory and private temporary directory.

Each launch uses a fresh private API credential in a restricted temporary key file. Credentials stay out of arguments, renderer state and diagnostics. Readiness requires an owned loopback listener, rejection of an unauthenticated request, and authenticated model-alias, per-slot context and slot-count responses. Port collision cannot attach to an unrelated server. Public health is not readiness proof.

After readiness, the helper accepts one inherited-pipe stop command and broadcasts Ctrl+C only in its private console. It uses a normal handler for its own survival, so the child does not inherit an ignore-Ctrl+C flag. The existing supervisor allows 180 seconds for startup, five seconds for graceful stop and two seconds for forced confirmation. Cancellation before readiness uses owned termination; it is not labelled proven upstream graceful cleanup. Force and abnormal-owner cleanup target retained jobs, never a process name or a later PID search.

An exit receipt requires the captured helper to exit and the job to be empty. The broker releases package/model handles and removes the credential directory before resolving exit. Failed cleanup stays a failure. Native tests establish this mechanism using synthetic console handlers; two real calibration runs also exited 0 after private-console graceful shutdown. Packaged visual presentation and Task Manager grouping remain unverified. Diagnostic memory observations use retained ownership-checked process handles and the complete job's peak private commit; unknown attribution remains unknown.

## Local validation and remaining inputs

Use Node 24.21.0 and pnpm 11.19.0. Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm --filter @modelloom/core test:native` and `pnpm --filter @modelloom/core check:native`. The native suite builds with MSVC warnings treated as errors; static checks cover all four owned C++ sources. No model or GPU workload is needed for these tests.

A signed development bundle and actual Bonsai calibration are available. The [bounded diagnostic and desktop evidence](runtime-bonsai-validation.md) records passed scenarios, failed attempts and remaining limits. Full cache saturation and 20 GiB of free RAM are not prerequisites. The development desktop uses existing Import GGUF, picker, Run, Cancel and Stop controls through a sandboxed preload bridge. Main checks sender/frame identity and accepts only closed commands and an opaque imported-model ID; paths, executable arguments, credentials, ports and native handles never become renderer authority. Quit closes admission and waits for preparation and owned exit. No CSS, font or layout changes are part of this connection. Chat generation, public API, custom configuration and persistent import remain unavailable. Production custody, other platforms, packaged presentation/grouping, scheduling, durable history, distributed workers and inference equivalence retain separate gates.

The 2026-10-07 startup correction exposes local hostname, OS, CPU and trusted role
before importing or loading a model. Local identity remains visible with activation
disabled or GPU details unavailable; development GPU capacity is supplemental and
does not grant admission. The existing card uses **This device** and the supplied
role. Standalone desktop still starts as Coordinator; worker enrollment is separate.
Explicit demo builds retain their labelled fixtures. No styling changed.

Windows checks passed with both ordinary disabled activation and the enabled
development build: actual local card before import, model null/stopped, Run
disabled, malformed snapshot fields rejected, navigation preserves the card, no
renderer errors and full Quit exits with code 0. Local JSON/screenshots are under
`packages/core/out/activation/b11306/evidence/desktop/local-device-{disabled,development}.*`.
Desktop unit tests passed 60/60 and core tests 236/236; targeted startup/role/GPU
fallback regressions passed 16/16 after the final lint correction. Type checking,
lint, affected-source formatting and diff checks passed. No model load or mining
change was required. This is Windows observation, not macOS/Linux release evidence.

The GPU-name follow-up adds the bounded display name to the existing NVIDIA
resource query and carries it with the same physical GPU's capacity. The actual
desktop now displays **NVIDIA GeForce RTX 4060 Ti** and **16.0 GiB VRAM** before
model import. The raw driver total is 16,380 MiB; the existing one-decimal display
rounds that to 16.0 GiB. The app snapshot was compared against a fresh observation
of the same physical UUID, rather than assuming an exact 16 GiB raw value. Core
tests passed 238/238 and desktop tests 61/61. After the lint correction, GPU-query
tests passed 26/26, host compilation and lint passed, and the actual desktop check
passed with no model loaded or renderer errors and confirmed exit code 0. Names
are display metadata only; admission checks, runtime settings and styling stay
unchanged.
