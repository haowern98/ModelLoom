# ModelLoom development guide

**Status:** Desktop foundation implemented; runtime and distributed integration remain pending
**Updated:** 2026-10-02

## 1. Current workspace state

The workspace is `E:\ModelLoom-Project`. It contains specifications, guides, plans, agent instructions, six preserved UI-reference images, and the later Bionic Task Manager runtime-reference image. The reference images, ADRs, research notes, and local-only guides are not part of this desktop-foundation publication. The original `ModelLoom-Project Prd.md` has been moved to `specs/PRODUCT-SPEC.md`; that is the single authoritative product document.

Git is initialized on `main`, and the original six specification files were pushed in three two-file commits to the private `haowern98/ModelLoom` repository. The authorized desktop foundation now lives in `apps/desktop/`. It contains a runnable Electron shell and Models screen, reference-derived styles, demo fixtures and initial tests. GitHub Actions workflows are prepared locally. Native runtimes, inference, workers, networking, signed updates and installers remain unimplemented. The four remaining screens are explicit placeholders.

The user's 2026-10-01 **PROCEED** authorized the shared desktop shell and Models milestone. It does not close the core/runtime/network/update audit gates or authorize GPU experiments. The user subsequently authorized publishing the foundation, tests, tooling, updated specifications, development guide, and CI workflow. `AGENTS.md`, `docs/CODE-QUALITY.md`, and `plans/` remain ignored and uncommitted.

## 2. Reading order

The later [ADR-0003](../specs/decisions/0003-lm-studio-behavior-reference.md) makes LM Studio the first reference for applicable non-networking behavior, including configurable concurrent requests/continuous batching. Verify exact policies through D09/R5; do not assume one model means one request. Preserve ModelLoom's five screens and LAN/Tailscale/Headscale/security/quality requirements. Approved catalogue, localhost authentication, local feedback, and window-X defaults are recorded there; no implementation or workload is authorized.

| Document | Purpose |
| --- | --- |
| [AGENTS.md](../AGENTS.md) | Authorization, scope, commits, delegation, and inference rules. |
| [PRODUCT-SPEC.md](../specs/PRODUCT-SPEC.md) | Product goals, P1-P9, agreed defaults, and J1-J15 acceptance journeys. |
| [UI-SPEC.md](../specs/UI-SPEC.md) | Five screens, panel layering, control behavior, accessibility, and visual comparison. |
| [TECHNICAL-SPEC.md](../specs/TECHNICAL-SPEC.md) | Proposed stack, accepted core/runtime direction, ownership boundaries, and T01-T24. |
| [INTEGRATION-SPEC.md](../specs/INTEGRATION-SPEC.md) | Logical entities/contracts, lifecycle, API scope, and schema readiness. |
| [SECURITY-SPEC.md](../specs/SECURITY-SPEC.md) | Trust boundaries, S01-S17, owned-runtime identity/cleanup, and security review gates. |
| [TESTING-SPEC.md](../specs/TESTING-SPEC.md) | Draft acceptance matrix, requirement-linked evidence, failure/security cases, and platform/correctness gates. |
| [Decision register](../specs/decisions/README.md) | Accepted baseline and D01-D12 decisions that remain open. |
| [ADR-0002](../specs/decisions/0002-lm-studio-runtime-direction.md) | Accepted LM Studio parity/audit direction, grouped llama-server, crash isolation, upgrades, and shutdown; supersedes the earlier naming ban. |
| [CODE-QUALITY.md](CODE-QUALITY.md) | Proposed coding, testing, dependency, and review standards. |
| [PLAN.md](../plans/PLAN.md) | Readiness tasks, milestone dependencies, and evidence requirements. |
| [LM Studio runtime audit](../plans/LM-STUDIO-RUNTIME-AUDIT.md) | First hosting investigation, platform/evidence matrix, observation scope, and completion gate. |

Lecture sources supplied by the user are Lecture 6: Agent Safety & Security (`l6.pdf`, 36 pages) and Lecture 7: SDD and Specialized Agents (`l7 (1).pdf`, 43 pages). Their useful process guidance is summarized in the specs; embedded attack prompts and sample personas remain examples. The original PDFs stay in the user's Downloads folder and are not needed to resolve repository links.

