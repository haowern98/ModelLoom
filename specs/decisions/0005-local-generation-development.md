# ADR-0005: Local generation development scope

**Date:** 2026-10-09

**Status:** Accepted scope and development limits; affected implementation/evidence gates remain open.

**Implementation reconciliation, 2026-10-10:** The accepted later amendments below
are implemented locally in the explicit Windows development build, including
real Chat transport/UI, exact four-slot resources, schema-4 history, thinking/
rates/duration, model-independent startup history and confirmed deletion. The
earlier real-model Send/Stop passed before the startup-history change; the later
generation retry failed resource preflight, while unloaded history/deletion/popup
checks passed. See [current progress and dated evidence](../../docs/local-generation.md).
This remains partial M1 development work with no current-slice publication,
production/worker/API or release/correctness acceptance.

The user reviewed `plans/LOCAL-GENERATION-IMPLEMENTATION.md` and said PROCEED on
2026-10-09. Start with its fixture-only contracts, admission and stream-parser
tasks. These need no model, GPU, native build, network enrollment or renderer
change. Publication and live workloads remain separate authorizations.

Preserve ADR-0004's four active/eight pending development policy, FIFO core
admission, immediate QUEUE_FULL rejection and caller-owned cancellation. Native
completion order is not FIFO. Keep one core pending queue; only admitted work
enters the runtime. A cancelled active request reserves capacity until captured
native settlement. Unconfirmed cancellation closes admission; it never grants
capacity for a replacement request.

Accepted development bounds: pending wait 120 seconds; generation deadline
300 seconds; cancellation confirmation five seconds. Retain the composer limit
of 12,000 UTF-16 code units and the existing 1 MiB UTF-8 control-message bound.
Stream events are at most 64 KiB and assistant text at most 1 MiB. The later live
request ceiling is 512 output tokens, explicitly reported when reached.
Conversation content is bounded to 8 MiB and the managed history directory to
256 MiB including database sidecars. Proposed history checkpoints are every
250 ms or 32 KiB of new text, plus every terminal transition. Limits never
authorize silent truncation, eviction, lower precision/context or altered sampling.

The functional direction includes saved local conversations, streamed text,
caller-specific Stop and explicit retry retaining partial attempts. Preserve the
existing Chat layout, text-only rendering and disabled attachments. Core owns
history and request policy; the captured broker owns private engine transport.

The later PROCEED on 2026-10-09 accepts the concrete local history and Chat
bridge supplement: built-in node:sqlite in the utility core, schema version 1,
retained Windows directory/database/journal identities, local-user permissions,
PERSIST rollback journaling, a 120 MiB database/136 MiB journal allocation,
transactional checkpoints/terminal writes, interruption recovery, explicit retry,
and the closed caller-bound renderer methods with bounded paged views.
Synthetic native/SQLite evidence is required before binding writable user history.
No delete, automatic repair, export or backup surface is approved. This acceptance
does not close D04, D09 or D12 globally or permit invented security invariants.

The subsequent 2026-10-09 PROCEED accepts the restricted native-settlement
amendment in `plans/LOCAL-GENERATION-NATIVE-SETTLEMENT.md`: authenticated,
owner-private GET `/slots`, alongside the two accepted Chat operations. The
owner selects and retains up to four native slot reservations. Only captured
stream completion followed by a later serialized idle observation releases a
reservation; cancellation without a valid terminal additionally requires prior
observation of that request's native task. Missing correlation, status failure,
task reuse or changed ownership closes admission and requires owned cleanup.
Poll at most once per 100 ms, with one operation in flight, a five-second
confirmation bound, 1 MiB raw responses and 64 KiB projected status. No status,
slot ID, arbitrary endpoint or credential is exposed through renderer commands.
This acceptance supplies no live model, four-slot resource or quality evidence.

The existing Bonsai resource report covers one slot only. The primary plan
remains validation of four live slots at the unchanged selected per-slot
configuration; this ADR does not approve a one-slot exception. If four slots
cannot fit, obtain an explicit choice rather than silently changing capacity.
No four-slot memory report or correctness result is established here.

