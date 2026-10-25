# Loading, measurements and Tailscale recovery review

Reviewed the current uncommitted `feat/tailscale-integration` implementation on
2026-10-25. The user authorized fixes with PROCEED, then authorized migrating PTSS
to the single source-development launch. This is a review of the connected
loading and networking paths, not a claim that the entire product is bug-free.

## Confirmed failures and repairs

1. **Retry redisplayed the previous error.** `App.tsx` reset dismissal while
   `useRuntime.ts` retained the old fault during a new request. Retrying now clears
   that fault immediately. Pending polls can update starting/loading and memory
   warnings; a stale terminal snapshot cannot replace the new attempt's result.
   Saved-configuration retries now reset dismissal consistently too.
2. **Bulk TLS writes could close the overlay.** A real mutually authenticated TLS
   response of 256 KiB failed through `overlayChannel` with `socket hang up` and
   `INVALID_RPC_CHANNEL`. TLS may coalesce records into a write larger than the
   IPC stream's 64 KiB input bound. The overlay now fragments writes before that
   boundary and waits for each write callback. Its IPC frame validation, 8 KiB
   frames, sequencing, acknowledgement and backpressure limits remain intact.
   The TLS regression and an exact-byte 256 KiB round-trip pass.
3. **The idle measurement deadline covered both directions too narrowly.** The
   complete measurement previously had only 1.5 seconds, including setup and both
   directional samples. Each direction now has a five-second bound, with ten
   seconds for the pair. Bulk samples remain limited to 500 ms and 16 MiB; runtime
   activity still cancels them immediately.
4. **One failed direction discarded a successful sample.** The peer now preserves
   a successful direction and reports the other as unavailable. If both fail, it
   reports failure. Activity/cancellation still aborts the whole operation.
5. **Busy measurements implied a failed connection.** A successful control ping
   followed by DIAGNOSTICS_BUSY now remains idle and respects the probe cooldown.
6. **Shutdown could skip retrying failed cleanup.** Both the network owner and
   desktop wrapper now retain failed cleanup and allow another close attempt.
   A helper that fails before enrollment opens is also retained until its exact
   exit is confirmed. No enrollment replacement or plaintext fallback is added.
7. **Known startup failures lost their reason.** Timeout and unexpected exit now
   have distinct UI messages. The supervisor preserves only three allowlisted
   startup reasons: RPC_DISCONNECTED, PLACEMENT_MISMATCH and CONTEXT_MISMATCH.
   Arbitrary native output remains excluded from renderer errors.
8. **Existing startup tests bypassed the required launch workflow.** Their fixture
   now supplies the source-launch marker before testing the build steps. The
   direct-launch rejection test remains in place.

## Inspected verification

- `pnpm test`: exit 0; 4 launcher tests, 429 desktop tests in 62 files, and 995
  core tests in 100 files passed.
- `pnpm typecheck`: exit 0 for desktop and core.
- Targeted ESLint on changed implementation and test files: exit 0.
- Native integration group: diagnostics, RPC and multi-GPU integration, 19 tests
  in three files passed. No live model or GPU benchmark was started by these tests.
- PTSS source dependency installation and type checking: exit 0.
- The pre-existing Git index comparison had zero differences. No staging,
  commits, pushes or hosted CI results are implied.

## Live application work and limits

Windows Computer Use initialization failed before any action. A Windows fallback
successfully clicked Connections inside the user's visible PTSS StarDesk window
and captured the resulting sharing/approval screen.

PTSS was running an older packaged development executable with no source tree or
dependencies. A source workspace was prepared at `D:\ModelLoom\ModelLoom-Project`.
The migration ran as the interactive user. All six core-profile files matched
their originals after copying to the previously absent source profile. Original
data remains intact. The old packaged executable was renamed with `.disabled`.
Its location-bound embedded Tailscale enrollment was deliberately not copied.

Both PCs now run through `npm run electron dev`. Actual app windows were captured
on both. HAOWERNSLAPPY automatically resumed its existing Tailscale enrollment
and displayed Connected. PTSS's new enrollment needs the user's browser sign-in.
The updated HAOWERNSLAPPY app also completed an ordinary window-close Quit
without a cleanup popup, then was relaunched through the same canonical command.

