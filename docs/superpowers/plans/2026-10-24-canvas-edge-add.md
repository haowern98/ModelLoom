# Canvas edge add implementation plan

**Goal:** Fade in one add button on the nearest device-card edge, add the chosen PC on that side, and show a quiet first-use hint.

**Authorization:** The user approved the image and said PROCEED. No commit, push, remote update or inference run is included. Preserve the pending default-GPU selection work and pre-existing staged research.

**Architecture:** Keep existing picker and canvas membership actions. Track a local UI-only pending anchor and cardinal grid positions; collisions move the new card farther in the chosen direction. Measure card bounds for neutral presentation-only lines. No change to peer/network topology, execution order or layer assignment. Persist only a non-sensitive first-add hint flag in browser local storage, with an in-memory fallback if storage is unavailable.

**Tech stack:** Existing React, CSS, Vitest and Playwright. No dependency additions.

- [x] Add failing card tests for nearest edge, one button, picker pinning and keyboard directions; implement pointer/focus and fade with reduced motion.
- [x] Add failing geometry tests for all four directions, negative positions and occupied cells; implement bounded grid placement.
- [x] Wire pending anchor to the existing picker, membership and collision-free grid. Show only real canvas relationship lines, without fabricated latency/network facts. Remove stale lines when nodes disappear.
- [x] Show muted "Hover near an edge to add a device." beneath a lone node until its first successful addition. Fade on hover/focus; keep dismissed on later visits.
- [x] Test page integration, pointer/zoom geometry, placement lines, loading guards, persisted hint and keyboard access. Run typecheck, scoped lint/format and affected tests; inspect a real browser screenshot.

Existing multi-card demo layout remains unchanged until the user creates a spatial placement. Spatial layouts use uniform card columns and automatic row heights so unequal GPU counts cannot overlap.

## Verification

- Affected Vitest suites: 67 tests passed in eight files, including the pending default-GPU-selection tests. Card, page and geometry regressions were observed failing before their respective fixes.
- Desktop TypeScript check, scoped ESLint, scoped Prettier and whitespace checks passed.
- Browser renderer with approved-peer fixtures: pointer selection on four edges, fade-out before repositioning, keyboard placement in all four directions, reduced-motion behavior, persisted hint dismissal, Fit to view, and repeated right-edge additions were checked. Measured cards did not overlap, and the second line routed around the intervening card. Inspected screenshots are in ignored `packages/core/out/canvas-edge-bottom-preview.png` and `packages/core/out/canvas-edge-repeated-preview.png`.
- Independent review found and verified fixes for edge-switch fading and lines crossing cards. The routing regression includes a taller neighboring card in the source row.
- Validation used renderer fixtures, not a new live PTSS pairing or inference run. No packaged app deployment, commit or push was performed.
