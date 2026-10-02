# ModelLoom UI specification

**Status:** Agreed visual references; shared shell and Models demo implemented for visual review
**Updated:** 2026-10-02
**Related:** [product](PRODUCT-SPEC.md), [integration](INTEGRATION-SPEC.md), [security](SECURITY-SPEC.md)

Runtime behavior follows [ADR-0002](decisions/0002-lm-studio-runtime-direction.md): LM Studio GUI/core/runtime direction, accepted grouped llama-server, independent upgrades, ordinary engine-crash isolation, and desktop-owned shutdown. The [runtime process screenshot](references/runtime/README.md) is lifecycle/presentation evidence, not an additional UI-screen design.

## 1. Visual source of truth

The user requires the app to match the five supplied ModelLoom screens, subject to the explicit revisions below. The unchanged images are preserved under [references/ui](references/ui/README.md). Match the approved layout, spacing, proportions, colors, icons, cards, controls, and status bars; do not substitute a generic dashboard or redesign the composition. Font sizes follow the ChatGPT reference by text role, as defined in section 2.1, rather than the original ModelLoom screenshots.

| Screen | Reference | Comparison image size |
| --- | --- | --- |
| Models | [models.png](references/ui/models.png) | 1280 x 720 |
| Cluster | [cluster.png](references/ui/cluster.png) | 1280 x 720 |
| Chat | [chat.png](references/ui/chat.png) | 1280 x 720 |
| Settings | [settings.png](references/ui/settings.png) | 1280 x 720 |
| API | [api.png](references/ui/api.png) | 1672 x 941 |

These are image dimensions, not assumed CSS viewport sizes. Capture equivalent frame/content bounds and record OS scaling/device pixel ratio during implementation comparison. Resolve exact font/icon/logo assets and any measurable visual tolerance under D08. The images are required design references, not proof of asset licensing or evidence of runtime capability.

The user's supplementary [panel-layering.png](references/ui/panel-layering.png) clarifies the aesthetic: where there is a sidebar and right-hand content panel, the right-hand panel is **darker**, reads as a **foreground surface above the sidebar**, and has **rounded exposed corners**, especially the visible top-left boundary. 'Above' describes visual stacking, not moving the panel upward on the page. Keep separation subtle; do not add a heavy border or pronounced shadow absent from the references.

The user's later comparison makes the ChatGPT app the proportion reference for the outer title bar and left icon rail. Use a taller title bar and narrower rail than the initial ModelLoom demo, preserving the supplied ModelLoom screen contents and panel layering. The current visual-review dimensions are a 44px title bar, matching native window-control overlay, a 50px rail, and centered 36px rail buttons. These are CSS dimensions derived approximately from the scaled reference; compare captures at matching OS scaling before claiming an exact visual match.

The user's subsequent header revision removes the separate ModelLoom logo/name row and the Models subtitle. Align the Models heading, search, view toggle, Import GGUF, and Download models controls in one centered row at supported desktop sizes. Keep the demo indicator in the bottom status bar, outside the header. This explicit revision supersedes the branding row and Models subtitle in the original screen references.

The first authorized milestone implements this shell and the Models screen with a visible **Demo data** indicator. Search, view switching, confirmed simulated model switching, stopping, details, and confirmed demo-entry removal operate locally. Import/download controls explain their unavailable integration; no file transfer or inference is simulated as a real operation. Cluster, Chat, API, and Settings remain explicitly labeled next-milestone placeholders. Exact font/logo assets, unfinished screen behavior and visual acceptance still need review; a passing screenshot capture is not a claim of pixel identity.

## 2. Shared visual and interaction rules

- U01 (P7, P9): Preserve the narrow navigation rail, ModelLoom identity, main content composition, blue primary actions/selected outlines, dark surfaces, restrained borders/glow, and persistent bottom status bar shown in the relevant screen image.
- U02 (P9): Use shared components/tokens for buttons, search fields, cards, menus, badges, inputs, panels, spacing, typography, and icons. Derive font sizes from the ChatGPT reference for the corresponding text role; use the approved visual references and assets for other properties. Do not invent exact font names, radii, or pixel values and call them approved.
- U03 (P7): Every actionable element has an accessible name, keyboard operation, visible focus, and a clear disabled/busy/error meaning. Status uses readable text/icon meaning in addition to color. Hover-only controls must also work by keyboard.
- U04 (P4, P6, P9): Data is real in normal operation. Show unknown/stale/unavailable explicitly; sample metrics, names, model layer ranges, and chat text are fixture content only. A hidden optional status display cannot suppress critical errors.
- U05 (P7, P9): Define empty, loading, success, interrupted, disconnected, and failed states in the same visual language. Recovery appears near the affected action with a concise reason and next action; detailed logs are secondary.
- U06 (P7): No mandatory onboarding wizard or tour. Make add-device, choose-model, start, chat, API access, and runtime controls discoverable in context. Technical explanations remain short and useful.