The old HAOWERNSLAPPY instance rejected normal Quit with Runtime cleanup failed.
Its remaining tree was verified to contain only the exact workspace Electron
processes, the networking helper and that helper's Windows console host, with no
native engine descendants. The exact stuck main PID was terminated; its helper
exit was confirmed before the canonical relaunch. No process-name-wide kill or
system Tailscale service operation was used.

The exact cause of the user's earlier native model-load failure was not retained
by that older process. The reproduced bulk-channel defect is confirmed, but it
does not prove that it was the sole cause of that historical attempt. A successful
live distributed Bonsai load, sustained transfer rates, restart/shutdown after a
live load, and native macOS/Linux acceptance still need evidence.

## PTSS source migration follow-up

PTSS's source app visibly reached Connected after browser enrollment, with its
own embedded address. Its copied identity and trust records passed a bounded
diagnostic, and the physical GPU probe returned one GPU. The initial peer-service
failure was traced to the source activation directory being administrator-owned
with only Modify access for the interactive user. The native private-directory
guard correctly refused that permission state. The exact activation directory
was assigned to the interactive user with a protected user/SYSTEM FullControl
DACL. The same native check then passed and the Connections UI populated the
GPU and preserved HAOWERNSLAPPY approval without changing identity or trust.

Sharing then exposed a migration omission: only the upstream runtime archives
and inventory had been transferred, while the signed repository and expanded
candidate directories were absent. The required coordinator and peer candidate
and repository directories are being transferred directly to D:, excluding the
old verification, installation, experiment and model directories. Live sharing
and loading remain unverified until that transfer and the UI checks complete.

## Pairing response-close diagnosis and correction

A controlled overlay diagnostic reproduced the split result: the worker created
one incoming request, and the initiator received a complete HTTP 200 response,
then its ClientRequest emitted ERR_STREAM_PREMATURE_CLOSE before asynchronous
body validation settled. The request error handler discarded the valid reply,
so the renderer received no invitation and could not open code entry.

The exchange now leaves that specific late error to the response parser only
when IncomingMessage.complete is true. Status, JSON, size, certificate and
fingerprint validation remain active. Incomplete responses and other request
errors still reject. The earlier trial that changed overlay finalization was
removed because it did not correct this race.

Inspected focused verification after this correction:

- Native code-pairing integration: 9 tests passed, including invitation, code
  verification, approval and inventory through both parent/core IPC boundaries.
- Core overlay channel and diagnostics tests: 7 tests passed.
- Desktop Tailscale candidate tests: 10 tests passed.
- Desktop/core type checking and changed-file ESLint: exit 0.

Updated source files were copied to PTSS. Both applications completed normal
Quit and were relaunched through npm run electron dev; both resulting windows
were captured. PTSS sharing was enabled for the live pairing check. No model
load was started and no Git staging, commit or push was performed.

The live pairing check is currently blocked independently: HAOWERNSLAPPY's
Network page reports saved enrollment unavailable, and a read-only native
safeStorage diagnostic confirmed decryption failure. Its enrollment has not
been replaced or cleared. Browser re-enrollment requires the user's recovery
approval and sign-in before live code-entry behavior can be confirmed.

## Live pairing dialog verification

After the user approved recovery, HAOWERNSLAPPY completed Sign out through the
Network UI and opened browser enrollment. The user confirmed sign-in. The
Network page subsequently displayed Connected with its embedded address, and
PTSS appeared under Add device. Clicking Connect opened Verify ptss on
HAOWERNSLAPPY, with the six-digit code entry field visible. The original missing
initiator-dialog symptom is therefore verified corrected in the live apps.
The dialog was left open for the user; no code was entered or approval bypassed.
This does not establish a successful model load or persistent enrollment across
a later restart. Screenshot evidence: packages/core/out/tailscale-integration/
pairing-code-entry-live.png (ignored local output).

## Duplicate pending requests and delayed-start timeout follow-up

A controlled trace of the previous build counted actual POST /v1/pair requests:
one invitation produced one POST and one incoming row; retrying produced a
second POST, two incoming rows with different IDs, and only one outgoing row.
The receiver only reused approved requests, while the sender replaced its old
outgoing request by fingerprint. This proves the retry-to-duplicate mechanism;
the historical UI screenshot alone cannot identify which action sent its second
POST. Background reconnection was a possible caller, not a proven attribution
for those particular historical rows.

