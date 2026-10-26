# Tensor cache development

This feature targets faster repeat distributed loads. The first transfer supplies the original weight bytes; later worker loads can reuse verified local bytes. Local coordinator GPU loads still read the original GGUF through the existing loader. Cache use does not alter placement, quantization, sampling or numerical kernels.

The accepted contract is [ADR-0009](../specs/decisions/0009-tensor-cache.md). The implementation plan is [2026-10-26-tensor-cache.md](superpowers/plans/2026-10-26-tensor-cache.md).

## Storage controls

- On by default; disabling preserves cached files.
- Per-PC editable size limit, free-space reserve and directory.
- Replace least recently used (default), or keep existing entries and skip new writes.
- Lowering the limit with replacement enabled trims managed entries on the next cache operation. Keep existing entries preserves prior data, including data above a newly lowered limit, and pauses new writes until there is room.
- Usage includes managed payloads/partial writes; cleanup preserves unrelated files.
- Changes affect subsequently admitted native workers. Existing GPU tensors stay usable after disk entries are cleared.

The development defaults put bulk cache files beside the fixed activation state, on E: for HAOWERNSLAPPY and D: for PTSS. The preferences file is small and atomic. Native picker changes append `ModelLoom-TensorCache-v1` to the selected parent; an arbitrary nonempty directory is not adopted. Source profiles, enrollments, pairing approvals and original model files are separate.

## Build and verification

Use the existing pinned Node/MSVC development setup. Everyday app startup remains `npm run electron dev` from the project root in the normal Windows user context. The source launcher prepares the small cache binding when its source/binary receipt changes, without rebuilding llama.cpp or copying CUDA files on app startup.

```powershell
node packages/core/scripts/build-tensor-cache.mjs --test
pnpm --filter @modelloom/core exec vitest run src/tensor-cache --maxWorkers=1
pnpm --filter @modelloom/core exec vitest run --config vitest.native.config.ts src/tensor-cache/native.test.ts
pnpm --filter @modelloom/desktop exec vitest run src/main/tensor-cache.test.ts src/renderer/features/settings/StorageSettings.test.tsx
```

The cache build driver has POSIX C++17/N-API branches using existing local Node headers (`NODE_INCLUDE_DIR` if needed). That source/build support does not constitute native macOS/Linux test evidence. Windows worker identity/containment remains the existing development deployment boundary.

The RPC build is an explicit maintainer operation, separate from app startup. It uses the b11306 source archive from `https://codeload.github.com/ggml-org/llama.cpp/tar.gz/4f31296a907d73f3409f720429bcf31111615d77`, stored at `packages/core/out/tensor-cache-source/source.tar.gz`. Required SHA-256: `acbc1be00cc17559164f635af6d69df4798b64c2f6504fc90da58cf4f3b80f3b`. The patch tool validates this archive and restores source/headers from it before applying checked transformations. Only `ggml-rpc.dll` is rebuilt against the existing runtime import interfaces.

```powershell
node packages/core/scripts/build-tensor-cache-runtime.mjs --test
$env:MODELLOOM_BUILD_PEER_HOST = '1'
node packages/core/scripts/build-network-guard-probe.mjs
node packages/core/scripts/prepare-tensor-cache-runtime.mjs
```

Preparation creates one unsigned candidate at the fixed staging directory below, with a manifest and provenance. It does not sign, install, replace the existing runtime or start an app. Do not reset verifier state or lower metadata versions to activate it. Development signing/deployment must preserve existing trusted metadata versions and use the normal reviewed publisher boundary.

The private-directory update uses version `b11306-dev12-tensor-cache-v1` and the
fixed staging directory `packages/core/out/tensor-cache-native/package-private-directory-v2`.
Its `--resume` mode can finish an interrupted preparation only when no inventory,
preparation receipt or published repository exists, and every existing candidate
file exactly matches the verified sources or current build outputs. It does not
delete files or replace a signed preparation. `--refresh` remains restricted to
an existing complete, unsigned preparation.

After a source change, `prepare-tensor-cache-runtime.mjs --refresh` reuses that unsigned candidate after checking all its existing files against its previous manifest. It refuses to refresh a published candidate. This avoids repeated full runtime staging copies.

