# ModelLoom testing specification

**Status:** Draft for review; no application tests have been implemented or run  
**Updated:** 2026-10-01  
**Scope:** Product acceptance, contract validation, security, visual fidelity, runtime lifecycle, and inference correctness. This document does not authorize coding, workloads, process termination, or experiments.

## 1. Purpose and lecture basis

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

| Layer | Required evidence | Limits |
| --- | --- | --- |
| Unit | Validation, state transitions, resource accounting, cancellation ownership, and other isolated invariants | Cannot prove a working engine, installer, or network. |
| Contract/integration | Real component exchanges where available; malformed, oversized, unsupported-version, stale, and unauthorized messages; errors and stream termination | Test doubles are labeled and later supplemented at the actual boundary. |
| UI/component | User-visible states, keyboard/focus behavior, safe rendering, and functional control actions | Rendering success does not establish inference or worker security. |
| Native/runtime | Actual GGUF loading, capability reporting, supported placement, ordinary native failures, and process lifecycle | Compile success and controlled termination alone do not prove native-crash recovery or unchanged quality. |
| Security | Peer approval/revocation, API access, filesystem scope, privileged bridge validation, update verification, and diagnostic redaction | Protected transport does not certify native RPC safety. |
| Platform/end-to-end | Installed app, real core/engine, real LAN/Tailscale/Headscale paths, headless operation, and supported mixed-device journeys | A single platform or simulated worker cannot establish cross-platform acceptance. |
| Inference correctness | Approved D12 reference and comparison procedure on actual supported runtime/device configurations | Visual acceptance and token-throughput measurements are separate evidence. |

For each affected behavior, choose applicable ordinary, boundary, ambiguous, failure, cancellation, and adversarial cases. Define precise expected behavior for ambiguous inputs before implementation. Do not manufacture tests that merely reproduce private implementation details.

## 4. Product acceptance matrix

| Journey | Minimum observable checks |
| --- | --- |
| J1: Clean install | First local response through the installed app without manual engine setup; discoverable controls; packaged Windows app grouping; no visible console; actual platform process identities. |
| J2: LAN | Explicit approval, two real participating devices, actual placement, and a completed response. |
| J3: Private networks | Tailscale and existing Headscale exercised separately; enrollment/reconnect failures; approved-peer restriction; actual path or an honest unknown state; no public raw RPC. |
| J4: Placement | Valid manual split accepted; invalid or unsupported assignment rejected before generation; actual placement reported. |
| J5: Chat/API | Same active model; supported model-list and completion clients; local default and key enforcement; streaming/non-streaming outcomes. |
| J6: Runtime update/rollback | Independently install/select/update and restore a working runtime; same GGUF reloads; user data survives; incompatible or failed candidates cannot become a falsely healthy cluster. |
| J7: Worker failure | Interrupt a required worker during generation; truthful terminal status and retained partial output; controlled recovery without hidden replay. |
| J8: Headless worker | Linux operation without a desktop session; service recovery, diagnostics, scoped control, and independent lifecycle ownership. |
| J9: Shared requests | Simultaneous Chat/API work, saturation, per-request isolation, caller-owned cancellation, and no silent model switch. |
| J10: Placement restart | Save while running; applied revision stays unchanged until explicit restart; affected work is explained and resolved. |
| J11: Storage | Actual required transfer/cache, quota and integrity checks, interrupted transfer, scoped cleanup, and preservation of user originals. |
| J12: Visual/accessibility | All five reference compositions with approved revisions and relevant empty/loading/error states; ChatGPT font sizes by corresponding text role; foreground panel layering; keyboard, scaling, contrast, and reduced motion. |
| J13: Engine crash | Controlled termination and an ordinary native-crash case separately; usable GUI/unaffected core; honest request outcomes; bounded recovery. |
| J14: Quit/abnormal exit | Idle, loading, generating, queued, and transition states; hung-engine escalation; verified owned exits; unrelated/headless processes preserved. |
| J15: Shared core/runtime | Desktop and independent headless operation use the reviewed shared machinery and runtime-management contract; same-model checks and documented parity gaps. |

The product specification remains authoritative for each journey's full criteria. This matrix organizes evidence and does not reduce that scope.

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

