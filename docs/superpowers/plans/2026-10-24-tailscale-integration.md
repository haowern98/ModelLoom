# Tailscale Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans after implementation is explicitly authorized. Use bounded subagent work only within approved contracts; keep security design authority with the primary implementer. Steps use checkbox syntax for tracking.

**Goal:** Enroll ModelLoom into the user's Tailscale network and discover eligible sharing PCs without IP entry while preserving existing pairing, both-GPU sharing and canvas behavior.

**Architecture:** A core-owned bundled Go tsnet executable provides private streams and network status. Existing TypeScript peer control, pinned TLS and worker authorization remain authoritative. The renderer receives sanitized state and candidate IDs through validated actions.

**Tech Stack:** Existing Electron/React/TypeScript, Node TLS, platform-specific ownership/protection adapters and the bundled Go/tsnet component. Desktop enrollment uses Electron safeStorage with checked OS-backed providers. Pinned Go 1.27.3 and Tailscale v1.104.2 at `e26db7a5797683ec99ad1516c40b628c7f2dfd71`; see ADR-0008 for the approved safeStorage broker and helper-owned lock/vault contract.

**Spec:** [Proposed design](../specs/2026-10-24-tailscale-integration-design.md). Read it alongside current project specifications and ADR-0007.

## Global constraints

- Status: user-approved implementation PROCEED on 2026-10-24. No actual enrollment, deployment, hosted CI run or commit is recorded by this update. GPU runs and publication retain their separate scope gates.
- Work on `feat/tailscale-integration` in `E:\ModelLoom-Project`. Base inspected: `e96c30e19354fd53d8ce40fc128909938a5e3af7`.
- Preserve unrelated staged research/reference files and CRLF-only working-tree changes. Stage explicit paths if commits are later requested; do not use `git add .`.
- Keep commits focused by feat/test/docs/refactor/chore purpose. Follow the current AGENTS.md maximum of two files per commit unless a later user instruction overrides it. No commit/push is requested by this implementation record.
- User-confirmed scope on 2026-10-24: Tailscale discovery first; keep manual LAN/IP connections. Headscale and automatic LAN discovery are deferred.
- Cross-platform compatibility is required: Windows, macOS and Linux use local secure-storage adapters and the same network/pairing protocol. Two Windows PCs are the first milestone, not complete platform acceptance. Do not copy protected enrollment files across operating systems.
- Keep Share this PC / Add device, six-digit verification plus receiver approval, directional app trust, both shared GPUs, one-active-model scope and Save/Discard.
- Tailscale login is not worker authorization. Retain exact TLS identity verification, protected raw native endpoints and no public fallback.
- Current UI scale is 24/18/16/14/13/12px by role. Preserve shared components, keyboard access, reduced motion and local GPU read availability during network failure.
- Do not change weights, quantization, context or sampling. GPU performance/equivalence experiments require a separately agreed contract.

## Review focus

1. Existing system Tailscale and embedded ModelLoom nodes coexist without changing each other's state or producing trusted duplicate devices. Tasks 2, 4 and 7.
2. Late login/discovery responses after disconnect, logout, account change or Quit cannot restore sharing or connect the wrong tailnet. Tasks 2, 4 and 5.
3. Storage protection failure, a helper crash or network delay cannot block local GPU inventory or leave an indefinite spinner. Tasks 2 and 5.
4. Advertised identities, reused IPs, malformed frames and revoked peers cannot reach privileged inventory or native operations. Tasks 1, 3 and 4.
5. Route/path changes during active work cannot replay a request, overwrite placement or create a misleading latency/bandwidth result. Tasks 3, 6 and 7.

## File map

The file map describes implementation areas; actual source paths and evidence take precedence over earlier proposed filenames.