Before distributed admission, the coordinator's verified shared RPC dependencies must match its local peer backend and the remote worker. The full worker executable/dependency identity check remains in place. A partial protocol update is rejected before launch.

## Evidence captured on 2026-10-26

- Native filesystem tests: cold/warm byte equality, known-answer SHA-256, corruption, truncation/length mismatch, LRU/keep policies, lowered limits, quota, reserve, partial cleanup, lease exclusion, source namespace separation and scoped clearing. LRU fixtures use distinct initial ages rather than assuming filesystem clock resolution.
- Native maintenance ABI: recognized files clear; unrelated original files and nonempty unrelated directories stay protected.
- Actual patched RPC handlers with unchanged CPU backend: 16 MiB cold miss, warm byte-exact restoration, corrupted-entry miss/repair, length mismatch and cache-off HELLO behavior. No socket listener, model or GPU was started for this test.
- Isolated browser rendering: Storage label/description/heading fonts and line heights match Appearance; no horizontal overflow at 1462 and 1000 pixels; both menu options and keyboard focus restoration work. This used a browser-only fixture, not live backend data. The only observed console error was the pre-existing missing favicon.
- Final full desktop suite: 451 tests passed (65 files). Final portable core suite: 1025 passed (102 files), including coordinator/worker build mismatch rejection. Launcher/profile suite: 9 passed. Focused authenticated TLS/native suite: 47 passed (5 files).
- TypeScript checks, full ESLint, Prettier, native formatting, diff whitespace check, core compilation and renderer production build passed. Vite retains its chunk-size advisory; no runtime build or UI test was skipped to silence it.
- The first final desktop run had one existing model-configuration interaction test exceed its unchanged 5-second deadline while native build/verification ran concurrently. Its isolated rerun passed, and the subsequent full desktop run passed without changing that test or its deadline. The LRU native fixture also exposed equal-timestamp ambiguity; explicit initial ages now test promotion/eviction deterministically, and the filesystem/RPC suites passed afterward.

The isolated preview browser and owned port-5181 server were closed. Automatic approval review rejected removal of the 21 reviewed temporary paths with `blocked by policy`; approximately 183 MiB remains. A report-by-default cleanup script is available at `packages/core/out/tensor-cache-native/Cleanup-TensorCacheDiagnostics.ps1`; only the user may run it with `-Apply` after that rejection. The runtime candidate was subsequently signed and activated as described below; its package and pinned source archive remain build assets. All 157 pre-existing staged files remain staged; no commit or push was performed.

### Activation and library-startup regression

The development publisher now supports an authenticated inventory update using the existing custody and trusted metadata chain. The tensor-cache inventory `b11306-dev10-tensor-cache-v1` advances the predecessor's three metadata roles from version 8 to 9, preserving package identity and the pinned root. All 42 candidate files were verified before activation on both Windows PCs. The existing signing custody worked only in its original context; normal desktop launches continue in the ordinary Windows user context and do not use that publisher context.

Live activation exposed a separate startup failure on HAOWERNSLAPPY. The captured history-host preparation promise rejected with `CORE_START_TIMEOUT`: main killed the utility at its five-second boot deadline and the controller mapped that to the saved-library error. Both SQLite integrity checks and native directory guards passed. A separate, model-free utility probe booted in approximately 523 ms and exited cleanly. The service boot deadline is now 30 seconds, independent of the model startup budget, with a distinct safe timeout message. Regression tests cover boot after six seconds, bounded failure at 30 seconds, retained ownership cleanup and preservation of genuine library errors.

After updating both source checkouts, both apps quit with zero retained owned processes and launched through `npm run electron dev` in their existing normal profiles. HAOWERNSLAPPY restored both model entries and the existing `test22` configuration; PTSS restored its intentionally empty model library. Tailscale remained connected on both without resetting enrollment. PTSS sharing and the existing approved pairing resumed successfully. The saved configuration read returned no assignment issues. Focused checks passed: 4 utility-deadline tests, 48 runtime-controller tests, 9 native host tests, both TypeScript checks, scoped ESLint and core compilation.

### Two-PC loading observations

