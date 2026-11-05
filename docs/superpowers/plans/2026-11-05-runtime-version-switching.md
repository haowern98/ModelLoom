# Runtime Version Switching and Updates Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task by task after the user authorizes coding and the runtime policy review is complete for the affected tasks.

**Goal:** Let users switch between approved CPU, CUDA, and Vulkan GGUF runtimes on Windows and discover, download, and install new ModelLoom runtime releases from Settings.

**Architecture:** Trusted core code supplies the verified release catalog, installs packages, and resolves launch identity. Electron main owns update jobs and the saved selection. React shows the selection from startup metadata and receives installed-file verification results separately.

**Tech stack:** TypeScript, Electron, React, the existing TUF verifier, Vitest and Playwright.

**Spec:** The supplied Installed runtimes screenshot, [UI specification](../../../specs/UI-SPEC.md), [security requirements S15–S16](../../../specs/SECURITY-SPEC.md), and [decision D11](../../../specs/decisions/README.md).

## Current state and prerequisite

`feat/runtime-selection` currently binds GGUF coordinator loads to the signed Windows x64 CUDA bootstrap `b11306 · dev14`. The separately signed `b11306 · dev15` build is provisioned for the peer worker. Both are installed under `~/.modelloom/runtimes/` on this PC. A worker build is selectable for GGUF only if separately qualified and approved for coordinator loads. Older CUDA directories, including `dev10` and `dev12`, do not establish current approval. CPU needs its own qualified package, and the existing verified peer path requires CUDA.

Review D11 for this scope before enabling real switching or live updates. Start with two Windows x64 CUDA coordinator builds to exercise same-backend version switching and updates. Qualify CPU and Vulkan coordinator builds before calling the Windows runtime selection feature complete. Keep the existing default when there is no saved choice. An intentional choice of an older build must use current trusted metadata authorizing that build. The production trust catalog is empty today. Live releases need an approved trust root, release feed and signing process. Start implementation and verification with an isolated signed test feed. Package deletion is outside this plan.

## Windows backend scope

| Backend | Local compatibility and qualification |
| --- | --- |
| CPU | Verify the build's CPU instruction requirements and system RAM. Validate CPU-only placement without GPU offload. |
| CUDA | Verify the NVIDIA device and driver against the signed build requirements. Exercise current local and distributed CUDA loads. |
| Vulkan | Add an explicit manifest backend and qualify the Windows build. Detect a usable Vulkan device and driver, and verify GPU placement and memory admission. Exercise representative AMD, Intel, and NVIDIA devices before advertising support for each. |

ModelLoom's current inventory schema recognizes CPU and CUDA. Extend the schema and runtime admission for Vulkan. CPU and Vulkan start with local inference. Distributed support for either requires separate RPC compatibility and correctness evidence. A saved cluster plan that requires CUDA workers stays saved and receives an actionable incompatibility message if the selected backend cannot run it. Check the intended execution device, model load and output quality before advertising compatibility. See the [llama.cpp build documentation](https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md).

## Runtime storage

Bionic keeps versioned backend folders together in `C:\Users\user\.lmstudio\extensions\backends`. The source development app uses `~/.modelloom/runtimes/` for both coordinator and peer worker builds, with a separate directory for each verified installation. The main process owns the path. Bootstrap inputs, unrelated runtime state, and isolated packaged development profiles keep their existing locations.

Use the existing verified installer for migration from the workspace-local coordinator and worker stores. Check destination free space before writing. On insufficient space, the app can reuse a legacy copy that passes verification against the current signed package. Once the home copy is verified, it takes precedence. Older copies stay on disk.

## Dialog and interaction

