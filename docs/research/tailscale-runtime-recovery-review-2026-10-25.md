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

## Transfer fragmentation diagnosis and correction

The first transfer trace located acknowledgement waits but did not isolate their
cause. Its separate SSH measurement was not a controlled comparison of the app's
transport and did not establish that IPC was, or was not, the main limiter.

A subsequent A/B/A/B comparison kept the same running apps, approved identities,
embedded Tailscale enrollment and authenticated diagnostic path. The changed
variable was the local parent/core IPC fragment size: 8 KiB versus 32 KiB. Both
variants used the same temporary 64-KiB producer chunks, four-second samples and
64-MiB per-direction ceiling. Normal activity cancellation remained enabled.
No model, sampling setting, GPU workload, enrollment or pairing was changed for
this comparison. Payload contents and credentials were not recorded.

| Sample | IPC fragment | Upload Mbps | Download Mbps |
| ------ | ------------ | ----------: | ------------: |
| A1     | 8 KiB        |       61.58 |        117.72 |
| B1     | 32 KiB       |       88.78 |        115.52 |
| A2     | 8 KiB        |       33.72 |        100.64 |
| B2     | 32 KiB       |      104.24 |        122.33 |

The mean upload increased from 47.65 to 96.51 Mbps in these samples, about 2.03x.
Two subsequent 32-KiB samples measured 92.02 and 95.64 Mbps. These are bounded
observations on this connection, not a promised speed multiplier for every link.

The cause is unnecessary fragmentation before and after TLS, with a serialized
local acknowledgement per fragment. A 16,406-byte encrypted record was reproduced
as three IPC messages of 8192, 8192 and 22 bytes. A regression first failed on
that sequence; the corrected transport carries the same bytes in one message.
The permanent change uses 32-KiB frames, still with one fragment in flight,
canonical base64, exact sequence/channel checks, backpressure and the existing
deadline. The 64-KiB write bound is unchanged. Only native/overlay data envelopes
receive a 64-KiB JSON allowance; ordinary controls retain their 16-KiB limit.
A second regression reproduced rejection of an otherwise valid 32-KiB native
frame before that envelope guard was corrected.

The UI also changed units between idle bandwidth in Mbps and live traffic in
MiB/s. For example, 60 Mbps is approximately 7.15 MiB/s. Both views now use the
same byte-rate formatter, and the active description includes model loading.
Fonts, CSS and layout controls are unchanged.

Checks passed: 175 peer/network tests, 95 desktop connection/loading/runtime/
shutdown tests, desktop/core type checking, and changed-file lint/format checks.
These include byte equality, backpressure, timeout, forged channel, ordering,
oversized/noncanonical data and the admitted native-RPC path. They do not replace
the separate inference-correctness acceptance gate.

The normal Bonsai loading path was then exercised with the permanent transport
change and the original diagnostic budgets restored. The existing test22 saved
configuration still assigned layers 0-30 locally and 31-63 to PTSS. During the
bounded minute of model transfer, 30 observed loading snapshots above 1 MiB/s
averaged 11.26 MiB/s and peaked at 14.55 MiB/s. The earlier unmodified loading
trace peaked at 7.14 MiB/s. The test intentionally requested Stop after that
minute; Stop returned stopped with no runtime error or memory override. Ready
was not observed, so this establishes the native transfer path, not a complete
model-load or generation acceptance result.

The deployed PTSS checkout also passed the 17 focused IPC/overlay/native-admission
tests. Final implementation and regression-test sources match between PCs by
SHA256. The temporary producer/budget changes, mode switches, main-process
driver, samples, backups and scheduled diagnostic tasks were removed after the
normal source relaunch. Only the fix, regression coverage and this evidence
record remain in the project diff; unrelated working-tree/index entries remain.

## Complete two-PC load comparison and latency tracing

The subsequent comparison used the normal `run-configuration` bridge with saved
`test22` revision 1 on both source-development apps. Both apps were launched only
with `npm run electron dev` from their respective workspace roots, in the normal
interactive Windows user context. The temporary baseline changed only
`RPC_IPC_FRAME_BYTES` from 32 KiB to 8 KiB on both PCs, then restored the exact
32-KiB source backup. Its SHA256 on both PCs was
`305c32baba19894844403e9e6238b956cd11aeb102a1b99f57ba1cb5074fc5d5`.

