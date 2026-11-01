# ModelLoom UI specification

**Status:** Approved screen compositions retained; Windows development local Chat/runtime and later Chat refinements implemented, other production integrations pending
**Updated:** 2026-11-01
**Related:** [product](PRODUCT-SPEC.md), [integration](INTEGRATION-SPEC.md), [security](SECURITY-SPEC.md)

Runtime behavior follows [ADR-0002](decisions/0002-lm-studio-runtime-direction.md): LM Studio GUI/core/runtime direction, accepted grouped llama-server, independent upgrades, ordinary engine-crash isolation, and desktop-owned shutdown. The [runtime process screenshot](references/runtime/README.md) is lifecycle/presentation evidence, not an additional UI-screen design.

**Approved Codex frame revision, 2026-10-31:** The user's PROCEED adopts the
inspected Codex Windows frame dimensions and surface treatment across Chat,
Cluster, Models, API and Settings. Use a 52px icon rail and 238px contextual
navigation panel, preserving the combined 290px sidebar. Keep 20px rail icons,
36px buttons and 8px gaps; the wider rail gives 8px horizontal button insets.
Right and bottom workspace gaps are 4px. Exposed workspace corners use 12px
rounding except the bottom-right corner, which uses 4px. Keep this frame rounding
separate from existing card, dialog and composer radii.

On Windows, use the native Mica backdrop with transparent window chrome and rail.
Contextual navigation uses `rgba(17, 17, 17, 0.65)` over that backdrop, with
transparent ancestors; main content uses opaque `#111111`. Mica is an operating
system material, not a fixed sampled hex colour. Other platforms retain the
existing opaque native window fallback. Preserve the 44px title bar, typography,
page compositions, selection states and controls. This revision supersedes the
earlier 50px rail, 240px contextual panels, solid chrome/sidebar/main backgrounds,
5px outer gaps and 16px outer frame rounding described below. It does not change
the internal card colours or authorize additional icon replacements.

**Approved Settings scrollbar revision, 2026-11-01:** The user's PROCEED adopts
Codex's native Chromium scrollbar treatment for Settings categories and details
only. Use `scrollbar-width: thin`, a transparent track and
`rgba(252, 252, 252, 0.084)` idle thumb colour, changing to
`rgba(252, 252, 252, 0.156)` while the scrolling pane is hovered or active.
Retain Chromium's native thumb hover/press contrast adjustment. Remove Settings'
fixed WebKit scrollbar width, thumb border and 40px top/bottom track margins;
the details scroller spans the pane's full height inside the existing rounded
workspace clipping. Native arrow buttons and end spacing remain Chromium-owned.
Reserve a stable details scrollbar gutter without changing content padding,
independent scrolling or keyboard access to the final controls. Other screens'
scrollbars retain their existing treatment. This supersedes Settings' earlier
10px strip, 6px painted thumb and 40px track-margin rules below.

**Approved app-wide scrollbar revision, 2026-11-01:** The subsequent PROCEED
extends the same native thin scrollbars and idle/hover colours to every scroll
area through shared CSS, including Chat history/transcript/composer, Models and
model configuration, API pages/code/logs, Cluster navigation/model picker/inspector,
dropdowns and overflowing dialogs or multiline fields. Remove all fixed WebKit
scrollbar width, colour, radius and track-margin overrides. Keep each container's
existing scrolling, clipping and overscroll containment. The Cluster inspector
retains its fixed padded frame, stable gutter and centred body content; hovering
the panel padding also brightens its thumb. Its thumb is now visible at idle,
replacing the earlier transparent-idle and `#626262` hover-only treatment. Model
configuration actions remain outside their scroller. This supersedes the
Settings-only scope above and the older scrollbar exceptions below.

**Approved dropdown scrollbar revision, 2026-11-01:** Apply the inspected Codex
standard menu's 4px padding and 16px corners to the Cluster model picker and the
shared configuration dropdowns: Context Overflow, Method, Companion, CPU suffix
retrieval, Execution device, This PC's address and When cache is full. Retain the
shared native thin scrollbar colours and Chromium-owned track ends. Replace the
380px/60vh caps with the available space above or below the trigger, bounded by
the viewport minus 16px, using a 5px trigger gap and 6px collision clearance.
Reposition on resize or surrounding scrolling; keyboard navigation must scroll
the focused option into view. Short lists show no scrollbar unless they overflow.
This does not add scrolling to the Chat composer's model popup.

The reference is the default menu surface in Codex Windows package
`OpenAI.Codex_26.1023.6621.0_x64`, inspected statically with REA. Specialized
Codex picker/fade variants can differ; this revision adopts its standard menu.

**Approved Devices consistency revision, 2026-11-01:** The user approved the
Devices mockup that adopts Connections' card and row treatment. Hardware cards
inherit the shared 16px rounding and 16px horizontal padding; rows inherit the
56px minimum height and 14px vertical padding. Use 14px medium-weight property
labels and muted 13px values, keeping the existing right-aligned value column
and narrow-screen stacking. Use 14px heading-to-card gaps, 36px between hardware
sections and 24px between the device identity and its first section. Keep device
names, role badges, reported hardware facts, unavailable states, navigation and
the existing content column unchanged. This supersedes the older compact
Devices row sizing and 12px hardware-card rounding.

**Approved Chat navigation revision, 2026-11-01:** Use the inspected Codex
navigation treatment with a Chat header and search action, followed by a separate
New chat row. No notification button or Projects controls are included. Pinned
chats appear first; unpinned chats retain Today when needed, Yesterday and Older
groups. Section buttons reveal a chevron on hover or keyboard focus and toggle
their group's contents. Use Codex's traced C6 disclosure SVG (20×21 viewBox),
rendered at 14×14px with its original 0.6 currentColor stroke. Expanded groups
reveal it on hover/focus; collapsed groups retain the visible, right-facing
chevron. Keep the 238px contextual panel, native history scrollbar
and a fixed Archived chats entry outside the history scroller.

Use the packaged Codex compose, search, pin/unpin, archive, ellipsis and chevron
artwork. The user's subsequent correction matches Configurations typography:
14px regular (400) chat titles and 14px semibold (600) section headings. The
subsequent spacing correction also adopts Cluster's 18px/500 title with a
14px top and 18px left inset, 6px outer row insets, 6px vertical/12px horizontal
row padding, 18px row line height and 18px following-section margins. Section
heading padding is 0px top, 12px horizontally and 6px bottom. The title, section
headings and chat names share the same 18px left text inset. New chat and the
fixed archive footer use the same horizontal insets and 14px text. The subsequent
REA-verified New chat correction uses the original 16px compose artwork in a
30px row with 14px text and 5px vertical padding, retaining Cluster alignment.
The New chat wrapper has 14.5px top padding so its text bounds begin exactly
24px below the Chat title text bounds in the shared system-font layout. Chat rows
retain 30px minimum height, 10px selection rounding and a 16px title fade. Hover or focus reveals ellipsis,
pin/unpin and archive controls. The ellipsis menu contains only Pin/Unpin,
Archive and Delete chat; archived rows substitute Unarchive. Deletion retains
the existing confirmation and safe cancellation. Archived chats remain readable
and restorable through the footer entry. Pin/archive actions never cancel a
response or change the globally active model.

The subsequent chat-title hover correction starts movement immediately when the
pointer enters any part of the row, including its padding and action area.
Keyboard focus within the row also reveals overflowing titles. Use a linear
out-and-back animation with no initial hold or delay and half the shared line
duration (minimum two seconds per leg, reaching 60 CSS px/s for longer titles).
Leaving the row resets the text; short titles stay still and reduced motion
disables animation. The subsequent Configurations correction applies the same
timing and whole-row hover trigger to saved configuration names in Cluster.

Real chat pin/archive flags are stored in protected history schema 6 through
validated boolean commands and survive restart. Renderer-only demo flags survive
page navigation in the existing app state. Row spinners reflect active
conversation summaries and pending Send preparation, including background chats;
leaving Chat does not stop polling or reset generation. Completion, cancellation
and failure remove the spinner. Hover actions temporarily replace its visible
slot without changing generation state. This supersedes the older direct-delete
Chat row controls and combined New chat/search header.

**Approved Chat Markdown rendering, 2026-11-01:** Render assistant answers and
expanded thinking as safe Markdown with headings, emphasis, nested lists,
blockquotes, inline/fenced code, task lists, links and tables. Keep user prompts
literal. Fenced code has a language label, syntax highlighting for supported
languages, explicit Copy code feedback and contained horizontal scrolling;
unknown languages remain readable plain code. Tables scroll independently at
narrow window sizes. Reparse streamed content as it grows, including open code
fences, without changing the stored answer or raw Copy response contents.

Use pinned react-markdown, remark-gfm and rehype-highlight dependencies. HTML
stays escaped text, not active elements. Do not enable raw HTML, executable
previews, remote images, scripts or new Electron permissions. Only absolute
HTTP/HTTPS URLs without credentials become links, with noopener/noreferrer;
existing desktop navigation restrictions remain in force. Images display their
alt text without fetching resources. This milestone does not add math, diagram
execution, attachments or external-link IPC.

The user's correction hides only the successful Complete status and removes
only the brain glyph beside thinking. Keep the thinking label, duration,
chevron and expansion. All other statuses, including Stopped and errors, retain
their existing text and behavior. The complete response action footer (Copy,
Retry, generation speed, prompt processing speed and acceptance rate), its
icons, styling, handlers and positions relative to one another stay unchanged.
This supersedes section 6's earlier plain-text-rendering milestone only.

**Approved Chat search popup, 2026-11-01:** Replace the inline Chat sidebar
search field completely. The header search button uses the original Codex
magnifying-glass-lg-light-16 artwork at 16×16px in its existing 32px target.
Clicking it opens a native modal with an autofocused Search chats input and
one Chats results section. Omit the All/Actions/Chats tabs, Tab hint, Quick
actions, New chat/Open folder commands and project labels.

Use the inspected command-menu proportions: up to 768px wide, capped at 92vw,
16px corners, a surface at 65% opacity and 24px backdrop blur. The adapted header
and list occupy up to 504px total, capped at 90vh. Results use original 16px
chat-bubble artwork, neutral selection highlights and contained vertical
scrolling. Show recent saved chats for an empty query; filter titles and saved
message text, including archived conversations, when typing. Search results
never filter the sidebar or alter drafts, selection or generation until opened.
Opening an archived result also reveals its archived sidebar group.

Arrow keys/Home/End select results; Enter opens the selected chat and dismisses
the modal. Escape or an outside click cancels. Keep Tab focus inside the modal,
restore focus to the search trigger on dismissal and clear the saved-message
search query when closing. Retain the current stored-message search
implementation and its debounced updates. No new IPC or model operation is added.

**Approved Chat composer revision, 2026-11-01:** Replace the fixed-height message
field with content-based sizing: grow and shrink with typed, pasted or restored
drafts, starting at 44px and scrolling internally after 25dvh. Keep a 20px line
height, the existing 14px message font, 24px composer corners, 10px top/side and
8px bottom surface padding, 18px total input inset and a 4px input/footer gap.
Remove the inner textarea focus outline; indicate keyboard focus on the outer
composer border. Keep the existing model selector, attachments and Send/Stop
controls, stored drafts, generation state and protected response footer.

Offer Expand/Collapse for drafts with a newline or at least five lines of
content. Use Codex's original 20px paired-arrow artwork in a 32px target at the
input's upper-right, with text clearance. Expanded mode occupies available
conversation space, bounded by the viewport minus the 44px title bar and 128px
clearance; retain internal scrolling and reachable bottom controls. Collapse
returns to content-based sizing. Both actions retain the draft, selection and
editor focus. A different conversation starts compact. Enter sends normally;
in expanded mode Enter inserts a line and Ctrl/Cmd+Enter sends, retaining Shift
and IME safeguards. Respect reduced motion.

Reference: static REA inspection of the installed Codex Windows
`OpenAI.Codex_26.1023.6621.0_x64` composer functions A1n, T1n, x4r and S4r.
Scoped parent evidence:
`ev_ad22ed099c058ad3c3e03b56e31429e45822f298bc53f388f1346d15f92f528d`.
This establishes packaged implementation details, not live pixel parity or
feature availability in every Codex configuration. ModelLoom uses Chromium's
native textarea content sizing to reproduce that behavior.

**Cluster configuration implementation, 2026-10-16:** Auto place produces a
reviewable draft using fresh resources and the verified stock estimator, preferring
one GPU before both GPU orders and centre-out cuts. Save retains named intent;
Run captures that saved revision and checks applicability before interrupting an
active model. Dirty or changed revisions fail preparation. Selection and Save do
not change the active session. GPU bars show verified active ranges after complete
stock startup checks. Stop/Cancel stay reachable and Quit joins owned estimator
cleanup. This applies only to the exact Bonsai 64-block b11306 Windows development
profile (context 7680 per slot, four slots, q8 KV, fixed default batches and one/two
local NVIDIA GPUs). Preserve existing layout and controls. Broader production,
remote and platform acceptance remain open.

## Current UI baseline, 2026-10-05

**Reconciled current state, 2026-10-10:** This heading retains the original
baseline anchor. Its renderer-only table and unavailable-Send descriptions below
record the October 5-6 milestone, superseded for the explicit development build
by ADR-0005 and sections 10-12. Models import and Cluster load/Stop now connect
the exact approved local runtime; Chat has durable startup history, Send/Stop/
Retry, thinking, saved metrics/duration and confirmed deletion. The user removed
thumbs-up/down. API and joining remain previews; Settings integration, attachments,
downloads and worker networking remain unavailable. Startup still opens Models.
See [current scope/evidence](../docs/local-generation.md). Earlier typography,
layout and reference constraints continue to apply unless explicitly revised.

The user asked to reconcile the specifications with the completed UI work and explicitly prohibited further UI changes. Preserve the current renderer layout, fonts, spacing, padding, colours, icons, control placement and navigation. This reconciliation changes documents only. Any later UI change requires separate explicit authorization; unresolved integration decisions do not authorize a redesign.

The historical renderer baseline below superseded conflicting descriptions in the original screenshots and earlier revision notes for that milestone. It does not report current development integration or completion of the five-screen product. The subsequent 2026-10-06 PROCEED added the Settings UI preview described in section 8; later Chat/runtime approvals are summarized above.

| Area                | Current presentation and working local behaviour                                                                                                                                                                                                                 | Integration still pending                                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell/navigation    | 44px title bar, 50px rail, 16px workspace radius; Demo data label and no bottom status bar. Order: Home opening Chat, Cluster, Models, API, Settings, More. API uses Phosphor HardDrives; More contains Chat only. Startup opens Models.                         | Storage/Metrics destinations, production Settings behaviour, supported-platform release acceptance.                                                        |
| Models              | Single compact Name/Last used list; search, sample details, confirmed demo-entry removal and gear navigation. Retain the identifier and size/GGUF/quantization pills. Unknown last use is —. Header retains upload and compass.                                  | Actual import/catalogue/download, parsed metadata/compatibility and recorded use. No two-column layout or Downloaded/Imported/Browse tabs are implemented. |
| Model configuration | Six sections in a centred 800px column; per-model pending edits and saved defaults, validation, reset and Back to Models. Set in Cluster navigates; speculative decoding remains disabled Off.                                                                   | Durable defaults, actual hardware limits/optimization and runtime application.                                                                             |
| Cluster             | Reference device canvas, pan/zoom/fit, contextual floating panel, model/placement planning, validated simulated Run/Stop/restart/cancel, renaming, and session-only connection/request/sharing previews.                                                         | Real devices, discovery/enrollment/approval, model loading, memory preflight, optimization and inference.                                                  |
| Chat                | Rounded outer workspace, intermediate charcoal history sidebar and fine straight divider; history/search, New chat, per-chat drafts, copy and local feedback. No branding/right artifact panel/top-right toolbar. Send and attachments are unavailable.          | Sending/generation/cancellation, persistent history, safe Markdown and attachment capabilities.                                                            |
| API                 | Centred Server, Access, Integration and Server logs cards; example tabs/copy and Choose in Cluster. Stopped state, example endpoint, required-key label, unknown metrics and empty logs.                                                                         | Server lifecycle, binding/exposure, credentials, live metrics/logs and finalized API contract.                                                             |
| Settings            | 240px category panel, search and session-retained category selection; centred 728px Appearance and Runtime previews, disabled settings controls and an empty runtime-inventory dialog. Network links to API. Other categories explain their pending integration. | App-wide appearance, persistence, runtime inventory/install/update/select, storage/network/diagnostic operations and remaining category layouts.           |