The unchanged Bonsai-27B Q1_0 model and saved `test22` configuration reached Ready with layers 0–30 on HAOWERNSLAPPY's RTX 4060 Ti and 31–63 on PTSS's RTX 4070 SUPER. The first cache-filling load took 437.801 seconds, the cached repeat 167.499 seconds, and a later cache-off load 408.764 seconds. These are individual observations, not repeated controlled benchmarks: the cold attempt included mining-pause transitions, and the cache-off observation followed the response-reader fix described below. The cached repeat was approximately 59% shorter than the observed cache-off load. No exact total-traffic saving or inference-output equivalence was measured.

PTSS stored 1,941,626,880 bytes of verified cache entries for the warm run. The cache-off run kept usage at zero, reached Ready and automatically stopped the model. Both PCs' mining was paused for the comparison and restored afterward. The approved temporary PTSS reserve was returned from 3 GiB to 5 GiB, test entries were cleared, and caching was restored enabled on both PCs.

Live checks also exposed `ERR_STREAM_PREMATURE_CLOSE` in the asynchronous peer response reader. The status watch treated that reader failure as disconnection and cancelled preflight while PTSS remained online. The reader now collects delivered bytes directly; acceptance after a raced close requires parser-complete HTTP framing, an explicit exact length and valid bounded JSON. Responses now declare their byte length. Truncated bodies, other transport failures, invalid JSON and oversized data remain errors. Eighteen focused body/overlay tests and 38 existing native pairing/owner tests passed; the cache-off run then retained approval through preflight and Ready.

HAOWERNSLAPPY subsequently required recovery from two freezes. The user confirmed holding the power button; Windows's Kernel-Power 41 records with bugcheck code zero therefore do not establish spontaneous resets or their cause. The final cache-off check used bounded temperature/free-memory observation and immediate Stop after Ready; no further reboot occurred during that check. The user deferred further freeze investigation. No system-stability fix is claimed.

Temporary mining leases were released and mining was observed running again on both PCs. The diagnostic inspector listeners and temporary scheduled tasks were removed; both apps remain the canonical source versions with their existing profiles. The model is stopped and both cache preferences are enabled with a 5 GiB reserve and zero test payload bytes. Automatic approval review separately blocked deletion of the activation/debug scripts and transfer archives. `packages/core/out/tensor-cache-native/Cleanup-ActivationDiagnostics.ps1` reports those exact files by default; the user may run it with `-Apply` locally and beside the remote files. Runtime packages, build outputs, small result receipts and permanent regression tests are excluded.

Not yet established: repeated controlled timing, exact total-traffic savings, native Mac/Linux worker operation, independent security review or generation equivalence. Permanent regression tests remain source.

Final completion check after the startup and peer-reader fixes: all 1,040 portable core tests (103 files) and 453 desktop tests (65 files) passed. The changed source and compiled peer-reader files matched SHA-256 between both checkouts. Both canonical source apps remained open, with no owned model process or diagnostic inspector listener retained. No commit or push was performed.

## Private Windows folder validation, 2026-10-27

The restricted worker could access PTSS's selected cache leaf but could not
inspect its private profile/Downloads ancestors. The trusted helper now checks
and pins those ancestors, allowing the worker to validate a narrowly inherited
root handle. Parent ACLs remain unchanged. Optional setup failures reach the
existing Storage error display through a private local availability record.

Native private-folder cold/warm and sibling-file denial checks passed, as did
the actual patched RPC handler's byte-equality checks. The full core suite
passed 1,065 tests. Focused Storage/runtime-controller checks passed 55 tests;
final settings/session and Storage/management reruns passed 44 and 7 tests.

Both canonical source apps use verified development runtime
`b11306-dev12-tensor-cache-v1`. An all-PTSS Bonsai-27B Q1_0 load and its repeat
both reached Ready. PTSS's private C: Downloads cache retained 401 entries,
3,599,769,600 payload bytes. All existing reuse timestamps advanced during the
repeat, with no recreated or additional entries. The configured 10 GiB limit
and 5 GiB reserve were unchanged; C: retained about 8.69 GiB free.

The test model is stopped, and inspector listeners, forwarding and temporary
scheduled tasks are removed. Automatic approval review blocked transfer-archive
deletion; the small remaining archive/snapshot paths are recorded in the
private-folder implementation plan. No commit or push was performed. These
checks establish Windows private-directory caching, not a controlled timing,
cross-platform worker, generation-equivalence or full security acceptance result.
