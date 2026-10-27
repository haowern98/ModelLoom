# RPC input residency integration plan

> **For agentic workers:** Use superpowers:executing-plans locally. The user authorized this integration with PROCEED in the current chat. The agent API cannot select Luna/max, so no model substitution or delegation.

**Goal:** Integrate the measured external input-residency mechanism into the authenticated ModelLoom peer path using strict TypeScript, with no UI or runtime-binary changes.

**Architecture:** Negotiate `input-residency/1` as an optional HTTP-upgrade capability after existing peer authorization. A client-side Duplex transforms complete repeated SET requests into bounded dictionary references; a worker-side Duplex reconstructs the identical original bytes before the existing restricted native helper. Native responses stay opaque. Legacy peers use the existing raw stream. Output prefetch remains disabled and experimental in the isolated research prototype.

**Tech stack:** Existing Node.js streams, Buffer, SHA-256, TypeScript and Vitest. No dependencies, new listeners, SSH transport, native compilation, credentials or signing changes.

**Spec:** Current user-approved integration scope and AGENTS.md; existing pairing, exact runtime identities, GPU reservations, ownership and shutdown contracts remain authoritative.

## Decisions and bounds

- Preserve the current branch and all pre-existing changes; do not commit, push, publish or change renderer/preload code.
- Do not interpret native tensor metadata. Full original SET records are compared byte for byte and restored on every use, so the extra cache-flag byte and hash-layout changes in protocol 7/8 are preserved without changing engine binaries.
- Recognize successful native HELLO majors 6/7/8 only for optimization. Unknown majors retain literal byte transport. Native responses and numerical behavior are unchanged.
- Cache at most 64 MiB and 4,096 records per connection, with 512-byte to 4 MiB native payloads eligible. Literal framing is at most 64 KiB; arbitrary native uint64 request lengths stream in bounded chunks without allocating their advertised size. Dictionaries reset on close/reconnect.
- No acknowledgements are fabricated; no native computation is skipped; no uncertain execution is retried. Partial framed EOF and missing references close the stream. Writes and reads must honor backpressure, cancellation and errors.
- The HTTP capability selects a codec only; it cannot grant peer approval, GPU access, paths or launch authority. Only verified worker backends advertise it. Preserve old clients and old workers before any framed bytes are sent.
- Preserve actual wire-byte accounting through the wrapper and existing loss/heartbeat/cleanup behavior. Independent native-worker cleanup remains owned by the existing backend.
- Do not broaden current runtime compatibility or imply mixed-release support. Do not change the accepted runtime package, existing disk-cache controls, models, sampling or UI.

## Task 1: Strict TypeScript codec and stream

Files: `packages/core/src/peers/rpc-residency-protocol.ts`, `rpc-residency.ts` and their tests.

- [x] Write failing tests for fragmentation, literal streaming, exact references, shape/offset/overlap changes, eviction, malformed/missing references and EOF.
- [x] Implement the bounded protocol and per-connection owned-byte dictionary.
- [x] Implement client/worker Duplex adapters; test protocol 6/7/8, unknown-version literal fallback, real backpressure, transport loss and dictionary cleanup.
- [x] Run focused Vitest and strict TypeScript checks; inspect failures and retain evidence.

## Task 2: Existing peer path

Files: `rpc.ts`, `node.ts`, `verified-rpc.ts`, and focused integration tests.

- [x] Test opt-in negotiation, actual transformed traffic, old-peer fallback and malformed negotiated replies before wiring.
- [x] Add optional backend support and exact upgrade acknowledgement after existing authorization and worker readiness.
- [x] Wrap the existing approved streams; preserve admission checks, revocation, reservations, heartbeat, tuple ownership, and confirmed close semantics.
- [x] Test negotiated shutdown/failure and multi-GPU isolation, then run relevant existing peer suites.

## Task 3: Verification and documentation

- [x] Run scoped format/lint, core and desktop typechecks, core host build and justified peer regressions. Do not run app builds or native compilation merely to repeat existing evidence.
- [x] Review every changed call site and the transport boundary locally, since requested-model independent review is unavailable.
- [x] Update development documentation with actual scope, commands and evidence. Distinguish protocol tests, native-boundary tests and live app acceptance; do not inherit the prototype's speed claim as an app measurement.
- [x] Report branch, changed scope, verified checks and any live activation limits. No UI changes, commits, publication or private-key operation.

## Review focus

- Partial headers, large model weights and slow readers must not cause unbounded buffering or waiting for bytes the sender cannot yet write.
- Native versions and record contents never authorize a bridge that the peer did not negotiate.
- A dictionary hit always restores the original write even after graph mutation or buffer reuse.
- A dropped worker/transport must close the wrapper and reach the existing runtime-loss and owned-cleanup paths.
- Cached bytes and timers must be released on ordinary close, error, cancellation and reconnect.