Two new native regressions failed before the correction: repeated invitations
returned different IDs, and simultaneous initial invitations returned different
IDs while asynchronous code creation was in progress. The receiver now
serializes pending creation by validated identity and reuses the live request
without renewing its expiry or resetting code guesses. Different identities
remain distinct; name changes cannot replace a bound transcript. The sender
retains verification and its original object when the returned ID is unchanged.
The same controlled trace now reports two POSTs but one incoming row and one
unchanged request ID. The protocol, code verification and approval requirements
remain active.

Broader verification exposed a separate delayed RPC startup failure. Its trace
showed the approved TLS wrapper at 21000 ms while the exact underlying raw TCP
socket remained at 10000 ms; that raw timeout emitted and the client received
RPC_UNAVAILABLE. The approved startup path now updates both tracked layers of
that connection and disables both idle timers after upgrade. Unapproved
admission retains its original timeout.

Final inspected checks: 38 native pairing/owner/node integration tests, 29
desktop candidate/live-peer tests, and 14 core overlay/pairing-code/reconnect
tests passed (81 total). Desktop/core type checking and changed-file ESLint
passed. The earlier complete-response/close regression still passes through
both parent/core IPC boundaries, now also retrying before code verification.
The global guessing-limit test explicitly cancels between attempts to exercise
fresh IDs without weakening its budget assertions.

Both source workspaces received the correction and were relaunched through
npm run electron dev. PTSS completed normal Quit. HAOWERNSLAPPY's old instance
reported Runtime cleanup failed; its exact descendant tree was verified to have
no model engine, then the stuck main PID was terminated and its helper exit
confirmed before relaunch. Both Network pages subsequently displayed Connected
without another browser sign-in. The old shutdown failure is recorded, not
claimed corrected by this pairing change. No model load, commit or push occurred.

Live confirmation after the latest relaunch: one UI Connect opened Verify ptss
on HAOWERNSLAPPY and one incoming request on PTSS. A bounded diagnostic then
sent two additional introductions to the running PTSS receiver using the same
installation identity and display name. Both returned the same request ID; no
code or approval was submitted. PTSS still displayed one incoming row and a
Connections count of 1, while HAOWERNSLAPPY's verification dialog remained open.
Screenshots are retained as ignored local evidence:
ptss-single-request-after-retry.png and pairing-dialog-after-deduplication.png
under packages/core/out/tailscale-integration/. This verifies the previous
missing-dialog fix remains functional alongside request deduplication.

## Quit cleanup correction

The peer parent closed its overlay channel before waiting for the utility core
to exit. A valid overlay frame already queued for IPC delivery then encountered
the closed channel, raised INVALID_CONTROL, and caused containment to terminate
the core before its cleanup receipt. The parent reported PEER_CLEANUP_FAILED even
when native process exit was confirmed. A rejected close promise also prevented
a later exit-confirmation attempt from succeeding.

The overlay now remains available through the peer exit wait. Message validation
and cleanup-receipt/zero-exit requirements remain enforced. Failed close attempts
can retry native confirmation. Main attempts network cleanup after core teardown
even when teardown rejects, retains both causes when both owners fail, and reports
which cleanup phase failed instead of always blaming the model runtime.

The queued-frame and retry tests failed before the correction and passed after.
An added malformed-frame case still rejects cleanup, as do missing receipts and
nonzero core exits, including repeated attempts. Final checks passed: 44 core
shutdown/overlay/network tests, 87 desktop runtime/loading/quit tests, and 38
native pairing/node/owner tests. Type checking, changed-file ESLint, formatting,
and the core host build passed. The native suite retains coverage of the earlier
complete-response pairing fix, duplicate invitation reuse, and approved startup
timeout correction.

Both source workspaces received the correction. Normal window-close Quit was
observed on the updated apps: all 10 HAOWERNSLAPPY owned processes and all eight
PTSS owned processes exited, with zero remaining. Both apps were subsequently
launched through npm run electron dev. This live check was idle; it does not
establish shutdown during an active distributed model load or generation.
Both Network pages displayed Connected after relaunch without browser sign-in.

## Active generation activity acknowledgement during Quit

An isolated check of the production composition found a separate teardown bug:
beginPeerQuit marks peer admission closed before a cancelling generation or
pending token count reports idle. The activity callback looked up its owner
through getPeerHost again, which rejected NOT_READY after that admission change.
This converted an otherwise successful native settlement into a rejected result.
The earlier idle Quit check did not exercise that path.

