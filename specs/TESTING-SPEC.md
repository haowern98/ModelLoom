# ModelLoom testing specification

**Status:** Production acceptance draft; dated Windows runtime/local Chat and earlier hosted demo evidence recorded separately

**Updated:** 2026-10-10

**Scope:** Product acceptance, contract validation, security, visual fidelity, runtime lifecycle, and inference correctness. This document does not authorize coding, workloads, process termination, or experiments.

## 1. Purpose and lecture basis

**Current evidence summary, 2026-10-10:** The local development implementation
has recorded real-model Chat, four-slot prefill/reuse, protected history/upgrades,
startup-before-model, deletion/restart and neutral-popup evidence. The latest
deletion suites passed 89 desktop/436 core/five Chat browser tests, seventeen
native history cases and one isolated native Chat case. The popup correction
passed eighteen selected browser checks and actual Electron appearance checks.
The native Chat case first failed owned cleanup under concurrent checks; its
unchanged isolated repeat passed. The cause remains unproven.

Real-model Send/Stop/reopen passed before the startup-history change. The later
generation attempt failed resource preflight before engine launch; newer deletion
and popup UI checks used no loaded model. These results do not establish fresh
real-model cancellation during deletion, manual native Computer Use, hosted CI
for this local slice, full M1, distributed correctness or release/platform
acceptance. This documentation reconciliation reruns no application tests or
workloads. Dated details below and [local Chat development](../docs/local-generation.md)
are the evidence record; older suite counts remain historical, not cumulative.

Define what evidence establishes the requirements in [PRODUCT-SPEC.md](PRODUCT-SPEC.md), [TECHNICAL-SPEC.md](TECHNICAL-SPEC.md), [INTEGRATION-SPEC.md](INTEGRATION-SPEC.md), [SECURITY-SPEC.md](SECURITY-SPEC.md), and [UI-SPEC.md](UI-SPEC.md). Test-writing conventions, documentation comments, and contribution rules remain in [CODE-QUALITY.md](../docs/CODE-QUALITY.md). Concrete test files, commands, tool versions, and execution order belong in an approved subsystem plan and the verified development guide.

The user's lecture notes support this separation, but do not prescribe a file named TESTING-SPEC.md:

- Lecture 7, page 8 connects evolving specifications with automated verification; pages 12-13 illustrate acceptance criteria and exceptional inputs; pages 15 and 20 cover validation, review, and test-driven development; pages 26-27 show integration-test tasks with explicit outcomes. Page 35 distinguishes test, security, and review responsibilities.
- Lecture 6, page 9 discusses automated checks and recovery; page 11 requires inspectable evidence; page 12 calls for systematic normal, boundary, ambiguous, failure, and adversarial cases. Page 24 discusses testing hostile inputs.

Sources: [Lecture 6](C:/Users/user/Downloads/l6.pdf) and [Lecture 7](<C:/Users/user/Downloads/l7 (1).pdf>). These external PDFs remain in Downloads. Their sample attack prompts and workflow examples are source material, not project permissions or mandatory implementation choices.

## 2. Traceability and test records

Each meaningful behavior test identifies its requirement IDs and the observable outcome. Every supported J1-J15 journey requires real acceptance evidence; a unit test or mocked demonstration cannot independently close a journey. Requirements outside a milestone stay explicitly pending.

A case records: case ID/name, requirement references, configuration and preconditions, stimulus, expected observable result, cleanup obligations, and necessary evidence. A run adds app/core/runtime revisions, model hash and settings where relevant, OS/architecture/devices/network, selected limits, actual result, exit status, redacted artifacts, reviewer, and limitations.

Use result states **passed**, **failed**, **not run**, **blocked**, and **not applicable with reason**. Distinguish a mocked boundary, a real local runtime, an actual network, packaged-platform acceptance, and correctness evidence. Retain failed-run evidence; retries do not erase a failure or justify weakening an assertion.

## 3. Verification layers

| Layer                 | Required evidence                                                                                                                                    | Limits                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Unit                  | Validation, state transitions, resource accounting, cancellation ownership, and other isolated invariants                                            | Cannot prove a working engine, installer, or network.                                                     |
| Contract/integration  | Real component exchanges where available; malformed, oversized, unsupported-version, stale, and unauthorized messages; errors and stream termination | Test doubles are labeled and later supplemented at the actual boundary.                                   |
| UI/component          | User-visible states, keyboard/focus behavior, safe rendering, and functional control actions                                                         | Rendering success does not establish inference or worker security.                                        |
| Native/runtime        | Actual GGUF loading, capability reporting, supported placement, ordinary native failures, and process lifecycle                                      | Compile success and controlled termination alone do not prove native-crash recovery or unchanged quality. |
| Security              | Peer approval/revocation, API access, filesystem scope, privileged bridge validation, update verification, and diagnostic redaction                  | Protected transport does not certify native RPC safety.                                                   |
| Platform/end-to-end   | Installed app, real core/engine, real LAN/Tailscale/Headscale paths, headless operation, and supported mixed-device journeys                         | A single platform or simulated worker cannot establish cross-platform acceptance.                         |
| Inference correctness | Approved D12 reference and comparison procedure on actual supported runtime/device configurations                                                    | Visual acceptance and token-throughput measurements are separate evidence.                                |

For each affected behavior, choose applicable ordinary, boundary, ambiguous, failure, cancellation, and adversarial cases. Define precise expected behavior for ambiguous inputs before implementation. Do not manufacture tests that merely reproduce private implementation details.

## 4. Product acceptance matrix

| Journey                     | Minimum observable checks                                                                                                                                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| J1: Clean install           | First local response through the installed app without manual engine setup; discoverable controls; original packaged Windows runtime names and owned cleanup; no visible console; actual platform process identities.       |
| J2: LAN                     | Explicit approval, two real participating devices, actual placement, and a completed response.                                                                                                                              |
| J3: Private networks        | Tailscale and existing Headscale exercised separately; enrollment/reconnect failures; approved-peer restriction; actual path or an honest unknown state; no public raw RPC.                                                 |
| J4: Placement               | Valid manual split accepted; invalid or unsupported assignment rejected before generation; actual placement reported.                                                                                                       |
| J5: Chat/API                | Same active model; supported model-list and completion clients; local default and key enforcement; streaming/non-streaming outcomes.                                                                                        |
| J6: Runtime update/rollback | Independently install/select/update and restore a working runtime; same GGUF reloads; user data survives; incompatible or failed candidates cannot become a falsely healthy cluster.                                        |
| J7: Worker failure          | Interrupt a required worker during generation; truthful terminal status and retained partial output; controlled recovery without hidden replay.                                                                             |
| J8: Headless worker         | Linux operation without a desktop session; service recovery, diagnostics, scoped control, and independent lifecycle ownership.                                                                                              |
| J9: Shared requests         | Simultaneous Chat/API work, saturation, per-request isolation, caller-owned cancellation, and no silent model switch.                                                                                                       |
| J10: Placement restart      | Save while running; applied revision stays unchanged until explicit restart; affected work is explained and resolved.                                                                                                       |
| J11: Storage                | Actual required transfer/cache, quota and integrity checks, interrupted transfer, scoped cleanup, and preservation of user originals.                                                                                       |
| J12: Visual/accessibility   | All five reference compositions with approved revisions and relevant empty/loading/error states; ChatGPT font sizes by corresponding text role; foreground panel layering; keyboard, scaling, contrast, and reduced motion. |
| J13: Engine crash           | Controlled termination and an ordinary native-crash case separately; usable GUI/unaffected core; honest request outcomes; bounded recovery.                                                                                 |
| J14: Quit/abnormal exit     | Idle, loading, generating, queued, and transition states; hung-engine escalation; verified owned exits; unrelated/headless processes preserved.                                                                             |
| J15: Shared core/runtime    | Desktop and independent headless operation use the reviewed shared machinery and runtime-management contract; same-model checks and documented parity gaps.                                                                 |

The product specification remains authoritative for each journey's full criteria. This matrix organizes evidence and does not reduce that scope.

### 4.1 Add device entry points and new-worker placement

**Planned; not run against real joining.** For U11-U13 and J1/J3/J10/J12, verify that the toolbar Add device and a node's + enter the same joining/approval flow for the current cluster. Neither entry point chooses a parent node. After approved joining succeeds, the new worker card appears automatically in the worker area; its visual position does not assert a network relationship. Dotted lines and latency/path details must reflect verified connections, including unknown/unavailable states, rather than an invented coordinator link or full mesh. Joining alone must leave applied layer allocation unchanged; later allocation changes retain the draft/save/confirmed-restart contract. Unsuccessful or canceled joining must not present a candidate as an approved, connected worker. Current fixture-panel checks establish only entry-point equivalence, not this future integration behaviour. Implementation and real-network acceptance remain behind their separate review and authorization gates.

## 5. Request, persistence, and lifecycle invariants

- Given reviewed active capacity N, pending capacity B, and timeout policy, test admission at and beyond each applicable bound. Distinguish active engine slots from pending requests; verify limits by observation rather than badge text. Numeric values are selected through D09, not inferred from LM Studio's reference default of four.
- Cancelling one request cannot cancel another, mix their histories, duplicate tokens, or incorrectly report completion. Cover client disconnect, late cancellation, engine failure, shutdown, and restart races. Every request has exactly one authoritative terminal outcome.
- Pending work remains bound to its intended model/session. Switching model, placement, or runtime resolves affected work explicitly and never secretly reroutes it.
- Exercise persistence across clean restart and authorized crash cases, including migration failure, interrupted writes, disk exhaustion, and concurrent ownership. Preserve completed messages, partial-message status, settings, and placement revisions according to D04.
- Resolve process ownership using authoritative instance/handle information. Test process-ID reuse and a similarly named unrelated process; executable-name matching must never choose shutdown targets.
- Test runtime activation and Quit racing each other, partial worker preparation, failed health/model checks, and recovery to the retained working package. Inspect actual exits and data state, not just acknowledgements.

## 6. Security acceptance

The [six-area investigation](../docs/research/IMPLEMENTATION-READINESS-INVESTIGATION.md) identifies additional cases to carry into affected subsystem plans: pending-engine work versus core admission bounds; corrupt/truncated stock tensor-cache files and partial writes; cache quota exhaustion; Linux/headless secret-storage fallback; protocol-compatible but unapproved build sets; partial cluster activation/recovery; and concurrency-dependent numerical/RNG behavior. These are not passed tests or accepted numeric limits.

Trace security checks to S01-S17 and the reviewed threat model. Include unauthorized renderer/frame calls; hostile rendered model/file content; path traversal and out-of-scope deletion; spoofed discovery; unapproved/revoked peers; replay/stale input; API key errors and rotation; unapproved browser origins; oversized inputs/resource exhaustion; and redacted logs/exports.

Update tests include invalid signatures/hashes, expired or replayed metadata, incompatible packages, archive extraction escapes, interrupted download, failed activation, and intentional rollback authorized by current trusted metadata. Protected offline reuse and key/role recovery follow the approved D11 policy rather than a test-only bypass.

Test all applicable worker transport paths, including any native/RDMA bypass. Native RPC advisory review, containment, and malformed-input validation remain release gates under D03. Use a separately approved bounded environment for crash/adversarial probes; do not run exploit payloads on the user's installation or infer security from tailnet membership.

## 7. Visual and platform evidence

Use the unchanged [five screen references](references/ui/README.md) for composition, subject to the approved revisions in [UI-SPEC.md](UI-SPEC.md). Font sizes follow the user's ChatGPT app reference by corresponding text role under UI-SPEC section 2.1; the original ModelLoom screenshot font sizes are superseded. Control frame/content bounds, OS scaling/device-pixel ratio, app zoom, image resizing, fonts, fixture content, scroll position, and animation state. Review captures side by side and with overlays/differences where useful. Numeric visual tolerance and approved assets are D08 decisions; do not bless mismatches by raising a threshold after failures.

For typography evidence, use the approved CSS size table in UI-SPEC section 2.1: main page headings 24px; section headings 16px; dialog headings 18px; card/model/device titles, chat messages, and body text 14px; supporting descriptions and control text 13px; metadata and compact secondary/status text 12px. At default text scaling, check observed computed font sizes against the corresponding role values and record each role's reference, measurement method, and implementation size. Distinguish the approved ModelLoom design choices from directly measured ChatGPT values. Check role consistency across page/section/card headings, chat/dialog body text, menus, buttons, inputs, descriptions, metadata, and status labels. Compare at matching scaling and verify that text remains readable and centered where intended, without clipping controls or overflowing cards, dialogs, and footers at supported window sizes. A valid size difference between distinct roles is not itself a failure. Passing functional tests alone does not verify matching font sizes; this documentation change supplies no new typography acceptance evidence.

Cover accessible names, keyboard navigation, focus recovery, screen-reader status, readable contrast, text scaling, reduced motion, and status meaning without color. Essential actions remain reachable at each approved window size. Intentional reference deviations require recorded user approval.

For UI-SPEC section 2.3's toast revision, verify success, error and information appearances; a visible keyboard-operable × with the name Dismiss notification; immediate manual dismissal; five-second expiry; pause/resume on hover and keyboard focus; and a fresh timer when a notification is replaced or repeated. Showing a toast must not steal focus; removing a focused close control restores focus to the live triggering control or an appropriate fallback. Check announcements without relying on colour alone, reduced motion, message wrapping, containment, and unchanged toolbar/card/panel bounds while the toast is visible. Expiry must not clear field validation, change placement state, or remove access to pending-proposal Apply/Discard actions. Saved and applied results retain distinct wording and explicit restart confirmation. Local automated toast evidence is recorded in section 10; assistive-technology and wider platform acceptance remain separate.

The first-release platform matrix must include approved Windows/Linux NVIDIA configurations, Apple Silicon Metal, Linux headless, CPU fallback where supported, and mixed-device multi-node operation. Record OS, architecture, driver, runtime/backend, and connection versions per result. Exact supported floors and pins await D10; platform omissions remain visible. Direct and relay paths are separate observations, and no connectivity result guarantees speed.

## 8. Inference correctness

Before any authorized comparison, D12 defines the single-GPU/reference configuration, selected dense GGUF/hash, context and sampling, prompt corpus, comparison scope, numerical assumptions, stopping conditions, and resource bounds. Preserve the user's requirement: no quality loss and no draft-model methods.

Use per-request comparisons for concurrent workloads as well as single requests. Equal seeds or one matching answer alone do not establish general equivalence across backends or concurrency. Any exact-token claim requires its approved deterministic/numerical comparison conditions and actual evidence. Do not relax the reference to justify an optimization, substitute a different quantization, or invent a blanket tolerance. Performance experiments require separate authorization and cannot replace correctness acceptance.

## 9. Tooling and delivery gates

