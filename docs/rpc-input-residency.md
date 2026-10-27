# RPC input residency

ModelLoom can encode repeated tensor SET requests across its existing authenticated peer transport. The worker restores every original request before passing it to its existing restricted native helper. The runtime executable and libraries are unchanged. There are no UI changes, additional listeners, helper executables or dependencies.

## Negotiation and ownership

The coordinator offers `x-modelloom-rpc-residency: input-residency/1` during the existing RPC HTTP upgrade. The worker acknowledges only when its backend explicitly supports the codec and existing peer approval, GPU reservation and worker-readiness checks have succeeded. The verified backend supports it. The capability grants no additional permission.

An absent acknowledgement preserves the raw stream for an older worker. An older client receives raw RPC from a new worker. An unsupported acknowledgement rejects the connection before forwarding native bytes. Exact runtime compatibility checks remain unchanged; this feature does not enable different runtime releases in one inference session.

The TypeScript Duplex adapters live in `packages/core/src/peers/rpc-residency.ts`; the bounded data codec lives in `rpc-residency-protocol.ts`. They use the existing TLS/overlay and owned-worker lifecycle. Destroying a wrapper destroys its transport and releases its RAM dictionary. Peer revocation and worker loss still reach the existing cleanup path. Connections and GPU assignments have separate dictionaries.

## Exact reconstruction and bounds

After observing a native HELLO with major version 6, 7 or 8, the encoder retains complete SET records with payloads from 512 bytes to 4 MiB. Each connection retains at most 64 MiB and 4,096 records with FIFO eviction. SHA-256 selects a candidate, and byte equality is required before a reference is used. Caller-owned buffers are copied. Definitions and references use bounded private frames; all other native bytes use literal frames of at most 64 KiB. Large native requests track their uint64 length and stream without allocating their advertised size.

Unknown native versions use literal transport after HELLO. Native responses remain opaque and pass through unchanged. No tensor layout is interpreted, so version-specific fields remain part of the exact bytes being compared and restored.

Every reference restores the original SET, including after a graph, overlapping write, memset, allocation reuse or free. The dictionary is transport compression rather than a claim that GPU memory remains unchanged. There is no skipped native write or computation, fabricated completion, cached output, or retry after uncertain execution. Missing references, invalid private bounds and truncated frames close the stream. Backpressure propagates through both adapters.

The dictionary is ephemeral connection memory, separate from the existing disk weight-cache control. Model weights, quantization, context, sampling and numerical execution are unchanged. Protocol reconstruction tests establish byte preservation; formal model-quality acceptance remains a separate gate.

## Verification on 2026-10-27

Working branch: `feat/rpc-input-residency`, based on `d2430e8`, with pre-existing unrelated work preserved. Commands use the existing pinned Node 24.21.0 executable under `packages/core/out/tooling` and installed workspace tools. No native compilation was needed.

From `packages/core`:

```powershell
node ../../node_modules/vitest/vitest.mjs run --maxWorkers=1
node ../../node_modules/vitest/vitest.mjs run --config vitest.native.config.ts src/peers/node-integration.test.ts src/peers/multi-gpu-integration.test.ts src/peers/rpc-integration.test.ts src/peers/owner-integration.test.ts src/peers/code-pairing-integration.test.ts --maxWorkers=1
node ../../node_modules/typescript/bin/tsc --noEmit
node ../../node_modules/typescript/bin/tsc -p tsconfig.build.json
```

The portable suite passed with **1,085 tests in 106 files**, exit 0. The focused codec/stream cases cover fragmentation, exact repeats and changed bytes, supported/unknown versions, dictionary eviction, uint64 lengths, truncated frames, backpressure, transport loss and cleanup. Core typecheck and host build passed, exit 0. Desktop `tsc --noEmit` also passed, exit 0. ESLint passed on all nine affected TypeScript files, exit 0.

The real native fixture runs stock RPC through approved TLS in both raw and negotiated modes. It allocates a small CPU backend buffer, writes and reads bytes, overwrites the buffer, then proves that a repeated SET restores the original bytes while crossing the app transport as a reference. It performs no model inference. Other peer tests cover legacy negotiation, invalid acknowledgements, separate GPU dictionaries and owned cleanup.

The native peer regression command passed with **71 tests in five files**, exit 0. It includes both stock native modes and the negotiated TLS cases above. The final scoped Prettier and whitespace checks also passed, exit 0.

## Evidence limits

The subsequent [Bonsai diagnosis](research/BONSAI-RESIDENCY-DIAGNOSIS-2026-10-27.md) records the user's unchanged 7 tok/s result, a controlled codec comparison, large unchanged output downloads and measured owned-helper overhead. It does not establish a live desktop speedup.

The [integration plan](superpowers/plans/2026-10-27-rpc-input-residency-integration.md) records the approved scope. The [isolated JavaScript prototype](research/external-rpc-bridge-2026-10-27/) contains separate two-PC model measurements. Those results are not measurements of this app integration.

Output prefetch remains experimental and disabled in the app. Full graph-execution/output fusion is not implemented here. No live desktop model generation or new GPU benchmark has been performed for this integration. Packaging and cross-platform acceptance remain unverified.

## Two-machine test deployment, 2026-10-27

The user separately authorized deployment to PTSS and HAOWERNSLAPPY. Both development apps are now running the updated core code. Five production TypeScript modules and their JavaScript/declaration outputs match exactly across the two machines, 15 files in total. PTSS compiled the sources independently before activation; its generated outputs matched the laptop's manifest. Existing PTSS source files were checked against the prior baseline and backed up before replacement.

HAOWERNSLAPPY's app had already started after its updated core build, so another restart was unnecessary. PTSS's Vite watcher rebuilt its main bundle but could not restart the app from the build subprocess. Activation instead used normal Quit, confirmed exit of the previous owned processes, and the supported `npm run electron dev` command under the already signed-in Windows user. The normal profile preflight passed. No profile guard or source launcher was modified, and the temporary user-session launcher task was removed afterward.

At verification, the laptop app PID was 20400, with core/peer PIDs 26704 and 31344. PTSS's new app PID was 25372, with core/peer PIDs 17236 and 18780; its previous app and owned core processes had exited. PTSS's launch error log was empty. Before/after hashes matched for 89 native files per machine, including the inspected runtime candidates and existing bindings. No native runtime package was replaced, no model was transferred or loaded, and no UI source bytes changed.

Deployment evidence is retained in ignored `packages/core/out/rpc-residency-deploy-20261027/`: `manifest.json`, `local-result.json`, `ptss-result.json` and the native hash baseline. PTSS retains its source/output backup and `rollback.json` under the same relative directory in `D:\ModelLoom\ModelLoom-Project`. Live model loading, negotiated model traffic, reconnect behavior after deployment and integrated GPU benchmarking remain pending; running processes and matching files do not establish those results.
