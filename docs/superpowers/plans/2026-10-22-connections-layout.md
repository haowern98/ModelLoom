# Connections Layout Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Apply the user-approved Connections reference layout with Join cluster, Share this PC and Add device tabs.

**Architecture:** Reuse the Settings content column and spacing, existing peer commands, identity verification and shared controls. Present pending incoming requests within Share this PC and move the sidebar count to Connections. No peer protocol, discovery or runtime changes.

**Tech Stack:** Existing React, TypeScript, CSS Modules and Vitest.

**Spec:** The user's three reference screenshots, three Join/Share/Add mockups and explicit control-sizing clarification in this conversation; specs/UI-SPEC.md updated with the resulting behavior.

## Global Constraints

- Work in the existing checkout; preserve staged reference material and unrelated changes.
- No new dependencies, fake production peers, simulated live networking or unimplemented pairing-code input.
- Keep existing fingerprint verification and all approval/sharing error handling.
- Reuse Appearance's 44px page inset, 728px column and 40px heading gap.
- Extract and reuse Model Configuration's exact 32 by 20px toggle, 16px thumb and existing checkbox artwork.
- Implementation was initially uncommitted; the user subsequently authorized local commits only. No push or PR.

## Review Focus

- All three tabs remain keyboard-accessible and preserve the canvas across navigation.
- Sidebar Connections badge reflects only incoming pending requests and disappears at zero.
- Approval still requires explicit identity verification; revocation and sharing commands remain unchanged.
- Live Join remains explicitly unavailable; a layout update cannot imply implemented discovery or OTP pairing.
- Narrow windows and longer device names retain usable controls and readable labels.

### Task 1: Navigation and reference layout

- [x] Add failing regression coverage for Connections tabs, merged requests and the relocated count.
- [x] Verify the new behavior fails before implementation.
- [x] Update ClusterViews, ClusterSidebar and ClusterPage navigation/layout; retain the existing canvas instance.
- [x] Restyle existing live/demo joining content as Settings groups and visible manual connection forms.

### Task 2: Shared controls and working peer actions

- [x] Extract the unchanged model toggle styling to a shared CSS module; consume it in both screens.
- [x] Keep shared checkbox artwork in live and demo GPU selections.
- [x] Cover incoming request verification, sharing enable/stop, approved access revocation and outgoing identity confirmation through the new views.
- [x] Update stale navigation expectations without weakening security assertions.

### Task 3: Verification

- [x] Run focused renderer tests, desktop typecheck, lint, scoped formatting and renderer build.
- [x] Inspect the actual renderer at desktop and narrow widths, including computed toggle/checkbox sizes and Settings heading spacing.
- [x] Update UI-SPEC.md and report exact checks and any remaining limits. The user subsequently authorized focused local commits.