The model remained Bonsai-27B-Q1_0.gguf, with layers 0-30 on HAOWERNSLAPPY's
4060 Ti and 31-63 on PTSS's 4070 SUPER. Context, four-slot concurrency, batches,
KV types, flash attention and all saved preferences remained unchanged.

| Completed run          | Command start to Ready | First loading snapshot | Mean observed transfer above 1 MiB/s | Peak observed transfer |
| ---------------------- | ---------------------: | ---------------------: | -----------------------------------: | ---------------------: |
| Previous 8-KiB framing |              474.834 s |               62.089 s |            5.09 MiB/s (59 snapshots) |             6.89 MiB/s |
| Current 32-KiB framing |              257.687 s |               65.871 s |           11.09 MiB/s (27 snapshots) |            13.17 MiB/s |

Both command results actually reported Ready and the same active cluster runs.
The elapsed reduction was 217.147 seconds, or 45.73%, in this consecutive pair.
The similar preflight times and native startup logs place the gain in loading,
rather than an earlier resource-admission completion. These are one successful
run per condition, without a cold-cache reset or statistical repetitions, not
a guaranteed percentage for every load. PTSS's existing Kryptex miner remained
running in both conditions; its PID's CUDA engine measured approximately 100%
utilization. No unrelated application was stopped. No generation or output
equivalence claim follows from reaching Ready.

Other attempts failed: a 32-KiB attempt exited after 524.465 seconds without
Ready, and transient peer failures cancelled planning with `PLANNING_CANCELLED`
before native startup in other attempts. Those failures are excluded from the
successful-run timings and remain relevant reliability limitations.

Latency was traced separately. The existing `pingTelemetry` formula still times
a fresh authenticated control call, including overlay dial, TLS and response.
It is not a WireGuard RTT measurement. During a healthy transfer, independent
OS ping to PTSS measured 17-19 ms. Plain fresh TCP/HTTP discovery measured about
18-31 ms to connect and 37-56 ms for the full HTTP request. Earlier samples also
had real external-path variation and packet loss; not every historical spike
can be assigned to application IPC.

Conditional logpoints matched the same overlay dial ID across both processes.
In a 45-second loading window, 60 complete dials showed 0-336 ms between the
peer core sending its request and the parent receiving it, averaging 67.12 ms
over all operation types. Examples waited 198, 228, 216 and 270 ms on that hop,
followed by parent-side TCP dials of 19, 15, 16 and 20 ms respectively. Return IPC
was normally 0-1 ms. Thus a substantial part of the displayed loading latency
was internal control-message delay on the IPC path shared with bulk transfer.
Fresh TLS/request setup adds further round trips. This measurement locates the
delay boundary; it does not establish the exact Electron scheduler or OS
mechanism that delayed delivery.

For snapshots with transfer above 1 MiB/s, displayed median latency was 344.29 ms
with 8-KiB framing and 292.20 ms with 32-KiB framing. The transport improvement
did not eliminate control-path delay. Separating or prioritizing bulk/control
delivery and measuring an established connection are follow-up work, not fixes
claimed by this comparison.

The temporary peer-call tracer had a teardown defect: removing its global trace
buffer while a wrapped request was still pending could throw from its `finally`
block, incorrectly failing that request. The model stopped after the measured
32-KiB Ready result during that teardown. The original PeerNode and TLS functions
were restored and inspected, with no tracer hooks or buffers remaining. A final
normal load and cleanup verification follows this correction.

Further profiling located the blocking native call, rather than only the IPC
boundary. `getPeerHost` in `hosts/development-desktop.ts` called
`ownershipBinding().privateDirectory(stateBase)` on every peer read, including
when the host promise already existed. That native function applies an
inheritable protected DACL synchronously using `SetNamedSecurityInfoW`. A
30-second main-process CPU profile attributed 8.232 seconds to that native call
under the `getPeerHost -> peers` stack. A second dial trace showed `postMessage`
itself returning within 0-1 ms, followed by 177-235 ms without parent delivery;
the core ran 11-14 ten-millisecond timer callbacks in those waits, while the
parent generally ran only one. Repeated permission application blocks the main
event loop and delays the authenticated control path.

