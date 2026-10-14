# ADR-0002: LM Studio runtime direction and lifecycle ownership

**Date:** 2026-09-30  
**Status:** Accepted requirements and audit direction; exact hosting design is pending D01; implementation is not authorized  
**Supersedes:** The process-name prohibition and unconstrained hosting-choice framing in [ADR-0001](0001-product-and-ui-baseline.md). Other product/UI requirements remain in force.  
**References:** P5/P6, J13-J15, [technical](../TECHNICAL-SPEC.md), [integration](../INTEGRATION-SPEC.md), and [audit plan](../../plans/LM-STUDIO-RUNTIME-AUDIT.md).

**Partial supersession, 2026-10-06:** [ADR-0004](0004-runtime-lifecycle-proposal.md) replaces the full-audit-before-hosting-selection prerequisite below for the initial Windows development slice. The original gate is retained here as decision history. Lifecycle/isolation/ownership, independently verified updates, headless reuse and platform/release obligations remain in force; D01 is not closed. Product coding still needs its reviewed plan and scoped authorization.

## Context and evidence

The user wants ModelLoom to replicate LM Studio's current llama.cpp hosting architecture as closely as technically possible: GUI -> Core -> versioned runtime -> CUDA/Metal/CPU. They also require easy llama.cpp updates, GUI survival after ordinary engine crashes, reuse of essentially the same core/runtime machinery headlessly, and cleanup when the desktop app fully quits.

The user supplied a Task Manager screenshot after chatting with Bionic. It shows `llama-server` inside the expanded Bionic app group. They then confirmed that the llama-server name is acceptable. The [preserved screenshot](../references/runtime/README.md) establishes this presentation for that observed session; it does not establish parent PIDs, local protocols, runtime directories, versions, crash survival, or other OS behavior.

Official sources establish GUI-independent llmster/core operation and separately managed inference runtimes: [LM Studio 0.4](https://lmstudio.ai/blog/0.4.0), [runtime management](https://lmstudio.ai/docs/cli/runtime/runtime). Public issues [#502](https://github.com/lmstudio-ai/lms/issues/502) and [#373](https://github.com/lmstudio-ai/mlx-engine/issues/373) contain user-reported helper/process/engine-port observations. They are not a complete official architecture specification; #502 reports helper memory growth, not proof of GUI survival after a native crash. D01 must establish the remaining details through versioned source evidence and authorized observation of actual installations.

## Accepted requirements

1. LM Studio's current llama.cpp hosting path is the reference architecture. Complete and review the replication audit before selecting ModelLoom-specific boundaries/protocols/hosting. Any necessary parity deviation must be documented against technical evidence and the product/security constraints.
2. Separate GUI, core, and runtime responsibilities. Do not load crash-prone native inference into the GUI/main process merely to remove a process entry. The precise process-versus-library/worker arrangement remains part of D01.
3. Updated by the user's 2026-10-14 decision: keep the original `llama-server.exe` filename. Its own Task Manager row outside ModelLoom and separate PIDs are acceptable. Remove renamed launch copies; app grouping is no longer an acceptance requirement. Preserve verified assets, crash isolation, owned shutdown and absence of a visible console. Other helper/RPC presentation is not settled by this name acceptance.
4. Ordinary runtime termination/native crashes must be contained so the GUI and unaffected core machinery remain usable, affected requests are interrupted/failed honestly, and bounded recovery is possible. Do not claim this protects against every OS/driver/resource failure.
5. Independently install/select/update verified platform/backend runtimes and roll back between sessions without an Electron rebuild/reinstall or end-user compilation. Check coordinator/worker compatibility and preserve model/chat/placement state. 'Easy update' means a supported app/headless-core operation, not manual binary replacement.
6. Desktop and independent headless operation reuse essentially the same core/runtime management machinery. Do not create a divergent headless engine manager merely because there is no GUI.
7. Full desktop Quit stops new work, cancels/resolves active/queued work, requests owned-engine/core/helper shutdown, escalates after a bounded deadline if required, and confirms exit. Abnormal desktop exits need a reviewed cleanup strategy to prevent owned orphan engines. Track ownership using trusted process/session handles or an equivalent reviewed mechanism; never kill by executable name or terminate unrelated deployments.
8. An explicitly independent headless deployment has its own lifecycle. Quit does not terminate unrelated local headless processes or remote worker services. Define assignment teardown separately. Closing/minimizing a window is not assumed to mean full Quit; review that UI behavior.
9. No visible terminal window appears in normal desktop use. The screenshot's Console Window Host entry does not establish a visible console, nor does it waive this requirement.

## Consequences and open details

D01 now investigates LM Studio parity rather than choosing freely between a GUI-loaded library and a renamed native sidecar. A separate runtime process is the strongest candidate supported by the user observation and public reports; exact packaging, supervision, communication, and cross-platform process grouping must still be established by the audit.

Internal engine endpoints/processes are not independent public API services. Endpoint exposure, authentication, signed updates, worker restrictions, quality preservation, and the five ModelLoom UI references remain governed by their existing specs. Architectural parity does not require copying every LM Studio feature or overriding security boundaries.

The runtime audit must record whether LM Studio provides rollback/cleanup/crash behavior directly or whether these are ModelLoom requirements needing an evidence-based extension. Numeric shutdown deadlines, retry budgets, restart policy, package layout, local protocol, exact core packaging, and helper/RPC names remain unresolved until reviewed.

## Acceptance and authorization

Add original process-name and ownership checks to J1, update/rollback to J6/J15, ordinary native-crash isolation to J13, and owned shutdown/abnormal exit to J14. Exercise supported Windows/Linux/macOS and independent headless ownership separately. Screenshots, successful builds, and parent/child relationships alone do not establish these behaviors.

The user authorized updating specifications and Markdown guides. No audit execution, installation, native spike, application coding, dependency installation, build, or workload is authorized by this ADR. Do not mark D01 complete from this documentation update.