Stateful demo data lives in renderer memory. Shared library/model selection, placement, configuration edits, conversation drafts/feedback and joining previews survive applicable screen navigation and reset on reload/full restart. Local page state such as search or selected example tab is not promised to survive navigation. Demo mode does not establish real serving or persistence; non-demo builds do not seed the sample model library or conversations.

The shared main-page title is 24px; Settings-style section headings are 14px medium; other section/conversation headings are 16px; library model names, device names, messages and body text are 14px; controls/search/descriptions are 13px; metadata/group/status labels are 12px. Rail icons are 20px with 1.75 strokes in 36px buttons. Search, Models header actions and Cluster launch/hamburger icons are 16px in 32px controls. Library row ellipsis/gear remain the approved 18px exception. The Models title and Name label share the left edge; the Models and Cluster header rows have 10px top padding and their left heading groups have the approved 20px inset. Each right toolbar stays vertically centred with its title. Moving the left Cluster group did not shift the right search/Add/hamburger group horizontally. Only Models Import has a 2px right visual offset; search and compass remain anchored.

Model configuration and API use the same 800px centred column, shared fonts, section/card spacing and outer-scrollbar 40px top/bottom track margins. Chat uses its independently scrolling history/messages. Detailed screen rules below retain all scoped exceptions.