After explicit PROCEED approval, permission setup was moved inside first host
initialization. The same native ownership/ACL operation still runs before host
creation and runs again if initialization fails and is retried. Cached reads do
not rewrite permissions. New tests first failed with nine permission calls for
nine reads, then passed with one call. They also cover concurrent reads, failing
closed before host creation on permission failure, and rechecking permissions
after a failed host initialization. No RPC authentication, identity storage,
directory policy or native ACL implementation was changed.

The user then approved temporarily pausing the exact existing PTSS Kryptex miner
for a second comparison. Its executable path and process creation time were
recorded before reversible suspension, and GPU utilization dropped from 100%
to 0%. Models, credentials, pairing records and load preferences were retained.
The original 8-KiB/permission-rewrite baseline runs against the already compiled
old build; source edits are applied only on the subsequent canonical relaunch.

The mining-paused old-build baseline did not reach Ready within ten minutes;
the explicit Stop observation at 620.829 seconds already saw a failed view and
returned stopped without an error. It is an incomplete/failed baseline, not a
successful load-time measurement. With both approved fixes rebuilt on both PCs,
the subsequent transfer showed 14-19 ms ordinary ping (six replies, no loss)
while app control latency was 86-89 ms in contemporaneous snapshots. Later
transfer snapshots measured about 70-93 ms. The fixed main-process profiles
contained no repeated `getPeerHost` permission-call samples. The preflight
profile instead showed ordinary file hashing and file reads.

Validation after restoring the permanent 32-KiB framing: 47 focused tests passed
across six files, including peer hosting, desktop deadlines, initialization
retry and IPC data admission. The PTSS checkout independently passed all 16
development-desktop tests. Core type checking, changed-source ESLint and
Prettier passed. Running the new 32-KiB tests while the deliberate 8-KiB baseline
was selected had correctly failed those frame-admission assertions; restoring
the permanent source made the focused suite pass. Both PCs' implementation and
regression-test file hashes matched after deployment.

The final mining-paused run reached Ready in **381.844 seconds** from the normal
saved-configuration command. Its first loading snapshot was at 140.884 seconds,
so file/resource preflight accounted for roughly 2m21s before loading. Both
expected layer runs were present in `activeCluster`, with no runtime error.
Across 33 loading snapshots above 1 MiB/s, median displayed control latency was
83.47 ms, mean was 90.79 ms, mean transfer was 8.88 MiB/s and peak was 10.15
MiB/s. This establishes a completed distributed load with the latency fix; it
does not turn the failed ten-minute baseline into an exact percentage gain.
The earlier completed framing-only pair remains the 474.834-to-257.687-second
comparison, under its separately recorded conditions.

The same recorded Kryptex process was resumed after Ready, using both executable
path and creation time to reject PID reuse. PTSS GPU utilization returned to
100%. Diagnostic prototypes had already been restored; no peer/TLS wrappers are
part of the product change. Final cleanup removes the temporary scripts,
logpoint/profiler output, baseline source backups and diagnostic scheduled tasks
on both PCs, while retaining the approved fix, regression tests and this record.

Post-cleanup bridge reads still reported Ready, no runtime error, the same two
active layer runs and an approved PTSS peer. Kryptex restarted its miner child
processes after resumption; GPU utilization remained 100%. Both source apps
remained open, with one primary app process per PC. The diagnostic scheduled
tasks, per-run directories and inspector listeners were removed/closed. Automatic
approval review initially rejected local directory deletion with only `blocked
by policy`; the user deleted it manually. A subsequent check confirmed the
directory was absent, no diagnostic tasks or app inspector listeners remained,
and exactly one primary local source app process was running. No generation
test was run, no credentials were reset, and no commit or push was made for this
diagnostic/fix slice.
