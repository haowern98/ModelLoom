# ADR-0003: LM Studio behavior reference

**Date:** 2026-10-01  
**Status:** Accepted reference direction; exact policies and implementation pending evidence/review  
**Scope:** P4-P9, T02, D01/D04/D07/D09/D11; documentation only

## Context and decision

The user directs ModelLoom to follow LM Studio where technically possible, explicitly including request scheduling and excluding ModelLoom's networking integration. This extends ADR-0002 beyond native runtime hosting. It supersedes the conversational proposal to generate only one response at a time as the initial scheduling baseline; that proposal was not an accepted implementation decision.

Use current, versioned LM Studio evidence as the first reference for applicable model loading/unloading, Chat/API request handling, generation controls, cancellation, runtime management, lifecycle, and compatibility behavior. Study observable update verification and failure behavior where available, but do not claim access to proprietary internals or signing credentials. Exact ModelLoom security and signing design still requires D11 review.

Networking continues under ModelLoom's LAN/Tailscale/existing-Headscale, worker pairing/revocation, protected transport, distributed placement, and headless requirements. LM Studio's connectivity products are not adopted by this decision.

Preserve the supplied five ModelLoom screens, one active model shared by Chat/API, independent runtime updates/rollback, owned-process shutdown, approved API authentication, and unchanged inference quality without draft models. The reference direction does not add multiple active models, MCP/tools, split-view UI, MLX, cloud accounts, or other LM Studio features. Record and justify deviations required by these constraints rather than silently replacing them.

## Request scheduling evidence and target

[Official parallel-request documentation](https://lmstudio.ai/docs/app/advanced/parallel-requests), checked 2026-10-01, documents llama.cpp continuous batching and configurable Max Concurrent Predictions, with a reference default of four. [LM Studio 0.4](https://lmstudio.ai/blog/0.4.0) also documents parallel requests to the same model. These establish the concurrency direction; they do not establish exact pending-queue size, fairness, wait deadlines, excess-request behavior, cancellation races, or cross-client isolation.

Target the same configurable concurrency behavior, using four as the documented reference default to evaluate. One active model does not mean one active request. Retain bounded pending admission and visible queued/busy/cancelled states; determine where the core and engine actually queue work before adding a second scheduler. Validate memory/context allocation, distributed backend support, cancellation isolation, per-request state, and inference correctness. Any required lower limit or unsupported configuration must be explained and recorded, without silently lowering context or quality. LM Studio's runtime version labels are not upstream llama.cpp source revisions.

D09 remains open for the concrete evidence-backed scheduling contract. Do not infer FIFO ordering, per-client priority, overload status codes, or timeouts from the continuous-batching documentation.

## Previously approved product defaults

The user's preceding approval accepts Hugging Face as the initial GGUF catalogue, API keys on localhost by default (and required beyond localhost), locally stored response thumbs-up/down, and window X performing full Quit with owned-process cleanup. D05/D06/D08 retain technical work needed to deliver these choices.

Attachment formats/capabilities, Home/Storage/Metrics destinations, and original visual assets remain unresolved: their earlier table entries requested specifics and contained no concrete functional default to accept. Do not invent those specifics from a blanket approval.

## Validation and consequences

Extend the audit and readiness plan to compare observed LM Studio behavior and relevant documented contracts by app/core/runtime version and platform. Label evidence as official, reported, observed, inferred, or unresolved. Record each parity gap and the minimum ModelLoom extension needed. Actual installation observation, workloads, crash probes, and implementation have not been executed or authorized by this decision.

This decision establishes the reference, not a guarantee that every proprietary detail can be reproduced or that every LM Studio default suits a distributed cluster. Product, security, resource, and correctness acceptance still apply.