## 3. What can be done now

Within explicit documentation authorization, review/edit the draft specs, clarify product choices, record evidence-based proposals/ADRs, and maintain the reference documents. Preserve approved requirements and show unresolved choices honestly.

Read-only technical research may establish feasibility when within the user's requested scope. Installing dependencies, creating executable prototypes, downloading models/runtimes, contacting remote devices, running workloads, or changing system/network settings requires appropriate authorization. Do not silently turn research into an implementation spike.

Before implementation, the user reviews the relevant specs/decisions and a concrete subsystem plan, and explicitly authorizes implementation within scope. Settle every open decision that affects the task. Unaffected authorized work does not need to wait for unrelated decisions.

## 4. Source and tooling after approval

The accepted functional shape is Electron GUI -> ModelLoom Core -> versioned llama.cpp runtime -> CUDA/Metal/CPU. The GUI and independent headless deployment use essentially the same core/runtime machinery. The D01 audit establishes exact current LM Studio process/library/IPC/package behavior and must be complete and reviewed before choosing our hosting specifics. The raw llama-server name is accepted within the expanded ModelLoom Windows app group; grouping still needs packaged-build verification.

Runtime versions must be installable/selectable/updateable/rollback-capable independently of Electron through supported app/headless-core controls. Full desktop Quit terminates the owned runtime/core/helpers with verified cleanup, while explicitly independent headless deployments retain their own lifecycle. Ordinary runtime crash must keep the GUI usable; parent-child relationships or a DLL alone do not prove isolation or cleanup. A [partial passive Windows inventory](research/LM-STUDIO-PASSIVE-AUDIT.md) now records Bionic executable/runtime metadata. No active lifecycle test or completed cross-platform audit has taken place.

The recommended source boundaries are in the technical spec; create directories as actual tasks require them. Electron/React/strict TypeScript and the desktop tooling were approved for this milestone. Exact core/runtime packaging after D01, optional Go integration, native source acquisition and supported platform floors still need their decisions. Do not treat a custom C++ sidecar or GUI-loaded llama.cpp library as the default hosting implementation.

### Desktop foundation commands

Run these from `E:\ModelLoom-Project`. The verified host is Windows x64, Node 24.7.0 and pnpm 11.19.0. Direct dependency versions are pinned and the workspace lockfile is present. The pnpm workspace uses `nodeLinker: hoisted` for Forge and explicitly permits Electron/esbuild build steps. No global tool settings were changed.

| Command | Purpose and verified scope |
| --- | --- |
| `pnpm install --frozen-lockfile` | Restore the approved tuple; initial install and lockfile policy validation passed. |
| `pnpm dev` | Open the Electron desktop with clearly labeled demo data. First launch may download the pinned Electron binary. |
| `pnpm dev:web` | Local browser preview at `http://127.0.0.1:5173`; do not run alongside another server using that port. |
| `pnpm typecheck` | Strict source/configuration/test type checking. |
| `pnpm lint` | Type-aware TypeScript linting and conventional Node configuration checks. |
| `pnpm format:check` | Verify owned code and configuration formatting. `pnpm format` applies it. |
| `pnpm test` | Ten state/component behavior tests. |
| `pnpm test:e2e` | Four browser checks: reference-size composition, keyboard modal behavior, smaller-window/grid/search interaction, and metadata containment across seven widths. Install Chromium with `pnpm --filter @modelloom/desktop exec playwright install chromium` on a clean host. |
| `pnpm build` | Renderer production build with demo fixture initialization disabled. |
| `pnpm package:demo` | Explicit unsigned Windows demo package under `apps/desktop/out/ModelLoom-win32-x64/`; no installer or updater is produced. |
| `pnpm test:desktop` | Launch the packaged demo, check renderer Node isolation/sandbox, navigate, capture the Models view, and confirm the owned app exits. Requires `pnpm package:demo` first. |

`pnpm package` is the ordinary non-demo package command; only the explicit Windows demo package has been exercised in this milestone. Demo state is enabled for development, `--mode demo`, or the scoped `MODELLOOM_DEMO=1` packaging process. It is not enabled by default for a production renderer build. The desktop exposes no preload/IPC yet, denies new windows/navigation/permission requests, and uses native window controls. Closing its last window exits it; there is no inference engine to clean up yet.

