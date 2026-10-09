# Local Chat development

**Status, 2026-10-10:** Implemented locally in the explicit Windows development
build on `feat/local-generation`; the slice has focused local commits. Ordinary/demo builds
keep generation disabled. This is a partial M1 development result, not production
or cross-platform acceptance. The earlier documentation reconciliation changed
Markdown only. The subsequent review-fix PROCEED authorizes the four Chat
corrections below, without API, worker, signing or publication operations.

The later demo-removal PROCEED makes ordinary startup/rebuild sample-free. Windows
development starts rebuild and enable the existing approved core before opening;
preparation failure stops startup. Models/Cluster use actual imported models and
detected devices or empty/unavailable states. Explicit tests retain their fixture
mode. The underlying ordinary host build still resets development-only output,
with production trust and live resource/verification checks unchanged.

| Area                   | Current implementation and evidence                                                                                                                                                                                     | Remaining limit                                                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime and admission  | Verified owned Bonsai CUDA activation; exact four-slot report, four simultaneous long-prefill/reuse checks and graceful exit recorded on October 9.                                                                     | Exact tested model/build/device only; fresh resource and signed-expiry checks still gate every launch. Production trust/report catalogues remain empty.               |
| Local Chat             | Closed caller-bound main/preload/utility bridge; Send, Stop, Retry, separate thinking/answer and bounded queue. Real-model Send/Stop/reopen passed before the startup-history change.                                   | Latest post-startup generation attempt failed resource preflight before launch; no fresh real-model Send/Stop or active-generation deletion result after that change. |
| Saved chats            | Protected schema-4 SQLite, exact known-schema upgrades, drafts, checkpoints, thinking duration and final speeds. Startup history and confirmed deletion work without loading a model; actual app restart checks passed. | No automatic storage repair, unknown-schema migration, secure-erasure claim or other-platform persistence evidence.                                                   |
| Chat presentation      | Compact Thinking/Thought for time row, inline measured speeds, Copy/Retry, fading hover-scrolling titles, Lucide trash and neutral confirmation dialog. Thumbs-up/down removed.                                         | Attachments remain unavailable and responses remain plain text; manual native Computer Use was unavailable.                                                           |
| Public API and workers | Existing API and joining screens are previews.                                                                                                                                                                          | D07 API/key/exposure contract, D02-D03 worker/network trust, distributed placement/cache/failure handling and inference correctness remain open.                      |

Recorded checks for the deletion slice: 89 desktop tests, 436 core tests, five
Chat browser tests, seventeen native history cases and one isolated native Chat
case passed. The native Chat case first failed owned cleanup under concurrent
checks; the isolated repeat passed unchanged and the cause remains unproven.
The later popup-only correction passed eighteen selected browser checks,
renderer build and an actual Electron appearance/Cancel/Escape comparison.
These are dated run counts, not a fresh all-suite run for this reconciliation.
The detailed history below retains earlier failures and their subsequent fixes.

The latest real-model UI receipts are `plans/chat-repair-live.json` and
`plans/thought-duration-live.json` (October 9). Later receipts are
`plans/startup-history-live.json`, the failed `plans/startup-generation-live.json`,
`plans/chat-delete-live.json` and `plans/neutral-dialog-live.json`.
All are ignored local evidence, not hosted CI or published artifacts. Historical
PR #5 evidence applies to the preceding runtime slice, not these local
changes. A subsequent local code review found four Chat bugs; their fixes are
authorized and implemented below. Independent review and publication remain pending.

Next: checkpoint this local Chat slice after verification, then review the D07 contract before
any API implementation. Follow M2 approved workers and M3 in-app private-network
integration under [the delivery plan](../plans/PLAN.md). Existing Tailscale
connectivity does not implement ModelLoom pairing, authorization or protected RPC.

The explicit Windows development build connects the existing Chat screen to the
utility core and its captured llama-server transport. Send saves one user turn
before generation; streamed thinking and answer text are checkpointed separately. Stop targets that
conversation's request. Retry adds an attempt to the original turn and retains
earlier partial output. Navigation and renderer reload never submit stored work.

The ordinary/demo build keeps generation disabled. Existing Chat layout, copy,
search, per-conversation drafts and disabled attachments are preserved. The user
removed response thumbs-up/down controls; Copy and live Retry remain.
Responses are rendered as text. The transcript follows new output while the
reader remains at the bottom. New text typed while a prompt is preparing is
retained as the next draft.