Window controls must remain operable with the correct platform behavior. The target dark references are the visual acceptance baseline. Light/system appearance options shown in Settings require reviewed theme behavior/assets; no light reference has been supplied. Define smaller-window behavior, scaling, minimum sizes, and overflow under D08 before claiming acceptance there. Preserve readability rather than shrink controls into unusable targets.

### 2.1. Font sizes by text role

**Approved scale; applied to the existing desktop views:** Use the concrete CSS sizes below, selected using the user's ChatGPT conversation, Library, and Scheduled references. Shared tokens now cover the Models screen, menus, dialogs, footer, and unfinished-screen placeholders. The chat-message token is defined for the future Chat implementation. The original five ModelLoom screenshots are no longer a font-size requirement. Their composition remains applicable except for the separately approved shell/header revisions.

| ModelLoom text role | CSS font size | Reference role and application |
| --- | --- | --- |
| Main page headings | **24px** | Library-style main heading; Models, Cluster, API, Settings, and any full-page Chat heading |
| Sidebar, section, and dialog headings | **18px** | Scheduled-style sidebar heading and comparable section titles; includes conversation-list and settings-category headings |
| Model names, device names, and card titles | **16px** | Titles of suggestion cards; use the same role size for active and inactive model names |
| Chat messages | **16px** | Conversation text |
| Dialog body and explanatory text | **14px** | Body copy, help text, and supporting card descriptions |
| Buttons, menu options, and search/input text | **14px** | Action and control text, including placeholders |
| Metadata labels and values | **12px** | Compact model/device metadata; distinguish label and value through approved weight/color rather than different sizes |
| Secondary labels, status labels, badges, and timestamps | **12px** | Compact supporting and status text, including the footer and demo indicator |

Define these values in one shared typography scale and reuse the corresponding role across all five screens, menus, dialogs, and states. Select the role by purpose: a heading inside a sidebar uses 18px even when it names a screen; a main page heading uses 24px. Match roles rather than forcing every text element to use the same size. Use this approved table when implementing the typography change; future role exceptions or scale changes require a recorded user-approved revision.

These are approved ModelLoom design values chosen by visual judgment, not claims that ChatGPT's underlying CSS has been inspected. Record OS scaling, device-pixel ratio, app zoom, and any image resizing when comparing captures; rendered image pixels are not CSS pixels. The 19px/14px/12px values visible in the supplied ChatGPT conversation describe the earlier ModelLoom styles, not ChatGPT's own computed font sizes. Review captures at matching scale before claiming exact visual parity. The existing font family is retained. Smaller desktop widths reflow model metadata into a second row before tiles become cramped; grid cards retain their full-width metadata area, and role sizes do not shrink at responsive breakpoints.

## 3. Navigation and shared status

The agreed top-level destinations are Models, Cluster, Chat, API, and Settings. Navigation preserves the common rail and clear selected state. Reference icons vary between screens; D08 must resolve semantic mapping without silently replacing the user's design. Home, Storage, Metrics, overflow, download, and profile controls visible in the references need explicit behavior/scope. Do not add account/cloud features because an avatar is present.

The bottom bar shows cluster health, actual participating machine/compute counts, relevant memory information, selected/observed connection path, defined latency measurement, API status, and the Open API action. Distinguish total detected devices from selected/in-use devices and unavailable/stale measurements. The cluster reference contains five GPU devices including Apple Silicon, while its footer says four GPUs; production counts must be computed, and unified memory must not be mislabeled as discrete VRAM.

Open API navigates to the API screen. Cluster indicators expose useful status details without implying a connected path guarantees inference performance. Proposed shared visual primitives include AppShell, NavigationRail, ForegroundPanel, PageHeader, StatusBar, StatusBadge, ModelRow/Card, DeviceCard, ActionButton, SearchField, and ContextMenu; these are responsibilities, not approved implementation class names.

## 4. Models screen

![Models reference](references/ui/models.png)

Preserve the header/search/actions, prominent running-model card, compact other-model rows, metadata tiles, blue launch/cluster actions, menus, and footer composition.

