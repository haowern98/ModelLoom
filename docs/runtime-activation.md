# Windows runtime activation

The shared core now contains a gated Windows x64 activation adapter. It is not connected to the desktop or exposed as a live CLI command. The existing desktop and independent headless harnesses still launch harmless fixtures. This work implements parts of ADR-0004 and S15-S17; live-model and release acceptance remain pending.

## Package authority

`createRuntimeVerifier` loads only a public root whose asset name and SHA-256 are reviewed build inputs in `runtime-package/trust-policy.ts`. The root policy requires a 2-of-3 root role. That catalogue is empty, so production verification currently rejects with `MISSING_TRUST_ROOT`. There is no caller-selected root, unsigned fallback or private-key operation.

The pinned `tuf-js` 6.0.0 client verifies signatures, versions, expiry, root rotation and the signed inventory's hash and length through a local-only repository adapter. Metadata is bounded to 1 MiB; network downloads and delegations are disabled. Successful verification records a clock floor and cached metadata version floors. Rotated roots are replayed from the original pinned root, rather than trusted directly from cache. Missing repository metadata, rollback, expired metadata and a backwards clock fail closed.

The inventory describes win32/x64, CPU or CUDA, protocol 1, the upstream commit, exact build identity, backend requirements, entry point, control helper and every executable dependency. It admits at most 256 files and 8 GiB of content. Absolute paths, traversal, alternate data streams, case collisions, Windows device names and malformed field sets are rejected.

Verifier capabilities and installation receipts are in-process objects tracked by private weak maps. Their serialized contents grant no authority. `createFixtureVerifier` can only issue fixture capabilities, including when it verifies valid test signatures. Installing a fixture never promotes it to live authority. Receipts expire at the earliest signed metadata expiry; a long model hash cannot bypass the final pre-launch expiry check.

## Installation and configuration

`installExpanded` consumes an already expanded bundle. It checks the full file tree, signed lengths and hashes, then copies into a fresh version directory restricted to the current Windows user and SYSTEM. Existing versions are preserved. ZIP extraction, download, automatic update and rollback selection are outside this slice.

`revalidateInstalled` repeats dependency hashing while retaining native file and ancestor handles. Those handles reject replacement, writes, deletion, hard links and reparse-point paths through process creation and the owned session. A caller must release the returned lock after confirmed exit. Job Objects and protected directories do not sandbox inference or protect against a compromised same-user account.

`inspectGGUF` bounds GGUF v3 metadata inspection and hashes the selected model. It validates architecture/context metadata, arithmetic, UTF-8 and parser limits; it does not validate the tensor body or prove a model can load. The adapter does not substitute weights or lower context, cache settings or sampling to fit memory.

The current configuration contract accepts exactly model SHA-256, per-slot context, slot count, GPU-layer count, K/V cache types, seed and temperature. Other settings are rejected instead of silently dropped. Per-slot context multiplied by slots must fit the native signed 32-bit context argument. The fixed arguments disable automatic fitting, Web UI, agent/MCP integration and automatic multimodal-projector discovery.

`checkResources` validates a planner report against the exact model, artifact, backend and configuration. All memory amounts are bytes and include weights, KV cache and scratch allocations. Unknown or uncertain requirements produce `NEEDS_RESOURCE_EVIDENCE`; a shortage produces `INSUFFICIENT_RESOURCES`. The result alone is not launch authority: the adapter admits only reports from reviewed build inputs.

The reviewed-report catalogue is empty. The adapter currently supports only the inspected upstream commit `4f31296a907d73f3409f720429bcf31111615d77`, CPU and zero GPU layers, with a fresh physical-RAM sample. CUDA driver/VRAM discovery and validated CPU/CUDA planner reports remain pending. The pure report tests exercise VRAM arithmetic; they do not establish live GPU support or Bonsai memory sufficiency.

## Owned readiness and shutdown

The native broker atomically places the control helper in the deployment and nested engine jobs before resuming it. `ModelLoom-runtime-host.exe` creates a private hidden console, launches the server into the same containment and emits one fixed startup receipt. The broker captures that server's process handle after checking image, creation time and job membership. The environment includes only the verified dependency directory, Windows system directory and private temporary directory.

Each launch uses a fresh private API credential in a restricted temporary key file. Credentials stay out of arguments, renderer state and diagnostics. Readiness requires an owned loopback listener, rejection of an unauthenticated request, and authenticated model-alias, per-slot context and slot-count responses. Port collision cannot attach to an unrelated server. Public health is not readiness proof.

After readiness, the helper accepts one inherited-pipe stop command and broadcasts Ctrl+C only in its private console. It uses a normal handler for its own survival, so the child does not inherit an ignore-Ctrl+C flag. The existing supervisor allows 180 seconds for startup, five seconds for graceful stop and two seconds for forced confirmation. Cancellation before readiness uses owned termination; it is not labelled proven upstream graceful cleanup. Force and abnormal-owner cleanup target retained jobs, never a process name or a later PID search.

An exit receipt requires the captured helper to exit and the job to be empty. The broker releases package/model handles and removes the credential directory before resolving exit. Failed cleanup stays a failure. Native integration tests establish this mechanism using synthetic console handlers; actual upstream cleanup, packaged visual presentation and Task Manager grouping remain unverified.

## Local validation and remaining inputs

Use Node 24.21.0 and pnpm 11.19.0. Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm --filter @modelloom/core test:native` and `pnpm --filter @modelloom/core check:native`. The native suite builds with MSVC warnings treated as errors; static checks cover all four owned C++ sources. No model or GPU workload is needed for these tests.

Live activation still needs a reviewed production public root and custody/recovery policy, a signed exact upstream binary/helper/dependency bundle, and validated resource reports for the selected configuration. Then exercise the actual adapter's readiness, bounded response, cancellation, reload and owned shutdown with the selected model. These inputs cannot be replaced by test keys, caller-provided checksums or an invented memory estimate. Other platforms, streaming/scheduling bindings, durable history, distributed workers and inference equivalence retain their separate gates.