The subsequent PR #6 review corrections preserve that newer saved draft through
Send admission and renderer reload before the Send reply. Admission clears only
the draft matching the submitted message, atomically with saving the turn. Old
Copy/Delete notifications clear on a new live status or Send/Retry/Stop operation,
including keyboard Send. The separate full-history paging performance finding
remains deferred. No schema, layout, inference setting or generation policy changes.

The October 10 review corrections make Stop abort prompt preparation before
native work starts, retaining unsent drafts. Active Stop keeps the existing
native settlement checks. Search reads saved titles, user messages and answer
text in the core, so unopened chats and partial responses are searchable without
a loaded model. It returns bounded summary pages with literal Unicode matching
and query/revision-bound cursors. Unchanged search results are reused until the
query or saved summaries change. Dates use saved update timestamps and local
calendar boundaries for Today, Yesterday and Older. New chat atomically reuses
an untouched empty conversation while preserving drafts and conversations with
turns. These changes require no schema migration or inference-setting change.

Review-fix verification passed 93 desktop and 441 core tests, eighteen targeted
Windows native history/Chat tests and five Chat browser checks, plus typechecking,
lint and host/renderer builds. The native Chat check uses actual Electron IPC and
protected history with synthetic generation. The first full attempt had five
existing UI timeouts during concurrent checks; an unchanged rerun passed. Two
browser fixtures initially lacked update timestamps and were corrected without
changing assertions. These checks add no fresh real-model, manual Computer Use,
hosted CI or inference-equivalence evidence. Mining stayed running.

Thinking uses the user's compact row and chevron reference. It starts collapsed;
clicking expands the saved/streaming text, with the answer below it. Stop retains
both partial fields and clears its waiting notice after terminal confirmation.

## Ownership and limits

Main captures the requesting window identity and validates its sender/frame.
The preload exposes only closed Chat commands and data-free change notifications.
The utility owns SQLite history, revision-bound paging and the four-active,
eight-pending queue. Main retains the engine endpoint, credential and native
slot monitor. No renderer command supplies a path, URL, header, slot, sampling
configuration, SQL statement or native completion receipt.

Input is limited to 12,000 UTF-16 code units; output to 512 tokens and 1 MiB of
combined thinking/answer text. Thinking counts toward the same token limit.
Reaching the token limit is displayed explicitly. Context overflow is
rejected before generation. Checkpoints run every 250 ms or 32 KiB, and on
terminal transitions. A cancelled native request retains capacity until its
captured stream and subsequent slot observation prove settlement; loss of that
proof closes admission and requests owned cleanup.

Windows history uses `%USERPROFILE%\.modelloom\chat\history.sqlite`, selected
by trusted main from Electron's home directory, with
retained Windows identities, local-user permissions and PERSIST journaling.
An unavailable or invalid store is not repaired automatically. Full Quit still
performs owned runtime cleanup if history opening fails. Recovered active
attempts become interrupted, with explicit retry available.

The approved version-1, version-2 or version-3 to version-4 upgrade adds a nullable
thinking duration, speeds for versions 1/2, and empty thinking for version 1,
preserving existing fields.
It validates the exact old schema/integrity and runs
under the guarded exclusive writer in one rollback-capable transaction. Unknown
schemas remain rejected. Completed assistant turns pass answer and thinking as
separate native Chat fields through the unchanged selected template.

Final responses save native generation and prompt-processing rates atomically
with their text, after confirmed settlement. Both appear after Copy/Retry at
12px normal weight in `#ABABAB`, with spacing and no separator or extra icons.
Generation counts thinking tokens too. Missing/invalid/nonpositive rates remain
hidden, including older responses and cached prompts with no measured prefill.
Retry starts with no rates and preserves earlier attempts' measurements.

The thinking row now uses `Thinking` without an ellipsis, then `Thought for [time]`
after the answer starts or the request stops. Its icon, chevron and styling stay
the same. The utility measures monotonic time from first thinking text to first
answer text, or cancellation/termination if no answer starts. This excludes queue,
prefill and later answer generation. Durations are saved with text and preserved
through Stop/recovery/reopen; once recorded, they cannot be changed. Old responses
without measurements show `Thought`; durations under a second show `<1s`.