Each activity transport now retains its existing peer-owner promise for idle
cleanup. Busy admission still goes through getPeerHost, so Quit does not permit
new work. Actual owner/acknowledgement failures still propagate. Regression tests
for cancelling generation and pending token counting failed with NOT_READY
before the correction and passed after it; a retained transport first used after
Quit still rejects without native dispatch.

Final checks passed: 68 core composition/activity/IPC/shutdown tests, 87 desktop
runtime/loading/quit tests, and 48 native peer/owner/process/history tests (203
total). Core/desktop type checking, changed-file ESLint, formatting, and the core
host build passed. A separate focused review found no actionable defect in the
change, while noting the mocked engine/peer boundary of these new regressions.
Both source workspaces received identical compiled host code. Both idle apps
completed normal Quit with all eight owned processes exiting before the
canonical relaunch. Real-model shutdown during loading/generation remains a
separate live acceptance case; the controlled regression establishes this
specific acknowledgement-order correction.

## Runtime installation reuse and disk exhaustion

Sharing failed before listener startup because the first resource probe in every
app session installed another UUID-named runtime directory. The backend's
installation promise survived only within its current process. The installer
neither searched for an existing verified installation nor checked available
space before copying. HAOWERNSLAPPY had 18 peer installations covering only three
versions, consuming 21,455,807,818 bytes. The current signed inventory and all 42
source files verified successfully, but E: had less space than the 1,192,008,381
bytes required by another copy.

The installer now checks existing managed directories using the current verifier
capability, native file/ancestor locks, complete tree validation, lengths and
SHA256 hashes. A new capability-backed receipt is issued for a reusable copy;
directory names and serialized receipts never grant authority. Source verification
still runs, damaged installations remain untouched, and different versions remain
available. Same-root installs serialize within the process. This is not a claim
of cross-process installation locking.

New copies receive a disk-space preflight. Both preflight exhaustion and copy-time
ENOSPC produce INSUFFICIENT_DISK_SPACE, with a useful inline/toast message instead
of the generic peer failure. If partial-copy cleanup also fails, both causes are
retained while preserving the original stable error classification.

Regression tests reproduced six reuse/disk failures and a seventh cleanup-error
failure before the fixes. Final checks passed: 18 native installer tests, 35 native
pairing/node/multi-GPU tests, 39 verifier/inventory/policy tests, and 107 desktop
sharing/runtime/loading/quit tests, 199 distinct tests total. Core and desktop
type checking, changed-file ESLint, formatting and the core host build passed.

Full-content audits and immediate containment/process checks identified only
unused byte-identical duplicates for removal. HAOWERNSLAPPY retained one copy of
each of dev7, dev8 and dev9; 15 duplicates reclaimed 17,879,851,283 bytes. PTSS
retained its oldest dev9 copy; six duplicates reclaimed 7,152,050,286 bytes.
Models, enrollment, identities, pairing data and configurations were not removed.

Both workspaces received identical compiled installer code (SHA256
F757FD378E84E6F43A97B90FD70EC7F78A0534F50C33077CC6531724205DE1B4).
The apps were launched only through npm run electron dev. Normal Quit stopped
all 20 owned HAOWERNSLAPPY processes after the first successful sharing check;
its second restart-and-share check also succeeded with both GPUs selected and
the same three installation directories. PTSS completed normal Quit with all
eight owned processes exiting, then successfully started sharing from its single
retained dev9 installation. Both apps showed Allow connections enabled, and
ports 49301 and 49302 were listening. Runtime processes on PTSS used the retained
directory rather than a new copy. Screenshots and cleanup evidence are under
packages/core/out/tailscale-integration/. This check establishes sharing startup
and installation reuse, not distributed model readiness or generation.

## Saved cluster canvas restoration

Saved configurations persisted GPU assignments but omitted the canvas positions
and chosen connection edges. When ClusterPage was recreated, its component state
was lost and live devices fell back to the demo grid. That grid gave the
coordinator a wider span than workers, while its connection IDs did not match
live device identities. Reusing a previous pan/zoom also allowed restored cards
to be clipped. A missing drawn line alone did not establish a network disconnect.

