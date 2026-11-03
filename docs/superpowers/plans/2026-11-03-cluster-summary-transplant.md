# Cluster Summary Transplant Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. User authorized implementation with PROCEED; do not commit or push without a separate request.

**Goal:** Transplant the approved summary demo into the desktop app, retaining real runtime data and inline card editing.

**Architecture:** Replace the contextual device/layer inspector with the demo summary composition. Selection is presentation state; only existing explicit configuration and canvas actions mutate the draft. Use a separate animated horizontal camera offset for panel reservation so opening the panel preserves zoom and GPU editor expansion remains anchored.

**Tech Stack:** React/TypeScript, OpenAI Apps SDK UI 0.2.2, Motion 14.9.0, Vitest and Playwright.

**Spec:** User-approved `/summary.html` demo and selection/transition instructions in this chat; record the resulting behavior in `specs/UI-SPEC.md`.

## Global constraints

- Work in E:/ModelLoom-Project on fix/ui-polish, preserving unrelated changes and staged files.
- Match the demo's Segoe UI, 13px regular rows, 300px shell, 20px insets, separators, surfaces, rounding, glyphs, inline disclosure and spring presets.
- No duplicate summary layer editor or speculative enable toggle. Use real configuration context, placement, model identity and loading state.
- Selection highlights the card and assignment row without dispatching edits or runtime actions.
- Preserve edge +/hint, approved inventory, add/remove guards, save/load semantics, rename and device-details navigation.
- Panel toggling repositions cards with the same spring; preserve zoom and editor camera anchoring. Reduced motion is instant.

## Review focus

- Selected versus running model differs: show the loaded model separately.
- Combined MTP plus CPU retrieval, target-linked placement, unavailable GPU and loading locks remain accurate.
- A newly added PC remains unassigned; adding must not move layers or start a model.
- Rapid panel toggles, exit focus/inert state and SDK dropdown portals remain usable.
- Panel height/editor expansion must not recenter the camera; single and multiple-device panel toggles must preserve zoom.

## Tasks

- [x] Write and run failing summary-selection/addition regression tests in `ClusterSummaryIntegration.test.tsx` and canvas zoom tests in `ClusterCanvas.test.tsx`.
- [x] Replace `ClusterPanel.tsx` with the approved summary and dedicated `ClusterPanel.module.css`; retain connection information as an inline auxiliary section and rename via the existing dialog/editor.
- [x] Wire real context, speculative methods, assignment ranges and picker actions in `ClusterPage.tsx`; separate card selection from device-details navigation in `DeviceCard.tsx`.
- [x] Add shared `cluster-motion.ts` presets and Motion dependency; animate panel presence and canvas horizontal offset in `ClusterCanvas.tsx` without modifying camera zoom.
- [x] Update obsolete contextual-panel tests to exercise inline card editing and persistent summary; run focused tests, typecheck, lint, formatting and renderer build.
- [x] Verify demo/app geometry, selection, motion, dropdowns and narrow-screen behavior with Playwright. Record validation and limitations in the UI spec/plan.

## Validation evidence

- Regression tests first failed on the old contextual inspector and panel-triggered re-fit; the implementation passes the new selection, inline picker and zoom checks.
- Cluster feature tests plus related Cluster app tests: 28 files, 189 tests passed. Updated old inspector tests exercise inline Done/Cancel and atomic Undo/Redo, durable Save/Discard, rename, selection and load guards.
- Browser QA uses the actual renderer at 5175 in demo mode and 5176 with an explicit mock runtime/configuration bridge. It does not start a native model. Measured panel width 300px, Segoe UI 13px, headings weight 400 and content inset 20px match the approved demo. Animation frames show intermediate card positions with unchanged zoom; editor expansion preserves the camera transform.
- SDK placement options use 13px Segoe UI and scoped dark tokens through the portal. Combined proposer plus CPU retrieval, stale placements and target-linked heads have focused coverage.
- Motion uses the installed Codex 26.1027.6604.0 artifact evidence retained in `.git/rea-summary-panel-20261103/motion-current/`: opacity/translateX states and spring duration 0.3, bounce 0.01.
- Renderer production build passed; Vite reports a large-chunk advisory. Typecheck and scoped lint are verified separately.
- No GPU generation, native process restart, remote PTSS update, commit or push performed for this task. Browser fixtures are validation data, not shipped telemetry.
- Existing unrelated staged changes were preserved; staged patch SHA-256 is checked before completion.

Final browser verification: both Playwright tests passed, including dropdown-only Escape dismissal, reduced-motion mode and containment at a 900px viewport. The post-review focused run passed all 9 tests. Typecheck and scoped ESLint passed.

## Commit-time verification

- Final summary includes collapsed-by-default Speculative workload and SDK picker button chrome corrections. Browser checks cover the real picker Add/Close actions and the neutral focus ring.
- Fresh typecheck, scoped ESLint and renderer build passed. The broad cluster/app run passed 187 of 189 tests, with two five-second interaction timeouts while build and checks ran concurrently. An isolated rerun of the affected Cluster app file passed all 10 tests without changing deadlines or assertions. The other 27 files passed in the broad run.
- Latest browser validation passed both tests. Older unrelated working-tree changes and the 157 pre-existing staged files remain outside these focused panel commits.