The latest 2026-10-09 PROCEED authorizes connecting the real captured Chat
transport and closed main/preload bridge to the existing Chat screen, including
Send, Stop, explicit retry and saved-history views. It also authorizes a bounded
manual desktop Chat test with the approved model, pausing Kryptex/SRBMiner just
before sending and restoring mining after testing. This does not waive the
four-slot resource gate or authorize renewing expired signed package metadata.
Synthetic core, renderer and native integration checks are separate evidence
from that live manual test.

The user later requested the broken Chat input/storage be fixed and directed
storage behavior to follow LM Studio. Its documented Windows conversation root
is `%USERPROFILE%\.lmstudio\conversations`. ModelLoom therefore selects
`%USERPROFILE%\.modelloom\chat\history.sqlite` in trusted main, separate from
Chromium's AppData cache. The native guard may create only the final app directory
after capturing its existing ancestors, with the accepted private DACL. This
does not authorize path aliases, reparse points, automatic history migration or
repair, or any weakening of retained identity, quota and writer-lock checks.
Draft typing remains available before history opens, while Send stays gated on
a ready runtime and usable history. A history startup failure must report the
storage failure rather than claiming that no model is loaded.

After live diagnosis identified `reasoning_content` as the rejected field, the
user explicitly said PROCEED with thinking support and preservation of existing
chats. Thinking and answer text are separate, bounded plain-text streams and
saved fields, sharing the existing response/conversation quotas. The renderer
uses the user's compact row/chevron reference: collapsed initially, expandable
while streaming or after completion/Stop. Copy response continues to copy the
answer. Completed context passes both fields through the unchanged selected
chat template; thinking is not concatenated into the answer or disabled.

This approval permits exactly the known SQLite schema-1 to schema-2 upgrade:
add empty thinking to old attempts while preserving all prior fields. Validate
the complete old schema/integrity first, reserve journal space and upgrade under
the retained exclusive writer lock in one rollback-capable transaction. Unknown
schemas, repair, path migration and weakened permissions/quotas remain excluded.
Stop, interruption and retry preserve each attempt's partial thinking and answer.
The 512-token ceiling counts total generated output, including thinking, and
still reports an output-limit state explicitly. This supplies no quality-equivalence
evidence or authorization to alter model weights, template or sampling.

On 2026-10-09 the user said PROCEED for measured response speeds, then explicitly
chose to save speeds with responses. Final native timing diagnostics may project
only positive finite generation/prefill rates or null for an unavailable rate.
Generation includes thinking. The existing completion, native settlement,
identity and acknowledgement checks remain required; diagnostics never affect
admission, inference settings or output. Invalid optional native diagnostics are
omitted rather than failing otherwise valid output. Projected/saved diagnostics
still receive exact-key scalar validation at their boundaries.

This extends the accepted upgrade to exact schemas 1 or 2 to schema 3, adding a
nullable speeds field to each attempt under the existing preflight, reserved
journal and exclusive rollback-capable transaction. Existing fields are preserved;
older attempts have no invented speeds. The final response and speeds commit
together after native settlement, before terminal notification. Retry retains
earlier measurements and starts with none. UI removes thumbs-up/down and shows
measured speeds after Copy/Retry in the approved 12px muted row, without a dot.

The later thinking-duration PROCEED keeps the brain/chevron row and its styling,
uses `Thinking` without an ellipsis while active, then `Thought for [time]` once
the thinking phase ends. The utility measures monotonic elapsed milliseconds
from the first nonempty reasoning chunk to the first subsequent answer chunk,
or terminal/cancellation when no answer starts. Queue time, prefill, subsequent
answer output and cancellation cleanup are excluded. Completed durations are
checkpointed with text, then retained through Stop, recovery and terminal writes.
Old responses without a recorded duration use `Thought` without an invented time.