- U07 (P3, P4): Import GGUF uses explicit file selection and validates metadata/compatibility before launch. Download models uses the approved Hugging Face GGUF catalogue, with D05 settling metadata/download contracts; show progress, cancellation, failure, origin/license information where available, and local storage location.
- U08 (P3): Search filters the actual library. Display actual architecture, quantization, size, parameter metadata, supported context metadata, and compatibility reasons. Distinguish model maximum context from configured active context.
- U09 (P4, P8): Start targets the selected asset/configuration and performs preflight. One active model is shared with Chat/API. Starting another model requires explicit switch behavior and interruption information. Open in Cluster navigates with the active model context.
- U10 (P6): Show preparing/loading, ready/stopped, running, incompatible, download-failed, and model-load-failed states honestly. Compatibility must be scoped to the selected runtime/backends/configuration rather than a blanket green badge.

Define the model menus, view-toggle control, storage/removal confirmations, empty library, and no-search-results behavior before implementing those interactions. The reference is not a requirement to ship its named model catalogue or specific model sizes.

## 5. Cluster screen

![Cluster reference](references/ui/cluster.png)

Preserve the selected-model header, search and placement toolbar, coordinator/worker cards, CPU/GPU tiles, dotted connection curves with latency labels, assignment bars, editing affordances, menus, and footer.

- U11 (P1-P2): Add device supports LAN discovery/manual private address, Tailscale, and existing Headscale entry points. Discovery, enrollment, approval, reachability, and readiness are distinct states. Show the selected mode and observed direct/relay/unknown path where relevant.
- U12 (P1, P3): Device cards show actual identity/role/OS, approved connection, runtime health, CPU/GPU/backend information, and selected/assigned participation. Indicate compute hardware unsupported by the active runtime with a reason and compatible action.
- U13 (P3, P8): Auto place produces a proposal for actual model/configuration/devices. Manual edit and Save placement preserve a pending revision; show estimated memory separately from actual use. Apply through explicit restart with the interruption warning. Do not silently move layers while generating.
- U14 (P4, P6): A required worker disconnect interrupts affected generation. Mark the peer and model/session appropriately and provide reconnect/restart/removal choices consistent with actual recovery policy.

Connection curves show verified relationships rather than an invented full mesh. Latency labels need measurement scope/unit/freshness; unavailable data remains unavailable. Layer ranges must be valid for the actual model and native placement method; the mock's ranges up to 127 are not a placement contract. List/small-window navigation and graph keyboard alternatives require D08 review while preserving the primary composition.

## 6. Chat screen

![Chat reference](references/ui/chat.png)

Preserve the conversation sidebar, New chat/search actions, grouped history, foreground conversation panel, model/cluster header, message alignment/cards/actions, composer, model selector, and footer.

- U15 (P4): Create/select/search locally stored conversations. Keep draft, queued, generating, complete, cancelled, interrupted, and failed states distinct. Saved partial output retains its terminal status; a restart does not turn it into a completed answer.
- U16 (P4, P8): Send validates the active model/session and settings, then reports queue/busy/progress. Provide a clear cancellation/stop action during generation and queued cancellation. Model selection cannot silently switch the globally active model.
- U17 (P4): Generation settings are accessible from the shown controls and identify the current configured model/runtime/context/sampling state. Safe text/Markdown rendering and copy behavior follow the security specification.
- U18 (P9): Response thumbs-up/down are stored locally against the response. Attachment formats/capabilities, plus, and overflow behavior still require D08. Do not invent multimodal support, executable tools, automatic retrieval, account synchronization, or remote feedback submission from these icons. Preserve their reference appearance; settle functional scope before release rather than shipping silent no-ops.

The sample conversation's claims about tensor/pipeline/data/hybrid parallelism are illustrative text, not approved supported features. Test fixtures may reproduce reference composition for visual review without presenting those claims as product documentation. Define new-chat dropdown, conversation management, unsaved draft behavior, and error recovery through D08/D04 before implementing them.

## 7. API screen

![API reference](references/ui/api.png)

Preserve Server and Access cards, endpoint/copy area, statistics, network selector, masked key controls, and the Integration example panel with language tabs and copy action.

- U19 (P4, P8): Expose server lifecycle, actual bound address, starting/running/stopping/failed states, and actionable launch errors. Define start/stop controls within the reference's action/menu language; do not invent a new dominant layout. Copy endpoint copies the actual address.
- U20 (P4, P8): Default to local-only access. Enabling LAN/private exposure is explicit and requires an API key. Explain allowed interfaces/scope and client impact. The screenshot's optional-key label cannot override the agreed mandatory network-key rule; a necessary label change is a recorded behavior clarification, not a redesign.
- U21 (P4): Key status is masked by default, with explicit reveal/copy/regenerate actions governed by reviewed credential policy. Regeneration explains affected clients. Localhost requires a key by default; D07 settles consequences for existing sessions and key lifecycle.
- U22 (P4, P6): Examples use the actual endpoint and served model ID, supported API fields, and secret placeholders. Python/cURL/JavaScript/SDK tabs are integration examples; they do not add those languages to the app stack. Verify examples against the supported API contract before release.

