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

The user chose to retain the existing Phosphor hollow/filled pairs for Cluster, API and Settings. The reference icon paths carry no separate licence declaration in the selected asset records; they are not covered by the Phosphor MIT notice. This change is a local development reference, not release/distribution clearance.

The top rail uses 20px icons in 36px buttons with a uniform 8px gap, giving 44px between centres, including after Home. The gap matches the installed desktop package's rail list (`itemSpacing: rail`, `gap-2`) and CSS (`--spacing: .25rem`) at the default 16px root. The lower Downloads/profile group retains its separate spacing.

ChatGptSidebarIcon.tsx uses static reference paths for the Cluster sidebar: `plus-circle-light-24` (Add device), `square-grid-2x2-light-16` (Overview), `desktop-light-16` (Devices), `wifi-light-16` (Connections), `envelope-light-16` (Requests), and `laptop-connector-light-16` (Your devices). All six render at 16x16 CSS px and stay outlined on selection; the row background indicates selection. The plus retains its original 24x24 viewBox, scaled to 16px; the others retain 16x16 viewBoxes. All six records come from the shared member below. Sidebar layout, text, badges and actions are unchanged.

Source members in app.asar:

The same shared sidebar icon component supplies Settings' `sun-light-16` (Appearance), `pulse-light-20` (Diagnostics), `sliders-light-16` (Advanced), and `magnifying-glass-lg-light-16` (Search). Diagnostics retains its 20x20 viewBox and scales to 16px; the other three retain 16x16 viewBoxes. The user's subsequent choice replaces Runtime, Storage and Network with Phosphor Cpu, Database and Network, rendered at 16px with regular outline weight. SearchField accepts this Settings-specific artwork; other search fields keep their existing icons.

- webview/assets/app-shared-30671c57ec82.js, SHA-256 392b023063a3569a2efc47a019accb2d1e72295b1bfec2cbb81fc37e1515580a
- webview/assets/app-initial-102e45562729.js, SHA-256 c59b2a0be6c13496b30ebda167925cdccab26799cae350c62d2b37afe3589b57