For typography evidence, use the approved CSS size table in UI-SPEC section 2.1: main page headings 24px; sidebar/section/dialog headings 18px; card/model/device titles and chat messages 16px; body and control text 14px; metadata and compact secondary/status text 12px. At default text scaling, check observed computed font sizes against the corresponding role values and record each role's reference, measurement method, and implementation size. Distinguish the approved ModelLoom design choices from directly measured ChatGPT values. Check role consistency across page/section/card headings, chat/dialog body text, menus, buttons, inputs, descriptions, metadata, and status labels. Compare at matching scaling and verify that text remains readable and centered where intended, without clipping controls or overflowing cards, dialogs, and footers at supported window sizes. A valid size difference between distinct roles is not itself a failure. Passing functional tests alone does not verify matching font sizes; this documentation change supplies no new typography acceptance evidence.

Cover accessible names, keyboard navigation, focus recovery, screen-reader status, readable contrast, text scaling, reduced motion, and status meaning without color. Essential actions remain reachable at each approved window size. Intentional reference deviations require recorded user approval.

The first-release platform matrix must include approved Windows/Linux NVIDIA configurations, Apple Silicon Metal, Linux headless, CPU fallback where supported, and mixed-device multi-node operation. Record OS, architecture, driver, runtime/backend, and connection versions per result. Exact supported floors and pins await D10; platform omissions remain visible. Direct and relay paths are separate observations, and no connectivity result guarantees speed.

## 8. Inference correctness

Before any authorized comparison, D12 defines the single-GPU/reference configuration, selected dense GGUF/hash, context and sampling, prompt corpus, comparison scope, numerical assumptions, stopping conditions, and resource bounds. Preserve the user's requirement: no quality loss and no draft-model methods.

Use per-request comparisons for concurrent workloads as well as single requests. Equal seeds or one matching answer alone do not establish general equivalence across backends or concurrency. Any exact-token claim requires its approved deterministic/numerical comparison conditions and actual evidence. Do not relax the reference to justify an optimization, substitute a different quantization, or invent a blanket tolerance. Performance experiments require separate authorization and cannot replace correctness acceptance.

## 9. Tooling and delivery gates

Proposed tooling under D10: Vitest for TypeScript unit/integration checks; React Testing Library for UI behavior if React is accepted; Playwright for desktop flows and visual captures, with its Electron support explicitly treated as experimental. Native checks use the selected upstream CMake/CTest interfaces and meaningful sanitizer/static checks; Go uses its standard testing/race tools if selected. [Vitest](https://vitest.dev/guide/), [Electron testing guidance](https://www.electronjs.org/docs/latest/tutorial/automated-testing), [Playwright Electron API](https://playwright.dev/docs/api/class-electron).

Pin and validate the selected tooling against the actual package before making it mandatory. Automation cannot stand in for native window/process presentation or real hardware/network acceptance. No tool is installed and no test command exists merely because this spec names it.

An implementation task completes when its affected acceptance criteria, relevant checks, and review pass with inspectable evidence and accurate updated specs/comments. A release additionally requires all applicable J1-J15 journeys, the supported platform/network matrix, reviewed RPC/update trust, approved correctness evidence, and recorded limitations. No arbitrary global coverage target is prescribed; untested critical contracts are still blockers. Pending future milestones do not block unrelated authorized work.

## 10. Current evidence

The GitHub Actions workflow now defines Quality, Browser, Windows desktop, and Security checks for pull requests and main pushes. Local workflow lint and its underlying foundation commands passed after updating Vite to 7.3.5. Secret scans passed and rejected a synthetic credential; the dependency audit has no high/critical findings and one low-severity esbuild advisory. Publication is authorized. GitHub-hosted evidence must be tied to the exact pushed commit and its completed run; local validation alone does not establish that result. Required-check branch rules have not been enabled.

The lecture pages and existing specifications were read. This document remains a draft contract for the full product. The desktop foundation has component, browser, and packaged Windows smoke checks; their scope is the simulated Models interface and shared shell. On 2026-10-02, browser inspection measured the approved role sizes, centered header controls and three-dot icon, and no metadata/footer overflow in list layouts at 1280, 1240, 1200, 1180, 1100, and 1000px widths. The four browser tests passed, including metadata containment in both list and grid views at those widths and the 1279px reflow boundary. Smaller grid cards use fewer metadata columns when needed. Packaged Windows inspection at device-pixel ratio 1.75 confirmed the page, model, metadata, search, menu, and dialog sizes and centered three-dot icon; the packaged smoke check passed navigation, renderer isolation, and normal owned-process exit. Formatting, TypeScript checking, and linting passed. This evidence does not establish complete five-screen or cross-platform visual acceptance. Installer, native-crash, queue, network enrollment, signed-update, and inference-correctness acceptance remain pending.