Define uptime as the live API server instance uptime, request-count scope/reset rules, and response-time semantics/window under D07. Network RTT, time to first token, and total generation time are different metrics. Do not copy the reference's 92 ms into production or imply it is a completed generation time. Examples/access states must stay readable without leaking keys.

## 8. Settings screen

![Settings reference](references/ui/settings.png)

Preserve the left category panel, darker foreground detail panel, Appearance selection, theme/accent/density controls, toggles, spacing, and footer. Categories are Appearance, Runtime, Storage, Network, Diagnostics, and Advanced.

- U23 (P7): Appearance handles dark/light/system selection, accents, density, status/metric visibility, animations, reduced motion, and contextual help. The supplied dark/blue/comfy state is the baseline. Honor OS reduced-motion preferences and do not let decorative motion delay actions.
- U24 (P5-P6): Runtime provides supported install/select/update/rollback actions with installed/selected/active engine identities, source/build/platform/backend compatibility, download/verification progress, coordinated worker selection, failure, and retained working rollback. Upgrading llama.cpp requires no app reinstall, compilation, or manual process launch. Switching happens between sessions and preserves models/chats/placement preferences. Show the affected work before restart/activation and report a failed candidate without losing the usable GUI.
- U25 (P3, P8): Storage shows model/cache locations and limits, actual use, transfer/cache progress, and scoped cleanup. Distinguish deleting managed cache from deleting an original user file; protect active required data.
- U26 (P2): Network handles LAN/Tailscale/Headscale cluster connectivity, reachability, approval/path details, and actionable enrollment failures. Provide a link to the API screen for API exposure; do not create two contradictory access-policy editors.
- U27 (P6): Diagnostics shows worker/runtime/API health, defined metrics, concise logs, and a redacted export. Advanced includes only approved options; it cannot enable draft-model decoding, weaken access restrictions, or accept unverified updates.

Only Appearance has a supplied detail-view reference. Runtime/Storage/Network/Diagnostics/Advanced need reviewed detail layouts using this same shell and control language before visual acceptance. Determine persistence and immediate-versus-confirmed change behavior from the affected contracts; do not assume every setting applies live.

- U28 (P5-P6): If llama-server terminates or crashes, keep the GUI available, show affected model/API/session state and interruption, retain partial text with its status, and offer controlled recovery. Full Quit stops desktop-owned core/runtime/helpers with bounded confirmed cleanup; separately launched headless deployments are unaffected. Window X performs full Quit, as approved; minimize is distinct and no silent tray/background continuation is introduced. Runtime switching, loading, and queued work must not conceal shutdown or restart failures.

Windows desktop acceptance checks the engine beneath the ModelLoom app group and allows the llama-server name and separate Details PID. Do not add fake process-hiding UI or promise invisible execution. The precise grouping and other helper names are verified under D01; macOS/Linux visibility is documented separately. No visible terminal appears in normal use. This changes runtime acceptance, not the supplied screen layouts.

## 9. Accessibility and visual verification

Acceptance J12 includes all five populated reference compositions plus empty/loading/error/interrupted states, with the approved revisions applied. Compare composition against the ModelLoom references and font sizes by role against the ChatGPT reference under section 2.1. Compare matching captures side by side and by overlay/difference when helpful, controlling fonts, fixture data, scroll position, scaling, and motion. Record discrepancies and get approval for intentional deviations. Do not claim pixel-perfect verification from a screenshot pasted into an otherwise unimplemented shell.

Check keyboard order/activation, focus after modal/menu close, screen-reader names and status updates, readable contrast, text scaling, reduced motion, and status meaning without color. Scrolling must keep actions reachable without hiding the composer or footer behind content. Test window controls and resizing on each supported platform.

J13-J15 separately cover GUI survival after ordinary engine crash, owned-process Quit/abnormal-exit behavior, and desktop/headless runtime management reuse. Static reference images and a responsive mock GUI cannot establish those lifecycle results.

Real data replaces illustrative values without changing design. Security/behavior labels that must differ from the mock, navigation inconsistencies, unsupported reference actions, and missing assets go through D08 and the relevant product/security decision. They are not permission for arbitrary visual changes.

No UI capture, implementation comparison, or runtime accessibility test has been performed yet.