Source anchors: [shell](../apps/desktop/src/renderer/app/AppShell.tsx), [shared tokens](../apps/desktop/src/renderer/styles/global.css), [shared state/routing](../apps/desktop/src/renderer/app/App.tsx), [Models](../apps/desktop/src/renderer/features/models/ModelsPage.tsx), [configuration](../apps/desktop/src/renderer/features/models/ModelConfigurationPage.tsx), [Cluster](../apps/desktop/src/renderer/features/cluster/ClusterPage.tsx), [Chat](../apps/desktop/src/renderer/features/chat/ChatPage.tsx), and [API](../apps/desktop/src/renderer/features/api/ApiPage.tsx). Prior local test evidence and its limits are recorded in [TESTING-SPEC section 10](TESTING-SPEC.md#10-current-evidence).

## 1. Visual source of truth

The user requires the app to match the five supplied ModelLoom screens, subject to the explicit revisions below. The unchanged images are preserved under [references/ui](references/ui/README.md). Match the approved layout, spacing, proportions, icons, cards, and controls; do not substitute a generic dashboard or redesign the composition. Font sizes follow the ChatGPT reference by text role in section 2.1. The neutral dark colour template in section 2.2 supersedes the original screenshots' general blue-action styling.

| Screen   | Reference                                  | Comparison image size |
| -------- | ------------------------------------------ | --------------------- |
| Models   | [models.png](references/ui/models.png)     | 1280 x 720            |
| Cluster  | [cluster.png](references/ui/cluster.png)   | 1280 x 720            |
| Chat     | [chat.png](references/ui/chat.png)         | 1280 x 720            |
| Settings | [settings.png](references/ui/settings.png) | 1280 x 720            |
| API      | [api.png](references/ui/api.png)           | 1672 x 941            |

These are image dimensions, not assumed CSS viewport sizes. Capture equivalent frame/content bounds and record OS scaling/device pixel ratio during implementation comparison. Resolve exact font/icon/logo assets and any measurable visual tolerance under D08. The images are required design references, not proof of asset licensing or evidence of runtime capability.

The user's supplementary [panel-layering.png](references/ui/panel-layering.png) clarifies the aesthetic: where there is a sidebar and right-hand content panel, the right-hand panel is **darker**, reads as a **foreground surface above the sidebar**, and has **rounded exposed corners**, especially the visible top-left boundary. 'Above' describes visual stacking, not moving the panel upward on the page. Keep separation subtle; do not add a heavy border or pronounced shadow absent from the references.

The user's later comparison makes the ChatGPT app the proportion reference for the outer title bar and left icon rail. Use a taller title bar and narrower rail than the initial ModelLoom demo, preserving the supplied ModelLoom screen contents and panel layering. The current visual-review dimensions are a 44px title bar, matching native window-control overlay, a 50px rail, and centered 36px rail buttons. These are CSS dimensions derived approximately from the scaled reference; compare captures at matching OS scaling before claiming an exact visual match.

**Rail revision, 2026-10-15:** Remove the disabled Storage and Metrics buttons and their icons. The remaining top rail order is Home/Chat, Cluster, Models, API, Settings and More, with existing sizes and spacing retained.

**Rail simplification, 2026-10-18:** Remove the Downloads, WW profile and More buttons, including the More menu. Keep Home/Chat, Cluster, Models and API at their existing top positions. Move Settings to the former WW profile centre at the bottom, retaining its 20px icon, 36px button, selection state and keyboard focus. Other shell geometry and screen content stay unchanged. This supersedes the lower controls and More behavior described in earlier rail revisions.

**Rail icon and spacing revision, 2026-10-15:** Home and Models use the installed OpenAI desktop package's actual hollow/filled Home and Books paths; More uses its three-dot artwork in both closed and open states. The user chose to retain the existing Phosphor Network, HardDrives and GearSix hollow/filled pairs for Cluster, API and Settings. Selected destinations use filled artwork in white; unselected destinations use hollow artwork in muted grey. Retain 20px icon boxes, 36px buttons, the charcoal selected/open background and visible keyboard focus. Use a uniform 8px gap between the top buttons with no extra margin after Home, giving 44px between centres. This matches the packaged desktop rail's `gap-2`, `.25rem` spacing token and `2.25rem` buttons at the default 16px root. See [asset provenance](../docs/CHATGPT-ICONS.md). This supersedes earlier glyph, stroke and spacing rules for the top rail only; the lower download/profile controls and overflow-menu entry remain unchanged.

**Rail icon revision, 2026-10-31:** Replace Cluster's Phosphor Network with the installed Codex `circle-grid-2x2-connect-light-24`, API's HardDrives with `terminal-light-20`, and Settings' GearSix with `gear-light-20`, using their exact static paths through ChatGptRailIcon.tsx. Cluster retains its original 24x24 viewBox scaled to 20px CSS; API and Settings retain their original 20x20 viewBoxes. All three retain the same artwork selected and unselected, inheriting white `#ffffff` when selected and muted grey `#8b8b8b` at rest; retain the charcoal selected background, existing buttons, spacing and keyboard focus. Do not fabricate filled variants. This supersedes the earlier Phosphor glyph and hollow/filled rules for these three rail destinations only. Home and Books artwork remain unchanged. See [asset provenance and distribution limitations](../docs/CHATGPT-ICONS.md).

The user's subsequent sidebar revision standardizes the main navigation icons (Home, Cluster, Models, API, Storage, Metrics, Settings and overflow) to **20px CSS boxes with 1.75 strokes**, preserving their existing glyphs, positions, 36px button areas and 11px corner radius. Unselected navigation buttons are transparent with muted `#8b8b8b` icons; enabled hover and selected/open controls use rounded `#2f2f2f` shading and white `#ffffff` icons. Selected navigation has no blue border, tinted surface or glow. Keyboard focus remains distinct through a neutral `#ababab` outline and does not select a destination. Home now opens Chat and uses the same hover/selected rules as the other enabled destinations. Keep unavailable controls disabled with their existing accessible explanation and muted treatment; this styling revision does not enable unfinished destinations. Overflow uses a neutral `#262626` menu with a subtle `#383838` border and contains Chat only; API is a direct rail destination. The separate bottom download/profile controls and 16px overflow-menu glyphs retain their existing sizes and treatments. These are approved ModelLoom review targets, not measured ChatGPT computed styles or a claim of exact screenshot parity.

The user's subsequent header revision removes the separate ModelLoom logo/name row and the Models subtitle. Align the Models heading, search and header actions in one centered row at supported desktop sizes. The 2026-10-04 revision below removes the view toggle and replaces the text actions with Import GGUF and Explore models icons. These explicit revisions supersede the original reference header.

The user's 2026-10-03 revision removes the shared bottom status bar across the app because it is cluttered. Content uses the freed height. Keep the existing demo disclosure as a small, plain label in the title bar; do not introduce another status row. The 2026-10-05 API navigation revision places API directly after Models in the sidebar and removes its overflow entry. This supersedes the footer composition and its former demo-label placement in the references.

The user's 2026-10-05 scrollbar correction uses the supplied top/bottom crops as a spacing reference: keep the main workspace's vertical scroll track generously clear of both rounded corners, including when scrolled to either end. Use 40px track margins at the top and bottom, with a 6px visible neutral thumb inside a 10px strip and 2px transparent side clearance. Preserve the full content viewport, scrolling, heading placement and reachable final controls; do not add blank content bands or a pinned header. Scope this styling to the outer workspace's main scroller, preserving the independently inset Cluster panel and other inner scroll areas. These CSS targets approximate the screenshot margins and do not claim exact reference-app measurements.

The authorized desktop demo implements the shared shell, Models library, per-model configuration and Cluster planning/launch flows with a visible **Demo data** indicator. Search, details and confirmed demo-entry removal operate locally in Models; simulated model switching and stopping live in Cluster. Import/catalogue controls explain their unavailable integration. Configuration stores defaults for the current app session only and has no engine effects. Chat and API now have renderer-only presentation under the approved revisions below; Settings now has the separately authorized renderer-only preview. No file transfer or inference is presented as a real operation. Exact font/logo assets, unfinished behavior and visual acceptance still need review; a passing screenshot capture is not a claim of pixel identity.

## 2. Shared visual and interaction rules

- U01 (P7, P9): Preserve the narrow navigation rail, approved title bar, main content composition, dark surfaces, and restrained borders. Apply section 2.2's white, charcoal, transparent, and explicitly scoped blue treatments consistently across screens. Apply the user's bottom-bar removal across all screens so the content uses the freed height.
- U02 (P9): Use shared components/tokens for buttons, search fields, cards, menus, badges, inputs, panels, spacing, typography, and icons. Derive font sizes from the ChatGPT reference for the corresponding text role; use the approved visual references and assets for other properties. Do not invent exact font names, radii, or pixel values and call them approved.
- U03 (P7): Every actionable element has an accessible name, keyboard operation, visible focus, and a clear disabled/busy/error meaning. Status uses readable text/icon meaning in addition to color. Hover-only controls must also work by keyboard.
- U04 (P4, P6, P9): Data is real in normal operation. Show unknown/stale/unavailable explicitly; sample metrics, names, model layer ranges, and chat text are fixture content only. A hidden optional status display cannot suppress critical errors.
- U05 (P7, P9): Define empty, loading, success, interrupted, disconnected, and failed states in the same visual language. Recovery appears near the affected action with a concise reason and next action; detailed logs are secondary.
- U06 (P7): No mandatory onboarding wizard or tour. Make add-device, choose-model, start, chat, API access, and runtime controls discoverable in context. Technical explanations remain short and useful.

Window controls must remain operable with the correct platform behavior. The target dark references are the visual acceptance baseline. Light/system appearance options shown in Settings require reviewed theme behavior/assets; no light reference has been supplied. Define smaller-window behavior, scaling, minimum sizes, and overflow under D08 before claiming acceptance there. Preserve readability rather than shrink controls into unusable targets.

### 2.1. Font sizes by text role

**Settings-style typography revision, 2026-10-15:** Section headings and row labels use 14px at medium weight 500 across Settings, Cluster Devices/Connections/Requests, Model configuration and API. This includes device-name headings, Runtime selection, Runtime packs and GGUF. Use the shared `--font-size-section-heading` token for these section headings; row labels retain their existing 14px card-title token. Main page titles remain 24px. Sidebar category labels, descriptions, canvas cards and dialogs retain their existing roles. This supersedes the earlier 16px section-heading values for the listed pages only.

**Approved revision, 2026-10-03:** Use the installed ChatGPT/Codex Windows app's default typography and corresponding control sizes. This supersedes the earlier values chosen visually. Shared tokens now cover Models, configuration, Cluster, Chat, API, menus, dialogs, the demo label and the Settings preview. Preserve the ModelLoom composition except for separately approved shell/header revisions.

| ModelLoom text role                                     | CSS font size | Reference role and application                                                                                       |
| ------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------- |
| Main page headings                                      | **24px**      | Compact Library-style heading; weight 500, line height 1.2, inherited letter spacing                                 |
| Settings-style section headings and row labels          | **14px**      | Weight 500 in Settings, Devices, Connections, Requests, Model configuration and API; section-heading token           |
| Other section/conversation headings                     | **16px**      | Retain existing role outside the approved Settings-style pages; weight 500                                           |
| Dialog headings                                         | **18px**      | Desktop dialog heading; weight 500; separate from section headings                                                   |
| Model names, device names, and card titles              | **14px**      | Standard plugin-card title role; weight 500; same size for active and inactive models                                |
| Chat messages                                           | **14px**      | Implemented message/composer role; production content rendering remains pending                                      |
| Dialog body and explanatory text                        | **14px**      | Base body copy; weight 400                                                                                           |
| Supporting card descriptions                            | **13px**      | Plugin-description role; weight 400, line height 1.625                                                               |
| Buttons, menu options, and search/input text            | **13px**      | Desktop New/Add and toolbar search roles; weight 400; button line height 18px and search line height 20px            |
| Metadata labels and values                              | **12px**      | Compact model/device metadata; distinguish label and value through approved weight/color rather than different sizes |
| Secondary labels, status labels, badges, and timestamps | **12px**      | Compact supporting and status text, including the demo indicator                                                     |

Define these values in one shared typography scale and reuse the corresponding role across screens, menus, dialogs, and states. Match roles instead of flattening the hierarchy. Use normal/medium weights 400/500; metadata values may use 500 while labels use 400. Retain the platform-native system font stack, which selects Segoe UI on Windows. OpenAI Sans is bundled in the reference app but is not its default UI font; do not add it solely on that evidence.

Use **28px** text-action buttons with 8px horizontal padding, **32px** icon buttons/search fields, and **16px** control icons. The active card may retain 12px action padding. Dialog confirmation buttons use **36px** height and weight 500. Browse tabs use **13px** medium text and **36px** height when implemented. Keep visible focus and keyboard interaction; do not shrink the already-approved navigation rail buttons.

Reference evidence: read-only inspection of Windows package `OpenAI.Codex_26.930.2377.0_x64`, including `app-shared-ac32c0d1413b.js`, `app-initial-1da99842592d.js`, `app-shared-6fb15e58cd7f.css`, `library-browse-layout-94ac49f79b44.js`, and the plugin/card modules. The preference definition defaults to a 14px base; the desktop applies 13px small text and 12px captions. Library/New and Plugins/Add use the legacy toolbar button, whose desktop height is 28px; the different shared header-button component is 32px. Do not conflate these components or substitute the browser typography scale.

These are source-verified defaults, not a claim that the live reference app's font preferences, computed styles, or zoom have been measured. The computer-use skill prohibits automating the ChatGPT desktop UI; no live reference inspection was performed. Record OS scaling, device-pixel ratio, app zoom, and any image resizing in comparisons. Screenshot pixels are not CSS pixels. Smaller desktop widths still reflow list metadata, and role sizes do not shrink at breakpoints. Exact screenshot parity remains unverified until both applications can be compared with their active font and scaling settings established.

### 2.2. Neutral dark colour template

**Settings sidebar icon revision, 2026-10-15:** Use the reference sun, pulse,
sliders and magnifying-glass artwork for Appearance, Diagnostics, Advanced and
Search. Use Phosphor Cpu, Database and Network in regular outline weight for
Runtime, Storage and Network, as explicitly selected by the user. Render all
seven at 16px and keep the existing outlined selection treatment, row shading,
spacing, labels, search filtering and category navigation. Scope the search
artwork override to Settings. See [asset provenance](../docs/CHATGPT-ICONS.md).

**Design revision, 2026-10-03:** Follow the user's ChatGPT/Codex references: neutral charcoal surfaces, white text, muted grey icons, rounded controls, and fewer blue buttons. This replaces the former rule that primary actions and selected navigation are generally blue. It changes presentation, not screen composition, action placement, device-card contents, or behaviour. The neutral treatments have been implemented in the shared navigation and current Models, configuration, Cluster, Chat and API surfaces through subsequent authorized revisions. Screen-specific overrides and exceptions below are part of the fixed baseline; the Settings preview and legacy base tokens do not establish a completed theme system. No additional implementation is authorized by this reconciliation.

#### Surface and text palette

Use shared semantic tokens. The values below are ModelLoom's dark-theme targets for visual review, not a claim that every ChatGPT component has these exact computed colours. The main reference background was sampled as `#181818`, and the user's hamburger reference as `#8b8b8b`; other neutral values define a consistent ModelLoom template. Existing status colours remain semantic accents.

| Role                                             | Target colour             | Use                                                                              |
| ------------------------------------------------ | ------------------------- | -------------------------------------------------------------------------------- |
| Window chrome and navigation/sidebar surface     | `#212121`                 | Neutral surrounding shell and sidebars                                           |
| Main content and Cluster canvas                  | `#181818`                 | Darker foreground content beside the sidebar                                     |
| Cluster device cards                             | `#1f1f1f`                 | Cluster card separation; Models uses flat rows with #212121 hover/focus shading  |
| Nested tiles, menus, dialogs, and floating panel | `#262626`                 | Raised surfaces; the Cluster overlay sits above its canvas without reflow        |
| Search/input surface                             | `#1a1a1a`                 | Quiet field with a subtle outline                                                |
| Charcoal utility button                          | `#303030`                 | Secondary actions with white text                                                |
| Hover/selected shading for transparent controls  | `#2f2f2f`                 | Rounded background for navigation, view controls, and panel toggles              |
| Subtle border                                    | `#383838`                 | Inputs, cards, and panels; avoid heavy outlines                                  |
| Main text                                        | `#f3f3f3`                 | Headings, labels, values, and enabled control text                               |
| Supporting text                                  | `#ababab`                 | Metadata, descriptions, and placeholders                                         |
| Muted toolbar icon                               | `#8b8b8b`                 | Unselected utility icons, including the hamburger                                |
| White action surface / hover                     | `#ffffff` / `#e5e5e5`     | Prominent neutral action; dark text `#181818`                                    |
| Blue graphic accent                              | Existing `#087dff` family | Dotted connections retain blue variants; current allocation bars use white fills |
| Link and keyboard-focus accent                   | `#78baff`                 | Readable links and visible focus on dark surfaces                                |
| Success/readiness                                | Existing `#26e0a0`        | Status text/icon, with readable status wording                                   |

Keep the darker right-hand content surface above its sidebar as described in section 1. The lighter inset Cluster overlay is a separate floating surface, not a replacement for that sidebar/content relationship. Rounded corners and subtle separation communicate stacking; do not add a strong glow or flatten every surface to the same grey. Search and text-action controls use pill shapes; icon controls use circular or rounded shading. Preserve the typography and control heights in section 2.1 and the explicit Cluster toolbar exceptions.

The user's 2026-10-04 correction explicitly matches the Models foreground background to the Cluster foreground and canvas at `#181818`. Apply this colour to the complete Models workspace, including the exposed rounded-corner area and padding around its content. Window chrome remains `#212121`; card, tile and control surfaces retain their separate roles.

#### Choosing a control treatment

Colour treatment and interaction state are separate decisions. A selected control is not automatically a primary action, and a blue element does not automatically mean the most important action.

| Treatment                                | When to use it                                                       | ModelLoom application                                                                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| White fill, dark text                    | Prominent action that advances or confirms the current task          | Add device; the main confirmation action in a dialog                                                                                   |
| Charcoal fill, white text                | Supporting utility action                                            | Supporting placement-choice actions; secondary dialog actions                                                                          |
| Transparent background, muted icon       | Quiet toolbar or navigation control                                  | Hamburger while closed, unselected view controls, filters, and overflow menus                                                          |
| Charcoal shading for selected/open state | Show the current destination, view, tab, or open panel               | Selected navigation/view controls; hamburger while its panel is open                                                                   |
| Subtle outline or quiet surface          | Selectable content or a field that should not compete with an action | Search fields, cards, and suggestions                                                                                                  |
| Blue accent                              | An explicitly identified graphic, link, or focus affordance          | Dotted connections, links and keyboard focus; current allocation bars use white fills and hardware retains the scoped In use indicator |
| Semantic status/error colour             | Communicate readiness, warning, failure, or destructive intent       | Retain green/amber/red meanings and accompany them with text or icons; never reuse blue to imply success                               |

Use one prominent white action per local task group where possible. Two independent groups may each have a white action; this is not a one-button limit for the whole screen. Do not make every clickable element white. Models uses utility icons; launch controls live in Cluster under the approved revisions below. New feature-specific blue buttons require an explicit documented purpose; blue Voice or download controls in the reference app do not authorize equivalent features or a general blue-button rule in ModelLoom.

#### Interaction states

- **Default:** White actions and charcoal utilities retain their assigned fill. Unselected icon controls are transparent. The hamburger's strokes remain `#8b8b8b`.
- **Hover:** White fills become `#e5e5e5`; charcoal utilities may lighten subtly. Transparent controls gain rounded `#2f2f2f` shading. Hover does not change selection or open a panel by itself.
- **Selected/open:** Navigation, tabs, view controls, and panel toggles retain charcoal shading while active. Use an accessible selected/pressed/expanded state; never rely on background colour alone. Opening the Cluster panel does not turn its hamburger into a white or blue action.
- **Pressed:** Give brief tonal feedback within the existing treatment; do not change the action's semantic role.
- **Disabled:** Use a visibly muted surface, label, and icon; an unavailable action must not retain the visual emphasis of an enabled white action. Keep its reason discoverable and its disabled meaning accessible. Run is unavailable without a selected model and available demo devices. Invalid placement is checked on Run or Apply and restart and blocks loading with an error toast.
- **Busy/error:** Retain the action's identity, show readable progress or a nearby error, and preserve existing cancellation/recovery behaviour. Do not communicate state through a colour change alone.
- **Keyboard focus:** Keep a distinct visible outline on buttons, inputs, and other controls, including transparent icons. The user's sidebar revision uses a neutral `#ababab` outline for navigation controls, separate from their charcoal selected state. The user's canvas-specific revision below removes the canvas outline in every state while retaining keyboard pan/zoom. Blue focus on other controls is separate from selection and button fill. Check contrast on each actual surface during implementation; these target values are not accessibility test evidence.

#### Reference evidence and limits

Read-only inspection of Windows package `OpenAI.Codex_26.930.2377.0_x64` found separate colour, variant, and selected/open choices in the shared button components. Library New uses a primary pill; Library view controls use secondary ghost buttons with a separate selected state. `thread-panel-toggle-button-1bfd1ce54bd4.js` switches its standard toggle from ghost while closed to secondary while pressed. Utility surfaces such as View source use a separate control-surface component. This explains why white, shaded charcoal, and transparent controls coexist; it is not a universal colour rule across every ChatGPT version or component.

The user's screenshots also show blue links, Voice, and a download/update control. OpenAI's [appearance documentation](https://help.openai.com/en/articles/11958281-updating-your-visual-experience-on-chatgpt) confirms that accent settings affect some elements while others keep their own colours, with differences by platform and version. ModelLoom therefore defines blue's uses explicitly above rather than copying every blue reference element. Light/system theme palettes and user-selectable accent mappings remain subject to their existing review; this revision defines the neutral dark baseline only.

### 2.3 Floating notification toasts

**Design revision, 2026-10-03:** Replace transient full-width notification banners with compact floating toasts, following the user's supplied green Copied conversation as Markdown reference. This defines ModelLoom's notification treatment; it does not claim a universal ChatGPT rule or change restart-confirmation dialogs.

Position the toast at the top centre of the content workspace, inset below the window chrome. It overlays the current screen and any floating side panel without shifting the toolbar, cards, canvas, or panel. Use a rounded rectangle, subtle semantic border, leading status icon, concise readable message, and an always-visible trailing **×** close button. Keep the toast sized to its message, with wrapping and safe horizontal margins in smaller windows; do not stretch it into a full-width banner. Only the toast intercepts pointer input; the surrounding screen stays usable.

**Position revision, 2026-10-15:** All success, error and information toasts share one anchor: horizontally centred within the main content area, 24px below its top edge. The sidebar, toolbar height, canvas pan/zoom and details-panel visibility must not change that anchor. Keep the same position across Overview, Devices, Connections and Requests and recalculate the horizontal centre when the window resizes.

| Kind        | Dark surface / border | Text and icon                | Example                 |
| ----------- | --------------------- | ---------------------------- | ----------------------- |
| Success     | `#082312` / `#245c35` | `#70d38a`, check-circle icon | Placement saved         |
| Error       | `#2b1010` / `#713333` | `#ffb4b4`, error-circle icon | Couldn't save placement |
| Information | `#262626` / `#383838` | `#f3f3f3`, information icon  | Proposal discarded      |

These are ModelLoom target tokens for visual review, not exact measurements of the reference app. Keep device-readiness colours separate. Colour never supplies the only status cue: include the icon and understandable wording. The close icon uses the toast's text colour, has a comfortably clickable transparent button, gains subtle shading on hover, and retains visible keyboard focus and the accessible name Dismiss notification.

All three kinds disappear automatically after **five seconds**. Pause the remaining time while the toast is hovered or contains keyboard focus, then resume when neither applies. Clicking × dismisses it immediately. A new notification replaces the visible one and starts a fresh timer; repeated messages also restart the timer. Dismissal and expiry remove only the notification, never change a draft, apply/discard a proposal, clear a field error, or cancel an operation. Do not steal focus when showing a toast. If the focused close button disappears, restore focus to the live control that triggered the message, with an appropriate page control as fallback. Honour reduced motion; animation must not delay dismissal or actions.

Announce success/information politely and errors urgently without moving focus. Field validation remains beside its input until resolved, and unresolved operational errors retain a readable explanation and recovery action in their owning screen or panel after the toast expires. Pending proposal/field-error state remains available independently of toasts. Discard changes restores the active allocation or the current plan baseline; applying active changes uses Apply and restart. They do not depend on a transient toast. Restart confirmation remains a separate explicit dialog.

For Cluster, replace Proposal discarded · applied placement unchanged with a neutral Proposal discarded toast; discarding retains the applied placement. The later direct-edit revision removed Keep draft, Save changes and the saved-proposal block. Run or Apply and restart validates the pending proposal; replacing an active session requires interruption confirmation before simulated loading. This revision supersedes the earlier instruction to keep transient notices visible outside the panel; persistent proposal/error state stays in its relevant context. The user's subsequent PROCEED authorizes this implementation in the Cluster demo. Local verification is recorded in TESTING-SPEC section 10; the shared component does not by itself establish adoption or visual acceptance across other screens.

## 3. Navigation and shared status

The agreed product destinations are Models, Cluster, Chat, API and Settings. The current rail mapping is fixed by the baseline table above: Home opens Chat; API follows Models; More contains Chat only. Storage and Metrics are omitted from the rail under the 2026-10-15 revision. Downloads and Local profile remain disabled with explanations. Settings opens Appearance in the renderer-only preview described in section 8. Their future functional scope, remaining assets and theme/platform extensions stay under D08; the implemented mapping is no longer an unresolved choice. Do not add account/cloud features because an avatar is present.

There is no shared bottom status bar. Cluster and API status belong in their respective screens. Distinguish total detected devices from selected/in-use devices and unavailable/stale measurements. Production counts must be computed, and unified memory must not be mislabeled as discrete VRAM.

API is available directly from its Server icon after Models in the sidebar; it is absent from the navigation overflow menu. Cluster indicators expose useful status details without implying a connected path guarantees inference performance. Proposed shared visual primitives include AppShell, NavigationRail, ForegroundPanel, PageHeader, StatusBadge, ModelRow/Card, DeviceCard, ActionButton, SearchField, and ContextMenu; these are responsibilities, not approved implementation class names.

## 4. Models screen

![Models reference](references/ui/models.png)

The approved compact-library revision below supersedes the reference's running-model card, metadata tiles, status badges and launch/cluster actions. Preserve the current header and neutral shared controls.

- U07 (P3, P4): The upload icon, named Import GGUF, uses explicit file selection and validates metadata/compatibility before launch. The compass icon, named Explore models, opens the approved Hugging Face GGUF catalogue, with D05 settling metadata/download contracts; show progress, cancellation, failure, origin/license information where available, and local storage location. The current demo explains unavailable integration instead of transferring files or browsing a connected catalogue.
- The 2026-10-15 import-indexing PROCEED adds a persistent index for the current
  accepted development model. After file selection, show a text-only pending row
  with the actual filename and a spinner labeled Indexing…. Preserve existing
  rows; hide pending metadata/actions until inspection and index storage succeed.
  Remove all model-brand logos from Models and the Cluster model picker.
  Startup displays Updating library… while restoring the saved index, then lists
  cached entries with the runtime stopped. Keep unavailable files visible with a
  clear re-import explanation and disabled Configure. Source paths stay private
  to main/core; explicit loading revalidates file identity and existing admission.
  See [model import indexing](../docs/model-import-index.md) for migration and scope.
- U08 (P3): Search filters the actual library. Rows show identity, size, format and quantization; Model details exposes architecture, parameters, maximum-context metadata and compatibility reasons. Distinguish model maximum context from configured active context. Unknown last use has no invented timestamp.
- U09 (P4, P8): Select, place, validate and launch models in Cluster. One active model is shared with Chat/API. Replacing it requires explicit interruption confirmation. Models has no Start, Stop or Open in Cluster control.
- U10 (P6): Show preparing/loading, running and model-load failures in Cluster; show import/download failures in their corresponding flows. Compatibility must be scoped to the selected runtime/backends/configuration rather than a blanket green badge. The compact library has no Ready/Stopped/Running or Fully compatible badges.

The current demo already implements details/removal menus, confirmation and empty/no-search-results states as specified below. Actual storage deletion and download contracts remain pending. Models uses a single list view with no grid toggle. The reference is not a requirement to ship its named model catalogue or specific model sizes.

### Authorized Models toolbar revision, 2026-10-04

The user's PROCEED removes the grid/list toggle and replaces the Import GGUF and Download models text buttons with two icon-only actions, ordered Find model, Import GGUF (upload), Explore models (compass). Keep the heading alignment. The subsequent 2026-10-05 approved sizing refinement uses 16px icons in these 32px circular controls, with `50%` rounding, transparent idle backgrounds, no border or shadow and muted `#8b8b8b` strokes. Hover uses `#2f2f2f` shading, matching the Cluster hamburger. Each icon has its action name as both an accessible label and tooltip; preserve visible keyboard focus. The search field follows the matching-search revision below. Remove the download chevron. Preserve search filtering and the demo's honest import/download explanations. This supersedes the earlier toggle, charcoal Import pill and white Download pill. Catalogue networking and file transfer remain unimplemented; the subsequent compact-library revision governs the rows.

The user's subsequent PROCEED renames Search models to **Find model**, with the visible placeholder **Find model...**, and makes it identical to Cluster's **Find devices...** field. Both use the same shared search-field component and styles: 240×32px, `#1a1a1a` background, 1px `#383838` border, `999px` rounding, 14px horizontal padding, 8px icon-to-input gap, 16px search icon with `#ababab` strokes, `#f3f3f3` entered text, 13px input text and 20px line height. Preserve Find devices' existing placeholder rendering and keyboard focus treatment rather than introducing a Models-only override. Filtering continues to target each screen's own data; toolbar positions and the other controls are unchanged.

### Authorized compact Models library, 2026-10-04

The user's subsequent 2026-10-05 PROCEED retains the compass and shifts only the Import GGUF button 2px right, including its hover/focus target. Use a local visual offset without changing the toolbar layout footprint, search position, compass position, glyph size or vertical alignment. The proposed two-column library and Downloaded/Imported/Browse tabs remain unimplemented. Explore is deferred; retain the existing compass and its unavailable-integration explanation. Earlier discussion of removing GGUF/identifier or adding capability pills did not replace the implemented row baseline.

The user's 2026-10-05 PROCEED moves Models 20px to the right and 10px down from its previous position to follow the Library reference's inset. Add 10px above the header row to retain vertical centring of the search/actions with the title. Align the Name column label's left edge with Models by shifting that label 4px right from its previous 16px column inset. Preserve font roles, table/row geometry and Last used alignment; these are local Models styles rather than shared-shell padding changes.

The user's PROCEED adopts the generated library-style reference for the list, retaining the current heading, matched Find model field, upload/compass icons and `#181818` workspace. Use Name and Last used columns, stable library ordering and compact flat rows with subtle dividers. Each row shows a 32px existing model logo, name, size/GGUF/quantization chips and a secondary identifier. Truncate long names and identifiers with full-text tooltips; wrap chips at narrower desktop widths. Use rounded `#212121` row shading on hover or keyboard focus, without permanently framing every row as a card.

The user's 2026-10-05 clarification requires filled grey backgrounds for the size/GGUF/quantization tags and Back to Models button, superseding the earlier text-colour interpretation. Library and configuration-header tags use solid `#303030` fills. Restore the prior text colours: library tags and Back text/arrow use white `#f3f3f3`; configuration-header tags retain their original muted `#ababab` text. Back uses `#303030` at rest and `#383838` on hover, with unchanged text/arrow colour and neutral border. Keyboard focus retains its separate visible outline. Model names, headings and unrelated controls retain their existing colours.

The user's subsequent PROCEED matches Back to Models' internal spacing to the supplied Image-button reference: 7px vertical and 12px horizontal padding, with an 8px icon-to-text gap. This produces a 34px control at the existing 13px text size and 18px line height. These are ModelLoom CSS targets derived from the reference's proportions, not inspected ChatGPT CSS. Scope this spacing to Back to Models; keep its colours, font size and the shared dimensions of other buttons unchanged.

The user's 2026-10-15 PROCEED enables retained Last used for imported models. Record the trusted time when a Chat or API request is dispatched for execution, including requests cancelled after dispatch. Importing, configuring, loading, token counting, rejected admission and cancelled queued requests do not count. Keep the timestamp in the separate retained configuration database across restarts and reimports of the same model identity, independently of chat-history deletion. Concurrent writes must not move it backwards. A timestamp storage failure must not change inference output or weaken cleanup confirmation.

Refresh the label automatically. For the viewer's current local day, show **Just now** below one minute, **12 min ago** below one hour, then **2 hr 15 min ago**, omitting zero minutes. Show **Yesterday** for the previous local calendar day and **13 Oct 2026** for older dates. Hover reveals the exact local date and time including seconds. Never-used or unknown history remains **—**; demo fixtures do not invent usage times.

Keep ⋮ and gear actions visible in every row: 18px icons within borderless 32px circular controls, muted grey by default and `#2f2f2f` on hover/open, with shared keyboard focus. The ⋮ group contains Model details and confirmed Remove model entry. Prevent removal of the active demo model until it is stopped in Cluster. Escape/outside click dismiss the group, and modal dismissal restores focus to its trigger. Details retains the existing metadata, identifier and format; compatibility is **Not verified**, rather than a fabricated result.

Remove the large metadata tiles, status badges, expanded running card, Start/Stop and Open in Cluster actions. Search and empty results remain functional. The user initially chose **compact list first; configuration next**; the later configuration approval below replaces the gear's transitional explanation with its configuration page. The removal affects Models controls only; Cluster's placement, Run/Stop, validation and switch confirmation remain functional.

### Authorized per-model configuration demo, 2026-10-04

The user's PROCEED authorizes the revised six-section configuration mockup, with the subsequent corrections applied: no model logo, no section-navigation sidebar, blue enabled toggles and white sliders. Keep the existing navigation rail with Models selected. A single centred, scrollable column has the Model configuration heading, model name and GGUF/quantization chips, Back to Models action, six external section headings above rounded charcoal groups, and a bottom Reset defaults / Save defaults row. There is no Run/Play control here. GPU Offload opens Cluster through Set in Cluster without applying settings or changing placement.

Use the shared Segoe UI system stack and text-role tokens: 24px page title, 14px medium section headings, 14px medium setting labels, 13px controls/descriptions and 12px chips/supporting text. Do not translate scaled screenshot pixels into isolated font literals. Use the same `#181818` foreground, `#f3f3f3` text, `#ababab` supporting text, `#383838` borders, 28px fields/actions and 16px group rounding. Configuration groups use `#222222`, inputs `#262626`; enabled switches use blue `#487fff` with a white thumb, disabled switches grey, and slider thumbs/fills white on a charcoal track. Shared switch geometry is 28×16px with a 12px thumb; range thumbs are 12px. The column is at most 800px CSS wide, with 40px header-to-content spacing, 36px between sections, 14px heading-to-group spacing, 16px horizontal group insets and 14px vertical row padding. These are consistent ModelLoom review targets, not measured ChatGPT screenshot parity. Reflow narrower windows without shrinking the text-role sizes. Preserve visible keyboard focus, labels, help text and native numeric/slider/checkbox semantics.

Include all agreed sections and controls:

- **Prompt:** System Prompt textarea.
- **Context and Performance:** Automatic Optimize Based on Hardware with Recommended label; Context Length; GPU Offload; CPU Thread Pool Size; Evaluation Batch Size; Physical Batch Size; Max Concurrent Predictions with Experimental label; Flash Attention.
- **Generation:** Temperature; Limit Response Length and optional maximum; Context Overflow; Stop Strings with exact-string entry/removal.
- **Reasoning:** Enable Thinking; optional Reasoning Budget; Reasoning Budget Message.
- **Speculative decoding:** disabled Off method selector with an honest unavailable explanation. Do not add draft-model selection or parameters. No method is enabled before unchanged-quality evidence and runtime approval.
- **Advanced:** Top K, optional Top P, Min P, Repeat Penalty and Presence Penalty; expandable Chat Template editor; optional RoPE Frequency Base/Scale; optional Seed. The 2026-10-17 revision removes the llama.cpp Arguments Override row and its text editor from the page for now, retaining existing stored fields without exposing or executing them.

The user explicitly selected **current app session only** for Save defaults. Keep separate saved defaults and pending edits per model, retaining pending text across Models/Cluster navigation. Save validates enabled fields and updates only that model's session defaults; it never loads an engine, changes active inference or modifies placement. Back to Models restores focus to the gear. Reset defaults replaces pending values with sample defaults and still requires Save to change the saved defaults. Auto mode disables the manual context field while retaining its value. Optional controls retain disabled values; thinking disables its dependent fields. Exact stop strings preserve whitespace and Enter adds without submitting the form. Template and argument overrides remain inert text; never interpret or execute them. The demo clears all settings on restart/reload and uses no persistent storage.

Editor validation rejects empty/nonfinite values, nonintegers in count fields and values outside the sample control ranges; Physical Batch Size cannot exceed Evaluation Batch Size. Demo ranges include temperature 0–2, Top P/Min P 0–1, CPU threads 1–64, Presence Penalty −2–2 and Seed 0–4294967295. Positive counts and RoPE values follow their field minima. Sample defaults and editor ranges are not runtime/backend/hardware capability claims; production limits and settings application remain subject to the reviewed runtime/configuration contracts. Limit text inputs and exact stop entries locally; up to 16 stop strings are supported by this demo editor. Show inline errors, focus the first invalid control and confirm successful session saving honestly.

The approved 2026-10-17 save-feedback revision replaces the bottom success message with the shared green success toast from section 2.3, centred 24px below the main content's top edge. Show it only after Save succeeds, retaining the honest session-only wording in the demo and requiring core acknowledgement for imported models. Keep Reset defaults and Save changes in their existing fixed bottom bar without moving or resizing them. Saving progress, validation explanations and save failures retain their existing feedback. The toast supports close, five-second expiry and paused expiry during hover or keyboard focus; dismissing it does not change saved settings.

### Model configuration wiring revision, 2026-10-17

For imported models, Save commits the existing protected per-model record. Generation settings apply to new requests; context, threads, batches, concurrency, Flash Attention, RoPE, reasoning budget/message, template and overflow preferences apply after explicit reload. When the owner reports pending load changes, the existing green save notification explains that reload is required. No control causes automatic reload or changes an admitted request.

Context Overflow offers all three choices, with **Stop at Limit** as the default. Stop rejects a prompt that cannot fit its requested reply budget and stops generation at the loaded context boundary. **Truncate Middle** removes older middle turns while retaining the system instructions, first user turn and newest input. **Rolling Window** removes the oldest turns while retaining system instructions and newest input. Trimming affects only the request, never stored conversation text. Both continuing modes use the pinned runtime's supported context shift during generation; a native context that cannot shift is rejected before readiness instead of silently using a different policy. Protected prefixes must be compatible with the selected native template.

Opening or closing Chat Template changes only editor expansion. Nonblank template text enables the custom template; clearing it restores the model default. Inactive numeric controls retain their previous valid saved values if their pending input is invalid. Their valid manual values remain retained while disabled. Reasoning Budget Message is passed only with an enabled reasoning budget.

Set in Cluster selects the model being configured without loading it. Successful model-default saves refresh cached Cluster load settings while preserving pending layer assignments and Undo history. These changes preserve the existing layout, typography and control sizes. Automatic hardware optimization, speculative decoding and removed raw argument overrides remain outside this revision.

### Model configuration control consistency, 2026-10-17

Both configuration dropdowns use Cluster's Choose model pill and popup design,
including its chevron, surfaces, rounding, hover/selection treatment and keyboard
dismissal. Centre the 32px pill within the existing 28px settings slot so adjacent
content does not move. Keep the disabled speculative method unavailable.

Numeric fields use Assign Layers' separate up/down caret buttons within their
existing 108×28px footprint. Preserve native numeric editing, each setting's
integer or decimal step, bounds, optional/disabled state, sliders and validation.
Keep all other labels, fonts, spacing, section geometry and runtime wiring unchanged.

## 5. Cluster screen

### Approved sidebar revision, 2026-10-15

The user approved the generated sidebar/canvas mockup and authorized implementation.
This revision supersedes the older Cluster heading, search/Add toolbar and
hamburger composition below. Other screens and the global icon rail retain
their current styling and behavior.

- The left panel follows Settings: 240 CSS px, Segoe UI/system font stack,
  18px medium Cluster heading, 14px navigation and semibold group labels,
  30px navigation rows with 1px gaps, 6px vertical/12px horizontal padding,
  16px icons with an 8px gap, #1c1c1c background, #303033 divider and neutral
  10px selected-row rounding. Cluster appears once, in this sidebar.
- The later approved refinement removes device search entirely from Cluster.
  Sidebar Add device uses the reference circled-plus icon and opens a full content
  view. Overview, Devices, Connections and Requests have independent destinations;
  Your devices contains coordinator-first shortcuts to existing device details.
  Requests shows a count only when the demo actually has pending requests.
- The 2026-10-15 icon refinement uses the installed reference package's circled
  plus, square grid, desktop, Wi-Fi, envelope and laptop-connector artwork for
  Add device, Overview, Devices, Connections, Requests and Your devices respectively.
  Render all at 16px, retain outlined artwork on selected rows, and preserve the
  existing row shading, spacing, labels and navigation. Asset provenance is in
  [CHATGPT-ICONS.md](../docs/CHATGPT-ICONS.md).
- Overview preserves the device diagram and contextual details. Its compact
  model pill sits beside a 32px charcoal circular Run/Stop/Cancel/restart control.
  Run uses the Regular PlayCircle icon. The Details control is also a 32px charcoal circle.
  The Details toggle sits at the top-right with the same right-edge inset as the
  Models Explore compass button. Existing validation, confirmation, interruption, renaming and
  focus behavior remain in force. There is no duplicate title, search or Add
  dropdown in this header.
- The bottom-left zoom/percentage/Fit to view bar is explicitly protected.
  Preserve its component, icons, CSS, spacing, colours, position within the canvas
  and interaction behavior. Do not move it into the top toolbar or duplicate it.
  Keep the canvas mounted across Cluster destination navigation.
- The subsequent approved canvas refinement starts at exactly 100% instead of
  automatically fitting on launch. Window resizing preserves the current scale.
  A single device uses its own card bounds and stays horizontally centered in the
  available canvas, or in the space left of the open details panel. Vertically,
  place its center 32px above the midpoint of the canvas after reserving the zoom
  bar's height plus 28px at the bottom, matching the user's higher-card reference.
  Recompute this position on resize, restoration and panel changes. Manual pan and
  zoom remain available. Fit to view and keyboard 0 fit and center the diagram at
  the same visual height, leaving clearance above the existing control bar.
  This refinement authorizes canvas positioning changes while preserving the
  control bar's appearance, icons, padding and fixed placement.
- Devices presents supplied device/hardware details. Connections presents only
  supplied sample links with explicit sample latency, unknown path and unverified
  status. Requests reuses session-only decisions. Add/Join use available-device
  cards and a Connect manually disclosure, retaining distinct LAN/Tailscale/
  Headscale previews and request direction. Existing Join cluster and Share this PC
  contexts remain accessible from device/connection views.
- The 2026-10-15 hardware-inventory PROCEED replaces the blanket missing-fields
  note with individual measured rows. Local Windows devices show the OS-reported
  edition, display version and full build, machine architecture, physical CPU
  cores/logical threads, installed/usable/available RAM, and supported physical
  AMD/NVIDIA GPUs with their driver and available dedicated-memory readings.
  Never substitute shared RAM or truncated WMI AdapterRAM for dedicated VRAM.
  Unavailable readings stay unavailable; verified runtime backends come only
  from verifier-accepted installed inventory. Show the observation time and
  refresh local snapshots periodically. Preserve the approved Settings layout.
  See [hardware inventory](../docs/hardware-inventory.md) for provider and evidence limits.
- The subsequent 2026-10-15 GPU correction applies the same physical AMD/NVIDIA
  filter to the canvas and Devices, using PCI vendor identity. Exclude Intel,
  software/virtual display adapters, unknown identities and adapters Windows
  reports disabled or failed. Retain CPU and number GPUs after filtering.
  Windows device-change notifications immediately invalidate the ten-second
  telemetry cache and start a new observation. Discard observations overtaken
  by a notification, coalesce concurrent scans and update both views through
  the existing bridge. Display updates follow completion of native discovery;
  do not promise zero latency or treat idle/sleeping GPUs as disabled.
  This is a display policy, not runtime compatibility or admission authority.
- The later approved Settings-format revision applies to Devices, Connections
  and Requests: reuse Settings' centered 728px column, 44px top/24px horizontal/
  32px bottom content padding (18px horizontal at the existing narrow breakpoint),
  24px page titles, 40px header spacing, 14px medium section headings, 14px labels and
  13px descriptions. Device hardware, connections and requests use Settings'
  rounded #222222 groups with 16px side insets, 14px vertical row padding and
  shared row dividers. Keep existing actions, request decisions and sample/unavailable
  disclosures. Overview and Add/Join/Share retain their existing presentation.
- The later Devices inventory approval lists every supplied PC/Mac on the same
  scrollable page. Each named device has a role badge and plain label/value rows
  for reported CPU/core/thread details, each GPU's model/memory, unified memory
  where applicable, OS and device status. Remove Devices' three header actions,
  content icons and Device details/View details buttons. Connection actions stay
  on Connections; existing canvas and sidebar inspection remain available.
  Keep unknown architecture/RAM/free-memory/driver/backend data in one compact
  per-device disclosure, rather than repeating empty rows or inventing values.
  Apple unified memory is one shared pool, not separate RAM plus discrete VRAM.
  Additional hardware detection is outside this presentation revision.
- Use `@phosphor-icons/react` 2.1.10 Regular icons in changed Cluster surfaces,
  including Cpu and GraphicsCard. Preserve existing colours and selection
  highlights; no automatic Regular-to-Fill change is part of this authorization.
  Existing protected zoom icons and unrelated screens are excluded from migration.

This is a renderer presentation revision, not authorization to implement discovery,
enrollment, pairing, worker access or real request approval. Normal builds contain
no sample peers, links or participation requests; unavailable integration is stated
honestly. Local runtime callbacks and security boundaries are unchanged.

The 2026-10-07 approved startup correction shows the user's own PC in the existing
device card before model import/loading or remote connections. Identify it as
**This device**, display its observed hardware and trusted role, and keep model
status unloaded until actual readiness. Visibility is independent of Coordinator
or Worker role. Missing GPU information must not hide the PC. No card, toolbar,
font, colour or spacing redesign is part of this correction. Labelled demo builds
retain their fixture presentation; normal desktop builds show the observed PC
even when runtime activation is unavailable.

The GPU tile uses its detected model name alongside memory from the same physical
device; the generic hardcoded NVIDIA GPU label is removed. When capacity is known
but the name is unavailable, state **GPU name unavailable**. Keep existing tile
geometry, fonts and colours.

The subsequent approved hardware-stacking revision makes coordinator tiles use
the same vertical stack and icon/text layout as worker tiles: CPU first, followed
by each GPU beneath it. Remove coordinator-only horizontal columns and compact
tile overrides. Preserve the coordinator card's graph position, width, role badge,
palette and typography; hardware content determines its height.

GPU and unified-memory tiles retain the empty layer-bar track when unassigned,
with **Unassigned** and the existing pencil control below it. The approved track
colour is #4A4A4A so it remains visible against #303030 hardware tiles; assigned
fill remains white (#FFFFFF). Fill appears only when a layer range is assigned.

The approved CPU/GPU icon revision uses Lucide **Cpu** and **Gpu**, both white,
at the existing 26px size and 1.7 stroke width. GPU replaces the circuit-board
symbol. Preserve unified-memory icons and the remaining card styling.

The subsequent approved Settings-style card revision removes the monitor icon
beside the device name. The subsequent approved device-name revision uses 16px
at weight 500, retaining the shared font family. CPU/GPU labels use 14px at
weight 500; hardware details use 13px at weight 400 with the Settings description
line-height of 1.625.
The subsequent approved header revision removes the OS/address subtitle from
graph cards; OS/address information remains in device details. The latest
approved alignment centres the device name vertically with the role badge and
three-dot menu, superseding the earlier 4px name-to-tile gap. The approved top
inset is exactly 18px from the outer card edge to the pill's top: a 1px border
plus 17px top padding, with a 24px header/control area. The final approved
adjustments raise the outer top edge and entire header by 2px in total,
compensating with a 10px header-to-hardware gap to keep hardware cards and the
bottom edge fixed.
The device name retains its separate 1px upward translation from the shared
centre. Do not apply positional offsets to the badge or menu.
The subsequent approved device-details spacing revision uses 18px device-card
side/bottom padding, a 12px gap between hardware tiles and 12px padding inside
each tile; the later measured 18px top inset above supersedes the top padding.
The subsequent approved device-details colour revision supersedes the earlier
Integration-card palette: device cards use #262626 with a 16px corner radius;
hardware tiles use #303030 with a 12px radius and borders matching their fill.
Selected device cards retain that background with their existing selection outline.
Remove the device drop shadow while retaining selected and focus indications.
Preserve card widths and graph placement, vertical hardware stacking, white
CPU/GPU icons, role badges, layer tracks, Unassigned labels and existing controls.

![Cluster reference](references/ui/cluster.png)

Preserve the selected-model header, search and placement toolbar, coordinator/worker cards, CPU/GPU tiles, dotted connection curves with latency labels, assignment bars, editing affordances, and menus.

- U11 (P1-P2): Add device supports LAN discovery/manual private address, Tailscale, and existing Headscale entry points. Discovery, enrollment, approval, reachability, and readiness are distinct states. Show the selected mode and observed direct/relay/unknown path where relevant.
- U12 (P1, P3): Device cards show actual identity/role/OS, approved connection, runtime health, CPU/GPU/backend information, and selected/assigned participation. Indicate compute hardware unsupported by the active runtime with a reason and compatible action.

Connections places its muted description directly below the heading, with a 6px
visible gap and the same left edge. Its later 2px downward visual offset leaves
the heading, actions and following content positions unchanged. The connected-app text is "Network connections will
appear here." Join cluster, Share this PC and Add device form a right-aligned
group vertically centered against the combined heading and description, matching
the supplied Plugins header reference. Preserve the shared typography, button
styling, content-column width and networking availability behavior.

- U13 (P3, P8): The 2026-10-17 revision keeps acknowledged raw drafts and makes named Save optional. Put Configurations below Your devices. Keep icon-only Save beside Play, with Save configuration tooltip and accessible name. First Save requests a name and subsequent Saves update it. Play with empty assignments opens Auto place / Place manually, with the top-right X for dismissal. Assignment choices only prepare layers; the same Play button loads prepared assignments. The 2026-10-18 explicit-save revision supersedes draft retention when switching. Switching models or saved configurations, or leaving Cluster, shows Unsaved changes when assignments differ from the saved baseline. Provide exactly Save changes and Discard changes as the dialog actions, with a top-right X; X or Escape stays with edits intact. A new configuration includes its name field. Save switches only after successful persistence and updates an existing saved configuration in place. Discard clears a never-saved assignment or restores the last saved ranges, clearing Undo/Redo. Failed Save or Discard stays with recoverable feedback. Manual edits and Undo/Redo stay in memory, with no automatic draft writes. Only explicit Save, Auto place or Run synchronizes the owner session draft. Explicitly saved configurations survive restart. Undo to empty restores the assignment-choice popup. Preserve raw text and clear old validation errors on edits. Keep Stop/Cancel reachable while another selection is dirty; confirm interruption before replacing a session.
- U14 (P4, P6): A required worker disconnect interrupts affected generation. Mark the peer and model/session appropriately and provide reconnect/restart/removal choices consistent with actual recovery policy.
- U15 (P3): Configuration rows share the chat-row layout, font, rounded selection, measured truncation/fade and hover scrolling. Reveal the original OpenAI trash-light-16 icon on hover or keyboard focus, reserving its fixed control width. Reset scrolling on leave and respect reduced motion. Trash opens the shared confirmation dialog. Confirmed deletion removes only that saved configuration and its own draft, retaining model settings, other drafts/configurations and any already running session. Deletion is unavailable during loading or planning. Failed deletion preserves the row and edits.

The later approved compact editor puts an Undo / Redo / Reset to default pill
before the model selector, with Save / Play after it. A faint vertical divider
separates Reset from Redo. All actions stay visible, muted when disabled; Save is
disabled while clean. Undo/Redo restore raw assignment text in memory, new edits
clear Redo, and successful Save clears history. Reset creates one undoable
automatic proposal, without saving or loading. Remove the bottom Discard changes
action. Preserve the device header, back link, role, OS, address and connection.
Below the divider show Layer assignment and actual layer count/range once.
Omit CPU and duplicate GPU specifications from the editor, retaining them on the
canvas. Group GPU headings and First layer / Last layer fields on one charcoal
surface. Dark rounded fields have a faint inset divider and always-visible
stacked up/down buttons, with keyboard stepping within 0 through layer count
minus one. Typing preserves incomplete drafts and temporary overlaps; Save
retains field explanations and the red validation toast. This supersedes the
earlier dirty-only Save and bottom Discard presentation.

With no model selected, keep each GPU's First layer / Last layer fields and
arrows visible but disabled and muted, with dash placeholders and empty values.
Keep the Choose a model to assign layers hint, omit the Not used for model layers
message, and do not invent a layer count or maximum before metadata is available.

The subsequent approved header revision uses one icon-only Back arrow at the
left of the device name, with a Back to cluster overview tooltip and accessible
name. It returns to the overview inside the panel. Remove the panel's X and the
standalone back-text row; the existing external panel toggle handles showing and
hiding it, with Escape and focus restoration retained. Keep the existing type
scale, flat surfaces and GPU group. Place one muted This device / Sample device
and role line beneath the name. OS, address and connection remain accessible in
an initially collapsed, plain Device details disclosure; expanded labels and
values stack left-aligned, preserving complete technical strings and wrapping.

The later device-header spacing correction matches the canvas device name at
16px with the existing medium weight. Use a compact 24px identity row and a 2px
subtitle gap. Keep the Back offset. Device details uses 6px vertical summary
padding, followed by a 6px gap to the divider and 10px below it before Layer
assignment. These changes apply to the device panel; the overview title remains
18px.

The approved overview cleanup groups the selected model and muted state,
Hardware, and Layer assignment without adding cards or changing the flat palette.
Omit redundant State/Running model rows; keep a different running model visible.
Show actual device/GPU counts, one-decimal memory totals using GiB for observed
binary capacities, and unified memory only on devices that provide it. Unknown
capacity stays Unknown. Assignment rows open the device editor and distinguish
No assignment, Draft (including invalid raw edits), Saved and verified In use.
Remove the repeated Save instruction and vague Placement not confirmed label.
The user's compactness correction retains the existing 18px panel title, uses
14px section headings and 13px model text, and tightens overview-only gaps to
12–14px. Do not copy the generated image's enlarged typography or spacing.

Connection curves show verified relationships rather than an invented full mesh. Latency labels need measurement scope/unit/freshness; unavailable data remains unavailable. Layer ranges must be valid for the actual model and native placement method; the mock's ranges up to 127 are not a placement contract. List/small-window navigation and graph keyboard alternatives require D08 review while preserving the primary composition.

### Authorized Cluster demo, 2026-10-03

The renderer-only demo preserves the reference's coordinator above three workers, hardware tiles, dotted links, sample latency labels, assignment bars, menus, and placement toolbar. It uses the current shared typography and foreground-panel tokens. Search filters sample identity, OS, addresses, and hardware. Device/connection menus disclose their sample source; Add device explains the future LAN/Tailscale/Headscale modes without discovering, enrolling, or approving peers. The selected-model control now opens the model library dropdown described below. The 2026-10-05 API navigation revision places API directly after Models in the sidebar and removes its overflow entry.

The original demo used the reference's illustrative 128-layer allocation with separate keep/save/apply stages. The approved 2026-10-04 planning and launch revision below replaces those stages, introduces model-specific synthetic layer counts, and leaves all runtime/network/memory-fit/correctness integration pending. Allocation bars show sample layer share, not measured memory. No production placement contract is accepted by this UI simulation.

The user's subsequent 2026-10-03 cleanup removes the entire Cluster bottom summary bar and the explanatory sentence below its header. The model selector shows only the selected model name and chevron; its green dot and Demo running text are removed. The title bar's small Demo data label identifies the screen as simulated. This explicit revision supersedes the corresponding elements in the reference and initial Cluster demo. Hardware details, including separate VRAM and unified-memory labels, remain in their device cards; connection dialogs retain their sample disclosures. Critical errors, pending proposals, and restart confirmations remain visible when needed.

Builds with demo data disabled render no sample peers. The earlier contained horizontal scroll is replaced by the pan/zoom canvas below; this is demo usability evidence, not closure of D08's final graph/list design. Networking, runtime, pairing, cache, scheduling, and inference gates remain open.

### Authorized Cluster toolbar revision, 2026-10-03

The user's 2026-10-05 PROCEED moves the entire Cluster header row 10px down to match Models, while moving only its left group (Cluster, model selector and Run/Stop) 20px right. Find devices, Add and the panel toggle retain their previous horizontal positions. All header controls stay vertically centred. Apply these insets locally to the Cluster header and heading group; do not change shared workspace padding or the right toolbar's horizontal anchor.

The toolbar position and toggle styling remain current. The placement-only panel described in this first pass is superseded by the contextual-panel revision below.

The user approved a toolbar-first update following the supplied ChatGPT screenshots. Keep Cluster and the selected model at the left, with Find devices and Add device in their existing order at the right. Find devices uses a rounded pill with a subtle neutral-grey border. Add device uses a white pill with dark text. A single hamburger button immediately to its right toggles the Cluster panel: its strokes use the muted neutral grey sampled from the user's icon reference (#8b8b8b), while its background is transparent by default and gains rounded charcoal shading only on hover or while the panel is open. Keyboard focus remains visible. These supersede the corresponding toolbar styling in the original reference.

Layer placement, Auto place, and Save placement move into an initially closed floating panel below the toolbar. Its inset charcoal surface, rounded corners, and subtle shadow sit above the graph; opening it does not resize or reposition the graph or toolbar and does not block interaction with the canvas. Closing it with its close button or Escape from within the panel restores focus to the hamburger. Placement validation, pending/applied separation, and explicit restart confirmation retain their existing demo behavior. Pending notices and errors remain visible when the panel is closed.

This first pass changes the toolbar and houses the existing placement controls. It preserves all four current sample cards, their hardware tiles, dotted connections, and latency badges. Add device retains its current integration explanation. Pan/zoom, dragging, the contextual Add device entry, and the proposed available-device/joining flow belong to later UI work; the three-node generated mockups illustrate the direction and do not authorize changing the current fixture count or choosing a pairing protocol.

### Authorized contextual Cluster panel and canvas, 2026-10-03

The user's later PROCEED authorizes the Cluster colour revision, contextual panel, selection, Add device shortcuts, and canvas gestures. Preserve the four default fixture cards, detailed hardware tiles, dotted blue links, and latency pills. Cluster surfaces and controls use section 2.2's neutral palette; shared shell and other-screen palette rollout remain separate work. Coordinator cards have the same default border and shading as worker cards. The Coordinator badge identifies the role; it does not select or highlight the node. A selected card has a light-grey outline and slightly lighter surface, independently of keyboard focus. No device is initially selected.

The floating panel remains above the graph without resizing or repositioning it. The hamburger opens/closes it; selecting a card/name or connection, clicking a layer pencil, or choosing Add device opens the corresponding content. Closing or Escape restores the live initiating control, falling back to the hamburger if it no longer exists. There is no Layer placement / Auto place / Save placement button menu.

The user's subsequent scroll-containment fix separates the rounded outer frame from an inner scrolling area. The frame retains fixed 18px padding on every side, clips overflow, and never scrolls; the inner viewport, including its scrollbar, stays inset from the rounded edges at the top, middle and bottom of the content. Use a slim neutral-grey `#626262` scrollbar thumb with rounded ends and a transparent track, scoped to this panel. Keep focused controls' indicators visible inside the clipping boundary. Content may scroll normally, including its title; this does not introduce a pinned header. Layer fields and the contextual Discard changes action remain reachable, and panel scrolling never pans or zooms the canvas.

The user's corrected scrollbar refinement places the scroll strip near the outer right edge, approximately 4px inside the frame, with an 8px gap between the content and the scrollbar. Offset the reserved 6px scrollbar and its 8px gap together so body content retains equal 18px left and right padding. Keep this spacing when content does not overflow and at every scroll position. The top and bottom padding stays fixed. The track and thumb are transparent when the pointer is outside the panel; hovering anywhere inside the panel, including its padding, reveals the neutral thumb. Keep the thumb visible while dragged. Hiding/showing changes colour only, so content and controls do not move. Wheel and keyboard scrolling remain available while the thumb is hidden. This supersedes the previous 10px strip inset and cramped 2px gap, thumb-only hover behaviour and asymmetric body spacing.

| Context             | Panel content                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Nothing selected    | Cluster overview: active model, sample device count, separate discrete VRAM/unified memory totals, and allocation summary with selectable devices                  |
| Device selected     | Role, OS, address, unverified connection state, hardware details, and inline first/last layer fields for assigned or unassigned sample GPU/unified-memory hardware |
| Connection selected | Endpoint names, sample latency, unverified connection status, and unknown direct/relay path                                                                        |
| Add device          | Available-device area and LAN/Tailscale/Headscale joining information                                                                                              |

The user's subsequent device-name revision adds Rename device beneath Device details in each node's existing ⋮ menu, without another pencil beside the node name. Rename device opens that device's details panel with its current name focused and selected for inline editing; there is no rename modal. A muted pencil beside the panel title appears on title hover or keyboard focus and starts the same editor. The editor contains a Device name input, Cancel and a white rounded Save name action. Enter saves; Cancel and Escape restore the original name and focus the panel's pencil without closing the panel. Closing the panel or changing context discards an unsubmitted name edit. Reject blank/whitespace-only names with a field-associated explanation, trim outer whitespace on save, and limit the demo input to 64 characters. Renaming updates the card, accessible labels, search, device panel, overview and connection endpoint display names immediately, with a Device renamed success toast. Long card names use ellipsis and a full-name tooltip; panel headings wrap safely. This is a friendly display-name edit, independent of the layer draft: it does not alter identity, address, hardware, the selected model or allocations. Local demo names survive screen navigation and reset on app exit. It does not change an OS hostname, network registration or peer identity; persistent connected-device naming remains part of future integration.

The earlier Keep draft, toolbar Save changes and saved-proposal panel design is superseded by the 2026-10-04 planning/launch revision below. Pending input and active allocation remain separate. Field-specific validation stays beside the inputs; overall coverage errors appear only in section 2.3's floating error toast. Expiring or dismissing the toast cannot start loading or apply an invalid allocation.

The toolbar's Add device menu option and contextual node + open the same panel flow. With one connected device, its small charcoal circular + is always visible just outside the card's right edge. With two or more connected devices, + appears on card hover or keyboard focus and remains reachable while the pointer moves onto it. The threshold uses the actual device count, not the number of search results. The shortcut adds to the cluster; its location does not imply a direct link to the adjacent machine. The 2026-10-05 joining demo below supersedes the earlier empty-only Available devices presentation with explicitly labelled examples. It creates no enrolled peer, credential, real approval or verified connection. Real discovery/joining remains behind the networking and pairing decisions.

**Approved joining-panel revision, 2026-10-05:** Keep the existing right-hand panel and four-device diagram. The user's subsequent PROCEED replaces the split control with one Add capsule and a 14px chevron, without a leading plus. The label and chevron share one white surface and one `#e5e5e5` hover shade; clicking anywhere opens Add device, Join cluster and Share this PC. Selecting an option changes the content of the same panel while the button label always stays Add. Retain shared 13px text, 32px height, 14px horizontal padding, 8px text-to-chevron gap and full capsule rounding. Preserve contextual node + as a direct Add device shortcut. Support arrows, Home/End, Escape, Tab and outside dismissal, with return focus to Add after panel closure.

Add device invites another PC to contribute to this PC's cluster; Join cluster asks a coordinator to accept this PC. Each view has the existing LAN/Tailscale/Headscale mode controls, one available-example list and a private-address field, with pending outgoing status and an explanation of who must approve. Remove the old redundant dashed empty box. Share this PC exposes Allow participation requests, GPU/CPU choices, participation status and Stop sharing. Availability is off initially, never sends a request, never automatically approves one and never starts inference.

Cluster overview retains its model/device/memory/allocation information and adds Pending requests. Distinguish an invitation into another coordinator's cluster from a request to join this PC's cluster; describe the resulting roles before Approve/Decline. A small pending count appears on the existing hamburger, which opens overview when requests await a decision. Incoming examples and decisions remain visible only in the demo; actions change their illustrated status without adding a card, changing placement or simulating an authenticated connection. Outgoing status, sharing preferences, hardware choices and incoming decisions survive screen navigation for this app session only.

Use the actual existing overview panel as the sizing reference, rather than the generated mockup's apparent scale: retain 18px frame padding, 22px corners, the existing inset scroll viewport, 18px title/close icon, 14px medium section headings, 13px descriptions/controls and 12px detail rows. Reuse 18px section separation, 16px section top padding, 10px row padding, 8px action gaps and neutral dividers. Menu icons use 16px and its chevron 14px, matching existing controls. Use the existing 28px action controls and 28×16px blue/white enabled switch geometry. Keep the shared neutral palette, white primary actions and charcoal secondary actions. Non-demo builds show no candidates/requests and disable request/sharing actions until integration.

**Future connected-device behaviour:** Both entry points add a worker to the current coordinator-managed cluster after the reviewed joining/approval flow succeeds. Users do not choose a parent node; clicking a node's + does not attach the new worker to that node. Automatically place the new card in the worker area alongside the other workers. Card position describes the visual layout, not the network topology. Draw dotted lines only for verified relationships, with truthful direct/relay/unknown and latency information; do not invent a coordinator link or a full mesh merely because a card appears. Layer placement determines inference participation, and joining alone does not change the applied allocation. Keep pending placement separate from the active allocation and require validated Run or confirmed Apply and restart. This records intended UI behaviour only: automatic new-card placement and real joining/connection rendering are not implemented in the current demo and require the separately reviewed networking, pairing and placement integration.

Hold the left mouse button and drag empty canvas to pan; clicks on cards and controls retain their selection/edit behaviour. Mouse-wheel scrolling over the canvas zooms in/out around the cursor, bounded to 25–200%. Panel scrolling does not zoom the canvas, and the floating panel/header remain stationary. The initial graph fits the viewport; deliberate pan/zoom is preserved during panel changes. Keyboard alternatives on the focused canvas are arrow keys to pan, plus/minus to zoom, and 0 to fit. Input keystrokes do not trigger canvas shortcuts. Pan/zoom changes presentation only; node dragging/rearrangement and real network/placement changes are not implemented by these gestures.

The user's 2026-10-05 PROCEED replaces the bottom-left text hint with a fixed floating canvas-control bar, following the supplied Image-tools bar's padding and corner proportions. Use a flat `#2c2c2c` rounded rectangle with 12px corner radius, 8px vertical and 12px horizontal padding, 16px between control groups, and 8px icon-to-label spacing. Retain shared 13px control text, 16px icons and muted `#ababab` content; use 24px inner controls for a 40px bar height, transparent idle controls, `#383838` hover shading and visible keyboard focus. These are ModelLoom CSS targets derived from the screenshot, not inspected ChatGPT CSS. Keep the bar 16px inside the canvas's left and bottom edges, outside the transformed diagram and below the inspector. The subsequent approved refinement removes the redundant Pan button. Order the controls as zoom out, current percentage, zoom in, and Fit to view. Dragging empty canvas and arrow-key panning on the focused canvas remain available without switching modes. Zoom buttons share the keyboard zoom behaviour and 25–200% bounds, disabling at each limit. Fit to view and keyboard 0 share fitting, with clearance above the bar. Clicking, dragging or scrolling over the bar does not pan or zoom the diagram. Preserve the screen-reader gesture instructions and existing canvas, card and inspector interactions.

The user's subsequent colour/outline fix makes the Cluster content and its surrounding workspace padding one continuous `#181818` surface, with neutral `#212121` window chrome/navigation surround. Set the Cluster surface at its workspace container so the parent padding cannot expose the former `#111215` background. The canvas never draws a focus outline, including during mouse clicks, dragging, programmatic focus, or keyboard focus. It remains keyboard focusable and operable; individual buttons and inputs retain their focus indicators. This explicit canvas exception supersedes the general focus-outline rule only for the canvas region.

### Approved Cluster canvas dot grid, 2026-11-01

The overview uses a neutral dot grid across its full content background, including
behind the fixed floating top and zoom controls. Solid cards and controls cover
the dots; the navigation sidebar, Devices and Connections remain plain. Clip the
grid at the existing workspace boundary and preserve all layout and interactions.

Use Amoeba's 20 CSS px base spacing at ModelLoom's 100% zoom, with `#383838` dots
of 1px radius fading to transparent at 1.2px over the existing workspace surface.
The user rejected the initial 9.2px spacing as too dense at 100% zoom.
Scale the spacing with ModelLoom's zoom and anchor its origin to the same pan
coordinates as the cards; keep dot radius fixed. This background is decorative
and adds no pointer targets or accessibility announcements.

### Approved model planning and Run revision, 2026-10-04

**Scope:** Cluster demo and specifications only at this milestone. Preserve the four-device diagram, existing device/link/add/rename panel flows, neutral palette, scroll containment and pan/zoom. The later compact Models revision above removes its transitional launch controls. No engine, file transfer, GPU loading, inference, optimizer or real memory preflight is implemented by this demo.

Keep Cluster, the selected-model pill and a single launch icon together on the left of the header. Use an 8px gap between the model selector and launch button, matching Add to hamburger, while retaining the 14px title-to-selector gap; retain Find devices, Add and the hamburger at the right. The model pill is a flat charcoal surface without a border, raised edge or shadow. Its model name uses the same 13px control font, 18px line height and internal padding as Add: 1px vertically and 14px horizontally. Both controls retain a 32px height and an 8px text-to-chevron gap. It opens a dropdown containing the current Models library as compact tiles with name, file size, GGUF and quantization. Mark the actual demo active model separately from the planned selection. Support mouse/keyboard selection, arrow navigation, Home/End, Escape, Tab and outside-click dismissal. Empty/demo-disabled libraries disable selection and launch honestly. Cap the selector at 180px CSS width; truncate long names with ellipsis, keep the chevron visible, and retain the full name in its accessible label and tooltip.

Choosing a tile opens **Plan layer placement** with **Auto place** and **Place manually** as equal buttons side by side. Center **Cancel** beneath them as muted text with no filled background or border; brighten its text on hover and retain keyboard focus. Keep the top-right × close control. Explain that the model loads only on Run. Cancel preserves the previous model, proposal and active session. Auto place creates an editable sample split; manual placement starts with every GPU/unified-memory assignment blank. Neither action loads or replaces a running model. The demo deliberately uses synthetic counts (Qwen 128; Llama, Mistral and Phi 32; Gemma 42), not verified architecture metadata. Auto place proportionally scales the reference split; it is no optimizer or capacity guarantee. Production planning must use parsed model metadata and reviewed runtime/backend capabilities.

Each non-CPU hardware tile exposes its pencil even when unassigned. Editing first/last fields directly updates one shared proposal across nodes; retain incomplete, reversed, fractional and out-of-bounds text across panel closure/context changes and screen navigation so Run cannot silently reuse earlier valid input. Blank pairs represent unused hardware; partial pairs are invalid. Specific field errors remain associated with their inputs. The entire model layer range must be covered exactly once by supported unique assignments, without gaps or overlaps; using all GPUs is not required. Before Run and Apply and restart, validate the complete proposal against the selected model's layer count and show the red coverage toast on failure. No loading, model switch or restart begins on invalid coverage. In production, capability, reachability, runtime compatibility, model availability and memory preflight also run before launch under the existing integration decisions.

The Run icon and hamburger use 16px glyphs, matching the search icon and the Models header actions after the approved 2026-10-05 refinement. Run, Stop, Apply and restart, and Cancel loading share that size. The Run icon uses the hamburger's 32px circular geometry, borderless transparent default, muted #8b8b8b strokes and #2f2f2f hover shading. Supply Run model tooltip/accessibility text and keyboard focus. When the selected model is active and unchanged, show the Stop icon; pending edits to that active model show a restart icon named **Apply and restart**. A different planned model retains Run. Starting with no session proceeds after validation; replacing an active session requires an interruption confirmation on Run/restart, with Cancel preserving both the active session and edited proposal. No automatic generation follows launch: loading prepares the model for subsequent Chat/API requests.

For this renderer-only milestone, launch uses an observable 800ms simulated Loading state with a **Cancel loading** icon. Freeze model choice and layer editing during it, retain visible disabled fields, and keep the timer/state at the shared app level across screen navigation. Cancellation leaves the previous demo active model/allocation intact and preserves the proposal. Only successful simulated completion changes the shared active model and applied allocation. Overview distinguishes selected model, running model and Not loaded/Loading demo model/Ready simulated. Cards show Planned layers for the proposal and separate Active layers when an older allocation is still in use; hardware In use describes only the active sample allocation.

The user's 2026-10-05 refinement removes the green Ready indicator from hardware cards; retain In use only for hardware in the active sample allocation. CPU tiles and their device-detail sections show hardware information without the Not used for model layers explanation. Non-CPU assignments retain layer labels, unassigned state and editing actions. Allocation bars use white fills on charcoal `#303030` tracks with neutral borders, and layer-range labels and pencils use muted `#ababab` grey with neutral hover shading. Apply this to both planned and applied ranges. Allocation proportions, placement editing, launch validation and the overview's simulated session status remain unchanged.

Remove **Keep draft**, **Save changes**, the **Unsaved draft/Saved proposal** section and its saved-proposal explanation. A quiet **Discard changes** panel action appears only for edited proposals and is unavailable during loading. It restores the active allocation when editing that active model; otherwise it restores the selected mode's initial auto allocation or blank manual baseline. State survives navigation within the demo and resets on app exit. Persistent reusable placement storage is outside this implementation. Future draft-model speculative decoding is not implemented or accepted by this revision; the current no-draft-model/unchanged-quality requirements remain until separately revised and reviewed.

## 6. Chat screen

![Chat reference](references/ui/chat.png)

The user's 2026-10-05 PROCEED approves the revised ChatGPT-style layout, using the reviewed mockup and subsequent divider clarification. Preserve the app's existing 50px icon rail and 44px title bar. Home now opens Chat; Chat also remains accessible through More. The existing Models startup destination is unchanged.

The conversation sidebar is flat `#1c1c1c`, between the `#212121` icon rail/chrome and the `#181818` chat background. Rounded exposed corners belong to the outside of the combined workspace, including the sidebar's outer left corners. The sidebar-to-chat boundary is straight, with no inner rounding or shadow and a single low-contrast 1px `#303033` divider. This Chat-specific geometry supersedes the earlier generic right-panel rounding guidance. The user's subsequent PROCEED widens the sidebar to 240 CSS px at all supported desktop widths, matching the reviewed ChatGPT panel proportions. This replaces the earlier 210px width and 190px narrow-window override. Omit the ChatGPT word, replacement brand heading, entire right artifact panel and all top-right conversation toolbar icons. Keep the title, centred message/composer column, grouped history and New chat/search actions.

Reuse the approved Segoe UI/system stack and role tokens: 16px conversation heading, 14px messages/composer text, 14px sidebar New chat/conversation titles/search text, 14px semibold (600) Today/Yesterday group labels, 13px other control text and 12px status labels. The sidebar sizes reflect the user's subsequent PROCEED and apply only within the Chat sidebar. Action icons use 16px glyphs in 32px targets; the composer model chevron is 14px. The model pill has 13px text, 18px line height, 1px vertical/14px horizontal padding and an 8px gap. The existing outer workspace radius remains 16px; the composer uses 20px corners. Keep independent history/message scrolling clear of outer corners, with no horizontal overflow at the supported 1000px minimum window width.

For this renderer-only milestone, the user selected **Send unavailable for now**. Send and attachments remain visibly unavailable with explanatory titles; no generation, queue, model load, attachment read, storage or network operation is added. Demo mode shows four explicitly marked sample conversations. New chat, history selection/search, independent drafts and mutually exclusive response feedback live only in app memory, surviving screen navigation and resetting on full restart. New chat focuses the composer and reuses an untouched empty chat instead of accumulating empty entries. Copy writes only the explicitly chosen response, reporting success or a recoverable failure. All message/draft strings render as plain text. The composer reflects the globally active model; its dropdown offers Choose model in Cluster without silently switching it. Non-demo mode starts with one empty chat and no sample messages.

The user's 2026-10-06 Chat-sidebar PROCEED reuses the finalized Settings panel treatment: 14px semibold (600) muted date headings with 0px top/12px horizontal/6px bottom padding, 6px vertical/12px horizontal conversation-row padding, 18px row line height and 1px gaps between adjacent rows within each date group. Rows are 30px tall and retain their existing 10px highlight rounding. Expanded Search chats uses #2e2d30 fill and border while preserving 32px height and existing placement. This supersedes the earlier 13px regular date headings, 12px heading top padding and 38px contiguous rows. Preserve the 240px panel, 14px New chat/title/search text, charcoal background, header actions, search toggle/filter behaviour, composer and main conversation layout.

The subsequent gap-only PROCEED adds 19px above each later date group so the visible gap from the last Today entry to Yesterday matches New chat to Today with search collapsed. Preserve the heading-to-entry spacing, row padding, 1px inter-row gaps and first-group position. Expanded search retains its existing insertion behaviour.

The requirements below remain release acceptance targets. U15-U16 now have
partial Windows development storage/request evidence; demo interactions alone
do not close production persistence, mixed Chat/API scheduling, other-platform
or full Markdown-rendering acceptance.

- U15 (P4): Create/select/search locally stored conversations. Keep draft, queued, generating, complete, cancelled, interrupted, and failed states distinct. Saved partial output retains its terminal status; a restart does not turn it into a completed answer.
- U16 (P4, P8): Send validates the active model/session and settings, then reports queue/busy/progress. Provide a clear cancellation/stop action during generation and queued cancellation. Model selection cannot silently switch the globally active model.
- U17 (P4): Generation settings are accessible from the shown controls and identify the current configured model/runtime/context/sampling state. Safe text/Markdown rendering and copy behavior follow the security specification.
- U18 (P9): The approved later revision removes response thumbs-up/down; retain Copy and live Retry, with recorded generation/prompt-processing rates inline as specified in section 10. Attachment formats/capabilities, plus, and remaining overflow behavior still require D08. Do not invent multimodal support, executable tools, automatic retrieval, account synchronization or remote feedback submission from these icons. Preserve other reference controls and separately approved amendments; settle functional scope before release rather than shipping silent no-ops.

The sample conversation's claims about tensor/pipeline/data/hybrid parallelism are illustrative text, not approved supported features. Test fixtures may reproduce reference composition for visual review without presenting those claims as product documentation. New chat and per-chat saved drafts, startup history and confirmed deletion are implemented in the explicit development build. Any future new-chat dropdown, wider storage/platform behavior and complete runtime error recovery retain their affected review/acceptance gates.

## 7. API screen

![API reference](references/ui/api.png)

Preserve Server and Access cards, endpoint/copy area, statistics, network selector, masked key controls, and the Integration example panel with language tabs and copy action.

- U19 (P4, P8): Expose server lifecycle, actual bound address, starting/running/stopping/failed states, and actionable launch errors. Define start/stop controls within the reference's action/menu language; do not invent a new dominant layout. Copy endpoint copies the actual address.
- U20 (P4, P8): Default to local-only access. Enabling LAN/private exposure is explicit and requires an API key. Explain allowed interfaces/scope and client impact. The screenshot's optional-key label cannot override the agreed mandatory network-key rule; a necessary label change is a recorded behavior clarification, not a redesign.
- U21 (P4): Key status is masked by default, with explicit reveal/copy/regenerate actions governed by reviewed credential policy. Regeneration explains affected clients. Localhost requires a key by default; D07 settles consequences for existing sessions and key lifecycle.
- U22 (P4, P6): Examples use the actual endpoint and served model ID, supported API fields, and secret placeholders. Python/cURL/JavaScript/SDK tabs are integration examples; they do not add those languages to the app stack. Verify examples against the supported API contract before release.

Define uptime as the live API server instance uptime, request-count scope/reset rules, and response-time semantics/window under D07. Network RTT, time to first token, and total generation time are different metrics. Do not copy the reference's 92 ms into production or imply it is a completed generation time. Examples/access states must stay readable without leaking keys.

### Authorized API presentation, 2026-10-05

The user's PROCEED adopts the final centred, stacked mockup, using Model configuration as the layout and sizing reference. Use its 800px maximum column width, 24px top/32px bottom page margins, 24px title, 40px header-to-section gap, external 14px medium section headings, 14px heading-to-card gap, 36px between sections, 16px group rounding and horizontal insets, and 14px row padding. Stack Server, Access, Integration and Server logs in that order. Keep the main workspace flat `#181818`, groups `#222222`, fields `#262626`, neutral borders/text and existing shared font roles. Omit the header button, model identity/GGUF/quantization row and old summary footer. The user's subsequent navigation correction places the existing Server icon directly after Models in the sidebar and removes API from More. Match the other rail icons' 20px size, 1.75 stroke width, 36px button, spacing, keyboard focus and neutral selected state. Reuse the existing outer main scrollbar, including its 40px top/bottom track margins and clear rounded corners. Code/log viewers scroll independently and contain wheel scrolling at their ends.

This milestone is presentation only. Show Stopped and unavailable statistics, a clearly labelled example localhost address with disabled copy, and no bound server claim. Start, exposure selection, key generation/reveal/copy, and empty-log Copy/Clear controls remain disabled with explanations. Local only is the default preview state; authentication remains required, with no optional-key switch. No keys or logs are fabricated. The active model reflects the shared simulated library and is explicitly labelled demo, or Not loaded when absent; Choose in Cluster navigates without changing the model. Server logs is an empty, scrollable monospace viewer until a real log source exists.

Python/cURL/JavaScript/OpenAI SDK tabs select local illustrative snippets with `YOUR_API_KEY` and `YOUR_MODEL_ID` placeholders, never real credentials. Keyboard arrows/Home/End and a single tab stop support selection. Copy is an explicit user action with success/failure feedback and the existing sandbox-compatible selection-copy fallback, shared with Chat; no clipboard reads or new permissions/IPC are added. Snippets render as text and never execute. These examples do not close D07 or certify an SDK/API contract. Production U19-U22 remain integration requirements.

## 8. Settings screen

![Settings reference](references/ui/settings.png)

Preserve the left category panel, darker foreground detail panel, Appearance selection, theme/accent/density controls, toggles, and spacing. Categories are Appearance, Runtime, Storage, Network, Diagnostics, and Advanced.

**Approved Settings preview, 2026-10-06:** The user selected unavailable controls for this first screen. Match the updated Chat sidebar: 240 CSS px at all supported desktop widths, flat `#1c1c1c`, 14px category/search text and 14px semibold (600) group labels, following the later Preferences-heading PROCEED. Use an 18px Settings heading, existing Segoe UI/system stack, 16px category glyphs, 10px selected-row rounding and `#2f2f2f` selected fill. Reuse the outer 16px workspace rounding with a straight low-contrast 1px `#303033` divider and no inner rounding/shadow. Main details use the same `#181818` background as Models/Cluster.

The user's subsequent sidebar-spacing PROCEED uses 6px top/bottom and 12px horizontal category-row padding, 18px line height and a 1px gap between adjacent rows. Rows are therefore 30px high with 14px text; selected and hovered highlights retain the existing 10px rounding. This replaces the initial 10px vertical padding and contiguous 38px rows. That spacing authorization did not change the group label. The later explicit PROCEED sets Preferences to 14px semibold (600), using shared typography tokens and retaining its muted #ababab colour. Chat Today/Yesterday labels remained 13px regular at that revision; the later Chat-sidebar PROCEED in section 6 adopts 14px semibold headings. The supplied crop measures 52 physical pixels per highlight and 2 pixels between them, approximately 30px/1px at assumed 175% scaling.

The later search-gap-only PROCEED removes the group label's 12px top padding. This moves Preferences text and all category rows exactly 12 CSS px upward while preserving the Search field and Settings heading positions. Search-container bottom padding stays 10px, category-container top padding stays 6px, and group-label horizontal/bottom padding stays 12px/6px. Fonts, colours, category-row padding, 1px row gaps and the detail pane are unchanged.

The subsequent search-colour PROCEED matches the supplied ChatGPT crop's sampled fill, RGB(46, 45, 48), as #2e2d30 for the Settings search background and border. Keep the existing 32px field height, width, padding, rounding, text/icon treatment and position. This local Settings override does not change the shared search component or other screens.

Centre a maximum 728px column within the remaining right pane, not the entire window. This supersedes the generated preview's wider card column and earlier 800px Settings proposal; Model configuration/API retain 800px. The original 2559x1599 reference has a 1274px card width and approximately 376px/381px margins to the divider/scrollbar. At assumed 175% display scaling these correspond to about 728px and 215px/218px; this is screenshot-derived geometry, not live reference computed styles. Use automatic equal side margins, minimum 24px detail padding (18px at widths up to 1050px), 44px top/32px bottom padding, 24px main title, 40px header gap, 14px medium section headings, 14px heading-to-card gap, 36px section gap, 16px card rounding/insets and 14px row padding. Retain independent category/detail scrolling with 40px top/bottom scrollbar-track insets. Controls reflow without shrinking fonts at the 1000px minimum supported window width.

Appearance stacks Theme, Interface and Accessibility. Dark/Neutral/Comfortable and switch states are illustrative, disabled preview controls with explanations; they do not apply global settings. Category search matches labels and setting keywords, clears with Escape, and reports no matches. Selected category survives screen navigation in app memory and resets on reload. Search is local view state. Runtime stacks Installed runtimes, Runtime selection and Runtime settings. Manage installed runtimes opens an accessible empty inventory dialog; no versions, installed/active engines or compatibility are fabricated. Update/selection/log/download controls remain disabled. Storage, Network, Diagnostics and Advanced show explicit pending content instead of inventing unreviewed controls; Network offers Open API settings. No persistence, theme switching, runtime/files/network operations, new permissions or IPC are added.

- U23 (P7): Appearance handles dark/light/system selection, accents, density, status/metric visibility, animations, reduced motion, and contextual help. Section 2.2's neutral dark palette supersedes the reference's general blue-action baseline; preserve the supplied comfy density and settings layout. Light/system palettes and accent mappings still need review. Honor OS reduced-motion preferences and do not let decorative motion delay actions.
- U24 (P5-P6): Runtime provides supported install/select/update/rollback actions with installed/selected/active engine identities, source/build/platform/backend compatibility, download/verification progress, coordinated worker selection, failure, and retained working rollback. Upgrading llama.cpp requires no app reinstall, compilation, or manual process launch. Switching happens between sessions and preserves models/chats/placement preferences. Show the affected work before restart/activation and report a failed candidate without losing the usable GUI.
- U25 (P3, P8): Storage shows model/cache locations and limits, actual use, transfer/cache progress, and scoped cleanup. Distinguish deleting managed cache from deleting an original user file; protect active required data.
- U26 (P2): Network handles LAN/Tailscale/Headscale cluster connectivity, reachability, approval/path details, and actionable enrollment failures. Provide a link to the API screen for API exposure; do not create two contradictory access-policy editors.
- U27 (P6): Diagnostics shows worker/runtime/API health, defined metrics, concise logs, and a redacted export. Advanced includes only approved options; it cannot enable draft-model decoding, weaken access restrictions, or accept unverified updates.

Appearance follows the supplied detail-view reference. The Runtime preview uses the user's subsequent LM Studio screenshots for its section structure, while retaining ModelLoom's shared visual language and explicitly unavailable integration. Storage/Network/Diagnostics/Advanced still need reviewed detail layouts before their controls are implemented. Production runtime operations, persistence and immediate-versus-confirmed change behavior require their affected contracts; do not assume every setting applies live.

- U28 (P5-P6): If llama-server terminates or crashes, keep the GUI available, show affected model/API/session state and interruption, retain partial text with its status, and offer controlled recovery. Full Quit stops desktop-owned core/runtime/helpers with bounded confirmed cleanup; separately launched headless deployments are unaffected. Window X performs full Quit, as approved; minimize is distinct and no silent tray/background continuation is introduced. Runtime switching, loading, and queued work must not conceal shutdown or restart failures.

Windows desktop acceptance checks the engine beneath the ModelLoom app group and allows the llama-server name and separate Details PID. Do not add fake process-hiding UI or promise invisible execution. The precise grouping and other helper names are verified under D01; macOS/Linux visibility is documented separately. No visible terminal appears in normal use. This changes runtime acceptance, not the supplied screen layouts.

## 9. Accessibility and visual verification

Acceptance J12 includes all five populated reference compositions plus empty/loading/error/interrupted states, with the approved revisions applied. Compare composition against the ModelLoom references and font sizes by role against the ChatGPT reference under section 2.1. Compare matching captures side by side and by overlay/difference when helpful, controlling fonts, fixture data, scroll position, scaling, and motion. Record discrepancies and get approval for intentional deviations. Do not claim pixel-perfect verification from a screenshot pasted into an otherwise unimplemented shell.

Check keyboard order/activation, focus after modal/menu close, screen-reader names and status updates, readable contrast, text scaling, reduced motion, and status meaning without color. Scrolling must keep actions reachable without hiding the composer behind content. Test window controls and resizing on each supported platform.

J13-J15 separately cover GUI survival after ordinary engine crash, owned-process Quit/abnormal-exit behavior, and desktop/headless runtime management reuse. Static reference images and a responsive mock GUI cannot establish those lifecycle results.

Real data replaces illustrative values without changing design. Security/behavior labels that must differ from the mock, navigation inconsistencies, unsupported reference actions, and missing assets go through D08 and the relevant product/security decision. They are not permission for arbitrary visual changes.

Local browser captures, source/layout comparisons and packaged Windows UI checks have been performed for the current demo, including the separately authorized Settings preview; see TESTING-SPEC section 10. They do not establish pixel identity, production Settings behaviour, runtime accessibility or Linux/macOS acceptance. Historical documentation reconciliation alone did not authorize implementation; the later Settings PROCEED is recorded in section 8.

## 10. Approved response speed row (2026-10-09)

The user authorized removing Chat's thumbs-up/down controls and placing measured
speeds after Copy and live Retry on the same row. Use `Generation: … tok/s` and
`Prompt processing: … tok/s`, with no extra icons or dot separator. Use the existing
12px metadata token, normal weight, muted `#ABABAB`, and 16px spacing. Allow wrapping
when necessary to keep the row within the content viewport.

Use native `predicted_per_second` and `prompt_per_second` diagnostics from the
validated final stream. Generation includes thinking tokens. Hide missing,
invalid or nonpositive rates, including a zero prefill rate for a cached prompt;
do not invent rates for older responses or sample conversations. The user chose
to save rates with each final response, so recorded rates remain visible after
app restart when history is available.

## 11. Approved thinking-duration row (2026-10-09)

Keep the existing brain icon, chevron, font, color and expandable behavior. While
thinking is active, show `Thinking` with no ellipsis. Once the answer starts or
thinking stops, show `Thought for 12s`, `Thought for 9m 36s`, or hours when needed.
Durations under a second use `Thought for <1s`. Time is measured from the first
thinking text until the first answer text, or termination/cancellation if no
answer starts; exclude waiting/prefill and later answer generation. Save that
duration with the attempt so it survives app restart. Older responses without a
recorded duration show `Thought`, with no invented historical time.

## 12. Approved chat deletion and title overflow (2026-10-09)

The user's later PROCEED selects Lucide `Trash2` for now: a 16px muted `#ABABAB`
glyph in the existing 32px action target, fixed at the row's right edge. Show only
that action on row hover or visible keyboard focus; touch surfaces keep it
available. Preserve the 240px sidebar, row spacing and selection highlight.
Selection and deletion are separate buttons with clear accessible names.

Long titles fade across the final 24px instead of using an ellipsis. Hover or
keyboard focus reserves space for the trash button. A 700ms animation delay plus
the initial 15% hold of a minimum four-second leg means visible movement begins
after at least 1.3 seconds; longer titles have a longer initial hold. Move
the overflowing text left to reveal its ending and return it smoothly. Measure
the actual overflow; short titles remain still. The trash button stays fixed and
leaving the row resets the title. Reduced-motion preferences disable scrolling.

Clicking trash opens the existing confirmation dialog with Cancel and Delete.
Cancel/Escape preserve the chat. Confirmed deletion stops that chat's active
response first and removes its saved messages, thinking, metrics and draft.
Deletion remains available without loading a model. Failure keeps the chat/draft
and reports an actionable notice. Deleting the selected chat opens an empty New
chat and focuses the composer; deleting another chat keeps the current selection.

The user's 2026-10-10 popup correction applies section 2.2's neutral treatment
through the shared dialog defaults: `#262626` background, `#383838` border,
`#F3F3F3` heading/enabled text and `#ABABAB` supporting text. Keep Segoe UI and
the shared 18px/500 heading, 14px/400 body and 13px/500 dialog buttons. Footer
actions use pills: charcoal `#303030` Cancel, white Delete with `#181818` text.
Use neutral backdrop shading and the shared 32px close target. This corrects the
old blue-grey defaults; confirmation, focus restoration and deletion behavior
are unchanged.

The 2026-10-10 review-fix PROCEED keeps this layout and corrects four live
behaviors. Stop also cancels prompt preparation before generation starts and
retains the unsent draft. Search finds saved titles, user messages and answer
text in unopened chats, including after restart and without a loaded model.
Show Searching while a changed query is pending. Group saved conversations by
their last update date as Today, Yesterday or Older using the user's local
calendar. Older uses the existing date-heading treatment and spacing. New chat
reuses an untouched empty chat; existing drafts and conversations with messages
are preserved. Thinking, measured speeds, deletion confirmation, Copy/Retry and
the inference configuration keep their existing behavior.

The subsequent 2026-10-10 PROCEED removes sample initialization from ordinary
startup and rebuilding. Models shows only actual imported models; Cluster shows
only detected/connected devices. Missing or disabled runtime integration shows
an empty/unavailable state while retaining any detected local hardware. Sample
models, devices and conversations remain opt-in test/demo fixtures only. The
Windows development launcher prepares its existing approved core before opening
the app, and a preparation failure stops startup instead of substituting samples.
This preserves screen layouts, saved chats and existing runtime security gates.

## Connections layout revision, 22 October 2026

The subsequent canvas-picker revision replaces the contextual Add device panel's
connection forms with Add to canvas. Keep the device-details header's back arrow,
title alignment and muted subtitle: "Choose a PC to add to this canvas." List
approved remote PCs not yet placed as clickable name/hardware cards, followed by
a matching dashed card with a centered plus. With no candidates, show only the
plus card. It opens Connections → Add device. Selecting a PC places it on the
canvas and closes the panel. New peer approval alone does not place it; placement
choices are session-only, while saved assignments and active allocations keep
their referenced PCs visible. Connecting, approving and placing remain separate
actions; the picker never grants peer access.

Remote node menus include Remove from canvas below Rename device. The local PC
never offers this action, regardless of its coordinator/worker role. Removal is
session-only presentation state: retain pairing and inventory, remove the node
and its displayed links, and make its card available in Add to canvas again.
Disable removal during model loading, any running model, automatic assignment,
configuration saving, and while the PC has layer assignments or an active
allocation. Do not clear assignments, revoke access or stop a workload implicitly.

The user's PROCEED adopts the supplied Connections reference and the subsequent
Join cluster, Share this PC and Add device mockups. This supersedes the separate
Requests destination and header action trio described earlier in this document.

- Keep one Connections destination in the Cluster sidebar. Its right-side badge
  counts incoming pending requests and is omitted at zero. Remove the separate
  Requests and Add device sidebar destinations; contextual canvas Add device
  controls still work.
- Reuse Appearance's Settings details surface, 44px top inset, 728px centered
  column, page-title typography and 40px heading-to-first-control gap. Remove
  the Connections subtitle and its reserved space.
- Below Connections, render compact Join cluster, Share this PC and Add device
  tabs in that order. Only the active tab has a neutral rounded background.
  Keep the Connections title while switching tabs. Support arrow keys, Home,
  End, visible focus, and properly associated tab panels.
- Use Settings sections and rounded groups. Share this PC places Allow
  connections and approved coordinators in its first group, then separate GPU
  rows under Shared hardware, the existing address selection, and incoming
  Requests. The address selector reuses Model Configuration's ConfigurationSelect
  component, including the Stop at Limit pill and its dropdown. Omit the setup hint
  and App identity disclosure from the page; identities remain in the verification
  dialog and setup instructions remain in Add. Approval, denial and
  revocation continue to require existing acknowledged peer commands.
- The share toggle and Model Configuration toggle use the same shared artwork:
  32px track width, 20px track height, 16px thumb. GPU checkboxes use the existing
  shared Checkbox module, including its 16px artwork and neutral checked state.
- Add device and Join cluster use grouped available-PC rows and an immediately
  visible manual-address form. The small section-header Add action focuses that
  form; Share's Add opens instructions for connecting from the other PC.
- Production views show actual supplied peer state and honest empty/unavailable
  states. This UI revision does not implement discovery, outgoing Join requests,
  or pairing codes. Existing full-fingerprint verification remains mandatory;
  approval alone must not be labelled as a verified live connection. Demo actions
  remain explicitly simulated and never alter live placement or authorization.

### Devices grouping and direct navigation (2026-10-22)

The approved Devices revision stacks PCs vertically, with System, CPU, Memory
and each GPU grouped under its PC. Unified-memory hardware keeps appropriate
labels without double-counting VRAM. Retain reported fields and explicit unknown
values; omit Last checked. Use the existing Settings page alignment, 18px PC
names, 14px medium group headings, 12px labels/values, 40px minimum rows,
12px card corners, 20px between groups and 40px between PCs. Long names/values
use the shared per-line fade and hover scrolling, respecting reduced motion.
At narrow widths, values stack under labels.

Device details in the canvas inspector replaces the inline disclosure with
navigation to Devices. Scroll to and focus the matching PC heading, with a brief
subtle highlight suppressed under reduced motion. Returning to Overview restores
the selected panel and preserves canvas membership and viewport. This navigation
does not pair a PC or place it on the canvas.

### Live approved-peer hardware (2026-10-22)

PTSS reports its own OS, architecture, CPU, memory, GPU memory/driver and verified
runtime backend facts through the existing mutually approved peer connection.
Unknown readings stay unknown. Renderer inventory is presentation only; native
placement still rechecks owned resources and physical GPU identities.

Use the accepted local native device-change scan to publish hardware changes.
An authenticated bounded inventory watch wakes when the worker publishes a new
snapshot, then utility/main/preload invalidations refresh Devices and canvas
without waiting for their fallback poll. Routine memory telemetry reuses the
10-second scan cache. A network failure requires bounded detection, not a claim
of zero elapsed time. Each idle watch renews after three seconds inside the
existing five-second exchange deadline; Quit cancels watches and retries.

Only shared enabled physical GPUs appear remotely. Disabling/removing one removes
its available card; re-enabling it restores it if its sharing permission remains.
A disconnected peer's whole Devices section and canvas node disappear; retain
its existing connection record for recovery. Do not invent durable pairing
persistence across application restarts. Affected planning/loading/running work
is interrupted through the existing owned stop path, retaining cleanup gates;
unrelated local work and ordinary free-memory changes continue.

Retain the last accepted display while a replacement snapshot is read, discard
superseded replies, and clear failed/disconnected data. Both desktops require the
updated peer reporter for this live contract. Local TLS fixtures and browser
fixtures do not establish a successful PTSS deployment or a live hardware test.
An older approved peer that rejects the live-inventory extension must not be
classified as disconnected for that reason alone. Recheck the existing approved
status and shared GPU inventory through the same authenticated connection; retain
basic inventory with unknown extended facts. Use bounded compatibility refresh
until both apps support the live reporter. Actual connection/authentication/read
failure still removes availability. Reporter compatibility never grants approval
or bypasses sharing, fingerprint, reservation or runtime checks.

### Manual six-digit pairing (2026-10-22)

Retain the Connections heading, design and spacing, with two tabs: Share this PC
and Add device. Share this PC contains sharing controls, shared hardware and
incoming requests and approvals. Add device contains manual LAN or Tailscale IP
entry, six-digit verification and outgoing remembered PCs. Remove the separate
Join cluster tab; this supersedes the earlier requirement to retain all three
tabs. Rename Invite to Connect. Do not substitute short-code device lookup,
discovery or embedded network enrollment. Adding a paired PC to the canvas
remains a separate action.

After connection, automatically open a six-digit numeric-code dialog on the
initiator; preserve leading zeros and permit paste. The receiver's Requests row
opens one dialog showing its transient code and waiting state. After verified
code entry, that same dialog shows Allow/Deny for shared GPU access. The initiator
shows waiting for approval and then the truthful approved/connected state.
Remove manual fingerprint comparison from this normal flow; core verification
and exact identity pinning remain mandatory. Failed verification/cancellation
keeps the dialog usable, and expiry, exhausted attempts, changed identity and
unreachable PCs produce specific messages. Successful saved trust reconnects
without re-entering a code while current sharing permission permits it.

### Canvas membership and device panels (2026-10-23)

Pairing and canvas membership remain separate. Paired available devices stay in
the Devices inventory, sidebar and Add to canvas picker even when they are not
on the current canvas. Opening an off-canvas device shows its identity, Device
details link, the helper text "Add this device to canvas to assign layers."
and an Add to canvas action. Do not show layer assignment fields until the device
is on the canvas. Adding it reveals those fields in the same panel; removing it
returns that panel to the off-canvas state.

Disable Add to canvas while a model is loading or running, or automatic layer
assignment is in progress. Cluster overview hardware counts, GPU memory totals
and device assignment rows include only devices on the current canvas. Automatic
layer assignment likewise considers GPUs only from devices on that canvas.

### Automatic Windows sharing readiness (2026-10-23)

Place the inspected two-tone spinner directly after Allow connections. Show the
spinner and "Starting sharing…" only while an actual sharing-start operation is
pending. Keep the switch off and disabled until the selected GPU helpers, listeners
on the selected address, and the owned firewall rule are ready. A local startup
failure appears inline; a pending or failed start must not appear as sharing on.

Native PTSS checks confirmed TCP reachability on both sharing ports and subsequent
cleanup. A later human-approved app startup also loaded the verified helper update,
enabled sharing with both GPUs selected, and allowed PTSS to reach both actual
Electron listeners. These checks do not establish fresh app pairing, inference or
production release readiness.

### Default shared GPU selection (2026-10-24)

Connections reads local GPUs, sharing state and addresses without waiting for
remote status checks or queued network operations. Background checks continue
updating pending, approved, declined and disconnected peers. Reading the page
does not grant remote hardware access or replace fresh runtime authorization.
If a read fails, retain the last inventory and show a Retry action. An initial
failure replaces the loading placeholders with this error state.

All detected GPUs start checked in Shared hardware. Newly detected GPUs also
start checked. Keep explicit unticks through inventory refreshes while the panel
is open, including when that GPU disappears and returns. Removed GPUs must not
remain in a sharing request. If every available GPU is unticked, disable Allow
connections until at least one is selected. Selection alone does not start
sharing; the user still enables Allow connections. While sharing is active,
display the actual shared GPU IDs and keep selection controls disabled. This
revision does not add persistent preferences across app restarts.

### Canvas edge add affordance (2026-10-24)

The approved mockup replaces the always-visible single-node plus with one add
button per hovered or keyboard-focused card, positioned on the edge nearest the
pointer. It can occupy the top, right, bottom or left edge; never display four
pluses together on one card. Keep the active edge pinned while its picker is
open and retain it while crossing onto the button outside the card. Use a quiet
150ms opacity fade, without moving animations, and disable the fade for reduced
motion. Keyboard focus reveals the control; arrow keys choose its edge and
Enter opens the existing picker.

A lone card shows the small muted hint "Hover near an edge to add a device."
beneath it. Fade the hint out on hover or focus. After the first successful
addition, retain dismissal as an optional local presentation preference; denied
browser storage falls back to dismissal for the current page session.

The chosen PC is added on the selected side of the source card. Occupied cells
move the new card farther along that direction; automatic row heights prevent
overlap between cards of different heights. Neutral dotted lines describe canvas
placement only. They do not invent latency, authenticated network links, or
inference order. Layer assignments remain authoritative. Removing or losing a
card removes its displayed placement lines. Existing loading, running, planning,
saving and removal restrictions remain in effect.

### Connection monitoring panel (2026-10-24)

Real canvas placement lines expose a clickable midpoint control. A measured local
peer connection shows its control round-trip time in milliseconds; unavailable
measurements show a dash. Clicking opens Connection details in the same right
panel, with a back arrow to Cluster overview, both device names, status and latency.
The latency includes control connection setup and is not inference latency.

When both PCs are idle, core automatically samples sending and receiving bandwidth
with bounded transfers and a cooldown. A loaded model can be idle. Loading,
planning, token counting and generation cancel bulk tests before native work
starts. During active work, the panel shows sending and receiving rates from
existing RPC byte counters, from this PC's perspective, without extra bulk traffic.
Idle bandwidth is labelled Last measured bandwidth, distinct from live traffic.
Unavailable observations retain historical values with explicit labels; unsupported
older reporters remain usable. Do not fabricate a direct measured connection
between two remote worker cards merely because a placement line joins them.
