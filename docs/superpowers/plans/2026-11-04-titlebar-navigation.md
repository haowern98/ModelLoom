# Title-bar navigation implementation plan

**Goal:** Add Codex-style Back/Forward controls that revisit specific ModelLoom pages and chats.

**Architecture:** Keep a renderer-only, per-window history of navigation locations. Restore route state without replaying model, assignment or chat-generation actions. Reuse Cluster's existing departure guard. Leave the native runtime, sidebar sizing and assignment Undo/Redo unchanged.

**Reference:** Installed Codex 26.1027.51404, REA navigation evidence under `.git/codex-navigation-20261104/`. Windows application-menu title bar: 36px region, 28px square controls centered vertically, 6px left safe inset plus the native left inset, 6px control gap, 16px arrow asset. The existing ModelLoom native window has no left caption inset. Preserve its 44px workspace offset while placing controls at x=6px/y=4px. Forward mirrors the same arrow.

## Tasks

- [x] Add failing tests for renderer history: distinct entries, duplicate suppression, backward/forward traversal, branch truncation and invalid-entry skipping.
- [x] Add failing app tests for settings categories, chats, device details, model configuration, shortcuts and deferred Cluster departure.
- [x] Implement history in `app/useNavigationHistory.ts`; keep state snapshots limited to navigation identifiers.
- [x] Add `app/TitlebarNavigation.tsx` and CSS; use the existing verified arrow asset, SDK tooltips, disabled semantics and no-drag hit areas. Connect through AppShell.
- [x] Connect App and controlled Cluster/Chat navigation state, retaining standalone component fallbacks and existing guards.
- [x] Run focused Vitest, typecheck, lint, renderer build and Playwright checks for title-bar position, hover stability and navigation behavior. Inspect the rendered result.

No commit, push, native runtime operation or peer update is part of this task.

## Validation

- 48 focused tests passed across history, app navigation, existing model configuration navigation, Chat and Cluster. The final history/navigation rerun passed 8/8.
- Desktop typecheck and scoped ESLint passed. Renderer production build passed with its existing bundle-size warning.
- Playwright verified x=6/y=4 and x=40/y=4, 28px controls, 16px icons, hover stability, shortcut tooltips, keyboard traversal and device-page restoration. A fresh page had no console errors.
- The broader App test file has three pre-existing failures: old CPU text, old dedicated-memory text and the old Models heading. All three were reproduced using a read-only Vite loader of the saved pre-change renderer files.
- No changes were staged or committed. Native/runtime files were not edited.