| Area                            | Proposed files / existing integration points                                                                                                                                                                                                           | Responsibility                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Component                       | `components/tailscale/go.mod`, `go.sum`, `main.go`, `protocol.go`, `node.go`, `state.go`, `state_windows.go`, `state_darwin.go`, `state_linux.go`, corresponding `_test.go` files                                                                      | tsnet ownership, framed pipe endpoint, platform-neutral protected enrollment contract with native providers, and sanitized events. |
| Core networking                 | `packages/core/src/network/{wire,helper,tailscale,transport,discovery}.ts` and corresponding tests                                                                                                                                                     | Validated network actions/views, process supervision, stream adapters and candidate reconciliation.                                |
| Peer integration                | `packages/core/src/peers/{node,owner,rpc,wire,desktop,utility}.ts`; existing peer integration tests                                                                                                                                                    | Route-aware control/RPC, read-only discovery, utility commands and unchanged authorization.                                        |
| Ownership if required by Task 1 | `packages/core/native/windows-ownership.cc`, `packages/core/src/hosts/windows-ownership.ts` and ownership tests                                                                                                                                        | Admit the exact owned networking child with retained pipe handles; do not broaden generic launch authority.                        |
| Desktop bridge                  | `apps/desktop/src/{main/index,main/runtime-controller,preload/index,shared/peers}.ts`                                                                                                                                                                  | Narrow validated actions, trusted browser launch, subscriptions and sanitized rendering views.                                     |
| UI                              | New `apps/desktop/src/renderer/features/settings/NetworkSettings.tsx` and tests; existing `SettingsPage.tsx`, `SettingsPage.module.css`, `app/App.tsx`, `features/cluster/LivePeers.tsx`, `usePeerInventory.ts`, `ClusterPanel.tsx` and relevant tests | Enrollment, recovery, discovery rows, Network link and route details using shared styles.                                          |
| Build/evidence                  | New `packages/core/scripts/build-network.mjs`; existing `apps/desktop/forge.config.cjs`, `forge.development.config.cjs`, `scripts/package-development.mjs`, package scripts and CI workflows as needed                                                 | Pin/build/package/verify executable and dependency notices; integrate actual Go checks.                                            |
| Documentation                   | Project specs, decision register, development guide and this plan                                                                                                                                                                                      | Record accepted bounded decisions and evidence separately from overall D02/D03 completion.                                         |

## Task 1: Freeze the component contracts before implementation

**Files:** Add an ADR under `specs/decisions/` using its next available number; modify the decision register. Finalize this design and plan after review.

**Consumes:** Current user scope and source-backed proposal.  
**Produces:** Reviewed executable contract: source/toolchain pins; request/event/frame schemas; state transitions; ownership and protected-store rules; limits; bootstrap route identity; auth-origin validation; compatibility behavior.

- [ ] Review the pinned tsnet source for `Start`, `Listen`, `Dial`, `LocalClient`, `Status`, notification behavior, `Store`, logout and diagnostic-upload opt-out. Record release tag, commit, Go requirement and dependency notices without treating a moving latest URL as a pin.
- [x] Specify the narrow core API: `readNetwork()`, `connectNetwork()`, `disconnectNetwork()`, `signOutNetwork()`, `refreshCandidates()` and `inviteCandidate(candidateId)`. Network view has state, sanitized account/tailnet/node address, candidate IDs and safe errors; no raw LocalAPI or secrets. Preserve existing manual `invite(address)`.
- [x] Specify `PeerTransport.dial(route, signal): Promise<Duplex>` and fixed inbound bootstrap/secure dispatch. Distinguish LAN from overlay routes with stable application identity and route generation. Cover request, callback, TLS server admission, RPC upgrade and cancellation, not just initial connection.
- [x] Replace OS tuple lookup for overlay RPC tracking with an exact core-owned stream binding. Current `PeerNode.upgradeRpc` matches local/remote socket addresses and ports; specify identity-preserving revocation/cleanup before implementing non-socket transports. Never fabricate address fields or bypass tracking.
- [x] Freeze helper pipe framing, stream/session limits, fair backpressure, parser rejection, process admission and non-secret error enums. Reject unbounded framing and arbitrary destinations. Require tests for partial/coalesced frames and a blocked reader before approving this boundary.
- [ ] Freeze the common enrollment-store contract and Windows DPAPI/macOS Keychain/Linux Secret Service providers, directory/lock/atomic-write ownership, logout failure recovery, independent deployment separation and diagnostic-upload policy. Review provider size/session constraints and state-versus-key protection. Confirm no hidden plaintext persistence in the selected dependency path and no fallback if a keyring is absent or locked. Headless Linux requires a separate reviewed non-interactive provider.
- [ ] Map current Windows-specific app identity, child ownership and native RPC restrictions to platform adapters. Record the exact files/interfaces after platform-source inspection; resolve the security contracts before implementing macOS/Linux worker access. Portable networking alone is insufficient.
- [x] Review discovery response schema and independent anti-abuse budget. It must not create pairing requests or reveal inventory. Review proposed four-concurrent/three-second/60-second discovery defaults and reconciliation behavior.
- [x] Confirm discovery scope: the user selected Tailscale discovery first with manual LAN/IP retained; automatic LAN discovery is deferred.
- [ ] Obtain review of the Network layout. Record approved versus proposed decisions explicitly. Keep commercial service clarification as a release dependency, not claimed legal clearance.