The development history core starts when the app opens, independently of model
import, signed runtime installation and GPU/resource preflight. Saved chats,
thinking durations, speeds and drafts are available before loading Bonsai.
One protected history writer stays open across import, load failure and model
Stop. Send/Retry still require the captured ready engine. Model loading prepares
the verified adapter separately; no model or stored request is started on app
startup. Full Quit waits for pending preparation and closes both retained core
and engine ownership. Startup/storage failure remains explicit and never triggers
automatic repair or a different history path.

## Evidence and remaining live gates

Automated renderer/core tests cover Send, partial text, Stop, Retry, navigation,
saved drafts, changes during prompt preparation, output-limit presentation,
caller rejection, paging, forged messages and bounded acknowledged chunks.
A synthetic integration test launches a real Electron utility, opens the
protected SQLite store, saves a streamed partial, stops, quits and reopens it.
These checks use a fake inference transport and do not establish live inference.

On October 9 the user authorized renewal with the existing development custody
and chose four-slot resource validation. Delegated metadata advanced from version
1 to 2, preserving the pinned root, inventory and keys. The existing verification
state accepted it. Timestamp expiry is October 10 at 08:24 UTC; expiry remains
enforced. The standalone publisher now supports `renew <previous-repository>
<new-repository>` and refuses to overwrite a repository. The prior repository is
preserved locally as `repository-expired-20261009`.

The signed, non-allocating planner passed for four slots at 7,680 tokens each:
30,720 aggregate context and rounded-up GPU components of 3,447/1,619/513 MiB.
The initial diagnostic stopped before engine launch with
`INSUFFICIENT_DIAGNOSTIC_RESOURCES`: 4,324,495,360 bytes of physical RAM were
available, below its original 10 GiB startup floor. That floor was arbitrary
and was replaced before the successful live retry below. No precision,
context, sampling or model substitution was made.

The retry removed that arbitrary 10 GiB calibration floor. Its replacement is
7.715 GiB: the observed one-slot resident peak plus three slots' checkpoint
reserves, a conservative host-shadow allowance for the added GPU context and
1 GiB of free-RAM headroom. The observed baseline already includes its runtime
and caches; those are not added again. This remains a calibration guard, not a
validated four-slot requirement. Two standalone regression tests pass, covering
eight-GiB admission and rejection of missing/invalid memory, insufficient memory
and a different physical GPU. This diagnostic guard remains separate from the
normal-loader report added after live validation.

The prepared workload measures four simultaneous 7,500-token prefills and
per-slot reuse, then checks RAM restoration on one slot with the previously
validated short prompt. All four resident prompts must first be replaced with
short prompts: otherwise idle near-limit slots repeatedly evict the short
snapshot. The failed eviction test is preserved as `four-slots-idle-eviction`.
A shared 768 MiB cache does not promise four near-limit prompt snapshots.
No cache, context, sampling or weight setting is reduced.

The successful four-slot run exited 0. All four 7,500-token prefills generated
16 tokens each; repeated requests reused 7,496 prompt tokens per slot. The RAM
restoration assertion passed after replacing the idle resident prompts. Peak
captured helper/server resident sets summed to 6,210,097,152 bytes (5.78 GiB),
and peak owned-job private commit was 8,852,537,344 bytes (8.24 GiB). The owned
helper exited 0 with no active processes after a graceful stop. Raw evidence is
`four-slots.json`/`.log`. Cleanup now waits for both an empty job and helper exit
before releasing its handle; the earlier cleanup race masked a cache-test failure.

The development catalogue retains the earlier one-slot report and adds the
exact four-slot report. Desktop selects four slots. Its conservative physical
RAM admission budget is 7,524 MiB (7.35 GiB), including full cache/checkpoint
reserves; it is not measured steady-state RAM or private commit. The GPU budget
is 5,579 MiB. Production catalogues remain empty. New regression checks reject
insufficient RAM/VRAM and changed settings and prevent desktop from selecting
the older one-slot report. Local ordinary tests pass: 69 desktop and 395 core;
all 58 native tests pass. Typechecking, host build and lint pass.

Kryptex's existing `KryptexElevationV2` scheduled task can be stopped and started
through commands. Each pause was verified by absence of Kryptex/SRBMiner;
restarting the same task restored SRBMiner with its existing settings. Validation
commands restore it in their failure paths too. No mining configuration changed.

Computer Use successfully imported the exact model through the native picker,
selected it in Cluster and clicked Run. Cluster reached "Local model ready"
with full GPU offload. Chat could not open history, so no live Chat message was
sent. Full Quit exited the app and its owned engine; mining was restarted and
SRBMiner's new process was verified.