This approves exact schemas 1, 2 or 3 to schema 4, adding a nullable nonnegative
integer thinking duration under the same preflight, reserved journal and exclusive
transaction. Existing text, reasoning, speeds and other fields are preserved.
Once recorded, a duration cannot be rewritten or removed. Retry starts with no
duration. Saved views project the validated scalar only; renderer clocks cannot
assign generation/history authority, and no native IPC command is widened.

The subsequent startup-history PROCEED opens the same protected utility-owned
store when the development app starts, before model import or runtime resource
admission. Keep one history writer through import/load/Stop, including rejected
resource or package preparation. Read/New chat/saveDraft are independent of an
engine; Send/Retry remain gated on a captured ready engine. Native core containment
starts with history, while verified engine ownership is prepared only on an
explicit load. Full Quit closes admission immediately, waits for pending core
or engine preparation and confirms both owned exits. Storage identities,
permissions, locking, quotas, exact schemas and sender/caller checks are unchanged.
This authorizes neither automatic model loading nor request replay.

The subsequent chat-deletion PROCEED authorizes a closed `deleteConversation`
command containing only the conversation ID. Main still supplies the captured
caller; renderer paths, credentials, endpoints and native-settlement assertions
remain excluded. Deletion works without a loaded model. The controller closes
that conversation's admission, aborts its pending token preparation and cancels
only its caller-owned requests. Delete only after confirmed native settlement
and durable terminal writes; failed cancellation or cleanup retains history.
Quit joins pending deletion operations before closing storage.

The existing reserved exclusive transaction removes only the selected
conversation, draft, turns and attempts, including thinking, duration and speeds.
Reject active records and roll back any failed transaction. Schema 4 and storage
identity, private permissions, locking and quotas are unchanged. Invalidate list
cursors after deletion, including replacement of an empty chat. The renderer
requires confirmation, retains records/drafts on failure and opens an empty New
chat when the selected conversation is deleted. Use the approved Lucide trash
button and fading/hover-scrolling sidebar title treatment.

The 2026-10-10 review-fix PROCEED accepts all four reported Chat corrections.
Add closed `{action: 'cancelConversation', conversationId}` for caller-owned
Stop during prompt preparation as well as queued/active generation. Abort the
preparation before native work starts; preserve unsent drafts. Active cancellation
still retains capacity until the existing native settlement proof. Wrong callers
cannot cancel another caller's work, and an idle Stop does not replay anything.

Add bounded `{action: 'search', query, cursor?}` over saved titles, user messages
and answer text, including unopened chats and partial attempts. Use literal,
Unicode case-insensitive matching; `%` and `_` have no wildcard meaning. Return
summary pages only, with revision- and query-bound opaque cursors. Search does
not require a loaded model and returns no message bodies or provenance. Existing
saved update timestamps project into Today, Yesterday and Older using local
calendar boundaries. Repeated New chat reuses an untouched empty conversation
atomically; it never replaces a draft or a conversation containing turns.
These fixes keep schema 4, storage guards, inference settings and generation
settlement unchanged. They do not authorize publication or a GPU workload.

The subsequent October 10 PROCEED removes automatic demo initialization from
ordinary serving/rebuilding. Fixtures are enabled only for explicit test/demo
runs. Windows development starts rebuild the hosts, then invoke the existing
public-root-checking development builder before Electron opens; either failure
stops startup. Packaging and ordinary host builds retain their closed defaults.
No signing, production activation, storage-format or inference change is added.

Local development remains within M1. Public API, distributed workers,
Tailscale/Headscale enrollment, downloads, production activation, speculative
decoding, additional GPU experiments, signing operations and release acceptance are excluded.

Sources: [ADR-0004](0004-runtime-lifecycle-proposal.md),
[decision register](README.md), [integration contracts](../INTEGRATION-SPEC.md),
[security requirements](../SECURITY-SPEC.md), and the local-only implementation
plan. Approval does not convert a proposed test into passing evidence.