**Gate:** The user approved the design and gave implementation-scoped PROCEED on 2026-10-24. Follow ADR-0008; downstream workers may not invent replacement security contracts. Cross-platform native worker admission still requires its own evidence.

## Task 2: Build owned enrollment and protected state

**Files:** Component files; `network/{wire,helper,tailscale}.ts`; peer utility ownership integration; bounded native ownership changes only if accepted in Task 1.

**Consumes:** Task 1 schemas, lifecycle/state contracts and pins.  
**Produces:** `readNetwork`, connect/disconnect/sign-out and validated event subscriptions backed by one owned component; no application peer transport yet.

- [ ] Add failing fixtures for successful enrollment, browser cancellation, required admin approval, expiry, locked/corrupt stores, logout failure, account change, process loss and stale generation events. Assert local peer read/GPU inventory remains responsive.
- [ ] Add Go parser/state-store tests for invalid/truncated frames, bounded memory, protected round trips, atomic-write interruption, single writer and wrong protection context. No live account or secret is needed.
- [ ] Exercise the same store conformance suite on each provider, including Keychain denial/lock and Secret Service absence/lock. Run actual native protected-store tests on the target OS, not only mocks on Windows. Test per-platform helper ownership/abnormal cleanup without opening native worker admission.
- [ ] Run the targeted tests and inspect the expected failures before implementing.
- [x] Implement the approved component, protected store, sanitized event adapter and scoped lifecycle. Resume saved enrollment but never enable sharing on startup. Validate auth URLs in main before external browser opening.
- [ ] Verify that Disconnect preserves enrollment while disabling automatic reconnect, Sign out has honest partial-failure behavior, and normal/abnormal owner exit cannot leave this helper alive.
- [ ] Run `go test ./...` from `components/tailscale`; run targeted Vitest files with `pnpm --filter @modelloom/core test -- src/network/helper.test.ts src/network/tailscale.test.ts`. Require passing results and inspect actual cleanup evidence.

## Task 3: Carry existing peer control and RPC over the overlay

**Files:** `network/transport.ts`; `peers/{node,rpc,owner}.ts`; targeted transport and existing pairing/RPC/reservation tests.

**Consumes:** Task 2 helper and Task 1 route/stream contract.  
**Produces:** LAN and overlay transport implementations behind `PeerTransport`, with existing peer authentication unchanged.

- [ ] Add failing tests for full six-digit pairing in both directions over a fake overlay, changed identity at a reused address, unpaired/revoked RPC denial, TLS pin mismatch, backpressure, helper loss and active-stream cancellation.
- [ ] Run these cases to confirm missing overlay transport is the failure. Retain existing manual LAN test assertions.
- [x] Route all peer control requests, callback/status paths and RPC upgrades through the approved transport. Deliver inbound component streams only to fixed core handlers. Keep TLS termination and app identity checking in the existing core.
- [x] Preserve current native process restrictions and both-GPU resource/reservation mapping. Do not open an extra raw RPC listener or treat tsnet source IP as app authorization.
- [ ] Run targeted transport tests plus `code-pairing-integration`, `owner-integration`, `rpc-integration`, `rpc-session` and `multi-gpu-integration` tests using the core Vitest command. Require unchanged LAN behavior and successful denied-path assertions.
- [ ] Adapt existing Windows-specific identity/ownership/RPC assumptions only through the Task 1 reviewed platform contracts. Run shared protocol conformance tests on Windows/macOS/Linux and require native access-denial evidence before enabling worker RPC on each OS.

## Task 4: Discover sharing ModelLoom peers without creating invitations