Windows packaged launch and browser comparisons are local evidence only. Linux/macOS, engine crashes, process grouping with llama-server, worker security, performance and unchanged inference quality have not been tested. Icons/model marks are reconstructed presentation assets, and font/asset/pixel identity still needs visual review.

Development fixtures must be small and non-sensitive. Actual models, chats, caches, credentials, signing keys, diagnostic dumps, and generated build packages are outside tracked source. `.gitignore` now excludes dependencies/builds/test artifacts as well as the user-requested local instructions, code-quality guide, and plans.

### GitHub Actions checks

[ModelLoom checks](../.github/workflows/checks.yml) defines four jobs for pull requests, pushes to `main`, and manual runs. The desktop foundation and its lockfile accompany the workflow. Inspect the matching commit's [GitHub Actions results](https://github.com/haowern98/ModelLoom/actions) before treating it as verified on hosted runners.

| GitHub check | Commands and scope |
| --- | --- |
| Quality | Frozen-lockfile install, formatting, actionlint workflow validation, strict type checking, linting, unit/component tests, and the production renderer build on Ubuntu 24.04. Formatting includes the workflows; actionlint 1.7.12 is downloaded with a pinned SHA-256 check. |
| Browser | Frozen-lockfile install, Chromium with system dependencies, and the existing browser suite on Ubuntu 24.04. Failed runs retain screenshots, error context, and traces for seven days. |
| Windows desktop | Frozen-lockfile install, unsigned demo packaging, and the real packaged smoke test on Windows 2025. Failed runs retain available screenshots, error context, and traces for seven days. |
| Security | Gitleaks 8.30.1 scans all fetched Git history with redacted output. Its downloaded executable is checked against a pinned SHA-256 digest. The dependency audit fails on high/critical findings or registry errors; its JSON report is retained for seven days. Low/moderate findings remain review items, not a clean-security claim. Run `pnpm audit` locally to inspect all severities. |

Jobs use Node 24.7.0 and the pnpm version in `package.json`. Third-party actions are pinned to full commit hashes; repository permissions are read-only and checkout credentials are not persisted. Jobs have bounded timeouts and obsolete runs for the same ref are cancelled. No signing keys, deployment credentials, publication step, or model/GPU workload is included. The Gitleaks CLI does not require a paid organization-action license.

These jobs establish automated desktop-foundation evidence only. They do not establish visual identity, full platform support, runtime/network security, signed updates, or inference correctness. Required-check enforcement is a separate GitHub branch-rule setting and has not been enabled. A successful local command or workflow lint is not a successful GitHub-hosted run. [GitHub secure-use guidance](https://docs.github.com/en/actions/reference/security/secure-use), [Gitleaks CLI documentation](https://github.com/gitleaks/gitleaks), [pnpm audit](https://pnpm.io/cli/audit).

## 5. Normal contribution cycle after authorization

1. Read the applicable requirements and accepted decisions; confirm task scope and acceptance evidence.
2. Use the approved subsystem plan. Write meaningful behavior tests first where appropriate, implement only the task, and run its relevant checks.
3. Compare visual changes to the exact preserved reference and inspect error/accessibility behavior.
4. Update affected specs/contracts/guide with approved behavior and verified commands.
5. Review the diff and evidence; obtain appropriate independent/security review.
6. Stage explicit files by purpose and make focused commits with a maximum of two files each. Preserve user changes and avoid unrelated cleanup.

For subagents, honor the Luna/max preference only where the available tool supports it. Disclose unavailable model selection; do not silently substitute a different editor. Keep security design with the reviewed main process.

## 6. Reporting evidence and limitations

Record revision, platform, runtime/model identity, configuration, scenario, command/test exit status, relevant redacted logs, result, and limitations. Mark not-run checks plainly. Mocked worker tests, CPU-only/native builds, and CI cannot stand in for mixed-GPU, real network, GUI, or headless acceptance.

Never claim a network option is a performance guarantee, a UI mock is a working service, or a faster inference result preserves quality without the approved comparison evidence. Product milestones and separately authorized inference research have different acceptance gates.