- Reuse the shared modal for the title, close button, keyboard focus, Escape, and focus restoration. Give the dialog a bounded scrolling body.
- Use a single GGUF dropdown like the reference. In the trigger and each option, show the backend and engine name on the left and a muted upstream `b` label on the right. Example labels are `CUDA 12 llama.cpp (Windows)`, `CPU llama.cpp (Windows)`, and `Vulkan llama.cpp (Windows)`. Show a CUDA major version only when verified for that package. Add a development suffix when needed to distinguish two builds with the same `b` number. A checkmark marks the selected version. Show installed builds by backend and disable incompatible options with a reason.
- Group installed versions under `llama.cpp · CPU`, `llama.cpp · CUDA`, and `llama.cpp · Vulkan` when each has a verified install. Show the verified installed count, a divider, and the newest version with a compatibility line.
- For a group with older versions, show a `Show older versions` button that expands the rows in place and changes to `Hide older versions`. Keep the selected and active versions visible even when they are older and the group is collapsed.
- Use upstream `b` numbers in the rows. Add the development suffix when present so builds sharing `b11306` are distinguishable. Keep `Selected` and `In use` as independent badges. `Selected` means the next load. `In use` means the currently ready session.
- The GGUF picker changes the preference. Selecting a version takes effect at the next explicit load. If a model is already running, keep showing its actual runtime and explain when the selected version will apply. If a saved choice becomes unavailable, show why and offer the approved default as an explicit selection.
- `Check for updates` fetches release metadata on demand and reports `Up to date`, `Update available`, or a useful failure with a retry action. Compare versions within each backend. Offer compatible releases for missing backends as `Install` and newer releases of installed backends as `Update`. An offer shows the build, download size and release notes when supplied.
- `Download and install` is a separate action. Show byte progress when the total is known, then show verification and installation as distinct states. After success, list the build in Installed runtimes and offer `Use on next load`. Keep the previous version selected until the user explicitly chooses the new one. A failed check or download leaves the installed list and current selection usable.

## Release feed and install contract

- Publish ModelLoom-qualified packages through a ModelLoom-controlled feed. Upstream llama.cpp tags identify the source build. Each selectable package also needs an exact ModelLoom build identity, its supported platform and backend, and a declared role and compatibility scope. Use signed release ordering within a channel and compatibility scope so display labels do not determine which build is newer.
- Review D11 for root and signing-key custody, authenticated metadata refresh and version floors, expiry and offline behavior, revocation, rollback, and distribution. Reuse the existing TUF verifier and installer checks. A release catalog must bind the package digest and size to the corresponding signed inventory and compatibility facts. A test feed uses fixture trust only.
- Run download and installation in the trusted host. Pass catalog identities through IPC. Keep archives and extraction in private staging, verify the archive before unpacking, enforce extraction limits, check space for both staging and installation, and verify the complete file tree before marking a build installed. Serialize jobs for the same package, clean up interrupted staging, and keep the last working package available under the approved rollback policy.
- Publish package artifacts and verified metadata before exposing the release through the feed. Verify the same artifacts from a clean client. For a cluster, use the selected build's declared worker requirements and report mismatches before model load. Coordinated remote updates require their own reviewed distribution flow.

## Release qualification

1. Qualify each exact package before publishing it. Start from a pinned llama.cpp commit and record the upstream `b` number, ModelLoom build revision, and backend. Run the package through the real ModelLoom host. Verify start, readiness, GGUF load, observed device placement, resource admission, streamed generation, cancellation, unload and cleanup. Exercise supported model options and qualify advertised capabilities such as speculative decoding separately.
2. Check output against a pinned reference for the supported model and settings. Use deterministic prompts and compare token output where the contract requires exactness. For distributed inference, verify the required output parity against a single-GPU run. Qualify coordinator/worker pairs and test that an incompatible worker is rejected before launch. The current CUDA RPC check pins an upstream commit and dependency identities, so a new commit needs an approved compatibility rule and fresh evidence.
3. Publish compatibility facts in signed metadata only after the tests pass. Before offering or loading a build, use the package's verified platform, backend, device, driver and feature requirements. Check the actual model and cluster configuration when loading. A valid signature proves provenance and integrity, while qualification and load checks establish whether the build works for the requested setup. Preserve the previously working approved package for recovery.

## Implementation and checks

