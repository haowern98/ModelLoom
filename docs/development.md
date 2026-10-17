# ModelLoom development guide

**Cluster configuration implementation, 2026-10-16:** Raw drafts and named
configurations use the caller-bound `modelLoomCluster` bridge and protected
schema-4 utility database.

The implemented Windows development slice uses the verified, unmodified b11306
runtime for the exact Bonsai 64-block profile: context 7680 per slot, four slots,
q8_0 K/V caches, flash attention on, batch 2048/microbatch 512 and one or two
NVIDIA GPUs on this PC.
Other load tuples remain rejected. It does not open production root custody,
change signatures or modify llama.cpp. Auto place refreshes resources and runs the
stock fit estimator, preferring one GPU, then checking both GPU orders and cuts
from the centre outward until the first feasible proposal. Review, Save and Run
remain separate actions. Run captures the saved ID/revision, model, load settings
and ranges, preflights before stopping an active model, and rechecks dirty state
and revision in core. Exact UUID launch and complete stock debug startup checks
bind PCI identities, all 64 blocks, output, cache/state and allowed input fallback.
The UI shows verified active ranges. Quit joins estimator cleanup.
See [native validation](research/cluster-placement-native-validation.md) for dated
evidence and remaining application-host validation.

**Status:** Windows development runtime, durable Chat, model configuration and the initial loopback API implemented; distributed and production/release integration pending
**Updated:** 2026-10-14

## 1. Current workspace state

The workspace is `E:\ModelLoom-Project`. It contains specifications, guides, plans, agent instructions, six preserved UI-reference images, and the later Bionic Task Manager runtime-reference image. The reference images, ADRs, research notes, and local-only guides are not part of this desktop-foundation publication. The original `ModelLoom-Project Prd.md` has been moved to `specs/PRODUCT-SPEC.md`; that is the single authoritative product document.

