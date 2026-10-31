# ChatGPT sidebar icon provenance

The shared chat/configuration row uses the original `trash-light-16` paths through
ChatGptTrashIcon.tsx. This record was read statically from the installed
OpenAI.Codex 26.1013.3656.0 package's
`webview/assets/app-shared-2f18b1632f37.js`, SHA-256
`c25c71cb02162edc2f03e8efce83708b00c453323caa5a4212bee5cbe4cdcf90`.
Only the three static path records are included, with their original 16x16
canvas and `currentColor` paint. This uses the same local development asset
scope and distribution limitation as the reference paths below.

Local reference package: OpenAI.Codex 26.1007.9446.0, installed Windows package.

Cluster Run uses the original `play-light-16` SVG (shared symbol `oKi`) through
ChatGptPlayIcon.tsx at its native 16x16 size. Its path was checked against the
installed shared bundle listed below. The circular button, spacing and other
Run/Stop/loading states are unchanged.

The assignment history pill uses original shared 16x16 glyphs through
ChatGptHistoryIcon.tsx: `arrow-left-lg-light-16` (`c4n`) for Undo,
`arrow-right-lg-light-16` (`f4n`) for Redo, and
`arrows-clockwise-rotate-lg-light-16` (`t3n`) for Reset to default.
The faint divider before Reset is CSS, separate from the SVG paths.

ChatGptRailIcon.tsx contains exact static path data, not executable code from the reference bundle. Imported assets are Home outline (home-light-20, shared U9n), Home selected (initial S0o), Books outline (books-light-20, shared G3n), Books selected (initial JAo), and More (ellipsis-horizontal-light-20, shared V5n). All use their original 20x20 canvas. More has no separate filled state in this implementation; it retains the same three dots when its menu opens.

The earlier decision to retain Phosphor hollow/filled pairs for Cluster, API and Settings is superseded by the 2026-10-31 rail revision below. The reference icon paths carry no separate licence declaration in the selected asset records; they are not covered by the Phosphor MIT notice. This change is a local development reference, not release/distribution clearance.

**Rail revision, 2026-10-31:** ChatGptRailIcon.tsx replaces Cluster's Phosphor Network with the exact `circle-grid-2x2-connect-light-24` paths, API's HardDrives with `terminal-light-20`, and Settings' GearSix with `gear-light-20`. Cluster retains its original 24x24 viewBox scaled to a 20px CSS box; API and Settings retain their original 20x20 viewBoxes. All three use the same artwork selected and unselected, inheriting white `#ffffff` when selected and muted grey `#8b8b8b` at rest, with the existing charcoal selected background. No filled variants are fabricated. Home and Books remain unchanged.

These three records were read statically from the installed OpenAI.Codex 26.1023.6621.0 package's `app.asar` member `webview/assets/app-shared-3b88f728481f.js`, SHA-256 `049e002cddcc8b63436e0197d3f061302eafa7e760379b5937e3ea876384ccd7`, with original archive integrity verified. The local development scope and distribution limitations above also apply to these paths.

The top rail uses 20px icons in 36px buttons with a uniform 8px gap, giving 44px between centres, including after Home. The gap matches the installed desktop package's rail list (`itemSpacing: rail`, `gap-2`) and CSS (`--spacing: .25rem`) at the default 16px root. The lower Downloads/profile group retains its separate spacing.

ChatGptSidebarIcon.tsx uses static reference paths for the Cluster sidebar: `plus-circle-light-24` (Add device), `square-grid-2x2-light-16` (Overview), `desktop-light-16` (Devices), `wifi-light-16` (Connections), `envelope-light-16` (Requests), and `laptop-connector-light-16` (Your devices). All six render at 16x16 CSS px and stay outlined on selection; the row background indicates selection. The plus retains its original 24x24 viewBox, scaled to 16px; the others retain 16x16 viewBoxes. All six records come from the shared member below. Sidebar layout, text, badges and actions are unchanged.

**Chat navigation revision, 2026-11-01:** `ChatNavIcon.tsx` uses the exact
`square-and-pencil-light-16`, `magnifying-glass-lg-light-16`, `pin-light-16`,
`pin-slash-light-16`, `archive-light-16`, `ellipsis-horizontal-light-16` and
`C6` section-disclosure SVG from the installed Codex package
`OpenAI.Codex_26.1023.6621.0_x64`. Search renders at 16px; New chat renders the verified 16px compose record; row actions render
at 16px, preserving each original viewBox. The footer archive glyph also renders
at 16px, matching New chat. The section disclosure uses the original 20×21 viewBox at 14×14px with
its 0.6 currentColor stroke; the shared member exports C6 as TN, imported as qo
and rendered by primary rZ. This supersedes the small-chevron asset selection.
All paths inherit currentColor. Original record bodies were read as inert
text from `webview/assets/app-shared-3b88f728481f.js`, SHA-256
`049e002cddcc8b63436e0197d3f061302eafa7e760379b5937e3ea876384ccd7`,
with archive integrity verified. No reference bundle code executes in ModelLoom.
The generation indicator uses a local CSS ring animation rather than importing
Codex's runtime animation implementation. The local-development provenance and
distribution limitations stated above remain applicable.

**Chat search correction, 2026-11-01:** The sidebar search control uses the
original magnifying-glass-lg-light-16 record QKt, wrapped as D6t and exported as
dK (primary import _u). Native GK renders it through SM with iconSize sm; the
sm token is 1rem (16px at the default root) in a 2rem/32px target. This supersedes
the previous 20px Chat search record. Chat search results use the original
chat-bubble-light-16 record from the same verified shared member, at 16px.
Scoped REA search Evidence: ev_5cbaeb1f2cacf097a4c757ff672103ca8a2d02511d612113d9ebfb2247a9f7e0.

**Chat composer expansion, 2026-11-01:** The expansion control uses the original
`arrow-up-right-arrow-down-left-sm-light-20` record tBt and
`arrow-down-left-arrow-up-right-sm-light-20` record dzt. Keep their original
20×20 viewBoxes and currentColor paths, rendered at 20px in 32px targets.
Primary S4r imports shared gH as Bte (I2t wrapping tBt) for Expand and WV as sc
(P2t wrapping dzt) for Collapse. The source is the same verified
`app-shared-3b88f728481f.js` member and SHA-256 recorded above. Only inert SVG
path data is copied; no reference runtime code executes in ModelLoom.
Composer REA parent evidence:
`ev_ad22ed099c058ad3c3e03b56e31429e45822f298bc53f388f1346d15f92f528d`.

Source members in app.asar:

The same shared sidebar icon component supplies Settings' `sun-light-16` (Appearance), `pulse-light-20` (Diagnostics), `sliders-light-16` (Advanced), and `magnifying-glass-lg-light-16` (Search). Diagnostics retains its 20x20 viewBox and scales to 16px; the other three retain 16x16 viewBoxes. The user's subsequent choice replaces Runtime, Storage and Network with Phosphor Cpu, Database and Network, rendered at 16px with regular outline weight. SearchField accepts this Settings-specific artwork; other search fields keep their existing icons.

- webview/assets/app-shared-30671c57ec82.js, SHA-256 392b023063a3569a2efc47a019accb2d1e72295b1bfec2cbb81fc37e1515580a
- webview/assets/app-initial-102e45562729.js, SHA-256 c59b2a0be6c13496b30ebda167925cdccab26799cae350c62d2b37afe3589b57