### 1. Approved catalog and verified installs

**Files:** `apps/desktop/src/main/{runtime-paths,index}.ts`, `packages/core/src/runtime-package/{verifier,inventory,install}.ts`, and the development policy and host under `packages/core/src/hosts/development-desktop.ts`.

- [ ] Write tests for two distinct approved builds sharing a `b` number, duplicate installations, an unapproved older directory, and damaged installed files.
- [ ] Read every selectable package identity from current verified metadata. Return display metadata separately from installation results. Deduplicate by verified package identity, including the exact build, and expose explicit compatible, incompatible or unknown states based on available evidence.
- [ ] Verify that name display remains independent of file hashing and that an older directory alone never appears as a selectable package.
- [ ] Test profile-based path resolution and migration with sufficient space, insufficient space, and a failed verification. Check that each selectable version resolves to a verified install in the home store after migration.

### 2. Persist selection and bind it to the next load

**Files:** `apps/desktop/src/shared/runtime.ts`, `apps/desktop/src/main/runtime-controller.ts`, the existing main-owned profile storage, and `packages/core/src/hosts/development-desktop.ts`.

- [ ] Test strict command validation, persistence across restart, stale preferences, an active session while a different version is selected, and a failed candidate load followed by explicit recovery.
- [ ] Accept only an opaque catalog identity from the renderer. Persist the choice in the existing profile and capture it once per load. Use that same package for memory admission, planning, native launch and active-runtime reporting. Reverify it before activation. Keep the previous working package available for explicit recovery.
- [ ] For distributed runs, bind worker compatibility to the captured build and required RPC capabilities. Block mismatches before launch, and preserve saved cluster configurations while reporting incompatibility at load time. Verify that a runtime change cannot reuse an incompatible execution plan.

### 3. Ship the dialog and picker behavior

**Files:** `apps/desktop/src/renderer/features/settings/SettingsPage.tsx`, `SettingsPage.module.css`, the existing desktop runtime hook, and `apps/desktop/tests/settings.browser.spec.ts`.

- [ ] Verify in Playwright that the dialog matches the screenshot structure, expands older rows, keeps an older selected or active row visible, and is usable with keyboard and narrow windows.
- [ ] Wire the picker to the saved preference. Exercise selecting an older build while another is in use, then simulate the next successful and failed loads. Keep the startup name visible with the installed-file request deliberately pending.
- [ ] Before claiming real switching, validate both approved builds on the same model and exercise a compatible and a mismatched worker. Keep test fixtures and live development evidence distinct.

### 4. Wire update discovery and installation to a test feed

**Files:** `packages/core/src/runtime-package/` for catalog refresh, staging and verified installation, `apps/desktop/src/shared/runtime.ts` and `apps/desktop/src/main/runtime-controller.ts` for update commands and status, and Settings UI and browser tests from task 3.

- [ ] Test a new compatible release, an already installed release, an incompatible release, a failed network check, and rejection of expired, replayed or tampered metadata. Verify that checking does not download package binaries.
- [ ] Add download and install by approved catalog identity. Test success, insufficient space, bad hashes, unsafe archive entries, cancellation, retry and duplicate requests. Verify that failures leave the previous package, selection and running session intact.
- [ ] Exercise the full Settings flow in Playwright against the test feed. Install a second version, see it in the grouped dialog, choose it for the next load, restart, and confirm the saved choice. Exercise an offline update check and a failed candidate launch with the earlier approved build still available.

### 5. Enable real releases after D11 review

- [ ] Approve the production trust root and feed, signing and publication ownership, compatibility rules, and release recovery procedure before enabling the live endpoint.
- [ ] Qualify the first two CUDA coordinator packages, the CPU and Vulkan coordinator packages, and the relevant CUDA worker packages. Publish a baseline release and a newer release, then test discovery, installation, explicit selection and authorized rollback from a clean Windows client. Record which packages and hardware were exercised. Include a CPU-only PC and a Vulkan-capable PC without CUDA in the qualification matrix.
