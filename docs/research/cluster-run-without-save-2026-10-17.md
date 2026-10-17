# Cluster Run without named Save, 2026-10-17

The user's PROCEED authorizes separating Run from Save. Auto-place still only
proposes an allocation. Play on an empty selected-model draft opens the existing
automatic/manual assignment dialog. Automatic choice prepares layers only;
manual choice opens the editor. Clicking the same Play button after preparation
loads the acknowledged draft. Save optionally stores a named configuration.
Existing named configurations, model settings and per-model drafts are preserved.

The renderer sends only the imported model ID and draft key/revision. Main reads
the protected draft, validates complete coverage, performs the existing fresh
resource check and rechecks the draft before preparing the engine. The utility
independently rereads the protected draft and compares the complete capture before
broker launch. Native ownership, model/package checks, physical placement and the
existing memory-warning dialog remain required. No named configuration is created
as a side effect of Run.

Regression coverage includes unsaved manual Run, empty-model assignment choices,
Qwen-to-Bonsai switching with unsaved draft restoration, automatic assignment
without loading, Undo to empty followed by the choice dialog, refusal to prepare
an empty run, late planning results, failed edit acknowledgement,
stale/changed drafts, Stop during the last draft read and forged utility capture.
Active draft matching includes revision, so later edits are not marked as the
loaded allocation. Named Save and clean named-config Run retain their tests.

Before the assignment-choice correction, the full core suite passed 700 tests in
68 files. The full desktop unit/UI suite
passed 267 tests in 39 files; the added final-read Stop regression subsequently
passed with the 27-case cluster-loading file. Type checking, core development
build, renderer build and targeted lint passed. Formatting and the existing staged
index were checked. No commit, push or new GPU inference experiment was performed.

The assignment-choice correction reproduced two failures before the fix: empty
Play skipped the dialog, and run preparation invoked the planner. After the fix,
62 desktop tests passed across 11 files, covering Cluster presentation, durable
draft/history integration, app launch flows, runtime state and memory warnings.
Desktop type checking, renderer build, targeted lint and formatting passed.
This correction changes renderer behavior only; it does not claim a new native
inference or hardware-validation run. The staged index remained unchanged.