Proposed tooling under D10: Vitest for TypeScript unit/integration checks; React Testing Library for UI behavior if React is accepted; Playwright for desktop flows and visual captures, with its Electron support explicitly treated as experimental. Native checks use the selected upstream CMake/CTest interfaces and meaningful sanitizer/static checks; Go uses its standard testing/race tools if selected. [Vitest](https://vitest.dev/guide/), [Electron testing guidance](https://www.electronjs.org/docs/latest/tutorial/automated-testing), [Playwright Electron API](https://playwright.dev/docs/api/class-electron).

Pin and validate the selected tooling against the actual package before making it mandatory. Automation cannot stand in for native window/process presentation or real hardware/network acceptance. No tool is installed and no test command exists merely because this spec names it.

An implementation task completes when its affected acceptance criteria, relevant checks, and review pass with inspectable evidence and accurate updated specs/comments. A release additionally requires all applicable J1-J15 journeys, the supported platform/network matrix, reviewed RPC/update trust, approved correctness evidence, and recorded limitations. No arbitrary global coverage target is prescribed; untested critical contracts are still blockers. Pending future milestones do not block unrelated authorized work.

## 10. Current evidence

### Fixture-backed core implementation, 2026-10-06 — local evidence

After plan review and explicit coding authorization, the private `packages/core` workspace implements validated events, immutable lifecycle/request records and one deployment's asynchronous supervisor with in-memory engine adapters. Root typecheck/test/lint/format commands include the package. No desktop source/configuration/test file was edited; SHA-256 for all 77 tracked desktop files matches the pre-implementation baseline. The UI and disabled preview integrations remain unchanged.

Evidence tuple: Windows x64; Node 24.7.0; pnpm 11.19.0; TypeScript 5.9.3; Vitest 5.0.3; branch `feat/runtime-lifecycle`, base `2ad39c3b0b959bf83155ce6f626b21d4127efd6b` plus uncommitted changes. Existing dependency pins were reused; lockfile changes add only the core importer. `pnpm install --lockfile-only --ignore-scripts` and `pnpm install --frozen-lockfile --ignore-scripts` exited 0. No engine/model was downloaded or launched.

| Check                                    | Observed result                                                                                                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Contracts RED -> GREEN                   | 35 expected failures before validation, then 35 passes.                                                                                                                                                |
| Lifecycle RED -> GREEN                   | 31 expected failures before transitions, then 31 passes; final review added the initial-admission regression.                                                                                          |
| Supervisor RED -> GREEN                  | Missing supervision produced expected failures; added late-rejection and superseded-operation regressions failed before fixes. Final core suite: 98 tests in 3 files, exit 0, no unhandled rejections. |
| `pnpm test`                              | 39 desktop tests in 8 files and 98 core tests in 3 files pass; total 137, exit 0.                                                                                                                      |
| `pnpm typecheck`, `pnpm lint`            | Expanded desktop/core checks both exit 0.                                                                                                                                                              |
| Targeted Prettier check                  | `packages/core`, root package/workspace/lint configuration pass, exit 0.                                                                                                                               |
| `pnpm format:check`                      | Exit 1 on seven existing desktop files, listed below; those unchanged files were not reformatted.                                                                                                      |
| `git diff --check`; desktop preservation | Exit 0; empty desktop diff and all 77 tracked desktop hashes unchanged.                                                                                                                                |

Existing formatting failures: `apps/desktop/src/renderer/app/App.tsx`, `apps/desktop/src/renderer/app/AppShell.tsx`, `apps/desktop/src/renderer/features/chat/ChatPage.module.css`, `apps/desktop/src/renderer/features/settings/SettingsPage.module.css`, `apps/desktop/src/renderer/features/settings/SettingsPage.tsx`, `apps/desktop/src/renderer/styles/global.css`, and `apps/desktop/tests/settings.browser.spec.ts`. No formatting assertion or tool setting was weakened to conceal this result. The overall workspace formatting gate remains outstanding.

Tested behaviors include strict UTF-8 control limits/field validation; stale identities; readiness, exit and stop races; safe startup faults; partial interruption without replay; five-second graceful/two-second forced confirmation; duplicate stop; late instances/rejections; explicit retry; independent fixture deployment survival; and request admission/operation-result correlation. Virtual-time cleanup tests assert actual fixture exit rather than equating a stop call with exit.

Final review was an author self-review because the subagent tool cannot select the requested Luna/max combination; it is not independent review. No commit, push, hosted CI run, build, browser/package check, native abort, real process containment, signing, GPU workload or inference-quality validation was performed in this slice. J1/J6/J13-J15 and D01/D09/D11/D12 remain unpassed by these fixtures. Desktop/headless hosts, live IPC/authentication, verified package activation and durable transcripts remain later work; this evidence is not release acceptance.

### Accepted first-core plan, 2026-10-06 — before implementation

[ADR-0004](decisions/0004-runtime-lifecycle-proposal.md) accepts a limited Windows development gate and the [fixture-backed core lifecycle plan](../plans/CORE-RUNTIME-LIFECYCLE-IMPLEMENTATION.md). Its planned tests cover malformed/oversized controls, stale operation identity, readiness/exit races, interrupted partial records, bounded graceful/forced cleanup and independent fixture instances. Planning and decision acceptance are not test results: no core source, process adapter, signing/verification implementation, live engine, GUI integration or new workload has been executed in this documentation step. J1/J6/J13-J15 and D01/D09/D11/D12 remain unpassed by these fixtures. Actual commands, counts and exits will be recorded after authorized execution.

### Historical local UI evidence and reconciliation scope, 2026-10-05

The fixed [current UI baseline](UI-SPEC.md#current-ui-baseline-2026-10-05) covers shell/navigation, Models/configuration, Cluster, Chat and API. The separately authorized 2026-10-06 Settings preview adds local category navigation/search and disabled Appearance/Runtime controls; its evidence is recorded below. Counts in earlier entries below describe those earlier revisions, including superseded controls, rather than the current implementation.

The preceding API implementation observed 39 unit/component tests, 40 browser tests and one rebuilt packaged Windows smoke case passing after the API sidebar correction, together with typecheck, targeted lint/format checks and demo packaging. It checked direct API access after Models, no API entry in More, shared 20px rail icons/selection, API/configuration containment and scrollbar rules, placeholder example copying and disabled real-server controls. Native review found no renderer errors, confirmed the 800px API column and reachable empty logs, and compared exact copied text. This is prior local implementation evidence, not a new test run performed by the documentation reconciliation and not a hosted CI result for the current local changes. The later Settings run is recorded separately below.

| Requirement area                          | Historical renderer-only evidence                                                                                 | Still required at that milestone for production acceptance                                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| U01-U10 / Models/configuration/navigation | Browser geometry/font containment, local editor validation, menus/focus and explicit unavailable integrations.    | Actual metadata/import/download, durable defaults and runtime application.                                                                       |
| U11-U14 / Cluster                         | Simulated placement/lifecycle validation, canvas/keyboard/panel interaction, cancellation and joining previews.   | Live hardware, networks/approval, real model preflight/loading and worker failure.                                                               |
| U15-U18 / Chat                            | History/search/New chat, drafts, explicit copy/feedback, plain-text containment and disabled Send/attachments.    | Persistent history, generation/streaming/cancellation, Markdown and attachment scope.                                                            |
| U19-U22 / API                             | Four cards, tabs/copy, unknown metrics, required-key label, empty log viewer and direct navigation.               | Real listener, credentials/transport, requests, live metrics/logs and supported clients.                                                         |
| S01-S03 / desktop boundary                | Packaged renderer isolation/sandbox, navigation restrictions and inert text; no privileged bridge.                | Full adversarial coverage and future IPC/security boundary evidence.                                                                             |
| U23-U28 / Settings/runtime lifecycle      | Renderer-only Settings preview; category navigation/search, disabled controls and empty runtime-inventory dialog. | Actual appearance/persistence, runtime inventory/install/select/update, isolated native crash recovery, owned engine cleanup and headless reuse. |

Documentation checks in this reconciliation verify local links, balanced fences, requirement ID definitions and an unchanged desktop source/config/test fingerprint. No application source/test/config is edited and no build, browser test, runtime workload or publication is performed. These checks do not close J1-J15, D01-D12, pixel-identity or Linux/macOS release acceptance.

Reconciliation checks passed for all nine edited Markdown documents: 121 local file/image links resolve, fences are balanced, and P1-P9/J1-J15/U01-U28/T01-T24/I01-I07/S01-S17 definitions remain complete and unique. SHA-256 over all 77 desktop source/configuration/test files is unchanged from the start of this documentation task.

### Historical foundation evidence

The GitHub Actions workflow now defines Quality, Browser, Windows desktop, and Security checks for pull requests and main pushes. Local workflow lint and its underlying foundation commands passed after updating Vite to 7.3.5. Secret scans passed and rejected a synthetic credential; the dependency audit has no high/critical findings and one low-severity esbuild advisory. Publication was authorized for that historical foundation scope. The current UI reconciliation authorizes no new publication. GitHub-hosted evidence must be tied to the exact pushed commit and its completed run; local validation alone does not establish that result. Required-check branch rules have not been enabled.

The initial hosted run for `a005220` passed Quality, Windows desktop, and Security. Browser containment failed on Linux because its fallback font made four compatibility values crowd the tile border at 1280px. The same failure was reproduced locally with Arial. Compact tiles now use two pixels less horizontal padding on each side; role sizes and assertions are unchanged. A second font case extends the suite to five browser tests. Inspect the replacement run's exact commit and completed results before accepting the correction on hosted runners.

The lecture pages and existing specifications were read. This document remains a draft contract for the full product. The desktop foundation has component, browser, and packaged Windows smoke checks; their scope is the simulated Models interface and shared shell. On 2026-10-02, browser inspection measured the approved role sizes, centered header controls and three-dot icon, and no metadata/footer overflow in list layouts at 1280, 1240, 1200, 1180, 1100, and 1000px widths. The four browser tests passed, including metadata containment in both list and grid views at those widths and the 1279px reflow boundary. Smaller grid cards use fewer metadata columns when needed. Packaged Windows inspection at device-pixel ratio 1.75 confirmed the page, model, metadata, search, menu, and dialog sizes and centered three-dot icon; the packaged smoke check passed navigation, renderer isolation, and normal owned-process exit. Formatting, TypeScript checking, and linting passed. This evidence does not establish complete five-screen or cross-platform visual acceptance. Installer, native-crash, queue, network enrollment, signed-update, and inference-correctness acceptance remain pending.

### Cluster demo evidence, 2026-10-03

The locally authorized Cluster demo adds component coverage for search, disabled-demo rendering, absent active models, enrollment explanations, navigation retention, and explicit restart cancellation/application. State tests reject unknown hardware, non-integer/out-of-range/reversed indexes, gaps, overlaps, and duplicate assignments; saved proposals cannot alter the applied allocation. Twenty unit/component tests passed. Seven browser tests passed with CI=true, including the existing Models regressions and Cluster keyboard/focus interactions, system/Arial font containment, current 24px page/14px device title tokens, and full graph/summary fit at 1280×720. At 1100×720 and 1000×620 the graph remains reachable through contained scrolling; the document does not overflow horizontally.

The actual Windows demo package passed the extended smoke test: Cluster navigation, saved-proposal cancellation, renderer isolation/sandbox, no renderer errors, and normal owned-process exit. Formatting, type checking, linting, production renderer build, and unsigned Windows packaging exited 0. This evidence is local and has not been published to GitHub. Sample hardware, latency, and 128-layer allocations establish no networking, runtime, native placement, memory-fit, inference-equivalence, or throughput result. Final visual review and D08 remain open.

### Cluster clutter cleanup, 2026-10-03

The user approved removing the Cluster summary footer, the explanatory header sentence, and the model selector's green dot/Demo running text. The single title-bar Demo data label remains; hardware details stay in the cards and API stays reachable through navigation. Current tests assert these removals, the compact model name, and preserved API navigation. Browser fit evidence now checks the complete device graph at the default height rather than the removed footer.

After this revision, 20 unit/component tests, seven browser tests with CI=true, and the rebuilt Windows package's smoke test all passed. Formatting, type checking, linting, and demo packaging exited 0. Layout coverage retains both system and Arial fonts at 1280, 1100, and 1000px widths. This supersedes the initial Cluster summary/disclosure composition above; networking and runtime gates remain unchanged. Nothing is staged, committed, or pushed.

### Cluster toolbar and floating placement panel, 2026-10-03

The toolbar-first revision adds a white pill-shaped Add device action, rounded neutral Find devices field, and one hamburger toggle. Placement controls now live in an initially closed floating panel. The new component scenario first failed because the toggle did not exist, then passed after implementation. It covers opening/closing, focus restoration, preserved card visibility and layer assignments, and disabled controls without an active model. Existing save/validation/restart tests access the controls through the panel.

`pnpm test` passed 21 unit/component tests. `CI=true pnpm test:e2e` passed eight browser tests, including existing Models and Cluster font/containment coverage. The new browser case checks transparent/default, shaded/hover, and shaded/open toggle backgrounds; white Add device colours; rounded search; unchanged card coordinates and dimensions on panel opening at 1280 and 1000px widths; panel containment; usable underlying search; and Escape focus restoration. A focused rerun of that case passed after removing keyboard focus from its screenshots, saved as `apps/desktop/test-results/cluster-toolbar-closed.png` and `cluster-toolbar-panel.png`.

### Contextual Cluster panel and canvas, 2026-10-03

This revision supersedes the placement-only panel evidence above. Before implementation, five revised component cases failed because the overview, device/link/Add device panel content and inline editing did not exist. Two browser cases failed because the canvas region was missing and the Coordinator still had its automatic blue border. The implemented version retains four default fixture nodes, hardware details and dotted links, with neutral Cluster colours and explicit selection independent of role.

`pnpm test` exited 0 with 22 unit/component tests. `CI=true pnpm test:e2e` exited 0 with 12 browser tests, including Models regressions. Coverage includes contextual selection and panel switching, empty discovery explanations, validated inline draft edits, exact allocation coverage before save, saved/applied separation, restart cancellation, and absent-model/demo-disabled states. Browser checks exercise actual left-button dragging, cursor-anchored wheel zoom, stationary panel bounds, panel wheel isolation, keyboard pan/zoom/fit, 25–200% zoom bounds, input-key isolation, and ignored right-button dragging. One- and two-device fixture variants exercise permanent versus hover/focus node + visibility and the shared Add device flow. Search does not change the connected-device count used by that rule.

System and Arial font containment still pass at 1280, 1100 and 1000px widths; the new node + is intentionally outside its card, while text and other controls remain checked for clipping. Panel opening preserves card bounds at 1280 and 1000px after viewport auto-fit settles. The original comparison initially captured the pre-fit frame after resizing; waiting for the resize frames fixed the measurement without relaxing the unchanged-bounds assertion. Device headings retain their device-name accessible labels despite their new selection buttons.

`pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`, and `pnpm package:demo` completed successfully. `pnpm test:desktop` exited 0: the rebuilt Windows demo passed inline edit/save/restart cancellation, renderer isolation/sandbox, no renderer errors, navigation, and normal owned-process exit. The previous exact-path demo was closed normally and confirmed exited before rebuilding. Captures include `apps/desktop/test-results/cluster-toolbar-closed.png`, `cluster-toolbar-panel.png`, `cluster-canvas-device.png`, and `cluster-packaged-windows.png`.

This is local UI/demo evidence only. Available-device discovery, pairing/approval, real connections/latency, native placement, runtime lifecycle, and inference correctness are not established. The Add device panel honestly reports no available candidates. Other-screen/shared-shell colour rollout, node rearrangement, platform-wide accessibility and final D08 acceptance remain outside this revision. No files were staged, committed or pushed.

### Continuous Cluster background and canvas focus, 2026-10-03

The Cluster workspace now owns the same #181818 background as its page, including the surrounding padding. Shared chrome and the native Windows title bar use neutral #212121. The canvas never draws an outline under mouse, programmatic or keyboard focus; its keyboard pan/zoom controls remain available, while buttons and inputs retain their focus indicators.

Two new browser checks first failed on the old workspace colour and canvas focus outline, then passed after the fix. `CI=true pnpm test:e2e` passed all 14 browser tests, including click/drag/keyboard canvas focus and visible search/button focus. `pnpm test` passed 22 unit/component tests. Type checking, linting, formatting and unsigned Windows packaging exited 0; `pnpm test:desktop` passed the rebuilt package's smoke test. The continuous background capture is `apps/desktop/test-results/cluster-continuous-background.png`. These are local UI/demo results; no publication or runtime/network acceptance is claimed.

`pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`, and `pnpm package:demo` exited 0. `pnpm test:desktop` passed the rebuilt Windows package's smoke test, including the floating placement controls, saved-proposal restart cancellation, renderer isolation/sandbox, absence of renderer errors, and normal owned-app exit. These are local renderer/demo results; no network, inference, pairing, CI publication, or other-platform result is claimed. Nothing is staged, committed, or pushed.

### Cluster notification toasts, 2026-10-03

The user's PROCEED authorizes replacing Cluster transient banners with section 2.3's compact floating success/error/information toasts. Three new browser cases failed before implementation on the absent toast treatments and dismissal control. The implemented toast has a visible ×, a five-second lifetime paused by hover or contained keyboard focus, fresh lifetime on replacement/repeated errors, and focus restoration after manual dismissal. Saving and applying remain distinct; toast dismissal/expiry does not change the allocation. Pending proposal state and restart/discard actions now remain in the overview panel, and field validation uses persistent associated descriptions beside its inputs.

`pnpm test` passed 22 unit/component tests. `CI=true pnpm test:e2e` passed 17 browser tests, including the three new cases and existing Models/Cluster regressions. New checks cover the three semantic treatments, immediate dismissal, keyboard/hover pause and resume, replacement and repeated-message timeout, unchanged card/panel bounds, retained proposal actions after dismissal/expiry, invalid-input descriptions after error expiry, and correction of invalid fields. The browser cases generate `apps/desktop/test-results/cluster-toast-success.png`, `cluster-toast-information.png`, and `cluster-toast-error.png`; later Playwright runs may replace that output directory. Type checking, linting, formatting and unsigned Windows packaging exited 0. `pnpm test:desktop` passed the rebuilt Windows package's smoke test, including toast dismissal followed by preserved proposal actions, explicit restart cancellation, renderer sandbox/isolation, navigation, no renderer errors and normal owned-app exit. This is local demo evidence; it does not establish screen-reader delivery, real placement, networking, inference correctness or final visual acceptance. Nothing was staged, committed or pushed.

### Keep draft border revision, 2026-10-03

The user authorized a visible rounded pill border on Keep draft, including its disabled state. This changes only the local editor button's presentation. Three existing browser flows passed with CI=true: draft editing/restart cancellation, toast dismissal with preserved proposal actions, and error expiry with persistent field validation. Formatting, unsigned Windows packaging and the rebuilt package's smoke test exited 0. A live renderer inspection checked disabled/enabled border visibility and rounded shape, white enabled text, and brighter hover border/shading; captures are `plans/keep-draft-disabled.png` and `plans/keep-draft-hover.png`. Windows display scaling quantizes the thin border, so its visible physical width was checked instead of assuming a computed width of exactly one CSS pixel. No new behaviour tests were added for this local styling change.

### Cluster panel scroll containment, 2026-10-03

The user's PROCEED authorizes fixing the panel scrollbar outside its rounded edges and the disappearing top padding. The outer panel now clips overflow and retains fixed padding; a separate inner area scrolls content and uses a neutral rounded scrollbar. Focus indicators are inset within that area, and sticky edit actions stay inside its viewport. The new browser case first failed because the inner scrolling region was absent. An initial fixture check assumed more than 100px of overflow, but the Mac fixture has 85px at the larger viewport; the case now exercises its actual middle and exact bottom rather than assuming content length. The fixed-frame, inset and control-reachability assertions remain intact.

`pnpm test` passed 22 unit/component tests. `CI=true pnpm test:e2e` passed 18 browser tests. The new case verifies fixed top/bottom/right insets and unchanged frame/viewport bounds during real wheel scrolling and at the exact bottom, neutral scrollbar styling, reachable layer controls and sticky Save changes, and Escape focus restoration at 1280×720 and 1000×620. It generates top/middle/bottom screenshots under `apps/desktop/test-results/cluster-panel-*.png`; later Playwright runs can replace this directory. Type checking, linting, formatting and unsigned Windows packaging exited 0. `pnpm test:desktop` passed the rebuilt Windows smoke test. These are local UI/demo checks; no runtime, network, inference or final D08 acceptance is established. Nothing was staged, committed or pushed.

The reopened packaged Windows demo also passed fixed-inset/frame checks at the top, middle and bottom of the Mac device panel at the user's display scaling. Captures are `plans/panel-scroll-top.png`, `plans/panel-scroll-middle.png` and `plans/panel-scroll-bottom.png`. The preview retains its original layer inputs; no proposal was saved or applied by this inspection.

### Cluster scrollbar hover refinement, 2026-10-03

The user's correction moves the scrollbar 8px farther right and hides its thumb until hovered or dragged, while preserving content spacing and the fixed vertical padding. The revised regression first failed on the previous 19px right inset. A dedicated `cluster-scrollbar.browser.spec.ts` permits native scrollbar painting in headless Chromium; rendered strip comparisons verify hidden/hovered/hidden appearances without reflow, alongside the existing scroll-containment and control-reachability checks at both widths. This separates the visual case from the other browser cases' default launch settings. `CI=true pnpm test:e2e` passed all 18 browser tests; `pnpm test` passed 22 unit/component tests. Linting, formatting and unsigned Windows packaging exited 0. The earlier always-visible thumb and right-inset expectations are superseded by this revision.

`pnpm test:desktop` passed the rebuilt Windows package's smoke test. This remains local demo evidence, with no runtime/network/inference acceptance or publication. Nothing was staged, committed or pushed.

### Panel hover, symmetric padding and coverage toast correction, 2026-10-03

The user authorized revealing the scrollbar on hover anywhere inside the panel, equal left/right content padding, and removal of the overall coverage error duplicated above Save changes. The body-spacing regression first failed with 19px on the left and 25px on the right. The component regression first failed because the duplicate coverage paragraph remained in the panel. The correction accounts for the reserved 6px scrollbar in the right padding and reserves its gutter even without overflow. Hovering the outer panel padding now reveals the thumb; leaving hides it without reflow. Overall coverage failures use the error toast only. Specific field errors remain inline; invalid drafts still cannot be saved, and dismissing the toast preserves editing and retrying.

`CI=true pnpm test:e2e` passed all 18 browser tests, including rendered hidden/hovered/hidden comparisons, equal content insets in the device and overview panels, fixed top/middle/bottom geometry and reachable editor controls at 1280×720 and 1000×620. `pnpm test` passed all 22 unit/component tests, including toast-only coverage failure, dismissal, correction and successful save with explicit restart confirmation. Type checking, linting, formatting and unsigned Windows packaging exited 0. This is local demo evidence; nothing was staged, committed or pushed.

`pnpm test:desktop` passed the rebuilt Windows package's smoke test. The reopened package also verified equal horizontal padding and scrollbar visibility when hovering the outer panel padding at the user's display scaling, plus fixed insets at top/middle/bottom. The hover capture is `plans/panel-scroll-hover.png`; the original layer inputs were restored without saving or applying a proposal.

### Content-to-scrollbar clearance, 2026-10-03

The user authorized an 8px gap between panel content and the scrollbar while retaining equal left/right body padding. The regression first failed with the cramped 2px gap. Moving the strip another 6px towards the outer edge and increasing its inner gap by the same amount preserves the body position and width. The strip stays approximately 4px inside the frame; top/bottom clipping and panel-wide hover behaviour remain unchanged.

`CI=true pnpm test:e2e` passed all 18 browser tests, including the measured 8px clearance, equal horizontal body padding, hidden/hovered/hidden rendering without reflow, scroll containment and control reachability at both desktop sizes. Formatting exited 0. No component logic changed in this refinement, so unit tests were not repeated.

Unsigned Windows packaging exited 0 and `pnpm test:desktop` passed the rebuilt package's smoke test. No changes were staged, committed or pushed.

### Cluster-wide Save changes toolbar action, 2026-10-03

The user's PROCEED authorizes moving Save changes from the device panel to the top toolbar between Find devices and Add device. It is rendered only for a kept unsaved cluster draft, remains available across node selection and with the panel closed, stays visible after invalid coverage prevents saving, and disappears after a successful save or draft discard. Typing into a field alone and having only a saved proposal do not reveal it. Keep draft stays in each hardware card. Saving still preserves a proposal across all nodes and leaves applied placement unchanged until the explicit restart confirmation.

New component and browser checks first failed because Save changes was still inside the panel. After the move, `pnpm test` passed 23 unit/component tests and `CI=true pnpm test:e2e` passed 19 browser tests. The added cases cover draft visibility, failed-save retry, edits retained across multiple nodes, toolbar saving while the panel is closed, disappearance after save/discard, absence of a duplicate panel action, white pill styling and ordered non-overlapping controls at 1280×720 and 1000×620. The component case was also rerun after adding explicit assertions for both other nodes' saved pending ranges. Type checking, linting, formatting and unsigned Windows packaging exited 0. `pnpm test:desktop` passed the rebuilt package's smoke test with explicit toolbar location/visibility and successful-save removal checks. No changes were staged, committed or pushed.

The reopened Windows demo verified hidden-before-draft and visible-after-Keep draft behaviour, toolbar placement before Add device, availability with the panel closed and after selecting another node, and absence of a duplicate panel action. Captures are `plans/toolbar-unsaved-draft.png` and `plans/toolbar-unsaved-draft-panel.png`. A valid unsaved sample draft remains for visual review; the preview did not save or apply it. This is local UI/demo evidence, not runtime, network or inference acceptance.

### Rename device menu action, 2026-10-03

The user authorized Rename device in each card's existing ⋮ menu. A native modal edits the friendly display name, validates blank names, trims outer whitespace and offers Cancel/Save name. Names are retained in the renderer's app state across screen navigation, with stable device IDs and unchanged hardware and placement. The selected panel resolves its device by ID so the renamed card and panel agree. No OS hostname, peer identity or network state is changed.

The new component case first failed because the menu action was absent. `CI=true pnpm test:e2e` passed all 20 browser tests, including keyboard opening, input focus, Escape cancellation and trigger restoration, blank validation, successful rename, search/overview/panel updates, a 64-character name at both desktop widths and absence of a placement draft caused by renaming. `pnpm test` passed all 24 unit/component tests, including preserved existing layer edits, trimmed names, cancellation and names retained across navigation. The first concurrent unit run hit the existing five-second limit in two longer interaction cases; a rerun after browser checks completed passed without increasing timeouts or weakening assertions. Type checking, linting and formatting exited 0. These are local UI/demo checks; connected-device naming and persistence are not implemented.

Unsigned Windows packaging exited 0. `pnpm test:desktop` passed the rebuilt package's smoke test, including focused rename input, successful card-name update and no placement Save action caused by renaming, plus existing renderer isolation, navigation, placement and owned-exit checks. Nothing was staged, committed or pushed.

The reopened package verified Device details/Rename device menu entries, prefilled focused input and Escape restoration to the menu trigger. Original names were left unchanged and the menu is open for review. Captures are `plans/rename-device-menu.png` and `plans/rename-device-dialog.png`.

### Inline device-name editing in the panel, 2026-10-03

The user's PROCEED replaces the rename modal with the selected device's panel editor. Rename device in the card menu opens and selects the current name; a muted pencil beside the panel title starts the same flow. Enter/Save name saves a trimmed friendly name. Escape/Cancel cancels only the name edit, keeps the panel open and restores pencil focus. Closing the panel or selecting another context discards an unsubmitted name. Existing layer drafts and device identity remain unchanged.

The revised component check first failed because the old rename dialog was still present. After implementation, `pnpm test` passed all 24 unit/component tests and `CI=true pnpm test:e2e` passed all 20 browser tests. A focused browser rerun passed after adding explicit checks for selected input text, white Save name styling, pencil visibility on title hover and keyboard focus, and cancellation when closing or changing panel context. Coverage also retains blank-name validation, trimming, long-name containment at both desktop widths, search/navigation updates and independence from placement drafts. Concurrent checks hit the existing component time limit and a shared Playwright artifact-directory race; separate reruns passed without increasing timeouts or weakening assertions.

Type checking, linting, formatting and unsigned Windows packaging exited 0. `pnpm test:desktop` passed the rebuilt package's smoke test with inline panel renaming and no rename dialog. The reopened package separately verified a focused prefilled editor, Escape cancellation with the panel retained, and re-entry from the panel pencil. The original name is unchanged and the editor remains open for review. Capture: `plans/inline-rename-panel.png`. Nothing was staged, committed or pushed. These are local UI/demo checks; connected-device naming and persistence remain future integration work.

### Neutral navigation sidebar, 2026-10-03

The user authorized the sidebar styling and specification update: seven main icons use 20px CSS boxes and 1.75 strokes; selection uses white icons on rounded charcoal without a blue border or glow. Unselected icons are muted grey on transparent buttons. Home loses its permanent shading while remaining unavailable. Keyboard focus uses a distinct grey outline. Button size, sidebar layout, destinations, and the separate bottom utility controls remain unchanged.

The new browser case first failed on the previous blue selected surface. After the revision, `CI=true pnpm test:e2e` passed all 21 browser tests. The added case checks muted/default, hover, selected and open states; transparent Home; consistent main icon dimensions and strokes; selection independent of hover/focus; keyboard navigation with a visible neutral outline; retained overflow/API access; and unchanged 36px button areas at 1280×720 and 1000×620. Existing Models, Cluster, panel, scrollbar, placement, rename and toast regressions also passed. Unit tests were not repeated for this presentation-only change.

Type checking, linting, formatting and unsigned Windows packaging exited 0. `pnpm test:desktop` passed the rebuilt package's smoke test, including neutral selected navigation, transparent Home, white Cluster icon, no selection shadow, and its 20px icon. The reopened package independently verified the seven icons, selected styling and grey keyboard focus at a 1.75 device-pixel ratio with a 1279×721 CSS viewport. Captures are `plans/sidebar-neutral-desktop.png` and `plans/sidebar-neutral-keyboard.png`; the Cluster screen remains open for review. Comparison with the user's reference is visual, not a measurement of the reference app's computed styles or exact screenshot parity. Nothing was staged, committed or pushed.

### Rounded neutral Models toolbar

The grid/list toggle and text-action styling in this historical result are superseded by the icon-only Models toolbar revision recorded below.

The user's PROCEED covers the four Models header controls only. Search models, Import GGUF and Download models use 32px pill controls; the grid/list toggle is circular, borderless and transparent by default, with charcoal shading on hover or while grid mode is active. Import uses charcoal and Download uses white with dark text. Existing model cards and card actions are outside this change.

The new browser case first failed because the view toggle retained its permanent filled background. After implementation, `CI=true pnpm test:e2e` passed all 22 browser tests. The case verifies default/hover/pressed/released toggle states, neutral colours, pill/circular radii, aligned non-overlapping 32px controls at 1280×720 and 1000×620, retained search filtering, keyboard focus and honest import/download explanations. Existing Models metadata/font, shared navigation and Cluster regressions also passed. Unit tests were not repeated for this presentation-only change.

Type checking, linting, formatting and unsigned Windows packaging exited 0. `pnpm test:desktop` passed the rebuilt package's smoke test with transparent default view toggle, rounded Import and white Download checks. The first independent desktop preview failed to retain hover through its colour transition; a rerun with the preview window brought forward and reduced-motion emulation passed the same hover/default/selected checks without changing product code or weakening assertions. Failure output is retained in `plans/models-toolbar-preview-error.log`; successful output is in `plans/models-toolbar-preview-open-2.log`. The reopened package verified the toolbar at a 1.75 device-pixel ratio and 1279×721 CSS viewport. Captures are `plans/models-toolbar-hover.png`, `plans/models-toolbar-grid.png` and `plans/models-toolbar-neutral-desktop.png`; Models is open in list view for review. No import, download or runtime integration is implemented. Nothing was staged, committed or pushed.

### Cluster model planning and Run, 2026-10-04

The user's PROCEED authorizes the Cluster demo and specification revision only. Selecting an entry from the current model library opens Auto place / Place manually choices without loading it. Manual placement starts unassigned; direct field edits retain incomplete or invalid text across node/panel/screen navigation. Keep draft, Save changes and the saved-proposal panel block are removed. Run and Apply and restart validate exact coverage of the selected model's synthetic layer count, permitting unused hardware. A pending model/allocation stays separate from the active session until confirmed simulated loading completes. Loading lasts 800ms, can be cancelled, disables layer edits without hiding their fields, and starts no inference. Discard changes restores the active allocation or initial unloaded auto/manual baseline. This supersedes the earlier keep/save/apply demo evidence above; historical results remain recorded.

The new component flow first failed because the model menu was absent. After implementation, `pnpm test` passed all 29 unit/component tests across five files. `CI=true pnpm test:e2e` passed all 26 browser tests. Four focused launch cases passed again after adding disabled-field and stale-error-clearance assertions. Cases cover manual/auto planning, exact coverage and invalid raw input, cancellation and active-session separation, launch completion across navigation, shared Models state, model-library removal, dropdown keyboard/focus handling, long-name accessibility/truncation, and header geometry at 1280, 1100 and 1000px with system and Arial fallback fonts. Existing panel, scrollbar, pan/zoom, neutral navigation, rename, toast and Models checks also pass.

The first full browser run had two failures: an invalid range unmounted its initiating pencil, breaking panel-close focus restoration; live edit display legitimately changed card height, invalidating an old whole-bounds assertion. The pencil is now stable. The pan/zoom case instead checks unchanged card position/width and canvas transform while typing, then separately verifies right-drag does not pan. A subsequent selector matched both the canvas world and its hint; selecting the world explicitly fixed the test's ambiguity without relaxing its behavior checks.

`pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `git diff --check`, and `pnpm package:demo` exited 0. `pnpm test:desktop` passed the rebuilt unsigned Windows package's smoke test, including validation before restart, confirmation cancellation, manual selected-model planning/loading, renderer isolation/sandbox, navigation, absence of renderer errors and normal owned-app exit. Its first attempt timed out on a node obscured by the still-open device panel; closing that panel before clicking the node corrected the test sequence. No timeout or assertion was weakened.

The reopened packaged preview separately verified the five-entry dropdown, placement modal, unloaded auto allocation, absence of In use/save actions and transparent circular 32px Run control at 1.75 device-pixel ratio and a 1279×721 CSS viewport. Captures were inspected: `plans/cluster-model-library-menu.png`, `plans/cluster-placement-choice.png`, and `plans/cluster-plan-before-run.png`. Cluster remains open with an unloaded auto plan for review. The demo uses synthetic counts and a proportional illustrative split, with no parsed GGUF metadata, real optimizer, memory-fit check, runtime launch, network operation or inference. Models redesign and draft-model speculative decoding remain outside this implementation. No production acceptance gate, other-platform result or hosted CI result is claimed. Nothing was staged, committed or pushed.

### Flat Cluster model selector, 2026-10-04

The screenshot correction removes the browser's default raised 2px button border from the model selector, leaving its existing charcoal pill, text, chevron and keyboard focus behavior. The existing header case first failed on the measured 2px border, then passed with a zero-width border and no shadow. All four focused Cluster launch browser cases passed, including the existing header/truncation checks across supported widths and fonts. Formatting, diff whitespace checking and unsigned Windows packaging exited 0; the rebuilt desktop smoke test passed. The reopened Windows demo verified the border/shadow absence at 1.75 display scaling, and the refreshed `plans/cluster-plan-before-run.png` capture was visually inspected. No placement or launch logic changed; unit tests were not repeated for this presentation-only correction. Nothing was staged, committed or pushed.

### Cluster selector-to-launch spacing, 2026-10-04

The user's correction sets the model selector-to-launch gap to 8px, matching the Add device-to-hamburger spacing. Title-to-selector spacing remains 14px. The existing header browser case first failed with a measured 14px gap, then passed at 8px across 1280, 1100 and 1000px widths with system and Arial fonts, retaining truncation and containment checks. Formatting and unsigned Windows packaging exited 0. This presentation-only change does not alter model planning or loading; unit tests and the full browser suite were not repeated.

### Centered placement Cancel, 2026-10-04

The approved placement-modal refinement centers Cancel below the two equal Auto place / Place manually choices, removes its white fill and border, uses muted text with brighter hover text, and retains the top-right close control and keyboard focus. The existing menu/cancellation browser case first failed on the white Cancel background, then passed with transparent background, muted color, measured horizontal centering and position below the choices. All four focused Cluster launch browser cases passed. The restart/switch confirmation footer remains unchanged. Formatting and unsigned Windows packaging exited 0. This presentation-only refinement does not alter cancellation or placement state; unit tests and the full browser suite were not repeated.

### Icon-only Models toolbar, 2026-10-04

The user's PROCEED removes the grid/list toggle and replaces the Import GGUF and Download models text buttons with upload and compass icons. The compass action is named Explore models. Both actions have accessible labels and tooltips, 18px icons, transparent borderless 32px circular controls and charcoal hover shading. The existing Models list, search and demo explanations remain; this does not implement file import, catalogue access or downloads.

The revised header browser case first failed because the grid toggle was still present. After implementation it detected the shared button rule shrinking icons to 16px; a scoped icon-size token fixes the measured size without changing other buttons. `pnpm --filter @modelloom/desktop exec playwright test models.browser.spec.ts --project=browser` exited 0 with all six Models cases passing. They check idle/hover styling, labels/tooltips, icon-only content, control size/alignment at 1280 and 1000px, keyboard focus and demo explanations, search and list containment across seven widths with system and Arial fallback fonts. Tests for the removed grid behavior were replaced with list-only checks.

Type checking, linting, formatting and diff whitespace checks passed. The Windows demo package was refreshed after the final CSS correction; its earlier package snapshot retained 16px icons, which the updated desktop check correctly rejected. The rebuilt `pnpm test:desktop` exited 0 with one smoke test passing, including icon styling, renderer isolation/sandbox, navigation and owned-app exit. The separate reopened preview verifies both idle and hover appearances at 1279×721 CSS pixels and 1.75 device-pixel ratio. Its capture `plans/models-icon-toolbar-desktop.png` was visually inspected and Models remains open for review. Unit tests and the full browser suite were not repeated for this toolbar-only revision. No other-platform, hosted CI, runtime or inference acceptance is claimed. Nothing was staged, committed or pushed.

### Matching Models and Cluster backgrounds, 2026-10-04

The user's PROCEED changes the complete Models foreground from `#111215` to Cluster's `#181818`, including the workspace padding and exposed rounded-corner area. Other surface roles are unchanged. Type checking, targeted formatting and diff whitespace checks passed. Packaging initially failed because the open preview held a DLL; its verified native parent was closed normally, then `pnpm package:demo` exited 0.

The packaged desktop smoke check initially timed out during its final screenshot after the interaction assertions. Its unchanged rerun passed in 7.5 seconds with the same timeout and assertions. The independent preview measured both foregrounds as `rgb(24, 24, 24)` at 1279×721 CSS pixels and 1.75 device-pixel ratio, returned to Models, and refreshed the visually inspected `plans/models-icon-toolbar-desktop.png` capture. Evidence is in `plans/models-background-preview.log`. No new tests, full browser run, runtime/network operations, staging, commits or publication were performed for this colour-only correction.

### Matching Find model and Find devices fields, 2026-10-04

The user's PROCEED renames the Models search to Find model and requires identical Find devices styling and dimensions. Both screens now use the same controlled SearchField component. Cluster's 240×32px field, neutral colours, 16px glyph, padding, placeholder rendering, entered-text styling and keyboard focus remain the reference. Each field still filters its own screen data.

The updated Models toolbar case first failed because Find model was absent. After implementation, all 29 unit/component tests and eight focused Models/Cluster browser cases passed. They cover filtering and empty results, smaller-window/list containment, system/Arial metadata widths, keyboard search focus, and Cluster filtering with an open panel. Type checking found a Playwright-only `exact` option mistakenly used in the renamed Testing Library locator; removing that unsupported option restored the typecheck pass. Linting, formatting and diff whitespace checks passed. `pnpm package:demo` exited 0 and the rebuilt `pnpm test:desktop` passed one Windows smoke test.

The reopened Windows preview directly compared both fields' computed container, input, placeholder and icon properties, including focused outlines; all collected properties matched. Both measured 240×32 CSS pixels. The placeholder colour was `rgb(117, 117, 117)` and entered text `rgb(243, 243, 243)`. The result, including 1279×721 CSS viewport and 1.75 device-pixel ratio, is recorded in `plans/models-search-preview.log`. The refreshed `plans/models-icon-toolbar-desktop.png` was visually inspected; Models remains open for review. No full browser suite, other-platform/hosted acceptance, runtime or network operation, staging, commits or publication is claimed.

### Compact Models library, 2026-10-04

The user's PROCEED and follow-up answer authorize the compact list first, with configuration next. Flat rows replace the metadata cards and running-card emphasis. Rows show the existing small logo, model name, size/GGUF/quantization chips, identifier, unknown Last used, and visible ⋮/gear icons. Details retains sample metadata and labels compatibility Not verified. The gear names the selected model and explains that configuration is deferred without changing settings. Start/Stop/Open in Cluster and status badges are removed from Models; Cluster retains planning, validation, switching and Run/Stop. Active demo entries cannot be removed until stopped there.

The revised component case first failed on the old card's missing GGUF chip. After implementation, `pnpm test` exited 0 with all 29 unit/component tests and `CI=true pnpm test:e2e` exited 0 with all 26 browser tests. Coverage checks filtering/empty results, unknown usage rather than fabricated timestamps, metadata access, protected removal and confirmation, keyboard opening/cancellation/focus restoration, outside-click dismissal, deferred configuration leaving the active model unchanged, and hover versus idle styling. Layout checks retain five visible rows and ten visible row actions, chip/action containment at seven widths from 1000 to 1280px with system and Arial fonts, and unchanged toolbar geometry. Existing Cluster tests now navigate through the rail and verify active state through protected removal rather than deleted Models status badges; Cluster behavior assertions remain intact.

Type checking, linting, formatting and diff whitespace checks exited 0. The verified previous preview was closed normally before `pnpm package:demo`, which exited 0. The rebuilt `pnpm test:desktop` exited 0 with one Windows smoke test passing, including compact rows, no Models launch controls, configuration explanation, renderer isolation, existing Cluster interactions and owned-app exit. The independent packaged preview passed row filtering, detail/configuration focus restoration, active-removal protection and exact Models/Cluster search-property equality. Both foregrounds remain `rgb(24, 24, 24)`. Its 1279×721 CSS viewport and 1.75 device-pixel ratio are recorded in `plans/models-compact-list-preview.log`; `plans/models-compact-list-desktop.png` was visually inspected and the compact Models page remains open for review. These are local UI/demo results; full configuration, file transfer, catalogue networking, runtime/inference, other platforms and hosted CI remain unverified. Nothing was staged, committed or published.

### Per-model configuration demo, verified 2026-10-05

The user's PROCEED authorizes the six-section page and replaces the earlier deferred-configuration explanation. The gear opens the selected model's defaults with no logo or extra section sidebar. Shared typography, neutral surfaces, blue switches and white sliders follow the approved design. Save defaults keeps separate saved values and pending edits per model only for the current app session; Reset changes pending values and requires Save. Back/navigation retains pending edits, and reload clears all defaults. GPU Offload opens Cluster; speculative decoding stays Off without draft-model settings. No runtime, template execution, argument execution or persistent storage is connected.

The updated component case first failed because the old gear explanation had no Prompt section. After implementation, `pnpm test` exited 0 with 33 unit/component tests across six files. `CI=true pnpm --filter @modelloom/desktop exec playwright test --project=browser --workers=2` exited 0 with all 30 browser cases. Coverage includes model-specific saved/pending defaults, navigation and focus restoration, session reset after reload, numeric and batch validation, keyboard sliders, retained disabled values, thinking dependencies, exact whitespace-preserving stop strings, and inert template/argument text. Layout checks cover 1280, 1000 and 800px widths with system and Arial fonts, six aligned groups, no horizontal overflow, shared font/control roles and absence of a logo, extra sidebar or Run action.

Initial checks identified an accessible GPU Offload label mismatch and unsupported native-range-thumb computed-style inspection. The button has an explicit Set in Cluster accessible name; white slider paint is checked through track styles and visually inspected captures. Concurrent heavy runs hit existing component/browser time limits; stable reruns passed without changing timeouts or weakening behavior assertions. Visual review then caught entry scrolling that crowded the heading and a selector-specificity issue shrinking wide text inputs. After those corrections, the four focused configuration browser cases passed again, including measured heading spacing and 304px text fields (244px at 800px).

Type checking, linting, formatting and diff whitespace checks exited 0. Final CSS/test formatting and diff checks also passed. `pnpm package:demo` exited 0 after rebuilding the final source. The rebuilt `pnpm test:desktop` exited 0 with one Windows smoke test, retaining renderer isolation/sandbox, existing Cluster behavior and normal owned-app exit while checking configuration entry, session save and reopening.

The independent packaged preview checks six sections, focus restoration, save/reset/reopen, disabled speculative decoding, blue switches and wide text fields. It records 24px title, 16px section headings, 14px labels, 13px input text, 28px inputs, 44px heading spacing and `rgb(24, 24, 24)` foreground at a 1279×721 CSS viewport and 1.75 device-pixel ratio. Evidence is in `plans/model-configuration-preview.log`; captures are `plans/model-configuration-desktop.png`, `plans/model-configuration-generation.png` and `plans/model-configuration-advanced.png`. These are local demo checks, not exact computed-style parity with the user's resized reference screenshots, runtime support, inference correctness, other-platform acceptance or hosted CI. Nothing was staged, committed or published.

### Workspace scrollbar corner clearance, 2026-10-05

The user's PROCEED authorizes the main workspace scrollbar margins shown in the two supplied crops. The native vertical track now has 40px margins at both ends, with a 6px painted thumb inside a 10px strip and 2px transparent side clearance. Styling is scoped to the outer main scroller. The content viewport and page scrolling remain intact; the separately inset Cluster panel is unchanged.

`CI=true pnpm --filter @modelloom/desktop exec playwright test configuration.browser.spec.ts cluster-scrollbar.browser.spec.ts --project=browser --workers=2` exited 0 with all five focused cases passing. They retain configuration navigation, keyboard interaction, saved/pending defaults, field validation and layout containment at 1280/1000/800px with system/Arial fonts, plus Cluster panel scrolling, inset geometry and hover visibility. Targeted CSS formatting, diff whitespace checks and `pnpm package:demo` exited 0. No unit or full browser suite was repeated for this scoped presentation change.

The rebuilt native preview verifies scrollbar paint at both scroll extremes, reachable Save defaults at the bottom, keyboard focus revealing Temperature, and configuration reopening at the top. Painted endpoint clearance measured 41.7 CSS pixels at each extreme in a 1279×721 CSS viewport at 1.75 device-pixel ratio. Full-page and strip captures were visually inspected: `plans/workspace-scrollbar-top.png`, `plans/workspace-scrollbar-bottom.png` and their `-strip` counterparts. Evidence is in `plans/workspace-scrollbar-preview-3.log`; the page remains open at the top for review. Earlier preview checks exposed capture/decode colour rounding and fractional Windows scrollTop, rather than product failures. The capture reader now distinguishes the known neutral thumb colour with a small channel tolerance; bottom verification asserts scroll saturation instead of comparing a fractional position to rounded scrollHeight/clientHeight. The 40px painted-clearance assertion remains intact. Earlier error logs are retained.

Nothing was staged, committed or published. These results cover the local Windows demo; exact screenshot parity, hosted CI and other platforms are not claimed.

### Quieter Cluster hardware cards and neutral layer bars, 2026-10-05

The user's PROCEED removes Ready from hardware cards and removes the CPU Not used for model layers line from both diagram tiles and device-detail sections. Hardware details remain. In use remains tied to the active sample allocation; the overview's simulated model lifecycle status is unchanged. Planned and applied allocation bars now use white fills, charcoal tracks and neutral borders; layer labels and pencils use muted grey with neutral hover shading.

Type checking, linting, targeted formatting and diff whitespace checks exited 0. `CI=true pnpm --filter @modelloom/desktop exec playwright test cluster.browser.spec.ts cluster-launch.browser.spec.ts cluster-scrollbar.browser.spec.ts --project=browser --workers=2` exited 0 with all 19 existing Cluster cases passing, covering composition, editing, validation, launch/cancellation, keyboard controls, pan/zoom, rename, toasts and panel scroll containment. No new tests, unit rerun or full-app browser run was needed for these scoped presentation changes.

`pnpm package:demo` exited 0. The independent rebuilt Windows preview checked absence of Ready and the CPU explanation, retained CPU metadata/device-panel fields, five active In use indicators and their disappearance after Stop, and exact white/charcoal/grey styles for both active and unloaded auto-planned ranges. Its 1279×721 CSS viewport and 1.75 device-pixel ratio are recorded in `plans/cluster-neutral-layers-preview.log`. `plans/cluster-neutral-layers-active.png` and `plans/cluster-neutral-layers-planned.png` capture the two states; the planned screenshot was visually inspected. Cluster remains open with an unloaded auto plan. No real engine, GPU operation or inference ran, and no other-platform or hosted CI acceptance is claimed. Nothing was staged, committed or published.

### Muted library chips and steady Back label, 2026-10-05

The user's PROCEED makes size/GGUF/quantization chip text muted grey, matching existing configuration-header metadata. Back to Models text and arrow remain grey in idle, hover and keyboard-focus states. Only the hover background changes; its neutral border stays fixed, and the separate keyboard outline remains visible. Model names and headings remain white.

Targeted CSS formatting and diff whitespace checks exited 0. `CI=true pnpm --filter @modelloom/desktop exec playwright test models.browser.spec.ts configuration.browser.spec.ts --project=browser --workers=2` exited 0 with all ten existing cases, retaining filtering, metadata/action access, navigation/focus restoration, configuration editing and system/Arial layout containment. `pnpm package:demo` exited 0. No new tests, unit/typecheck/lint rerun or full-app browser run was needed for the two scoped CSS changes.

The rebuilt Windows preview verified grey chip text, white model names, grey Back text and SVG in idle/hover/focus, charcoal hover background with unchanged neutral border, visible keyboard focus and working Back/gear focus restoration. It records a 1279×721 CSS viewport and 1.75 device-pixel ratio in `plans/models-muted-controls-preview.log`. Visually inspected captures are `plans/models-muted-chips.png` and `plans/configuration-muted-back-hover.png`; keyboard focus is captured in `plans/configuration-muted-back-focus.png`. The configuration page remains open for review. Nothing was staged, committed or published; no other-platform or hosted CI result is claimed.

### Filled metadata tags and Back button, 2026-10-05 clarification

The user clarified that grey refers to the backgrounds, and requested restoration of the original text colours. This supersedes the preceding muted-text interpretation. Library and configuration-header tags now have solid charcoal-grey fills. Library tags and Back text/arrow are restored to white; configuration-header tag text retains its original muted grey. Back has a solid grey idle fill and a slightly lighter hover fill, with unchanged text/arrow and border colours.

The two CSS files pass targeted formatting and diff whitespace checks. The ten existing Models/configuration browser cases passed again with exit 0 using the same two-worker focused command recorded above. The final unsigned demo package rebuilt successfully. The native preview checks all 15 library tags, both configuration-header tags, original text colours, filled Back idle/hover states, unchanged SVG colour and working Back/gear focus restoration. Its inspected captures are `plans/models-filled-tags.png`, `plans/configuration-filled-tags-back.png` and `plans/configuration-filled-back-hover.png`; evidence is in `plans/models-filled-controls-preview.log`, at 1279×721 CSS pixels and 1.75 device-pixel ratio. The rebuilt configuration page is open for review. No new tests, unit/static-analysis rerun, full browser suite, other-platform/hosted acceptance, staging, commits or publication are claimed for this CSS-only correction.

### Back button internal padding, 2026-10-05

The user's PROCEED matches the supplied Image-button reference's roomier internal spacing. Back to Models now uses 7px vertical and 12px horizontal padding, with an 8px icon-to-text gap. Its 13px text, grey idle/hover fills and white label/arrow remain unchanged. Other buttons retain their existing dimensions.

Targeted CSS formatting and diff whitespace checks exited 0. `CI=true pnpm --filter @modelloom/desktop exec playwright test configuration.browser.spec.ts --project=browser --workers=2` exited 0 with all four existing cases, including configuration navigation/focus restoration and layout containment with system/Arial fonts at 1280, 1000 and 800px. `pnpm package:demo` exited 0.

The first native preview expected a 34px height, but Windows at 1.75 device-pixel ratio snaps each 1px border to 0.571429 CSS pixels, producing a 33.1429px box (58 physical pixels). The check now accounts for measured border widths while retaining exact padding, gap, font and colour checks. The second preview passed stable hover geometry and Back navigation/focus restoration. Its 1279x721 CSS viewport, dimensions and process identity are recorded in `plans/back-button-padding-preview-2.log`; `plans/back-button-padding.png` was visually inspected. The rebuilt configuration page is open. These measurements verify the local implementation and reference proportions, not exact ChatGPT CSS parity. No new permanent tests, hosted/other-platform acceptance, staging, commits or publication are claimed.

### Floating Cluster canvas controls, 2026-10-05

The user's PROCEED replaces the pan/zoom hint with the approved floating rounded control bar, matching the supplied Image-tools reference's padding and corner proportions. Pan focuses the canvas; minus/plus share keyboard zoom and its 25-200% limits; the percentage reflects the actual scale; Fit to view shares keyboard 0 fitting. The bar remains fixed outside the transformed diagram, and fitting reserves clearance above it. Wheel and pointer gestures over the bar do not change the diagram.

The new browser regression first failed because Canvas controls did not exist. After implementation, the existing keyboard regression found an ambiguous old diagram selector, now corrected to select the transformed child. A subsequent run caught auto-fitting during a layer-error layout change after a requested Fit; explicit Fit now retains the deliberate view during editing, preserving the original stable-transform assertion. Assertions and timeouts were not weakened. The final `CI=true pnpm --filter @modelloom/desktop exec playwright test cluster.browser.spec.ts cluster-scrollbar.browser.spec.ts --project=browser --workers=2` exited 0 with all 16 cases passing. These cover toolbar zoom/pan/fit, fixed toolbar and inspector geometry, wheel/drag isolation, fitted diagram clearance and toolbar containment at 1280x720 and 1000x620, disabled zoom buttons at both limits, existing keyboard/mouse gestures, editing, navigation, rename and panel scrolling.

Type checking, linting, targeted formatting and diff whitespace checks exited 0. The final `pnpm package:demo` exited 0. The rebuilt native preview verified 8px/12px padding, 16px group spacing, 12px rounding, a 40px bar height and the grey palette, along with zoom/pan/fit behaviour, wheel isolation and fixed inspector/bar geometry. `plans/cluster-canvas-toolbar-preview.log` records the 1279x721 CSS viewport and 1.75 device-pixel ratio. The full capture `plans/cluster-canvas-toolbar.png` and close-up `plans/cluster-canvas-toolbar-detail.png` were visually inspected. The rebuilt Cluster page remains open. Screenshot-derived proportions are distinguished from exact ChatGPT CSS parity. No runtime, GPU, network, hosted CI or other-platform acceptance is claimed; nothing was staged, committed or published.

### Remove redundant Pan toolbar action, 2026-10-05

The user's PROCEED removes the Pan button and hand icon from the canvas bar. The remaining order is minus, percentage, plus and Fit to view. The bar's padding, height, rounding, palette and edge clearance are unchanged; drag-to-pan and keyboard panning remain available.

Targeted formatting and diff whitespace checks exited 0. `CI=true pnpm --filter @modelloom/desktop exec playwright test cluster.browser.spec.ts --project=browser --grep 'canvas' --workers=1` exited 0 with all three focused cases passing, including absence of Pan, retained canvas focus/keyboard behaviour, mouse drag/wheel zoom, toolbar zoom/fit, gesture isolation and fixed inspector/bar geometry. `pnpm package:demo` exited 0. The rebuilt native preview verified the compact bar, unchanged spacing/rounding/palette, absence of Pan and retained zoom/fit/keyboard controls. `plans/cluster-canvas-toolbar-compact-preview.log` records a 1279x721 CSS viewport at 1.75 device-pixel ratio; its compact close-up `plans/cluster-canvas-toolbar-compact-detail.png` was visually inspected. The Cluster page remains open. Nothing was staged, committed or published; no full-suite, hosted or other-platform acceptance is claimed for this removal.

### Cluster invitation, joining and sharing panels, 2026-10-05

The user's PROCEED authorizes the split connection control, Add device/Join cluster/Share this PC contexts and incoming examples in overview. New controls reuse the current panel's typography, icon dimensions, padding, spacing, corners and inset scrolling. Request directions describe the resulting coordinator/contributor roles; sharing availability never automatically approves a request. Session-only example actions retain outgoing pending status, manual pending addresses, incoming decisions and hardware preferences across panel closure/navigation without adding connected devices or changing layer placement. Non-demo builds offer no sample candidates or incoming decisions and disable simulated request/sharing actions.

Before implementation, all four new component scenarios failed on the absent views, count badge and controls. Existing empty-only discovery expectations were replaced with the approved, explicitly labelled example presentation while preserving assertions that the diagram remains four devices and placement is unchanged. Browser verification caught missing Tab dismissal, now fixed with menu keyboard focus/dismissal behaviour. The second-size sharing check was corrected to enable the persisted switch only when needed, reflecting the session-retention requirement rather than assuming a fresh state at each viewport.

Final `pnpm test` exited 0 with 37 unit/component tests. `CI=true pnpm test:e2e` exited 0 with all 34 browser tests, including three new joining cases and existing Models, configuration, Cluster, scrollbar, navigation and font-fallback regressions. Joining cases exercise keyboard menus, outside/Tab/Escape dismissal, initiating-control focus restoration, explicit incoming decisions/count, inert manual text, unchanged device/placement state, and panel containment at 1280x720 and 1000x720. Computed styles retain 18px panel padding, 22px corners, 18px titles/close icons, 16px section headings, 13px descriptions and 12px metadata, with 28x16px sharing switches. Browser captures are under `apps/desktop/test-results/cluster-*.png`; subsequent native smoke tests may replace that directory.

`pnpm typecheck`, `pnpm lint`, targeted Prettier checks, `git diff --check` and `pnpm package:demo` exited 0. The previous exact-path preview PID 29660 exited normally before packaging. `pnpm test:desktop` exited 0 with its packaged Windows smoke case, expanded to cover incoming decisions, pending outgoing requests, sharing/Stop sharing focus, unchanged four-card placement, existing runtime-demo controls, renderer isolation, no renderer errors and normal owned-app exit.

The reopened native preview checked all three joining views against the same panel style values, retained two incoming examples after toggling sharing, and produced no renderer errors. `plans/cluster-joining-native.log` records its 1279x721 CSS viewport, 1.75 device-pixel ratio and exact packaged main PID 5960. The native overview and Join cluster detail captures were visually inspected; captures are `plans/cluster-joining-overview-native.png` and `plans/cluster-joining-{add-device,join-cluster,share-this-pc}-native.png` with corresponding detail captures. The responding rebuilt app remains open in overview. This establishes local renderer/demo behaviour only, not discovery, delivery, peer authorization, role transitions, networking security, runtime/inference, hosted CI, other-platform or final visual acceptance. Nothing was staged, committed or published.

### Unified Add dropdown, 2026-10-05

The user's PROCEED replaces the split connection control with one fixed Add label and chevron. Clicking anywhere opens the same three options. The entire capsule shares one hover background, and selecting Add device, Join cluster or Share this PC changes only the panel context. The trigger keeps 13px text, a 14px chevron, 32px height, 14px horizontal padding and an 8px gap. Contextual node + remains a direct Add device shortcut.

The updated existing keyboard/browser regression first failed because the fixed Add trigger was absent. After implementation, `CI=true pnpm --filter @modelloom/desktop exec playwright test cluster-joining.browser.spec.ts cluster.browser.spec.ts --project=browser --workers=2` exited 0 with 18 cases. Its hover checks move to both ends of the one button and verify the shared `#e5e5e5` background; choosing a different view preserves Add and panel closure restores focus to it. Existing component/native tests now enter connection views through the dropdown, preserving their request, placement and session-state assertions. `pnpm test` exited 0 with 37 tests. Type checking, linting, targeted formatting and diff whitespace checks exited 0.

The previous verified preview PID 5960 exited normally before rebuilding. `pnpm package:demo` and `pnpm test:desktop` exited 0. The reopened native preview checked the single label, one chevron, padding/gap/font values, shared hover colour at both ends, all three panel choices and return focus, with no renderer errors. `plans/cluster-add-unified-native.log` records main PID 51116, a 1279x721 CSS viewport at 1.75 device-pixel ratio and a 73.6964x32px button. `plans/cluster-add-unified-menu-native.png` was visually inspected, and the app remains open with the dropdown visible. This is local UI evidence; no full browser-suite rerun, hosted CI, networking or other-platform acceptance is claimed for this refinement. Nothing was staged, committed or published.

### Header icons reduced to 16px, 2026-10-05

The user's PROCEED reduces Import GGUF, Explore models, the Cluster hamburger and every Run-icon variant (Run, Stop, Apply and restart, Cancel loading) from 18px to 16px. Models now inherits the shared 16px icon token instead of its 18px override. Existing 32px clickable areas, spacing, colours and interactions remain. The existing Models toolbar regression was updated to the approved size and first failed on the old 18px computed width; after the change, `CI=true pnpm --filter @modelloom/desktop exec playwright test models.browser.spec.ts cluster-launch.browser.spec.ts --project=browser --workers=2` exited 0 with all 10 cases. Existing smaller-window, system/Arial containment, search, menu and lifecycle assertions remain intact.

Type checking, linting, targeted Prettier and diff whitespace checks exited 0. The exact-path preview PID 51116 exited normally before rebuilding. `pnpm package:demo` and the updated `pnpm test:desktop` smoke check exited 0. The reopened native preview separately verified 16x16px computed SVG boxes and 32x32px button areas for Import, Explore, hamburger and all four Run variants, matching the unchanged 16px search icon. It restored the sample allocation after checking Restart and resumed the test clock before leaving Models open. `plans/header-icons-16-native.log` records main PID 54560, the 1279x721 CSS viewport, 1.75 device-pixel ratio and no renderer errors. `plans/header-icons-16-models-native.png` and `plans/header-icons-16-cluster-native.png` were visually inspected. No new permanent test cases, full-suite rerun, hosted CI, networking/inference or other-platform acceptance is claimed for this sizing refinement. Nothing was staged, committed or published.

### Model selector font and padding, 2026-10-05

The user's PROCEED changes the Cluster model name from 12px to 13px and matches its internal padding to Add. A shared style now supplies both controls with 13px text, 18px line height and 1px vertical/14px horizontal padding. The existing header containment regression compares their computed font, line height and padding while retaining long-name truncation, menu behaviour and system/Arial checks at 1280px, 1100px and 1000px widths.

`CI=true pnpm --filter @modelloom/desktop exec playwright test cluster-launch.browser.spec.ts cluster-joining.browser.spec.ts --project=browser --workers=2` exited 0 with seven cases. `pnpm typecheck`, `pnpm lint`, targeted Prettier and diff whitespace checks exited 0. The exact-path preview PID 54560 exited normally before rebuilding. `pnpm package:demo` and `pnpm test:desktop` exited 0.

The reopened packaged Windows app independently verified identical computed font, line height and padding, 32px height, 8px text-to-chevron gap and vertical centres for the model selector and Add. Both align with the search field; the model dropdown opens and Escape restores focus. `plans/cluster-model-padding-native.log` records main PID 53180, a 1279x721 CSS viewport at 1.75 device-pixel ratio and no renderer errors. `plans/cluster-model-padding-native.png` was visually inspected, and the responding app remains open on Cluster. This is local UI evidence; no full-suite rerun, hosted CI, networking/inference or other-platform acceptance is claimed. Nothing was staged, committed or published.

### Chat screen with Send unavailable, 2026-10-05

The user's PROCEED adds the reviewed Chat layout. Home now opens Chat, while the existing More entry remains. The intermediate `#1c1c1c` conversation sidebar and `#181818` chat surface sit inside the workspace's rounded outer frame; their internal boundary stays square and uses a low-contrast 1px `#303033` divider. The ChatGPT heading, right artifact panel and top-right controls are absent. The user explicitly selected Send unavailable for now. New chat, history selection/search, independent drafts and response feedback use session-only renderer state. Non-demo state seeds no sample messages. Attachments and Send remain disabled; changing the globally active model requires Cluster.

`pnpm typecheck` and `pnpm lint` exited 0. `pnpm --filter @modelloom/desktop exec vitest run --maxWorkers=2` exited 0 with 39 tests across eight files. The initial concurrent unit/browser run timed out three existing component cases at their unchanged five-second limits; running the unit suite separately passed without increasing timeouts or changing those assertions. Clipboard browser verification exposed Windows CRLF conversion; its exact-content assertion now normalizes only line endings.

`CI=true pnpm --filter @modelloom/desktop exec playwright test --project=browser --workers=2` exited 0 with all 37 cases. Three new Chat cases cover conversation state/search/focus, per-chat drafts across navigation, mutually exclusive feedback, actual clipboard contents, unavailable Send/attachments, model control routing without model switches, three flat surfaces, fine divider, absence of a right panel, and containment with system/Arial fonts at 1280px, 1100px and 1000px widths. After the desktop copy refinement, the three Chat browser cases passed again with one worker. Existing navigation expectations were updated only to enable the approved Home-to-Chat action.

The first native check exposed the packaged sandbox's Clipboard API denial and fractional Windows border quantization. Copy now tries the modern Clipboard API, then the explicit user-action selection-copy command, restoring focus/selection and reporting failure if unavailable. This adds no clipboard reads, preload, IPC, native permission grant or change to main-process security policy. The fallback uses the deprecated but supported copy command documented by [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand); its actual packaged result is verified below. The native divider assertion compares device pixels instead of assuming a fractional-scale computed CSS border is exactly 1px.

The verified previous preview PID 53180 exited normally before rebuilding. Final `pnpm package:demo` and `pnpm test:desktop` exited 0. The desktop smoke includes retained Chat drafts across navigation, reflection of the active Llama model without changing it, unavailable Send, the fine divider and exact OS clipboard contents, along with the existing sandbox and owned-process-exit checks. Targeted Prettier and diff whitespace checks exited 0.

The reopened native preview separately checked copy against the OS clipboard, search, feedback, draft retention, disabled Send/attachments, typography, absence of a right panel, square internal corners and no horizontal overflow. `plans/chat-native.log` records main PID 23632, the 1279x721 CSS viewport at 1.75 device-pixel ratio, `0.571429px` computed divider width (one physical pixel), the approved colours and no renderer errors. `plans/chat-native.png` was visually inspected; the responding app remains open on Chat. This verifies local presentation and session interactions only. Persistent conversation storage, sending/generation, Markdown, attachment integration, runtime/networking, hosted CI and other-platform acceptance remain outside this milestone. Nothing was staged, committed or published.

### Models heading position and Name alignment, 2026-10-05

The user's PROCEED moves Models 20px right and 10px down, then aligns Name with its left edge. Local Models styles add 10px above the header row, 20px before the title and 4px before the Name label. Shared shell padding, font roles, row geometry and Last used alignment remain unchanged. The toolbar stays vertically centred with the title.

`CI=true pnpm --filter @modelloom/desktop exec playwright test models.browser.spec.ts --project=browser --workers=2` exited 0 with all six existing Models cases, including system/Arial containment at seven desktop widths. The updated existing toolbar case compares the heading and Name left edges at 1280px and 1000px; its focused rerun with `--grep 'Models toolbar' --workers=1` exited 0. `pnpm package:demo` and `pnpm test:desktop` exited 0. Targeted formatting and diff whitespace checks exited 0.

The verified previous preview PID 23632 exited normally before rebuilding. The reopened packaged app independently verified the 20px heading margin, 10px header inset, unchanged 24px heading font, identical heading/Name x coordinates (`97.571434px`), a 47px total left inset and matching heading/search vertical centres. `plans/models-heading-inset-native.log` records main PID 30296, a 1279x721 CSS viewport at 1.75 device-pixel ratio and no renderer errors. `plans/models-heading-inset-native.png` was visually inspected, and the responding app remains open on Models. This is local layout evidence, not exact ChatGPT asset/font parity or hosted/other-platform acceptance. Nothing was staged, committed or published.

### Cluster header position, 2026-10-05

The user's PROCEED moves the entire Cluster header 10px down and only its title/model/Run group 20px right, matching the Models inset. Local header padding and heading-group margin implement the change without altering the shared shell or the right toolbar's horizontal anchor. The existing header regression verifies a 47px total left inset and aligned vertical centres for the title, model, Run/Stop, search, Add and panel toggle at 1280px, 1100px and 1000px with system/Arial fonts.

`CI=true pnpm --filter @modelloom/desktop exec playwright test cluster-launch.browser.spec.ts cluster.browser.spec.ts cluster-joining.browser.spec.ts --project=browser --workers=2` exited 0 with 22 cases, retaining launch, placement, joining, canvas and panel behaviour. Targeted Prettier and diff whitespace checks exited 0. The verified previous preview PID 30296 exited normally before rebuilding; `pnpm package:demo` and `pnpm test:desktop` exited 0.

The reopened native preview measured all six header elements against the previous two insets, temporarily reconstructed and then restored. Each moved exactly 10px down. Title, model and Run moved exactly 20px right; search, Add and panel toggle had zero horizontal movement. Their vertical centres remain aligned. `plans/cluster-header-inset-native.log` records main PID 59756, the 1279x721 CSS viewport at 1.75 device-pixel ratio and no renderer errors. `plans/cluster-header-inset-native.png` was visually inspected, and the responding app remains open on Cluster. This is local layout evidence; no full-suite rerun, hosted CI, networking/inference or other-platform acceptance is claimed. Nothing was staged, committed or published.

### API screen presentation, 2026-10-05

The user's PROCEED implements the final centred, stacked API mockup with Model configuration's 800px column, existing shared typography/neutral tokens, external headings, card padding/rounding and 40px outer-scrollbar track margins. Server, Access, Integration and Server logs appear in order under API, accessed directly from its sidebar icon after Models. The API entry is removed from More. No real server, exposure changes, credentials, logs, metrics or IPC are implemented. Lifecycle/exposure/key/log mutation controls are disabled with explanations. The example localhost address is labelled; statistics are unavailable; active-model text is explicitly demo. Choose in Cluster preserves the shared simulated selection. Four keyboard-accessible example tabs and explicit placeholder-snippet copying operate locally, with success/failure feedback. Chat and API now reuse the existing selection-copy fallback as a shared utility; no new permissions are granted.

The initial browser case failed on the previous API placeholder. Later geometry harness attempts incorrectly queried an orientation-specific pseudo-element and the configuration page's header instead of its containing page; these were corrected without weakening the required layout or 40px insets. `pnpm typecheck`, targeted ESLint/Prettier, `pnpm test` (39 tests), and `pnpm exec playwright test --project=browser --workers=1` from apps/desktop (40 cases) exited 0. The API cases include disabled-state honesty, shared model navigation, keyboard tab selection, exact clipboard copy, denial/failure recovery, and containment/alignment with system and Arial at 1440px/1280px/1000px. After visual review widened the endpoint/key control columns, all three API cases passed again. `pnpm package:demo` and `pnpm test:desktop` exited 0, including API controls/navigation and sandbox checks.

The in-app browser tool failed during initialization. Installed Chrome captured the local renderer at 1435x1096 and the full composition at 1435x1450, with no renderer errors, in `plans/api-browser-preview.log` and `plans/api-browser-{top,bottom,full}.png`. The source and post-fix capture were compared together at matching density in `plans/api-design-comparison.png`, with a focused Server comparison in `plans/api-design-fields.png`; `design-qa.md` records the field-width refinement and final passed visual review. Existing configuration tokens, real app chrome and normal scrolling take precedence over generated illustration sizing.

The previous owned preview PID 62952 exited normally before packaging. The reopened app independently checked its 800px column, four neutral cards, disabled start/key controls, reachable empty logs and exact example copy through the packaged sandbox, retaining focus. `plans/api-native.log` records final main PID 40140, a 1279x721 CSS viewport at 1.75 density and no renderer errors; top/bottom screenshots are 2238x1262 pixels. Native thumb analysis in `plans/api-scrollbar-evidence.json` measured 41.71px/42.43px visible clearance including the transparent border, confirming the unchanged 40px track inset. The app remains open on API. These are local UI checks; no real API-contract/security acceptance, hosted CI, runtime/networking or other-platform verification is claimed. Nothing was staged, committed or published.

The final API navigation correction was revalidated after moving its existing Server icon to the sidebar after Models and removing the More entry. All 40 browser cases and 39 unit cases passed, along with typecheck, targeted ESLint/Prettier, a fresh demo package and the packaged desktop smoke test. The navigation case checks the eight shared 20px icons, neutral API selection, no API overflow entry, keyboard focus and sidebar containment. Fresh browser/native screenshots show the final placement; native checks confirm the 20px icon and 36px button, exact example copying, empty logs and no renderer errors. Previous owned preview PID 54184 exited normally before this rebuild; PID 40140 remained open on API at that revision.

### Settings UI preview, 2026-10-06

The user's Settings PROCEED and explicit selection of unavailable preview controls authorize local presentation only. Settings reuses the updated Chat's 240px flat sidebar, 14px category/search text, 13px group labels and fine divider. The darker detail pane centres a maximum 728px column, matching the latest screenshot-derived margins rather than the generated mockup's wider column. Appearance has Theme, Interface and Accessibility cards; Runtime has installed-pack, engine-selection and settings sections. Search, category retention across navigation, the empty inventory dialog and the Network-to-API link work locally. Appearance/runtime mutations are disabled; the remaining categories have pending content. No settings persistence, engine inventory, theme changes, filesystem/network operations or IPC are implemented.

The first new browser case failed on the old placeholder because the Appearance heading was missing. After implementation, all three Settings cases passed. The full browser suite passed 44 cases with two workers, including search keywords/empty results/Escape, retained selection, disabled-state honesty, empty inventory and dialog focus restoration, the API link, and system/Arial containment at 1462px, 1280px and 1000px. It verifies the sidebar typography/colours and equal column margins without reducing fonts. Browser captures are retained in `plans/settings-browser-1462.png` and `plans/settings-browser-1000.png`.

Typecheck and targeted ESLint passed after removal of an unused placeholder import. The initial default-parallel unit run passed 36 tests but timed out three existing Cluster/joining/configuration cases at their unchanged five-second limit while other checks were running. A full isolated rerun, `pnpm --filter @modelloom/desktop exec vitest run --maxWorkers=1`, passed all 39 tests without changing assertions, timeouts or implementation. Demo packaging and the existing packaged Windows smoke case passed; the separate Settings native check exercises the new screen through the packaged app.

The prior owned preview PID 5616 exited normally before rebuilding. Native review confirmed 240px sidebar width, 14px category/search and 13px group text, `#1c1c1c` sidebar and `#181818` detail background. At 1280x722 CSS pixels and 1.75 density, the column measured 728.00px with 123.07px/122.93px side margins to the detail viewport. At 1001x621 it reflowed to 659.29px with 18.00px/17.71px margins; neither viewport overflowed horizontally. Contextual help remained reachable by scrolling. The empty inventory dialog opened, closed with Escape and restored focus, without fabricated versions or deletion actions. Renderer errors were empty. Captures `plans/settings-native-open.png`, `plans/settings-native-1000.png` and `plans/settings-runtime-native.png` were visually inspected. The verified packaged main PID 10388 was left open on Appearance. `design-qa.md` records the comparison and intentional preview limits.

This is local renderer and packaged-Windows evidence, not hosted CI, other-platform acceptance or production runtime/theme/security completion. Nothing was staged, committed or published in this Settings task.

### Settings sidebar row spacing, 2026-10-06

The subsequent PROCEED reduces category-row vertical padding from 10px to 6px and adds a 1px gap between adjacent highlights, retaining 14px text, 18px line height and the existing rounding. Preferences retains its current group-label typography; this scoped revision does not apply the separately proposed heading-weight change.

All three existing Settings browser cases passed with one worker, including system/Arial containment at 1462px, 1280px and 1000px. Targeted Prettier and diff whitespace checks passed. The verified previous packaged preview PID 10388 exited normally before `pnpm package:demo`, which passed. The reopened packaged app independently measured all six rows: 6px top/bottom padding, 14px text, 30.00px height and 1.00px gaps. Existing sidebar width, detail-column geometry, disabled controls and empty-dialog interactions were rechecked at 1280x722 and 1001x621 CSS pixels with 1.75 density; no horizontal overflow or renderer errors occurred. `plans/settings-sidebar-spacing-native.png` was visually inspected with Appearance selected and Runtime hovered, confirming the separated highlights. Verified main PID 35124 remains open on Appearance. No full unit/browser-suite rerun, hosted CI or publication is claimed for this small CSS revision.

### Settings Preferences heading, 2026-10-06

The next explicit PROCEED changes only the Settings group label to 14px semibold (600), retaining its muted `#ababab` colour. A shared semibold-weight token avoids an unnamed typography value; existing text roles and Chat date labels are unchanged. All three existing Settings browser cases passed with one worker, along with targeted Prettier and demo packaging. Verified prior preview PID 35124 exited normally before rebuilding. The reopened packaged app directly confirmed Preferences at 14px, weight 600 and `rgb(171, 171, 171)`, and retained 30px category rows, 6px vertical padding and 1px gaps. Existing 240px sidebar, centred detail geometry, disabled controls, lower-control reachability and runtime-dialog behaviour passed at both supported native review sizes without renderer errors or horizontal overflow. The fresh `plans/settings-native-open.png` was visually inspected; verified main PID 32620 remains open on Appearance. This is a scoped presentation check, not a full-suite or hosted CI rerun. Nothing was staged, committed or published.

### Settings gap below Search, 2026-10-06

The user explicitly authorizes reducing only the blank space below Search by 12px. Removing the Preferences label's 12px top padding shifts its text and all six category rows upward while retaining the Search field and Settings heading positions. The row padding/gap and group typography remain unchanged. All three existing Settings browser cases, targeted Prettier and demo packaging passed. The verified previous preview PID 32620 exited normally before rebuilding. A native comparison temporarily reconstructed and then removed the previous label padding: the text and each category row moved exactly -12 CSS px, while Search and Settings-heading bounding boxes were identical. The packaged app also retained the existing sidebar/detail geometry, unavailable controls and empty inventory-dialog interactions at both native review sizes, without renderer errors or horizontal overflow. The refreshed `plans/settings-native-open.png` was visually inspected. Verified main PID 20036 remains open on Appearance. No full-suite/hosted CI run, staging, commit or publication is claimed for this one-line CSS change.

### Settings search colour, 2026-10-06

The user's search-colour PROCEED applies the reference crop's sampled RGB(46, 45, 48), #2e2d30, to the Settings search background and border through a local CSS override. Shared search styling and other screens are unchanged; the field's typography, geometry and position are retained. All three Settings browser cases, targeted Prettier and demo packaging passed. Verified prior preview PID 20036 exited normally before rebuilding. The packaged app directly confirmed the background and border colours and 32px field height, together with retained Preferences/category geometry, centred content, disabled controls and runtime-dialog behaviour at both native review sizes. No renderer errors or horizontal overflow occurred. The refreshed `plans/settings-native-open.png` was visually inspected; verified main PID 37132 remains open on Appearance. No full-suite/hosted CI run, staging, commit or publication is claimed for this local colour override.

### Chat sidebar matches Settings treatment, 2026-10-06

The user's PROCEED applies the reviewed Settings-sidebar refinements to Chat: 14px semibold muted Today/Yesterday headings, zero heading top padding, 6px vertical conversation-row padding with 1px inter-row gaps, and #2e2d30 expanded search fill/border. Existing 240px sidebar width, 14px New chat/conversation/search text, actions, filtering, main messages and composer are retained. This is a local CSS change without integration, permission or state changes.

All six existing Chat and Settings browser cases passed with one worker, retaining selection, search/Escape/focus, drafts/feedback, exact copy, disabled sending and system/Arial containment. Targeted Prettier and demo packaging passed. The verified previous preview PID 37132 exited normally before rebuilding. Native review confirmed date headings at 14px/600 with muted grey and zero top padding, every conversation row at 30px height with 6px top/bottom padding, 1px gaps within Today, and the expanded search at RGB(46,45,48) with its retained 32px height. The sidebar remained 240px and the composer stayed visible without horizontal overflow at 1280x722 and 1001x621 CSS pixels at 1.75 density. Renderer errors were empty. `plans/chat-sidebar-compact-native.png`, `plans/chat-sidebar-font-native.png` and `plans/chat-sidebar-highlight-native.png` were visually inspected; the last capture shows adjacent selected/hovered rows with search expanded. Verified main PID 29032 remains open on Chat. No full-suite/hosted CI run, staging, commit or publication is claimed.

### Chat date-group separation, 2026-10-06

The user's gap-only PROCEED adds 19px above later date groups. Before the change, collapsed-search browser text ranges measured 26px from New chat to Today and 7px from the last Today entry to Yesterday. Only the inter-group margin changed.

All six existing Chat/Settings browser cases passed with one worker (14.8s); targeted Prettier and demo packaging exited 0. Verified prior preview PID 29032 exited normally before packaging. The first native helper run failed because its measurement selector included an outer section ancestor and measured the wrong button; the local helper was corrected to select the last button within Today explicitly. The fresh native run measured both visible text gaps at 26.4286 CSS px at 1.75 density, while retaining 30px rows, 6px vertical padding, 1px row gaps, typography, search fill and 240px panel width. Composer containment and no horizontal overflow passed at 1280x722 and 1001x621, with no renderer errors. The compact native screenshot was visually inspected. Main PID 37188 remains open on Chat with search collapsed. No full-suite/hosted CI run, staging, commit or publication is claimed.

### Publication and hosted CI reconciliation, 2026-10-06

The user separately authorized publication after the UI revisions. The desktop baseline merged through [PR #2](https://github.com/haowern98/ModelLoom/pull/2) at `e02c64a194f2887f3e9f2c1abb6fd92d0758c512`; the Settings preview and final Chat-sidebar refinements merged through [PR #3](https://github.com/haowern98/ModelLoom/pull/3) at `c723350eb5252a225c6079567616b7614060bd0d`. Earlier entries above describe their local snapshots and authorization at that time, not the current publication or process state.

| Hosted run                                                                                       | Revision                                   | Verified result                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [37367108948: PR #3](https://github.com/haowern98/ModelLoom/actions/runs/37367108948)            | `d8c5152b68d0d1b3416b1e0ed25561e91a93ca69` | Completed successfully on attempt 3; Quality, Browser, Windows desktop and Security all passed before merge. Earlier attempts contained jobs cancelled before acquiring hosted runners; successful job results were retained across retries. |
| [37405168066: main after PR #3](https://github.com/haowern98/ModelLoom/actions/runs/37405168066) | `c723350eb5252a225c6079567616b7614060bd0d` | Quality, Browser and Windows desktop passed; Security failed at Dependency vulnerability audit. Its retained JSON reported high-severity GHSA-68fv-2mgg-jv7q in source-map-js 1.2.1.                                                         |
| [37407189996: PR #4](https://github.com/haowern98/ModelLoom/actions/runs/37407189996)            | `b512d940b46bda018aed52b25e794dfa917bc7b6` | Quality, Browser, Windows desktop and Security all passed before merge.                                                                                                                                                                      |
| [37407421755: main after PR #4](https://github.com/haowern98/ModelLoom/actions/runs/37407421755) | `f68300ab9c4f45b09f26fee3b01fcdaf08145391` | Quality, Browser, Windows desktop and Security all passed after merge, including the formerly failing dependency audit.                                                                                                                      |

[PR #4](https://github.com/haowern98/ModelLoom/pull/4) changes only pnpm-lock.yaml: source-map-js 1.2.1 becomes 1.2.2 with its registry integrity and PostCSS snapshot references. Package manifests, renderer files and security thresholds are unchanged. Fresh local audit evidence reproduced exit 1 with one high finding before the update, then exit 0 with zero high/critical findings afterward; one existing low finding remained. Frozen-lockfile installation passed, and the installed package and PostCSS dependency resolution both reported 1.2.2. Typecheck, lint, production renderer build, all 39 unit cases and all 44 browser cases passed. Browser checks used CI=true with one worker and a fresh Vite server; unit checks used one worker.

The local format:check exited 1 because seven previously checked-out Windows files used CRLF. Independent Prettier comparison confirmed that each warned file differs only in line endings and its committed LF content satisfies formatting. No UI files were rewritten. The later hosted Quality jobs passed their normal formatting step. Renderer SHA-256 hashes remained identical throughout the dependency fix and merge.

This documentation-only reconciliation re-reads the exact GitHub run results; it does not rerun builds/tests or claim a new hosted result for the documentation edits. Native Linux/macOS acceptance, runtime/network/security integration, signed updates and inference correctness remain outside this desktop-demo evidence. Local main is synchronized to `f68300ab9c4f45b09f26fee3b01fcdaf08145391`; local-only research/reference/review files remain uncommitted.

### Windows ownership and fixture hosts, 2026-10-06

The subsequent scoped PROCEED authorizes Windows ownership plus independent headless and Electron utility fixture hosts on `feat/runtime-lifecycle`, based on `993459f99be1a16d32ef054402db578479980ce9`. This evidence was collected before publication; the user's following request authorizes focused commits and a branch push. It uses only a harmless compiled native fixture; Bonsai/GGUF loading, Bionic/miner operations and desktop UI changes are outside its scope.

The owner uses unnamed non-inherited kill-on-close deployment and nested engine jobs. Native creation supplies the job list atomically, verifies membership while suspended, then resumes. Only the explicit pipe-handle list is inherited. Core admission captures the trusted Electron child with expected image and creation-time checks before granting launch authority. Cleanup reports exit only after the captured process is signaled and its engine job has zero active processes. The same supervisor runs in the utility or independent headless host; native handles stay in main/headless. Headless controls use inherited bounded UTF-8 NDJSON pipes; Electron controls use inherited main/utility messages and test-driver Node IPC. No public listener, renderer bridge or production launch receipt is added.

Tests first failed on absent native/host implementations. Later boundary regressions first reproduced non-fixture package admission, malformed desktop JSON, replacement of invalid UTF-8 and missing utility-reply validation, then passed after their fixes. Integration uses a real native exception separately from forced job termination, preserves partial text as interrupted and requires explicit reload. It checks hung child/descendant cleanup, loading cancellation, normal Quit, abrupt owner death, unexpected utility-core exit and survival of an independent deployment. Teardown observes every reported fixture/core PID disappear; PID checks are read-only diagnostics, not termination authority. Additional unit checks cover exact schemas, payload bounds, monotonic IDs and post-Quit admission.

| Local verification                                           | Result and scope                                                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `pnpm --filter @modelloom/core test:native`                  | Exit 0; 17 cases across two suites, after /W4 /WX native build and host emission.                                        |
| `pnpm test` and final core rerun                             | Desktop 39 cases; core 112 cases; all passed. These are ordinary suites, separate from the 17 Windows integration cases. |
| `pnpm typecheck`, `pnpm lint`                                | Exit 0 across desktop/core; no assertions or lint rules weakened.                                                        |
| `pnpm --filter @modelloom/core check:native`                 | Exit 0; clang-format check and clang-tidy with warnings treated as errors on both owned C++ sources.                     |
| `pnpm exec prettier --check packages/core eslint.config.mjs` | Exit 0 for affected code/configuration.                                                                                  |
| `pnpm format:check`                                          | Exit 1 on the same seven pre-existing desktop files listed in the earlier line-ending evidence; none changed.            |
| Desktop SHA-256 comparison                                   | All 77 tracked `apps/desktop` files match the pre-execution snapshot byte for byte.                                      |

Tuple: Windows 11 Home Single Language 10.0.26200 x64, host Node 24.7.0, Electron 44.5.1, MSVC 14.44.35207, TypeScript 5.9.3, Vitest 5.0.3. The existing transitive node-gyp 12.4.0 was made an explicit pinned development dependency for its standard Electron-compatible delay-load hook. `pnpm install --offline --ignore-scripts` exited 0 with no package downloads; the first Electron integration run separately acquired its missing locked Electron binary through the installed package. No model or inference runtime was downloaded. Generated binaries remain ignored under `packages/core/out/`.

Review is by the author only: the available delegation tool cannot select the requested Luna/max reviewer. The review covers handles, admission, closed channel schemas, ABI exception containment, bounded output and controlled recovery. This is weaker evidence than independent security review. Compiler/static checks do not establish sanitizer coverage; no sanitizer run is claimed. Synthetic native allocation/Win32 failure injection and every instruction-level owner-death race remain unverified. Atomically assigned jobs reduce the engine creation gap, while broader packaged startup/owner-race acceptance still needs its own evidence.

These development harnesses do not activate the actual ModelLoom desktop core. Job Objects provide ownership cleanup, not a native-code sandbox. Production bootstrap/signature/package verification, reparse/asset integrity, authenticated engine transport, resource/context preflight, graceful real-engine teardown and live model loading remain gated. No packaged app grouping, visible-console presentation, GUI crash survival, durable history, macOS/Linux, hosted CI, network, GPU or inference-equivalence acceptance is claimed. The supplied UI is unchanged.

### Gated real-runtime activation implementation, 2026-10-06

The next PROCEED accepted the concrete activation contract after the previous fixture slice was committed and pushed at `b636110e775d66f7cd21340d864eb36c00e8ef63`. This evidence was collected locally on `feat/runtime-lifecycle` before publication; the user's subsequent request authorizes focused commits and a branch push for this activation slice. All 77 tracked desktop files match the pre-execution SHA-256 snapshot byte for byte. Bionic, mining and selected real models were not touched.

The local-only verifier uses tuf-js 6.0.0 with real ephemeral test signatures. Tests cover inventory bounds/path fields, hash/signature tampering, wrong roots, expiry, timestamp/clock rollback, verified root rotation, missing metadata and forged/fixture capability rejection. A regression first failed on an unintended 30-second capability limit, then passed after receipts were changed to follow signed expiry and backwards-clock checks. Production root custody and actual public-root loading remain gated and are not passed by fixture metadata.

Native installation tests check dependency integrity, retained file/directory locks, unexpected DLLs, reparse bundles, post-install tampering, preservation of a previous version and refusal to promote fixture/serialized receipts. Bounded GGUF tests use synthetic v3 metadata, not actual Bonsai weights. Resource tests check per-slot versus aggregate context, overflow, exact report/configuration matching, uncertainty, shortage and unchanged settings. They do not validate a planner's model-memory predictions.

The hidden-console integration uses an actual compiled synthetic Ctrl+C handler. It verifies hidden console state inside the helper, cleanup before confirmed exit, hung-handler escalation, loading cancellation, helper/owner loss, stale control, an owned listener and exclusion of inherited LLAMA_ARG overrides. Existing headless/Electron ownership tests still cover native crash, partial interruption, explicit reload and independent deployment survival. Authenticated readiness tests use a bounded local HTTP fixture to verify owner checks, unauthenticated rejection, alias/context/slot matching and malformed/oversized replies. The real adapter rejects forged authority and unsupported arguments; no positive actual-model adapter run is claimed.

| Local command or check                                                         | Inspected result                                                                                    |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `pnpm test`                                                                    | Exit 0; desktop 39 and ordinary core 180 cases passed.                                              |
| `pnpm --filter @modelloom/core test:native`                                    | Exit 0; 30 cases across four suites after MSVC /W4 /WX builds and host emission.                    |
| `pnpm typecheck`, `pnpm lint`                                                  | Exit 0 across desktop/core. Later edited core files also passed their targeted type/lint reruns.    |
| `pnpm --filter @modelloom/core check:native`                                   | Exit 0; clang-format and clang-tidy with warnings as errors on four owned C++ sources.              |
| `pnpm exec prettier --check .github packages/core package.json pnpm-lock.yaml` | Exit 0.                                                                                             |
| `pnpm format:check`                                                            | Exit 1 on the same seven untouched desktop files recorded above; no UI rewrite.                     |
| Final verifier/preflight regression rerun                                      | Exit 0; 29 cases after the final root-policy checks.                                                |
| Desktop hashes, `git diff --check`, fixture-process inspection                 | 77 unchanged files; whitespace check exit 0; no process under the owned `out/native` path remained. |

The verified host tuple is Node 24.21.0, pnpm 11.19.0, Electron 44.5.1 with embedded Node 24.21.0, MSVC 14.44.35207, TypeScript 5.9.3 and Vitest 5.0.3 on Windows 11 x64 build 26200. The Node archive was checked against its signed official checksums using the official public release keyring before extraction into ignored workspace tooling. SHA256 is `158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541`; gpgv reported a good signature with primary fingerprint `5BE8A3F6C8A5C01D106C0AD820B1A390B168D356`. Global Node and desktop source were not changed. Native Node-API builds retain the earlier 24.7.0 headers/import library and pass under both tested 24.21.0 hosts.

The production root and reviewed-memory catalogues remain empty. Live activation needs reviewed root custody/recovery, a signed exact upstream/helper/dependency bundle and validated configuration-specific planner reports. The adapter's first coded resource path is CPU/zero GPU layers; CUDA driver/VRAM discovery remains pending. Actual upstream graceful cleanup, model readiness/response/cancellation/reload, disk-full/fault injection, packaged visible-console/app grouping, independent security review, sanitizers, other platforms, hosted CI and inference equivalence remain unverified. The available delegation tool cannot select requested Luna/max, so this is author-reviewed local evidence. [Runtime activation](../docs/runtime-activation.md) records the implemented API boundaries.

### Read-only Windows CUDA resource slice, 2026-10-06

The next scoped PROCEED authorized read-only RAM/NVIDIA driver/VRAM discovery and per-device preflight on `feat/runtime-lifecycle`, after activation publication at `6c5945c851f5cc0283fff988309325da9245d6f3`. No desktop source, preview control, Bionic state, mining configuration or model workload was changed. Discovery and pure admission are implemented; the real adapter remains CPU-only and production trust/planner catalogues remain empty.

Tests cover strict bounded UTF-8/CSV parsing, byte conversion, unknown memory, duplicate GPU identities, impossible/overflowing amounts, exact configuration/report binding, missing or malformed placement, each GPU's budget, non-pooling of VRAM, numeric NVIDIA driver compatibility and rejection of active MIG partitioning. Real child-process tests exercise nonzero exit, missing executable, cancellation, timeout, unrelated-process survival and the combined stdout/stderr boundary. Native tests exercise OS-derived folders, a fresh physical-RAM sample and the installed NVIDIA query without loading a model.

The first targeted run failed because the new implementation modules did not exist. A later positive native regression failed with `QUERY_FAILED`: this installed driver's NVML initialization requires `ProgramFiles` in the query environment. Comparing inherited and restricted environments isolated that requirement. The fix supplies the OS known-folder value, rather than inheriting a caller value; the regression then passed even with a spoofed caller `ProgramFiles`. This is local evidence for the observed driver, not a general driver-compatibility matrix.

| Local command/check                                      | Inspected result                                                                                                                                                                                                             |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`                                              | Exit 0 on the separate rerun: 39 desktop and 210 ordinary core cases. The earlier run concurrent with build/static/type/lint jobs hit three existing desktop five-second timeouts; assertions and timeouts were not changed. |
| `pnpm --filter @modelloom/core test:native`              | Exit 0; 34 cases across four suites, after MSVC /W4 /WX builds and host emission.                                                                                                                                            |
| `pnpm typecheck`, `pnpm lint`                            | Exit 0 across desktop/core after the new changes.                                                                                                                                                                            |
| `pnpm --filter @modelloom/core check:native`             | Exit 0; formatting and clang-tidy with warnings as errors on all four owned C++ sources.                                                                                                                                     |
| `pnpm --filter @modelloom/core probe:resources`          | Exit 0 after the environment fix; one physical GPU, NVIDIA driver 617.14, WDDM, 16,380 MiB total and 12,097 MiB free at that instant. RAM/VRAM can change; this is not an allocation guarantee. No model was loaded.         |
| Desktop SHA-256 comparison and native process inspection | All 77 tracked desktop files are byte-identical to the prior baseline; no process under the owned `out/native` path remained.                                                                                                |

The tests use synthetic memory reports and process fixtures; they do not validate Bonsai requirements or actual CUDA placement/activation. A reviewed exact device-to-launch mapping, signed runtime assets, approved production trust and configuration-specific resource evidence remain prerequisites for live loading. WDDM management data is not a reservation or proof of an allocatable Windows budget. Other platforms, packaged visual/grouping checks, hosted CI, real upstream cleanup and inference equivalence remain unverified. [Runtime activation](../docs/runtime-activation.md) records the fixed read-only query and error contract.

### Local Chat wiring, 2026-10-09

Local checks on `codex/local-generation` connect the real captured transport,
utility-owned history/admission, closed main/preload bridge and existing Chat UI.
The automated checks below use synthetic inference. They do not establish the
requested live manual desktop test or inference equivalence.

| Check                                                          | Inspected result                                                                                                                                                                 |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`                                                    | Exit 0: 69 desktop and 393 ordinary core tests.                                                                                                                                  |
| `pnpm --filter @modelloom/core test:native`                    | Exit 0: 57 tests across seven suites, after native and host builds. Includes real Electron utility/protected SQLite save, Stop, full Quit and reopen with a synthetic transport. |
| Chat browser regression suite                                  | Exit 0: three tests, including system/Arial fonts and 1280/1100/1000-pixel widths.                                                                                               |
| `pnpm typecheck`, `pnpm lint`, core host build, renderer build | Exit 0.                                                                                                                                                                          |
| `pnpm format:check`                                            | Exit 1 on five untouched CRLF files. Their LF-normalized contents exactly match Prettier; no unrelated edits were made.                                                          |

Renderer/core tests cover retained partial output, explicit retry without a
duplicate user turn, reload without replay, caller-specific Stop, navigation
while another conversation runs, output-limit status, inert model text,
coalesced durable drafts and a new draft typed during token preparation.
Boundary tests cover wrong callers, forged chunk identities, exact reply
shapes, bounded acknowledged progress, stale paging cursors and cleanup despite
history-opening failure. Existing native tests retain ownership, directory
identity, integrity and unrelated-deployment coverage.

Computer Use now starts, navigates ModelLoom and opens its native model picker.
The user authorized existing-key metadata renewal and four-slot validation.
Renewal to version 2 passed against the existing verification state, preserving
the root and inventory. The signed four-slot planner exited 0 with 30,720 total
context; its GPU components rounded upward sum to 5,579 MiB. The guarded live
diagnostic exited 1 before engine launch because available RAM was
4,324,495,360 bytes, below its original 10 GiB startup floor. The retry replaces
that arbitrary floor with a 7.715 GiB calibration guard derived from the observed
one-slot peak, added slot reserves and headroom. Two standalone budget tests and
lint pass. The subsequent live four-slot diagnostic exited 0: four concurrent
7,500-token prefills, per-slot reuse, bounded RAM restoration and graceful owned
exit. Its resident peak was 6,210,097,152 bytes; private-commit peak was
8,852,537,344 bytes. Idle long prompts evicted the initial short-cache fixture;
that failure is preserved separately, and the passing fixture replaces all
four resident prompts first. No cache, context or precision setting changed.
Desktop now selects the exact development four-slot report, retaining the older
one-slot report. Initial admission reserved 7,524 MiB physical RAM and 5,579 MiB VRAM.
The user's October 14 RAM-reduction request revised the four-slot physical RAM
envelope to 6,500 MiB, retaining the same VRAM, configuration and full cache
reserves. Boundary rejection tests passed after an observed failing test; the
fresh four-slot run passed with a 6,186,299,392-byte resident peak, cache
restoration and clean owned exit. The RAM reserve remains an estimate rather
than a steady-state measurement or an allocation guarantee.

Command control of the existing Kryptex scheduled task verified both stop and
SRBMiner restart with existing settings. Computer Use imported the approved
model and reached Cluster's ready state, but Chat history failed to open. Windows
package virtualization redirects the application-data directory to Codex's
package cache; the native guard rejects the physical/logical path mismatch.
That first attempt sent no live Chat message. Full Quit left no owned engine,
and mining was restored. The user subsequently directed the storage fix to
follow LM Studio's documented profile-root layout. Trusted main now selects
`%USERPROFILE%\.modelloom`; native startup creates the final app directory
with private permissions after locking its ancestors. Path equality, link
rejection, retained identities, quotas and the writer lock remain unchanged.
Renderer regressions cover typing while history is unavailable, first-conversation
creation after startup recovers, draft transfer and a failed New chat's storage
error. A native regression creates a missing private app root, persists/reopens
its first draft and rejects a junction root without writing to its target.
The ordinary suites pass 72 desktop/395 core tests, and all 60 native tests pass.
Typechecking, host/native builds, lint and native static analysis pass.
The rebuilt Electron desktop's automated check accepts typing before loading.
The actual profile store also saves/reopens a synthetic draft. An earlier live
load with mining stopped was correctly refused
because available RAM was about 0.46 GiB below the validated reserve despite
ample free VRAM. No resource requirement was weakened. Mining was restored,
no owned engine remained, and manual Computer Use was unavailable on retry.

Subsequent diagnosis reached HTTP 200 and reproduced `INVALID_STREAM` on Bonsai's
string `reasoning_content` delta. After the user's thinking-support approval,
regressions verified separate streams, combined quotas, strict Unicode/identity
checks, acknowledged chunk bounds, saved/reopened thinking, Stop and unchanged
native-template context. Migration tests verify exact-schema 1-to-2 preservation,
post-ALTER rollback and unknown-schema refusal. The actual guarded profile
upgrade preserved every original field by a before/after content checksum.

The automated live Electron test passed: retained draft before loading, a complete
`HELLO` answer with 670 thinking characters, collapsed/expanded thinking, Stop
during a second request with 36 thinking characters retained, owned-engine stop
and protected-history reopen. Mining was restored and SRBMiner verified. This
does not complete the requested manual Computer Use test; the native pipe was
unavailable. The ordinary suites passed 73 desktop/405 core tests and all 60
native tests passed. A later ten-test Chat regression suite passed after clearing
the stale Stop footer. Typechecking, lint, host and renderer builds passed.
No worker/Tailscale
integration, hosted CI, production activation or quality-equivalence result is
claimed. [Local Chat development](../docs/local-generation.md) records current
behavior and startup limits.

### Saved response speeds, 2026-10-09

After PROCEED for the response row and the explicit choice to save speeds with
responses, regressions verify native final timing projection on finish or usage
envelopes, omission of invalid/missing rates, a cached prompt's zero prefill rate,
strict scalar IPC validation, settled response/metrics commit, idempotence and
retry isolation. Exact schemas 1 and 2 upgrade transactionally to schema 3;
tests preserve prior fields, reject unknown schemas and roll back injected
post-ALTER failures. Renderer reload retains recorded rates.

All 75 desktop, 419 core and 60 Windows native tests passed, as did four Chat
browser checks, typechecking, lint, host build and renderer build. Browser fixtures
verify 12px/400/#ABABAB labels, removal of thumbs-up/down, no horizontal overflow,
and alignment after Copy/Retry at 1280, 1100 and 1000 CSS pixels. No dot or new
speed icons are added.

The actual guarded schema-2 to schema-3 profile upgrade preserved every original
saved field, including thinking, across six conversations/thirteen attempts by
matching SHA-256. The automated real-model Electron test completed at 11:46 UTC:
Send returned `HELLO`, native rates were rendered, Stop retained partial thinking,
owned-engine stop passed, and the same recorded rates appeared after a full app
restart. Kryptex/SRBMiner was stopped before the GPU test and restored afterward.
This is automated UI evidence, not manual Computer Use, throughput-target,
quality-equivalence or cross-platform acceptance. Details and ignored evidence
paths are recorded in [local Chat development](../docs/local-generation.md).

### Thinking-duration row, 2026-10-09

The user's PROCEED authorizes `Thinking` without an ellipsis while thinking is
active, then `Thought for [time]`, preserving the existing icon/chevron/style.
Tests cover monotonic phase timing, first-answer checkpointing, Stop/recovery,
immutable saved duration, renderer reload and seconds/minutes/hours/sub-second
formatting. Old responses without a measurement use `Thought` without an invented
time. Exact schemas 1, 2 and 3 upgrade transactionally to schema 4; preservation,
rollback and unknown-schema refusal are covered.

All 81 desktop/423 core tests and 18 targeted native history/chat tests passed.
Typechecking, lint, host/renderer builds and targeted source formatting passed.
The actual schema-3 to schema-4 protected-profile upgrade preserved seven chats
and eighteen attempts, including their existing speeds, by a matching checksum.
The automated real-model test completed at 12:20 UTC: `Thinking` became `Thought
for 3s` for a measured 3691 ms phase, Stop preserved a partial duration, expansion
and owned-engine stop passed, and the recorded labels/speeds survived a full app
restart. Kryptex/SRBMiner was stopped before the GPU test and restored afterward.
The app was reopened. This is automated UI evidence; manual Computer Use,
quality-equivalence and other-platform acceptance remain separate. Evidence
paths are recorded in [local Chat development](../docs/local-generation.md).

### Development history at startup, 2026-10-09

The user approved separating history startup from model loading. Regressions
cover history before import/resource admission, Send gating, one writer through
import/rejected load/Stop, startup failure and Quit races with both preparations.
Development-host checks cover retained core ownership without package or engine
activation, rejected verification, late preparation on close, and binding/closing
the admitted adapter. Existing storage identities, private permissions, quotas,
writer locks, caller checks and engine gates are retained.

The actual Electron check at 14:32 UTC restored eight existing conversations,
including their thinking times/speeds, with no model imported or loaded. A new
draft survived a full app restart; existing conversation checksums matched and
Send remained disabled/denied. The additional generation check was rejected by
resource preflight before engine launch, so this run supplies no new Send/Stop
or quality evidence. Mining was restored and SRBMiner verified. Local evidence:
`plans/startup-history-live.json`, `plans/startup-history-restarted.png`, and
`plans/startup-generation-live.json` (all ignored). Manual Computer Use and
other-platform/production acceptance remain separate.

Local verification passed 86 desktop and 427 core tests, 39 targeted Windows
history/ownership/utility tests, typechecking, lint, host/renderer builds and
targeted formatting. Earlier automated live-generation evidence predates this
startup change; it is not a substitute for the rejected new generation check.

### Chat deletion and fading titles, 2026-10-09

The later PROCEED authorizes Lucide trash, title fading/hover scrolling and
confirmed saved-chat deletion. Store regressions verify target-only removal,
retention of unrelated drafts/messages/thinking/metrics, active-record refusal,
rollback after injected child-row deletion failure and stale empty-chat cursor
invalidation. Service/controller tests verify caller binding, same-chat admission
closure, cancellation settlement, pending-token-count abort, other-chat isolation,
safe failure retention and deletion without a loaded model. Renderer tests cover
Cancel, selected-chat replacement, failed deletion retaining the draft and
deletion during preparation.

All 89 desktop and 436 core tests passed, with five Chat browser checks,
typechecking, lint and host/renderer builds. At 1280, 1100 and 1000 CSS pixels,
browser checks verify the fade, hidden idle trash, visible hover/keyboard action,
measured title movement, fixed trash position, reset on leave, confirmation and
reduced-motion behavior. Seventeen native protected-history cases passed. The
native chat test failed owned-process cleanup during concurrent checks; its
isolated repeat passed unchanged. The initial failure's cause remains unproven.
The isolated test uses synthetic transport and real protected-store/utility
containment, retaining partial output and verifying deletion across reopen.

The actual automated Electron UI test completed at 15:56 UTC with no model loaded.
Cancel preserved the labelled synthetic chat, Delete opened an empty New chat,
and deletion persisted across renderer reload and full app restart. SHA-256 checks
confirmed that all eleven original chats remained unchanged; test-only records
were cleaned up. Mining stayed running. Ignored evidence:
`plans/chat-delete-live.json`, `plans/chat-delete-hover.png`, and
`plans/chat-delete-restarted.png`. This supplies no new manual Computer Use,
real-model cancellation-during-deletion, quality or cross-platform acceptance.

### Shared popup styling correction, 2026-10-10

The approved correction updates the shared dialog defaults to the existing
neutral popup treatment. Eighteen browser checks passed across Chat, Models,
Cluster launch and Settings. Targeted formatting and the renderer build passed.
The automated Electron check at 00:39 Malaysia time compared Delete chat with
Installed runtimes: both rendered the same neutral background, border, text,
Segoe UI font stack, 18px/500 heading and 14px/400 body. Footer buttons rendered
at 13px/500 and 36px height; Cancel was charcoal and Delete was white with dark
text, without gradients. Cancel/Escape retained the original conversation list.
Screenshots were visually inspected. No chat was deleted or model loaded;
mining stayed running. Ignored evidence: `plans/neutral-dialog-live.json`,
`plans/chat-delete-neutral-dialog.png`, and `plans/settings-neutral-dialog.png`.
This is automated Windows UI evidence, not manual Computer Use or other-platform
acceptance.

### Four Chat review corrections, 2026-10-10

The user authorized all four reviewed fixes. Regressions cover Stop before
native admission with draft retention, caller rejection and other-chat isolation;
saved Unicode/literal message search before opening a chat, bounded summary
paging and wrong-query/revision cursor rejection; local calendar date groups;
and concurrent empty-chat reuse with draft preservation. No schema migration or
inference-setting change is involved.

The complete ordinary rerun passed 93 desktop and 441 core tests. The first
attempt had five existing UI timeouts during concurrent checks; the unchanged
rerun passed with original assertions and deadlines, leaving the original cause
unproven. Five Chat browser checks passed after two stale fixtures were given
required update timestamps. Eighteen targeted Windows native history/Chat tests
passed, with actual Electron IPC, protected-store reopen and synthetic transport.
Typechecking, lint and host/renderer builds passed. No new GPU/model, manual
Computer Use, hosted CI, quality-equivalence or release evidence is claimed.

### Ordinary startup without samples, 2026-10-10

The later PROCEED removes the implicit serve-mode sample flag and prepares the
existing approved Windows development core in Forge before Electron opens.
Regression tests first reproduced samples with no bridge/disabled core and the
missing launch preparation. All 96 desktop tests passed, including build-before-
enable ordering, failed-build startup refusal and explicit demo isolation.
The browser run passed 47 of 48 checks; the existing long-title animation case
timed out with ten workers. Its unchanged isolated repeat passed, without an
assertion/deadline change. The original timeout cause remains unproven. The new
ordinary-startup cases verify empty Models/Cluster without a bridge and one
detected local device with no samples when the core is disabled. Fixture tests
use explicit demo mode on port 5175; ordinary tests use port 5176.

The actual automated Electron check through the normal Windows launcher passed:
development output was restored after rebuilding, the live core reported enabled,
five saved conversation summaries were accessible with no model loaded, Models
contained no samples and Cluster contained only the detected local device. The
owned test app exited gracefully and the app was reopened without the temporary
debugger. Evidence: ignored `plans/ordinary-startup-live.json` and
`plans/ordinary-startup-local-device.png`. Typechecking, lint correction and
host/renderer builds passed. No GPU/model run or manual Computer Use is claimed;
mining stayed running. This supplies no new release, networking or quality evidence.

### PR #6 draft and notification corrections, 2026-10-10

Regression tests reproduced a newer saved draft being cleared at Send admission
and Copy/Delete feedback masking later live status. The draft test holds the Send
reply, admits the original message after a newer draft is saved, then remounts the
renderer without a loaded model and checks the newer draft survives without a
second request. Store cases also check matching and empty drafts across store
reconstruction. Presentation tests cover current errors, completion without stale
feedback returning, Delete followed by Send, keyboard Send, Retry and Stop.

After the two fixes, `pnpm test` passed all 103 desktop and 444 core tests;
`pnpm typecheck`, `pnpm lint`, changed-file Prettier and `git diff --check` also
exited 0. These are local SQLite/synthetic transport and DOM checks. No new
native, real-model, manual UI or hosted CI evidence is claimed. Full-history
paging performance is deferred. Hosted CI must be checked on PR #6's updated
head after publication.

### Local API/package follow-up review, 2026-10-14

PR #6 is merged at `2ca5d791858b80d72a0737e286621ed827ba86df`. At review time,
the `feat/local-api` changes were uncommitted and had no hosted CI evidence.
The later local-commit checkpoint below supersedes the commit status.
[The follow-up review](../docs/LOCAL-API-REVIEW-2026-10-14.md) records the current
findings, exact commands and evidence limits.

Fresh results: 126 desktop tests passed sequentially, 537 core tests passed,
81 native tests passed after rebuilding native/host output, and three staging
tests passed with development preparation followed by ordinary-output restoration.
Five actual packaged checks passed for original-server private-stream EOF,
startup owner death, duplicate launch, version reporting and ordinary-package
authority rejection. Typechecking and native static checks passed. Full lint
fails on a staging-test `finally` throw. Raw formatting warns on 106 CRLF files;
all 202 tracked format-supported files pass after in-memory newline normalization.
The initial parallel desktop run had three five-second timeouts; sequential
success with unchanged deadlines does not establish their cause.

The real-model original-path test failed after 56.1 seconds. Its cleanup rejects
the new `runtime-cache` directory and masks any earlier failure; its installed
entry-count assertions also need to distinguish versions from the cache. No
latest loaded-model generation or owner-death acceptance is claimed. Mining was
stopped before the check and SRBMiner was observed running after Kryptex restart.
All 61 staged resource hashes and four original protected-profile hashes matched;
the ordinary workspace development flag was restored to false.

The private pipe supersedes the former temporary credential-file gap. Separate
original process rows are accepted by the user, so grouping is no longer a
failure. First-run/P06 reconciliation retains the continuation's test-host and
verification-floor qualifications. Ordinary native-fault, full loaded-model,
independent full security, release/platform and inference-quality gates remain
open. Older successful real-model results retain their original scope.

### Authorized API/package review fixes, 2026-10-14

The user authorized all three review fixes. The staging containment guard now
runs before `try/finally`. Test cleanup validates all installed entries before
deleting version copies, preserves the separate normal cache and rejects
unexpected/linked entries. Cleanup failure retains the primary failure as the
displayed cause. Live numeric-setting help explains saved generation defaults
and load settings requiring Stop/Run and verified resources; values and controls
are unchanged.

Three new filesystem regressions reproduced the old cleanup failures and pass
after the fix. Fresh checks passed eight focused tests, 129 desktop tests in 23
files sequentially, 537 core tests in 52 files, all three staging tests, full lint,
typechecking and the development package rebuild. Ordinary host output was
restored after development preparation. All 61 rebuilt resource hashes and four
original protected-profile hashes matched. The development archive is
`71a42493fb2c58742f4ec51dc004b923a8b39ed310896300634a3e51b3d99308`.

The first rebuilt-package live run failed at import with a generic runtime
error. Separate file/host registration and normal-profile import diagnostics
passed; the first failure's cause is not established. The second unchanged live
run imported Bonsai, then the memory preflight rejected loading. Both primary
failures survived cleanup. Captured app processes exited and mining was restored;
SRBMiner was observed running afterwards. Model/settings/resource guards were
unchanged. Generation and loading-owner-death acceptance remain open. Evidence
and commands are in [the review](../docs/LOCAL-API-REVIEW-2026-10-14.md) and its
ignored `review-fixes` evidence folder. The earlier review's native/static and
five packaged startup checks retain their original dated scope. No commit,
publication, signing, other-platform or inference-equivalence result is claimed.

### Packaged live generation after freeing memory, 2026-10-14

The first run with sufficient memory loaded Bonsai, completed real Chat and
unloaded normally. Its forced-close step incorrectly used Playwright's process
PID, which an isolated diagnostic identified as `cmd.exe`. The actual Electron
owner remained alive, so captured-process and runtime-file cleanup failed. Both
errors were preserved. The test now gets `process.pid` from Electron main,
matching existing lifecycle/private-stream checks; no product behavior, model,
settings, assertion, deadline or ownership guard changed.

The corrected actual packaged test exited 0 in 2.2 minutes. It verified original
server/helper names and paths, real Chat completion, graceful unload, reload,
forced main exit during loading, every captured process exited and the temporary
runtime version removed. Its separate `runtime-cache` and verification floors
were retained. Post-run audit passed all 61 resource hashes and four original
protected-profile hashes; ordinary compiled development authority stayed false.
Targeted lint/format and desktop typechecking passed. Mining was restarted and
SRBMiner observed running; no test app/helper/server remained.

The passing receipt and audit are under ignored
`packages/core/out/activation/b11306/evidence/packaged-development-20261014/review-fixes/live-ram-retry/correct-owner`.
This supersedes the previous paragraph's generation/loading-owner gap. It is
automated Electron UI evidence, not manual Computer Use, ordinary native-fault,
full API/security, hosted CI, platform/release or inference-equivalence acceptance.
No commit, signing or publication occurred during that live check.

### Local API commit checkpoint, 2026-10-14

The user subsequently authorized local commits. Feature and test groups are
recorded through `28d344d` in 68 focused commits with at most two explicitly
staged files each. Documentation and build tooling follow in separate groups.
Fresh pre-commit verification passed 129 desktop tests sequentially, 537 core
tests, full lint and typechecking. All 141 format-supported scoped files passed
an in-memory LF-normalized formatting check. This does not remove the previously
recorded global CRLF warnings or turn local results into hosted CI evidence.
The actual packaged live result above retains its tested artifact identity.
Research/reference assets, browser snapshots and local plans stay outside the
commits. No push, PR, signing or deployment is part of this checkpoint.

### PR #7 hosted test corrections, 2026-10-14

The user subsequently authorized push and PR creation, then corrections to the
failed checks. [Run 38582469564](https://github.com/haowern98/ModelLoom/actions/runs/38582469564)
at `7eb45c58e30db442015236ccc1badeba879c9921` passed Security and Windows desktop.
Quality failed two core cases: a fixture expected Windows separators on Ubuntu,
and another called `mkdtemp` before its output parent existed. Browser passed 47
cases and failed one outdated key-state assertion.

The corrections are test-only. The mocked development paths now use native
absolute fixture roots and exact joined child-path assertions. The failed-capture
fixture creates its output parent while retaining its cleanup containment guard.
The disconnected API preview asserts `Unavailable` within the key-status group,
retaining every disabled-control assertion. No product behavior, assertion
deadline, security control or resource requirement changed.

Fresh local checks passed all seven focused core cases, all 537 core tests,
all 48 browser cases with `CI=true` and one worker, full typechecking, changed-file
lint/format and diff whitespace checks. An absent scratch-parent setup check
passed. The browser failure was reproduced locally at the same stale assertion
before correction; an earlier cold-start attempt timed out before reaching that
assertion, with no deadline change. Ubuntu execution awaits the new hosted run;
local Windows success alone does not prove those hosted checks passed. No new
GPU, packaged-app, manual Computer Use or inference-equivalence run is claimed.

## Cluster sidebar evidence, 2026-10-15

The user-approved renderer revision on `codex/cluster-sidebar` adds the Settings-style
Cluster sidebar, independent destination views and compact model/action toolbar.
Networking and real request approval remain unavailable outside labelled demo fixtures.

- Desktop unit tests: 134 passed in 24 files with `vitest run --maxWorkers=1`.
  Concurrent validation had timeout-only failures in two existing interaction tests;
  the serial run passed with their original timeouts and assertions unchanged.
- Browser coverage: the 49-case suite produced 47 passes, one cold-load timeout
  in the API setup hook and one obsolete 24px Cluster-heading expectation.
  After correcting the heading expectation to the approved 18px sidebar value,
  both affected cases passed against warmed preview servers. The other 47 results
  are retained for the same renderer implementation; this is combined evidence,
  not a claim that the original suite run was fully green.
- Desktop typechecking, changed-source/test ESLint, changed-file Prettier,
  `git diff --check` and the normal renderer production build passed.
- New navigation regressions verify distinct destinations, simulated request
  decisions, normal-build refusal of sample peers, shared multi-field search and
  retention of the same canvas/control elements after zero-result search.
- Source comparison confirmed `ClusterCanvas.tsx` and all eight zoom/Fit control
  CSS rules are unchanged. Browser cases cover their pan/zoom/fit behavior,
  typography, bounds and retention across destination changes.
- Visual inspection covered the Overview and Add device previews at 1280px;
  browser geometry checks also exercised 1000px layouts and font fallbacks.
  Captures are local under `apps/desktop/out/cluster-sidebar-*.png`.

An independent read-only subagent review identified inconsistent search matching;
the shared matcher correction was reviewed and its regression passed. Validation
also found that notifications could cover Run; positioning them below the toolbar
resolved the browser regression. No new native/package, GPU, inference-equivalence,
worker-network or hosted-CI acceptance is claimed by this renderer evidence.

The later 2026-10-15 refinement removes Cluster device search and uses Phosphor
Regular PlusCircle for sidebar Add device. Search-dependent checks now cover
unfiltered devices, sidebar navigation and keyboard focus. The affected 19 unit
cases and 17 Cluster browser cases pass, as do desktop typechecking, changed-source
ESLint and formatting. Live browser inspection confirms no sidebar search input
and the circled-plus SVG. The full desktop suite and production build were not
rerun for this refinement; the preceding evidence describes the earlier revision.

The subsequent approved viewport refinement starts at 100%, preserves zoom on
resize and centers one device within the space left beside the details panel.
The user's higher-card reference supersedes exact vertical midpoint alignment:
startup, resize and Fit to view use the same raised visual center above the zoom
bar. The 26 Cluster browser cases pass, including new startup, single-device,
panel-open, resize, retained custom zoom and narrow-space Fit coverage. Existing
diagram interaction cases explicitly use Fit instead of relying on automatic
startup fitting. The affected 19 unit cases passed, and final desktop typechecking
and changed-source ESLint passed. Native minimize/restore was not manually checked.

For the subsequent Settings-format revision, nine affected Cluster page/joining
unit cases pass, along with desktop typechecking, changed-source ESLint and the
normal renderer build. In-app browser comparison at 1280px confirms identical
728px columns, title coordinates, 24px headings, group colors/radii and row padding
against Settings. All three destinations have no horizontal overflow or clipped
buttons at 1000px; Devices also passes at 800px. Device details, connection details,
Join cluster navigation and both simulated request decisions were exercised.
Visual captures and the appended QA report are local; the full suite was not rerun.

The later Devices inventory redesign passes 12 affected unit cases, including
new coverage of all supplied devices, removal of inventory actions/icons, honest
unknown specifications and no duplicated Apple unified-memory VRAM. Typechecking,
changed-source/test ESLint, formatting and renderer build pass. In-app browser
inspection finds four sample articles, zero inventory buttons/icons and a 728px
column at 1280px, with no overflow or clipped rows at 800px. The apple-design review
identified repeated unknown rows as clutter; the repaired version consolidates
those into a per-device note. No additional hardware detection or networking was
implemented or claimed. Full-suite and native desktop checks were not rerun.