**Files:** `network/discovery.ts`; `peers/{node,owner,wire}.ts`; discovery, wire and owner tests.

**Consumes:** Local peer status/events and route-aware transport.  
**Produces:** Bounded sanitized candidate snapshots, `refreshCandidates` and `inviteCandidate` using core-retained routes.

- [ ] Add failing tests for eligible/ineligible/offline peers, permission-limited visibility, malformed/unsupported capability replies, a tailnet larger than one discovery batch, refresh coalescing and sharing-off/peer-removal events.
- [ ] Assert repeated discovery makes zero pairing requests, sends no code, returns no GPU inventory and causes no approval or canvas mutation.
- [ ] Add identity cases: same name/different installations remain separate; embedded/system routes to the same confirmed installation merge; this installation is excluded; spoofed advertised identity never inherits approval.
- [x] Implement the versioned read-only capability operation and reconciler with approved limits. Expire candidate generations on account switch/disconnect. Treat unknown reachability causes honestly.
- [ ] Run discovery, `peers/wire.test.ts` and owner integration tests. Require all candidates eventually examined under the bounded queue, no background retry storm, and no stale candidate invitation after logout.

## Task 5: Wire Network settings and Add device

**Files:** Desktop bridge/main controller; NetworkSettings; SettingsPage; App routing; LivePeers; usePeerInventory; associated component and browser tests.

**Consumes:** Validated network actions/events and candidate IDs.  
**Produces:** Login/recovery/disconnect UI, automatic Tailscale device rows, Network navigation and unchanged manual pairing controls.

- [ ] Add failing component tests for every design state, safe error recovery, disabled duplicate actions, cancelled browser sign-in and login completion arriving after disconnect. Assert secrets/URLs are absent from public snapshots and diagnostic text.
- [ ] Add browser cases to `apps/desktop/tests/settings.browser.spec.ts` and a new `tailscale.browser.spec.ts`: keyboard enrollment/discovery flow, focus restoration, two supported widths, reduced motion, no indefinite GPU loading, no false Connected state and manual LAN entry retained.
- [x] Implement within shared Settings/Connections components and tokens. Keep Headscale out, retain the API settings link, and keep enrollment state distinct from Starting sharing.
- [x] Connect selected candidates to existing verification/approval UI. Preserve no assignment/count changes until explicit canvas addition, both GPU defaults/explicit selections, and unsaved placement drafts across Network navigation.
- [ ] Run desktop component tests, `pnpm typecheck`, then `pnpm --filter @modelloom/desktop exec playwright test --project browser tests/settings.browser.spec.ts tests/tailscale.browser.spec.ts`. Require actual passing results, not snapshots alone.

## Task 6: Add truthful route diagnostics without competing with inference

**Files:** Network status adapter; existing peer telemetry monitor/view; ClusterPanel and connection-detail tests.

**Consumes:** Approved peer transport and observed tsnet path state.  
**Produces:** LAN/Tailscale and direct/relayed/unknown presentation integrated into existing measurements.

- [ ] Add failing tests for a stale/configured relay field, missing path evidence, route change, helper loss during an idle probe, and runtime activity arriving before a bandwidth test finishes.
- [x] Implement path/freshness mapping and cancellation into the existing telemetry policy. Count application transfer bytes consistently; do not replace them with total machine or unrelated tailnet traffic.
- [ ] Verify active work stops synthetic bandwidth testing, path loss does not replay native/generation requests, and the panel uses existing font/spacing tokens. Do not claim zero overhead or inference equivalence from fixture tests.
- [ ] Run network/telemetry and connection-panel targeted tests. Broaden only for changed integration paths or unresolved failures.

## Task 7: Package, validate two PCs and record remaining gates

**Files:** Network build script, package/Forge/CI integration, notices and development documentation; update relevant specs and bounded ADR evidence.

**Consumes:** Completed Tasks 2-6 and approved pins.  
**Produces:** Reproducible platform packages, exact per-platform validation records and honest compatibility status; the first live milestone uses the two Windows PCs.