An optional bounded canvas record now travels with the existing draft and saved
configuration revision. Save, Discard, selection, history, automatic assignment
and Run acknowledgement preserve it. Canvas IDs and links remain presentation
data and never authorize a peer or determine inference order. Older records
without geometry remain readable and receive a deterministic connected layout.
Live cards share fixed-width columns, and restored scopes fit their visible
bounds. Existing explicit edge choices survive reopening.

Regression tests first reproduced rejection of canvas metadata, loss on Save,
the legacy demo-grid fallback, missing Run acknowledgement and automatic
assignment dropping geometry. Final checks passed: 133 core tests, 151 desktop
tests and 10 browser tests. Browser checks cover all four edges, equal card
widths, visible connections, viewport bounds, navigation and reload, plus the
existing launch and unsaved-edit flows. A long pre-existing UI test was split
into edit/save and restore/load cases with its assertions and five-second
deadlines retained. Core/desktop type checking and changed-file ESLint passed.
These checks use controlled runtime/peer fixtures; they do not establish a new
distributed inference or throughput result.

The core host build passed. All 15 deployed implementation/host files match by
SHA256 on both PCs. Normal Quit stopped all eight owned HAOWERNSLAPPY processes
and all 16 owned PTSS processes before their canonical source relaunches. New
app PIDs were 28432 and 22424 respectively. Before restart, the laptop's live
saved Bonsai configuration showed equal-width cards, a visible connection and
unclipped bounds. After restart, the saved configuration and local ranges
reopened with Save disabled, but Settings reported that the laptop could not
read its saved Tailscale sign-in. PTSS was therefore unavailable in that live
view. No credentials were reset. Full two-peer visual restoration after the
real restart remains blocked by that separate enrollment-storage failure;
controlled browser reload coverage passed as recorded above.

## Independent Windows launch and enrollment recovery

A read-only comparison established that the enrollment was intact. Windows
DPAPI could unwrap the profile keys, but enrollment authentication failed using
the key visible inside Codex's redirected context. Native file-handle queries
showed that Local State opened under Codex's LocalCache/Roaming/ModelLoom while
embedded-tailscale/enrollment.bin opened under the ordinary Roaming/ModelLoom.
Node realpath reported the ordinary path and did not reveal that difference.
A one-time read-only check in the interactive Windows user context decrypted the
same enrollment using the ordinary profile key and validated its domain and all
five entries. No key or enrollment contents were logged or copied to disk.
The temporary diagnostic task was removed after observation.

The canonical npm launcher now rejects inherited Codex Windows contexts before
starting Forge. A read-only Windows handle check also rejects redirected
existing profile/key/enrollment paths; unavailable checks stop startup. This is
a development workflow guard, not an authorization boundary. It does not change
encryption, copy keys, reset enrollment, move profiles or affect non-Windows
launches. Native tests accept ordinary and absent profiles, reject a junction,
and verify fixture contents remain unchanged. Four initial launcher regressions
failed before implementation. All nine launcher tests passed on both PCs, and
five desktop instance/protection tests passed. Changed-script ESLint, formatting
and syntax checks passed. A real npm invocation from Codex rejected before Forge.

The idle laptop app completed normal Quit with all six owned processes exited.
Windows Task Scheduler's interactive user session then ran the exact command
npm run electron dev from E:/ModelLoom-Project, using the checkout's Node runtime
under packages/core/out/tooling, with no inherited CODEX environment variables.
App PID 31184 showed Tailscale Connected using the existing enrollment without
browser sign-in. A second normal Quit confirmed all eight owned processes
exited; the same independent launch produced PID 38264, which again showed
Connected with the same embedded address. No model load or generation was
started. Both PCs have identical launcher/test files, and PTSS's ordinary
Windows profile probe passed. Native macOS/Linux sign-in was not retested.

The final Cluster check displayed no saved configurations. A separate read-only
SQLite inspection after normal Quit established that the existing core profile
at C:/Users/user/.modelloom contained two imported sources and zero saved cluster
records. Its database last-write time was 07:45:09 UTC, before the independent
launch correction began at 08:22 UTC. No cluster records were recreated and no
profile was migrated. The app was relaunched through the same independent
canonical command as PID 34404. Temporary verification launch tasks were removed;
the running app and its checkout-owned toolchain remain independent of Codex.
