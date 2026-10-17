# Cluster placement and model settings separation, 2026-10-17

The user's PROCEED authorizes Cluster Save to retain only model identity and GPU
assignments, keeping per-model settings separate. Planning and each Run resolve
the model's current saved context, performance and advanced settings. An active
load and already admitted requests retain their immutable captures.

Named and draft cluster JSON no longer embeds `load`. The owner reconstructs that
field only in planning replies and immutable session captures. Incoming assignment
edits cannot change model settings. Existing embedded settings are validated and
removed through the existing guarded transaction, preserving names, identities,
revisions and assignments. This does not copy old embedded values into the separate
model-settings table or replace the user's current model settings.

Resource estimates use current settings. Main compares settings again after the
estimate; the utility independently checks them against the protected store
before broker launch. A concurrent settings change rejects the pending load.
The renderer's placement comparison ignores load-only differences, so changing
model settings does not make a placement dirty or require another named Save.

Regression coverage checks raw stored records, current settings after reopen,
Flash Attention/cache compatibility, migration identity preservation and rollback,
load-only UI state, and stale settings at both main and utility launch boundaries.
The full core suite passed 706 tests in 68 files, and the affected desktop checks
passed 128 tests in 15 files. This supersedes the captured-model-settings behavior
recorded in the 2026-10-16 model-settings validation. It is not a new GPU
correctness or throughput experiment.

Strict type checking, targeted lint, formatting and the core development build
passed. The development app was gracefully stopped and relaunched with the
updated core. The pre-existing staged index was preserved; nothing was committed
or pushed.