- [ ] Package the pinned helper as a real resource outside ASAR and fail clearly when absent, incompatible or altered under the approved package-verification path. Add Go tests/build and dependency/license checks to CI without weakening existing jobs.
- [ ] Run `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, Go tests, browser tests, `pnpm package:development` and `pnpm test:desktop`. Inspect existing package-script preflight before running; use its verified runtime assets and E: temporary storage. Record command/result/artifact identity.
- [ ] After deployment/enrollment authorization, test HAOWERNSLAPPY and PTSS with the external Tailscale client unnecessary for app connectivity. Preserve remote administration access while isolating that test; do not stop the client carrying SSH without another approved path.
- [ ] Verify app enrollment/discovery, pairing both directions, retained enrollment after restart with sharing off, both GPUs, explicit unticks, revocation/re-pairing, live hardware changes, disconnect/account expiry, helper crash and normal/abnormal Quit.
- [ ] Check no raw RPC or management endpoint is externally reachable; unknown/revoked peers cannot access privileged operations; protected files/exports contain no plaintext credentials; diagnostic-upload opt-out is observed. Capture actual path or report unknown.
- [ ] Package the selected supported Windows/macOS/Linux targets and run native enrollment-storage, helper lifecycle and packaged UI checks on each. Validate mixed-platform discovery/pairing/revocation in both directions, plus protected worker access and hardware inventory on supported backends. If platform hardware/runners are unavailable, mark compatibility unverified and the overall delivery incomplete rather than silently deferring it out of scope.
- [ ] Real generation/performance/equivalence runs need a separately accepted workload/budget. Until obtained, report that gap explicitly; control-plane and inventory success do not prove distributed inference or TPS.
- [ ] Update the specs/decision evidence with exact passed/failed/unverified cases. Leave Headscale, automatic LAN discovery, headless, commercial-service clarification and overall D02/D03 release gates open as applicable. Windows-only evidence cannot close required cross-platform compatibility.

## Current implementation record

ADR-0008 records the approved Electron-main safeStorage broker (OS-backed providers, rejecting Linux basic_text), a protected plaintext map capped at 4 MiB, and a helper-held OS lock acquired before broker loading. The inert helper retains that lock while the app is open; Disconnect stops tsnet. Go owns atomic ciphertext vault read/begin/append/commit I/O, capped at 32,768-byte chunks, 8 MiB ciphertext and a 16-command queue on an independent control worker. Sign out stops the node and locally forgets state; upstream failure retains a recovery error without claiming administrator device deletion. Discovery uses only current allowed IPv4 tailnet peers and fixed ports 49301/49302 with four concurrent checks, three-second deadlines and a 60-second cooldown. Existing six-digit approval, manual LAN and shared Settings CSS remain.

Go targets windows-amd64, darwin-amd64, darwin-arm64, linux-amd64 and linux-arm64. Real macOS/Linux credential-provider and native-worker evidence remains pending. Existing Windows-specific app identity and containment have not been ported; do not claim complete mixed-platform GPU sharing. Checked items identify implemented contracts or behavior, not full live/platform acceptance. Compound checks that include unavailable platform or broad validation evidence remain open; see the dated evidence below. D02/D03 remain open overall.

## Local evidence, 2026-10-24

- Final Go suite: PASS, 4.375 seconds, including passive path mapping. Final cross-build and `--check` passed for all five targets; component source digest `9040401a8e90f3f53e2b21d50062af4393c8cf1903036c15c7d79d49af289368`. This digest identifies component source inputs, not a repository commit or executable checksum.
- Real Windows helper integration: two passing tests cover an opaque 100 KB transfer, pipe EOF, restart, lock exclusion and process termination. No Tailscale account enrollment was performed.
- Peer TLS/multi-GPU/code/diagnostics fixtures: four files, 18 tests passed with `--testTimeout 20000`. These exercise authenticated control and GPU mapping, not real GPU inference.
- Core unit suite: 100 files, 976 tests passed. A subsequent concurrent-owner-mutation regression run passed all six tests. Desktop suite: 61 files, 419 tests passed with `--testTimeout 15000`. Initial default five-second timeouts under CPU contention were observed; the later longer-timeout results do not erase those attempts.
- Full lint and formatting checks passed. Post-mutation typecheck passed; focused lifecycle/storage tests also passed after serializing mutations, rejecting inherited forced-login settings and restarting expired enrollments.
- Browser inspection confirmed shared 24/18 px heading sizes, the same font family and no overflow at 1440 px. The connected-view screenshot used mocked state; it is not live enrollment or full browser-suite evidence.
- The first development package attempt failed with ENOSPC in the C: temporary directory. The E: temporary-storage retry passed. A packaged Electron smoke check passed: the renderer received a disconnected Network snapshot, malformed network actions were rejected, and Windows native safeStorage encryption/decryption round-tripped with ciphertext-only output. No enrollment was attempted. A final package refresh after the recovery fixes remains recorded in the local evidence ledger.
- Browser inspection at 1000 px also found no horizontal overflow and verified that Open Connections opens the actual Connections page. Existing staged-index entries were compared to the initial snapshot with zero differences.

Path diagnostics use fresh passive LastWrite evidence with a 15-second window and actual CurAddr or PeerRelay evidence (pinned magicsock `populatePeerStatus`, around line 2240). Configured DERP Relay alone remains Unknown. There is no extra synthetic Ping. The public path array is bounded; six UI mapper tests passed. Existing idle bandwidth tests remain distinct from passive path observation.

### Authorized Windows deployment follow-up

The user subsequently authorized updating and opening both Windows apps and starting Tailscale browser sign-in. PTSS verified all 190 package files before switching the existing installation path, retained its rollback directory and opened in interactive session 1. HAOWERNSLAPPY uses the same updated archive. The deployed archive SHA-256 is `5643313f261187c674b2e8560c3f6bc10d14377f22f10f610de1fb5c8553c90c`; the networking helper digest remains `c48a01a2390656b53fd8cb970331aadbc1dfabda1e17fae63b4189c52cb4aa13`.

Live startup exposed a Chromium `Network` directory collision and Windows MSIX AppData redirection. Enrollment now uses the separate `embedded-tailscale` directory. Trusted-main paths are canonicalized before helper ownership and protected-domain binding; a directly linked enrollment root remains rejected. A redirected-parent identity-preservation regression and the existing linked-root rejection passed. The changed boundary received a focused security review. Main was rebuilt with the existing Forge Vite configuration and the archive refreshed; Electron, native runtime and Go artifacts were unchanged.

Both apps reached `needs-login`, and browser sign-in was requested on both. User authentication, connected discovery and live app pairing are not yet verified. The user has only Windows PCs available for this milestone. Native macOS/Linux credential-provider, identity/containment and mixed-platform validation remain open, along with hosted CI and real distributed inference/performance/equivalence. D02/D03 stay open.

The user then confirmed successful browser sign-in on both PCs. HAOWERNSLAPPY briefly reported Connected with five visible tailnet peers, but failed discovery dials exposed a helper cleanup bug on both PCs. Failed dial completion now retires its owned stream ID before returning the error, so the parent's legitimate close cannot be mistaken for an unknown stream. The regression failed before the fix and the full Go suite passed afterwards (4.514 seconds). Both apps were stopped gracefully for the Windows helper replacement; enrollments were retained. The refreshed Windows helper and sustained connected/discovery checks are pending. Previous five-target build results refer to the earlier source digest; Linux/macOS builds do not yet include this cleanup fix.

The Windows helper replacement subsequently passed its build and manifest check: executable SHA-256 `3d889c09bb9dac952ebd824e47b2c081ac46ff4c638296313156654bb38c3f5d`, source digest `1475e95a24d1da0a07e5df26309b626ddd9a7141fc412956f76e42c703ac3c96`. The same executable and manifest hashes were verified on PTSS before reopening both apps. Both reused their retained enrollments and reported Connected. Sharing was off on both PCs, with zero advertised candidates; live sharing-enabled discovery and pairing remain unverified. HAOWERNSLAPPY still enumerated two GPUs and PTSS one. No account credentials were inspected or recorded. The remaining Linux/macOS rebuild loop was stopped after the Windows milestone; those artifacts do not contain the latest cleanup fix.

## Completion and publication

Planning review was completed and followed by implementation authorization on 2026-10-24. That authorization does not establish passing tests, security acceptance, cross-platform compatibility or live two-PC enrollment.

No files are staged or committed by this plan. If publication is later requested, use explicit focused staging, preserve the pre-existing index, run appropriate verification, and inspect hosted checks on the exact pushed head before merge advice. A planning review cannot substitute for security review of the implemented boundary or real two-PC validation.