The current checkout is `feat/local-api`, based on PR #6's merge at
`2ca5d791858b80d72a0737e286621ed827ba86df`. The Chat/startup/deletion/popup and
sample-free startup slice is merged. This branch records configuration, the shared
Chat/API queue and development packaging, including the authorized October 14
review fixes. The source/test commit checkpoint is `28d344d`; documentation and
build-tooling commits follow separately. No push or hosted CI is claimed for this
local slice.
Earlier publications
include [PR #2](https://github.com/haowern98/ModelLoom/pull/2) (desktop foundation),
[PR #3](https://github.com/haowern98/ModelLoom/pull/3) (Settings/Chat preview),
[PR #4](https://github.com/haowern98/ModelLoom/pull/4) (dependency fix), and
[PR #5](https://github.com/haowern98/ModelLoom/pull/5) (Windows runtime lifecycle).
Their dated hosted results do not verify this local slice.

The explicitly enabled Windows development build now imports the approved local
GGUF, loads/stops the verified owned CUDA engine and supports durable Chat through
the protected utility core. Ordinary/demo generation remains disabled. Settings
and the public API are connected under accepted ADR-0006 for the approved Windows
development profile. Workers, networking, production runtime/update trust,
installers and other-platform acceptance remain pending. See
[local Chat development](local-generation.md) and
[local API development](LOCAL-API-DEVELOPMENT.md) for current behavior, inputs,
saved schemas and validation limits.

The user's 2026-10-01 **PROCEED** authorized the shared desktop shell and Models milestone. It does not close the core/runtime/network/update audit gates or authorize GPU experiments. The user subsequently authorized publishing the foundation, tests, tooling, updated specifications, development guide, and CI workflow. The 2026-10-03 **PROCEED** initially authorized the Cluster screen with clearly labelled demo data and local validation; later separate publication approvals covered the merged PRs above. `AGENTS.md`, `docs/CODE-QUALITY.md`, and `plans/` remain ignored and uncommitted.

The later authorized Models revisions provide a compact library and a gear action opening a six-section configuration page. Saved defaults and pending edits are separate per model and retained only for the current app session, as selected by the user. Save validates the editor; Reset restores pending sample defaults and requires Save. GPU Offload opens Cluster, and speculative decoding remains Off. These controls perform no hardware optimization, template/argument execution or engine operation. Local verification and the later authorized hosted checks are recorded in [TESTING-SPEC.md](../specs/TESTING-SPEC.md); UI implementation approval and publication approval remain separate.

### Fixed UI and current documentation scope

The 2026-10-05 reconciliation was documentation-only and prohibited UI changes. The later 2026-10-06 Settings PROCEED separately authorizes the UI preview in UI-SPEC section 8. Preserve the [current UI baseline](../specs/UI-SPEC.md#current-ui-baseline-2026-10-05) when planning integrations; additional visual revisions need separate explicit authorization.

Current development Chat supports Send/Stop/Retry, startup history without a model,
per-chat saved drafts, separate thinking/answer, saved native rates and measured
thinking duration, and confirmed deletion. The user removed thumbs-up/down;
Copy/Retry remain. Responses render as inert plain text. Model defaults now use
protected core storage for the imported development model; demo defaults and
joining previews still use session state where labelled. Attachments,
network exposure, catalogue/download and deferred destinations remain unavailable.
Settings category navigation/search and its inventory
dialog work, while appearance/runtime operations remain unavailable. Preserve
the existing Models layout and tags. TESTING-SPEC and local-generation.md record
dated local checks separately from historical hosted runs; no latest-slice CI,
full M1 or release acceptance is implied.

The 2026-10-05 API PROCEED established the reviewed centred column with Server, Access, Integration and Server logs cards, matching Model configuration's shared fonts, spacing and outer scrollbar margins. API remains directly after Models in the sidebar. The later 2026-10-13 authorization and accepted ADR-0006 connect its existing controls to a key-required loopback listener, protected keys, actual status/metrics, safe service events and current endpoint/model examples. Network serving remains unavailable. Key Copy uses the sender-checked main operation; other text copy retains the existing sandbox-compatible helper. See [local API development](LOCAL-API-DEVELOPMENT.md) for exact scope and validation limits. D07 remains open overall.

The historical 2026-10-05 Chat PROCEED authorized the two-column layout and
session-only renderer interactions, with Send unavailable at that time. Later
ADR-0005 approvals supersede that unavailable-Send/no-storage boundary for the
explicit development build. They retain the supplied composition, Home-to-Chat
navigation and Cluster model selection; attachments remain disabled. Sections
10-12 of UI-SPEC record the approved thinking/speed/deletion/popup refinements.

The 2026-10-05 approved joining revision adds a fixed-label Add dropdown with Add device/Join cluster/Share this PC views in the existing Cluster panel, plus incoming example decisions in overview. The Add label and chevron share one hover surface; choosing a view never changes the label. Its request status and sharing preferences live in renderer memory only. The example controls deliver no request, authorize no identity, add no connected card and alter no model allocation. Real networking and contributor-role transitions remain outside this UI milestone.

## 2. Reading order

The later [ADR-0003](../specs/decisions/0003-lm-studio-behavior-reference.md) makes LM Studio the first reference for applicable non-networking behavior, including configurable concurrent requests/continuous batching. Verify exact policies through D09/R5; do not assume one model means one request. Preserve ModelLoom's five screens and LAN/Tailscale/Headscale/security/quality requirements. Approved catalogue, localhost authentication, local feedback, and window-X defaults are recorded there; no implementation or workload is authorized.

| Document                                                           | Purpose                                                                                                                                      |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [AGENTS.md](../AGENTS.md)                                          | Authorization, scope, commits, delegation, and inference rules.                                                                              |
| [PRODUCT-SPEC.md](../specs/PRODUCT-SPEC.md)                        | Product goals, P1-P9, agreed defaults, and J1-J15 acceptance journeys.                                                                       |
| [UI-SPEC.md](../specs/UI-SPEC.md)                                  | Five screens, panel layering, control behavior, accessibility, and visual comparison.                                                        |
| [TECHNICAL-SPEC.md](../specs/TECHNICAL-SPEC.md)                    | Proposed stack, accepted core/runtime direction, ownership boundaries, and T01-T24.                                                          |
| [INTEGRATION-SPEC.md](../specs/INTEGRATION-SPEC.md)                | Logical entities/contracts, lifecycle, API scope, and schema readiness.                                                                      |
| [SECURITY-SPEC.md](../specs/SECURITY-SPEC.md)                      | Trust boundaries, S01-S17, owned-runtime identity/cleanup, and security review gates.                                                        |
| [TESTING-SPEC.md](../specs/TESTING-SPEC.md)                        | Draft acceptance matrix, requirement-linked evidence, failure/security cases, and platform/correctness gates.                                |
| [Decision register](../specs/decisions/README.md)                  | Accepted baseline and D01-D12 decisions that remain open.                                                                                    |
| [ADR-0002](../specs/decisions/0002-lm-studio-runtime-direction.md) | Accepted LM Studio parity/audit direction, grouped llama-server, crash isolation, upgrades, and shutdown; supersedes the earlier naming ban. |
| [CODE-QUALITY.md](CODE-QUALITY.md)                                 | Proposed coding, testing, dependency, and review standards.                                                                                  |
| [PLAN.md](../plans/PLAN.md)                                        | Readiness tasks, milestone dependencies, and evidence requirements.                                                                          |
| [LM Studio runtime audit](../plans/LM-STUDIO-RUNTIME-AUDIT.md)     | First hosting investigation, platform/evidence matrix, observation scope, and completion gate.                                               |

Lecture sources supplied by the user are Lecture 6: Agent Safety & Security (`l6.pdf`, 36 pages) and Lecture 7: SDD and Specialized Agents (`l7 (1).pdf`, 43 pages). Their useful process guidance is summarized in the specs; embedded attack prompts and sample personas remain examples. The original PDFs stay in the user's Downloads folder and are not needed to resolve repository links.

## 3. What can be done now

Within explicit documentation authorization, review/edit the draft specs, clarify product choices, record evidence-based proposals/ADRs, and maintain the reference documents. Preserve approved requirements and show unresolved choices honestly.

Read-only technical research may establish feasibility when within the user's requested scope. Installing dependencies, creating executable prototypes, downloading models/runtimes, contacting remote devices, running workloads, or changing system/network settings requires appropriate authorization. Do not silently turn research into an implementation spike.

Before implementation, the user reviews the relevant specs/decisions and a concrete subsystem plan, and explicitly authorizes implementation within scope. Settle every open decision that affects the task. Unaffected authorized work does not need to wait for unrelated decisions.

## 4. Source and tooling after approval

The accepted functional shape is Electron GUI -> ModelLoom Core -> versioned llama.cpp runtime -> CUDA/Metal/CPU. The GUI and independent headless deployment use essentially the same core/runtime machinery. [ADR-0004](../specs/decisions/0004-runtime-lifecycle-proposal.md) accepts the initial Windows development exception and shared TypeScript/utility/headless hosting direction. D01 remains open overall; live package activation and other-platform/release evidence keep their gates. The raw llama-server name is accepted within the expanded ModelLoom Windows app group; grouping still needs packaged-build verification.

Runtime versions must be installable/selectable/updateable/rollback-capable independently of Electron through supported app/headless-core controls. Full desktop Quit terminates the owned runtime/core/helpers with verified cleanup, while explicitly independent headless deployments retain their own lifecycle. Ordinary runtime crash must keep the GUI usable; parent-child relationships or a DLL alone do not prove isolation or cleanup. The [current evidence matrix](research/LM-STUDIO-HOSTING-EVIDENCE-MATRIX.md) records subsequent desktop CLI, independent headless and startup-failure observations. Those reference tests do not pass ModelLoom journeys or complete the cross-platform audit.

The recommended source boundaries are in the technical spec; create directories as actual tasks require them. Electron/React/strict TypeScript and the desktop tooling were approved for this milestone. Core TypeScript and initial hosting are accepted under ADR-0004. Exact core/runtime package pins, bootstrap verification, optional Go integration, native build tooling and supported platform floors retain their affected decisions. Do not treat a custom C++ sidecar or GUI-loaded llama.cpp library as the default hosting implementation.

### Desktop foundation commands

Run these from `E:\ModelLoom-Project`. The current privileged/headless development host is Windows x64, Node 24.21.0 and pnpm 11.19.0. The original desktop-foundation checks used Node 24.7.0; native Node-API headers/import-library compatibility is described in the core README. Direct dependency versions are pinned and the workspace lockfile is present. The pnpm workspace uses `nodeLinker: hoisted` for Forge and explicitly permits Electron/esbuild build steps. No global tool settings were changed.

| Command                          | Purpose and verified scope                                                                                                                                                                                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | Restore the approved tuple; initial install and lockfile policy validation passed.                                                                                                                                                                                         |
| `pnpm dev`                       | Open the ordinary Electron desktop without sample models/devices. On Windows, rebuild hosts and enable the approved development core before opening the window; preparation failure stops startup. First launch may download the pinned Electron binary.                   |
| `pnpm dev:web`                   | Ordinary browser preview at `http://127.0.0.1:5173`, without sample data or a native bridge; do not run alongside another server using that port.                                                                                                                          |
| `pnpm typecheck`                 | Strict source/configuration/test type checking.                                                                                                                                                                                                                            |
| `pnpm lint`                      | Type-aware TypeScript linting and conventional Node configuration checks.                                                                                                                                                                                                  |
| `pnpm format:check`              | Verify owned code and configuration formatting. `pnpm format` applies it.                                                                                                                                                                                                  |
| `pnpm test`                      | Run ordinary desktop/core regression suites; current dated counts and limits are recorded in TESTING-SPEC.                                                                                                                                                                 |
| `pnpm test:e2e`                  | Run browser checks for composition, interactions, dialogs and containment; suite counts are dated in TESTING-SPEC rather than fixed to the original foundation. Install Chromium with `pnpm --filter @modelloom/desktop exec playwright install chromium` on a clean host. |
| `pnpm build`                     | Renderer production build with demo fixture initialization disabled.                                                                                                                                                                                                       |
| `pnpm package:demo`              | Explicit unsigned Windows demo package under `apps/desktop/out/ModelLoom-win32-x64/`; no installer or updater is produced.                                                                                                                                                 |
| `pnpm test:desktop`              | Launch the packaged demo, check renderer Node isolation/sandbox, exercise Models/configuration/Cluster/Chat/API navigation and supported demo controls, capture views, and confirm the owned app exits. Requires `pnpm package:demo` first.                                |

`pnpm package` is the ordinary non-demo package command with runtime authority
disabled. `pnpm package:development` builds the separately approved Windows
development artifact; its evidence and limits are in
[the local API guide](LOCAL-API-DEVELOPMENT.md). The October 10 PROCEED removes automatic samples from ordinary serving
and rebuilding. Demo state requires explicit `--mode demo` or scoped
`MODELLOOM_DEMO=1` test/preview packaging; unit tests opt in separately. Browser
checks serve explicit fixtures on port 5175 and ordinary startup on port 5176,
away from the user's development app. A disabled/missing core shows actual
available hardware or an empty/unavailable state, never a sample replacement.

The Windows Forge `preStart` hook rebuilds the host output, then runs the existing
`packages/core/scripts/build-development.mjs`, which verifies the pinned public
root and restores development-only output. This runs for ordinary development
starts, not packaging or explicitly requested demo starts. Both steps must
succeed before Electron opens. Ordinary host builds still reset the development
flag; production trust, package verification and resource admission are unchanged.
The later explicit runtime/Chat development preload uses closed sender-checked
commands while keeping sandbox/isolation, navigation and permission restrictions.
Window X performs full Quit, joining history/request preparation and stopping
the app's owned core/runtime helpers; no independent deployment is terminated.
Current-slice packaged acceptance and wider crash/platform journeys remain open.

Browser and packaged Windows checks have dated local/hosted evidence. PR #6's
checks apply to the merged Chat slice, not the local API/package commits.
The original `llama-server.exe` may appear outside the app group under the user's
October 14 decision. Linux/macOS native acceptance, ordinary native faults,
worker security, performance and unchanged inference quality remain unverified.
Hosted Ubuntu browser checks do not establish Linux native desktop support.
Icons/model marks are reconstructed assets; font/asset/pixel identity still needs
visual review.

Development fixtures must be small and non-sensitive. Actual models, chats, caches, credentials, signing keys, diagnostic dumps, and generated build packages are outside tracked source. `.gitignore` now excludes dependencies/builds/test artifacts as well as the user-requested local instructions, code-quality guide, and plans.

### GitHub Actions checks

[ModelLoom checks](../.github/workflows/checks.yml) defines four jobs for pull requests, pushes to `main`, and manual runs. The desktop foundation and its lockfile accompany the workflow. Inspect the matching commit's [GitHub Actions results](https://github.com/haowern98/ModelLoom/actions) before treating it as verified on hosted runners.

| GitHub check    | Commands and scope                                                                                                                                                                                                                                                                                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quality         | Frozen-lockfile install, formatting, actionlint workflow validation, strict type checking, linting, unit/component tests, and the production renderer build on Ubuntu 24.04. Formatting includes the workflows; actionlint 1.7.12 is downloaded with a pinned SHA-256 check.                                                                                                              |
| Browser         | Frozen-lockfile install, Chromium with system dependencies, and the existing browser suite on Ubuntu 24.04. Failed runs retain screenshots, error context, and traces for seven days.                                                                                                                                                                                                     |
| Windows desktop | Frozen-lockfile install, unsigned demo packaging, and the real packaged smoke test on Windows 2025. Failed runs retain available screenshots, error context, and traces for seven days.                                                                                                                                                                                                   |
| Security        | Gitleaks 8.30.1 scans all fetched Git history with redacted output. Its downloaded executable is checked against a pinned SHA-256 digest. The dependency audit fails on high/critical findings or registry errors; its JSON report is retained for seven days. Low/moderate findings remain review items, not a clean-security claim. Run `pnpm audit` locally to inspect all severities. |

The activation slice updates all four jobs to Node 24.21.0 and retains the pnpm version in `package.json`; this CI edit has only local evidence until published and run. Third-party actions are pinned to full commit hashes; repository permissions are read-only and checkout credentials are not persisted. Jobs have bounded timeouts and obsolete runs for the same ref are cancelled. No production signing keys, deployment credentials, publication step, or model/GPU workload is included. The Gitleaks CLI does not require a paid organization-action license.

These jobs establish automated desktop-foundation evidence only. They do not establish visual identity, full platform support, runtime/network security, signed updates, or inference correctness. Required-check enforcement is a separate GitHub branch-rule setting and has not been enabled. A successful local command or workflow lint is not a successful GitHub-hosted run. [GitHub secure-use guidance](https://docs.github.com/en/actions/reference/security/secure-use), [Gitleaks CLI documentation](https://github.com/gitleaks/gitleaks), [pnpm audit](https://pnpm.io/cli/audit).

Latest verified hosted evidence, 2026-10-06: [PR #4 run 37407189996](https://github.com/haowern98/ModelLoom/actions/runs/37407189996) passed all four jobs at `b512d940b46bda018aed52b25e794dfa917bc7b6`. After merging, [main run 37407421755](https://github.com/haowern98/ModelLoom/actions/runs/37407421755) passed all four at `f68300ab9c4f45b09f26fee3b01fcdaf08145391`. This follows the earlier post-PR-#3 dependency-audit failure, recorded with its fix and local line-ending caveat in TESTING-SPEC. These results describe the published revisions, not a new run of this documentation-only update.

## 5. Normal contribution cycle after authorization

1. Read the applicable requirements and accepted decisions; confirm task scope and acceptance evidence.
2. Use the approved subsystem plan. Write meaningful behavior tests first where appropriate, implement only the task, and run its relevant checks.
3. Compare visual changes to the exact preserved reference and inspect error/accessibility behavior.
4. Update affected specs/contracts/guide with approved behavior and verified commands.
5. Review the diff and evidence; obtain appropriate independent/security review.
6. Stage explicit files by purpose and make focused commits with a maximum of two files each. Preserve user changes and avoid unrelated cleanup.

For subagents, honor the Luna/max preference only where the available tool supports it. Disclose unavailable model selection; do not silently substitute a different editor. Keep security design with the reviewed main process.

## 6. Reporting evidence and limitations

### Windows development fixture hosts

The separately authorized Windows ownership slice lives in `packages/core/`; it does not connect the current desktop renderer or load real models. From the repository root, `pnpm --filter @modelloom/core test:native` builds the harmless fixture and ownership binding, emits the headless/utility hosts and runs 17 native integration cases. `pnpm --filter @modelloom/core check:native` checks owned C++ formatting and static analysis. Both commands passed locally on Windows 11 build 26200 with the pinned existing MSVC/Node development tuple described in [core README](../packages/core/README.md). Ordinary root tests remain separate so Linux CI does not silently claim Windows ownership evidence. Generated artifacts stay in ignored `packages/core/out/`.

At publication, this ownership slice had 112 ordinary core cases, 17 native cases and 39 desktop cases. Its historical results are in [TESTING-SPEC](../specs/TESTING-SPEC.md#windows-ownership-and-fixture-hosts-2026-10-06).

### Gated activation slice

The later PROCEED adds the implementation described in [runtime activation](runtime-activation.md) on `feat/runtime-lifecycle`. Current checks pass 180 ordinary core, 30 Windows native and 39 desktop cases, with typecheck, lint, owned formatting and native static checks passing. All 77 tracked desktop files remain byte-identical; full local formatting still reports the same seven untouched desktop files. The user subsequently authorized focused commits and a branch push; no hosted result is claimed for this slice. Production public-root/signed-package/resource-planner inputs and actual model acceptance remain pending; the coded resource path is CPU only, with CUDA discovery deferred. Preview controls remain unavailable.

Record revision, platform, runtime/model identity, configuration, scenario, command/test exit status, relevant redacted logs, result, and limitations. Mark not-run checks plainly. Mocked worker tests, CPU-only/native builds, and CI cannot stand in for mixed-GPU, real network, GUI, or headless acceptance.

Never claim a network option is a performance guarantee, a UI mock is a working service, or a faster inference result preserves quality without the approved comparison evidence. Product milestones and separately authorized inference research have different acceptance gates.

# Local API development

The existing configuration and API pages are connected for the initial Windows development profile. See [model configuration and the local API](LOCAL-API-DEVELOPMENT.md) for protected keys, supported routes, settings/reload behaviour, limits, pinned client checks and validation boundaries.

Staging tests require development host output. Build hosts, run
`node packages/core/scripts/build-development.mjs`, then run
`node --test scripts/stage-development.test.mjs` from `apps/desktop`. Afterwards,
run `pnpm --filter @modelloom/core build:hosts` to restore ordinary disabled
output, even if a test fails. An ordinary host build correctly rejects the two
staging mutation cases before their intended assertions with
`DEVELOPMENT_BUILD_REQUIRED`; that is a setup failure, not tamper-test evidence.
These tests verify existing signed inputs and do not renew or sign metadata.