The history failure is caused by Windows package filesystem virtualization:
the logical `AppData/Roaming/ModelLoom` folder resolves physically under Codex's
package `LocalCache/Roaming/ModelLoom`. Read-only handle inspection and
`realpathSync.native` agree on that redirection. The native guard correctly
rejects the mismatch; there is no path-only fallback.

The user directed the fix to follow LM Studio. Its
[current Windows Chat documentation](https://lmstudio.ai/docs/app/basics/chat)
uses `%USERPROFILE%\.lmstudio\conversations`; the installed local directory
matches that layout. ModelLoom now selects `.modelloom` beneath the trusted
home directory, separate from Chromium's redirected AppData cache. The native
guard creates only the final app directory after retaining its ancestors,
using the existing protected current-user/SYSTEM DACL. Physical-path equality,
reparse and hard-link rejection, retained identities, quotas and the writer lock
remain enforced. Existing legacy files are not moved or repaired automatically.

Chat retains a renderer draft even before a conversation exists. Once history
becomes available after loading, it creates the first conversation and saves
that draft. Storage startup failure now returns `HISTORY_UNAVAILABLE` instead
of `NOT_READY`, and failed New chat preserves the actual error. Regression
checks reproduced both discarded input cases and the incorrect error before
the fix. Recovery also creates a separate conversation when an unassigned new
draft is present, leaving an older saved draft intact. All 72 desktop, 395 core
and 60 native tests pass; typechecking, host
and native builds, lint and native formatting/static analysis pass.

The rebuilt Electron desktop accepted typing before model loading in an
automated desktop check. Computer Use's native pipe was unavailable for this
retry, so it was not a manual Computer Use check. The live load attempt was
refused by the unchanged resource preflight. With mining stopped, a diagnostic
snapshot found 7,390,838,784 bytes available RAM against the 7,889,485,824-byte
validated reserve; free VRAM was 16,891,510,784 bytes against 5,850,005,504 bytes
required. No context, precision or budget was reduced. Mining was restored and
no owned engine remained. That attempt did not reach live Send/Stop.

A separate check opened the actual `%USERPROFILE%\.modelloom` guarded store,
saved a synthetic draft, closed it and reopened the same draft successfully.
This verifies the real profile storage location without claiming live inference.

The later live diagnosis reached HTTP 200 but failed with `INVALID_STREAM` at
the first string `reasoning_content` delta. The user approved thinking support
and preservation of existing chats. Parser/service/channel regressions first
reproduced that rejection, then passed with separate thinking and answer fields,
shared byte limits, strict Unicode/envelope checks and unchanged settlement.
Migration regressions cover preservation, reopen, unknown schemas and rollback
after a simulated post-ALTER failure. A guarded upgrade of the actual profile
store preserved all existing values: two conversations/five attempts with the
same before/after SHA-256 over every original field.

The rebuilt Electron desktop's automated live test passed on October 9 at
11:01 UTC. It retained the pre-load draft, loaded the approved four-slot model,
returned `HELLO` with 670 thinking characters, verified collapsed/expanded
thinking, then stopped a second request during thinking and retained its 36
partial characters. Full owned-engine stop and protected-history reopen passed.
Mining was paused before testing and restored afterward, with SRBMiner verified.
This is automated Electron/Playwright evidence; native Computer Use remained
unavailable. Ordinary suites passed 73 desktop/405 core tests; all 60 native
tests passed. The final stale Stop-notice regression passed in the ten-test Chat
suite. Typechecking, lint, host build and renderer build passed. Raw local
evidence is in ignored `plans/chat-repair-live.json`, `plans/chat-repair-live.png`,
`plans/thinking-history.json` and the earlier `plans/chat-repair-stream.json`.

Local renewal regressions cover actual expired roles, increasing versions,
unchanged root/inventory, cached rollback protection, tampered metadata and
existing-output refusal. Raw planner and diagnostic evidence is retained under
ignored `packages/core/out/activation/b11306/evidence/`.

The October 9 measured-speed amendment passed 75 desktop, 419 core and 60
Windows native tests, four Chat browser checks, typechecking, lint, host build
and renderer build. The guarded actual-profile schema-2 to schema-3 upgrade
preserved all original fields, including thinking, in six conversations/thirteen
attempts by matching before/after SHA-256. Synthetic upgrade/rollback tests also
cover schema 1, unknown schemas, invalid rate fields and terminal idempotence.

The automated live Electron check completed at 11:46 UTC: the real model returned
`HELLO`, its measured generation/prefill rates appeared after Copy/Retry at the
approved size/color, and those exact values survived protected-store reopen and
a full app restart in the rendered Chat screen. Stop retained partial thinking;
owned-engine stop passed and Kryptex/SRBMiner was restored. The browser fixtures
separately checked inline alignment at 1280, 1100 and 1000 CSS pixels. Evidence
is in ignored `plans/speeds-history.json`, `plans/chat-repair-live.json` and
`plans/chat-speeds-restarted.png`. This verifies rate plumbing and retention,
not a throughput target or a manual Computer Use run. The app was reopened for
the user after verification.

The thinking-duration amendment passed 81 desktop, 423 core and 18 targeted
Windows native history/chat tests, plus typechecking, lint, host/renderer builds
and targeted formatting. Regressions cover phase timing on a monotonic clock,
first-answer checkpointing, Stop, recovery, reload, immutable duration and
seconds/minutes/hours/sub-second formatting. Known schema-1/2/3 upgrades and
rollback are tested. The actual guarded schema-3 to schema-4 upgrade preserved
all original fields, including speeds, across seven conversations/eighteen
attempts by matching SHA-256.

The real-model automated Electron test completed at 12:20 UTC: `Thinking`
without an ellipsis changed to `Thought for 3s` for a measured 3691 ms phase.
Stop retained a partial thinking duration, and both durations and speeds survived
protected-store reopen and a full app restart. Expand/collapse, Send and owned
engine stop passed. Mining was restored, SRBMiner verified and ModelLoom reopened.
Evidence is in ignored `plans/thought-duration-history.json`,
`plans/thought-duration-live.json` and `plans/thought-duration-restarted.png`.
This is automated UI evidence; no new manual Computer Use or quality result is claimed.

The startup-history fix passed the actual Electron restart check at 14:32 UTC:
all eight existing conversations remained unchanged, saved thinking durations
and speeds appeared before import, a new draft persisted/reopened with no model,
and both the Send control and a direct Send command remained unavailable.
Evidence is in ignored `plans/startup-history-live.json` and
`plans/startup-history-restarted.png`. The additional live-generation attempt
was rejected by the unchanged resource preflight before engine launch; it did
not verify Send/Stop for this amendment. Its evidence is
`plans/startup-generation-live.json`. Mining was restored and SRBMiner verified.

Chat deletion is available before model loading. The row's Lucide trash button
opens a confirmation dialog; Cancel preserves the chat, and Delete removes its
draft, turns and attempts with saved thinking, duration and speeds. Selected-chat
deletion opens an empty New chat. The core blocks new same-chat requests, aborts
pending token preparation and awaits confirmed cancellation/terminal writes before
one rollback-capable transaction. Unsafe Stop or storage failure retains history.
Quit joins pending deletions. Existing storage guards and schema 4 are unchanged.
Long sidebar titles fade and scroll on hover/keyboard focus, with a fixed trash
button and reduced-motion support.

Deletion verification passed 89 desktop and 436 core tests, five Chat browser
checks at 1280/1100/1000 CSS pixels, typechecking, lint and host/renderer builds.
Seventeen protected-history native cases passed. The chat native test initially
failed owned-process cleanup during concurrent verification; the isolated repeat
passed without changing its assertions, deadlines or containment code. The cause
of the initial failure is not established. That isolated test verifies deletion
and retained partial output across protected-store reopen using a synthetic
transport, without a GPU run.

The actual automated Electron UI check completed at 15:56 UTC: confirmation Cancel
retained the synthetic chat; Delete opened an empty New chat; the deleted record
stayed absent after renderer reload and full app restart. All eleven original
conversations matched their original SHA-256 checksums. Only clearly labelled
test-created records were removed. Evidence is in ignored
`plans/chat-delete-live.json`, `plans/chat-delete-hover.png` and
`plans/chat-delete-restarted.png`. Mining stayed running. This is automated UI
evidence; manual Computer Use and real-model cancellation during deletion were
not run for this amendment.

This slice does not implement two-desktop inference, worker authorization,
Tailscale enrollment, a public API, production activation or inference-equivalence
acceptance. See [ADR-0005](../specs/decisions/0005-local-generation-development.md).
