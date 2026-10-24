# Share multiple physical GPUs

Goal: allow HAOWERNSLAPPY to share both selected GPUs with one approved coordinator.

Architecture: admit one existing verified helper per physical GPU before publishing sharing. Each authenticated RPC connection selects one allowed UUID and receives that GPU's existing single-device worker. Keep package verification, local elevation, exact ownership, TLS identity, and saved sharing scope intact.

Scope: approved by the user's PROCEED on 2026-10-23. No native protocol or binary replacement, dependency, benchmark, automatic canvas membership, or model-quality change. Existing two-execution-GPU placement limit remains separate.

Tech stack: TypeScript core, existing Windows helper, Vitest unit and Windows TLS integration tests.

- [x] `peers/verified-rpc-session.test.ts`: failing tests for per-GPU admission, selection, partial preparation, cleanup and retained seals.
- [x] `peers/verified-rpc.ts`: helper pool with atomic admission and retryable fail-closed cleanup.
- [x] `peers/reservations.test.ts`: failing tests for same-peer disjoint handles and independent leases; preserve competing-peer exclusion.
- [x] `peers/reservations.ts`: retain all remote handles until their own confirmed release.
- [x] `peers/multi-gpu-integration.test.ts`: real TLS tests for two simultaneous selected GPUs, rejected selectors, disconnect, revocation and pending startup cleanup.
- [x] `peers/node.ts` and `peers/rpc.ts`: authenticate explicit GPU selector, scope heartbeats per GPU, track workers independently and close every affected worker.
- [x] `peers/owner.ts` and its integration tests: forward exact requested approved GPU instead of requiring a single-GPU inventory.
- [x] Sharing errors identify local worker preparation failures without displaying remote network advice.
- [x] Run focused units, Windows TLS integration, typechecks, lint, formatting and host build; inspect independent review.
- [x] Record validation limits and implementation behavior in project documentation. No commit, push or PTSS deployment is requested by this task.

## Verification on 2026-10-23

Working branch: `feat/multi-desktop`, base HEAD `b470fa8`, with the user's existing uncommitted changes preserved. The 157 previously staged files were not changed by staging commands.

- Core unit command: `pnpm --filter @modelloom/core exec vitest run` with reservations, verified-rpc, verified-rpc-session, rpc-session, rpc-relay, desktop, wire, resources, pairing-code and peer-relays test files: 69 tests passed in 10 files, exit 0.
- Windows integration command: `pnpm --filter @modelloom/core exec vitest run --config vitest.native.config.ts` with multi-gpu-integration, node-integration and owner-integration: 28 tests passed in 3 files, exit 0. These use real Windows identities and TLS; multi-GPU transport tests use controlled worker fixtures.
- Desktop command: `pnpm --filter @modelloom/desktop exec vitest run` with LivePeers and Connections: 15 tests passed in 2 files, exit 0.
- Both workspace typechecks passed. Scoped ESLint, Prettier and `git diff --check` passed.
- `pnpm --filter @modelloom/core build:hosts` passed; `node packages/core/scripts/build-development.mjs` then restored the explicit development policy.
- Independent source review found the startup lease race. Tests first reproduced an expired stream and admission of a releasing reservation; both passed after bounded startup renewal and a successful-renewal requirement before HTTP 101. Final review found no further blocking issue.

Total: 112 focused tests passed. No performance benchmark, actual two-PC multi-GPU inference, packaged app update, or PTSS deployment was performed. Both PCs require the updated development build before checking multi-GPU connections. The current two-execution-GPU placement limit is unchanged.
