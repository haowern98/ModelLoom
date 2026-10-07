# Bonsai Windows development validation

Date: 2026-10-07. This records local development evidence, not release acceptance,
distributed correctness, a speed benchmark or a production signing arrangement.
The user approved this work with mining left running and the existing UI design
preserved. No miner process or settings were changed by these tools.

## Exact inputs

- Bonsai-27B-Q1_0 GGUF: 3,803,452,576 bytes; SHA-256
  `71d6871836886267f39f1ac69b1b1dd8a783970708d7a189960112ed02978901`.
  The original audit file has two hard links. A separate byte-identical copy
  under ignored `packages/core/out/activation/b11306/models/` permits the native
  single-link lock without weakening that check.
- Upstream `b11306`, source `4f31296a907d73f3409f720429bcf31111615d77`.
  Windows x64 CUDA 12.4 archive SHA-256
  `86b01329016bf48d49ce37b2ed99af1bb2af7269eca8f4936236d3e0c30b2af8`;
  CUDA dependency archive SHA-256
  `8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6`.
  Both match the official release asset digests.
- Signed inventory `b11306-cuda12.4-msvc14.44-dev1`: 40 files, 1,191,611,069 bytes.
  Includes the inspected helper, server/planner implementations and dependencies,
  CUDA DLLs and three Microsoft runtime DLLs with valid Microsoft signatures.
  The driver remains an OS dependency; the inventory uses the conservative
  CUDA 12.4 Update 1 Windows floor of 551.78. Observed driver: 617.14.
- Physical GPU `GPU-22c23971-dacf-2123-2169-ad70d8f6729a`; PCI `00000000:04:00.0`.
  The owned child sees this sole UUID as CUDA0 with no split across devices.
- User-confirmed test settings: 7,680 tokens/request, one slot, full GPU offload,
  Q8_0 K/V cache, seed 7, temperature 0.8. No automatic fitting or projector.

## Observed results

The explicit development verifier checked TUF metadata and every inventory file.
Installation copied to a new protected directory; dependency and model locks
remained held throughout each owned test. No fixture trust or unsigned fallback
was used. The ordinary build still rejects development activation.

The signed upstream `llama-fit-params --fit-print on` diagnostic exited 0 and
reported MiB floors: CUDA model 3446, context 404, compute 512; host model 170,
context 0, compute 27. Each reported category must be rounded upward before any
budget calculation. This estimator alone is not approved loader evidence.

Two actual calibration runs passed authenticated owned-listener readiness,
context=7680 and slots=1 checks; bounded generation; a 7,500-token prefill with
16 generated tokens; caller streaming cancellation followed by another reply;
and private-console Ctrl+C shutdown within five seconds. Each exited 0. Logs
confirmed no context truncation in the high-context request.

The second run attributed peaks to retained owned handles: helper/server resident
peak sum 5,721,894,912 bytes; whole engine-job private-commit peak 7,004,450,816
bytes. These peaks need not be simultaneous. Global RAM/VRAM snapshots are
background-sensitive and cannot alone establish process attribution.

Earlier calibration observations explain why host needs exceed the fit estimate:
the server enables an 8192 MiB RAM prompt cache and up to 32 recurrent-state
checkpoints per slot. The planner excludes those server reuse caches. An exact
general admission budget is therefore still pending validation of its bound;
the production memory catalogue remains empty.

The user selected caching enabled by default on 2026-10-07. Fixed server arguments
initially set `--cache-ram 8192 --ctx-checkpoints 32`; these are limits,
not an immediate 8 GiB reservation. Admission requires a separate validated
`serverCaches` report matching both limits, including all selected slots'
checkpoints and cache overhead. Its RAM budget is added to weights, KV and
scratch. Missing or mismatched cache evidence blocks launch; a cache-inclusive
shortage is rejected without silently disabling reuse or shrinking context.

The pinned server implementation counts cached checkpoint payloads inside the
8192 MiB prompt-cache cap and evicts entries before allocating a replacement.
Restoring a cached prompt moves its checkpoints into the active slot. Active
slot checkpoints are separate from the prompt-cache cap. The observed checkpoint
size was approximately 149.626 MiB; capacity planning for all 32 active
checkpoints plus the prompt cache would therefore cover about 12.68 GiB of cache
payload alone, before model/runtime allocations and overhead. This is a
capacity-planning calculation, not a measured peak or an approved memory report.
The short runs created at most two active checkpoints and do not validate that
larger bound. A later read-only snapshot showed 9,625,686,016 bytes of available
system RAM. No maximum-capacity cache workload was started. The user confirmed
24 GB of installed RAM and requested bounded remaining checks instead of cache
saturation. The earlier 20 GiB free-RAM target was withdrawn; it is not a Bonsai
startup requirement. The smaller approved policy below supersedes these initial
limits; both policies allocate lazily.

The normal CUDA Q8_0 value-cache arguments now explicitly enable flash attention,
matching the actual calibration run. The diagnostic uses those shared arguments
without adding a second flash-attention option.

Cache-policy regression checks passed on 2026-10-07: desktop tests 39/39,
core tests 229/229 and native ownership/publisher tests 41/41. Type checking,
lint and targeted formatting also passed. New tests first reproduced missing
explicit cache flags and omitted cache RAM accounting, then passed with the
fixed policy; an adapter test rejects cache-inclusive RAM shortage before
native process creation. These checks do not establish the real peak-memory
bound or enable the ordinary loader.

After aligning the flash-attention arguments, a new regression test reproduced
the missing explicit mode before the fix. The full checks passed again:
desktop 39/39, core 230/230 and native 41/41, for 310 tests. Type checking,
lint and formatting passed. Desktop source files remain unchanged.

## Remaining bounded CLI checks, 2026-10-07

`scripts/validate-lifecycle.mjs` completed the additional real-engine scenarios
using the explicit development verifier, signed package and locked Bonsai file.
It loaded one real model at a time, generated at most eight tokens per reply,
sampled available RAM and retained-job memory, and stopped only its owned engine
if free RAM fell below 1 GiB or engine-job private commit exceeded 8 GiB. These
diagnostic limits do not change the prompt-cache cap or the model configuration.

- Closing a separate deployment with a harmless native probe left real Bonsai
  usable. A separate native probe also survived the real-engine owner's death.
  This verifies ownership isolation, not simultaneous two-model capacity.
- Repeating a 101-token prompt reused 97 tokens and processed four. After an
  intervening different prompt, RAM restoration again reused 97 tokens; the
  pinned engine's cache-restoration trace was observed. No saturation was needed.
- Graceful stop exited 0 and left the owned job empty within five seconds.
  Explicit reload produced another reply with the same GGUF and settings.
- Forced job stop exited 1 and left the owned job empty within two seconds.
  The surviving owner then explicitly reloaded Bonsai and obtained a reply.
- The owner intentionally exited 91 without invoking its normal finally block.
  Retained-job observation confirmed that the complete tree was empty within
  two seconds. Cancellation before authenticated readiness also exited 91 and
  left its owned tree empty within two seconds.
- Temporary API credentials were removed after observed exit. The diagnostic
  left no test-engine processes running and did not change desktop sources,
  mining, Bionic or any unrelated deployment.

The first cache assertion used a three-token prompt. That run failed because
Bonsai's recurrent memory had no reusable checkpoint for such a short prompt;
the engine correctly reprocessed it. The cache was enabled. Retained failure
logs established this cause before the input was changed to a small 101-token
prompt. The reuse assertion was kept and the final run passed.

The successful cache/reload/stop cycle recorded an engine-job private-commit
peak of 6,266,187,776 bytes and helper/server resident peak sum of
4,987,199,488 bytes. Those are observations for the bounded workload, not a
full-cache upper bound. The final harness owner receipt showed zero active
processes; cancellation-before-readiness did too.

Raw results are in ignored `evidence/lifecycle.json` and `lifecycle-worker.json`
under the activation directory. These tests use a development diagnostic, not
the normal `realEngineAdapter`: the ordinary trust and memory catalogues remain
empty. Synthetic host tests separately cover interrupted partial output and GUI
core survival after an ordinary native fixture crash. The real diagnostic's
forced stop is not represented as an injected spontaneous native crash.

Final checks passed after this harness was added: desktop 39/39, core 230/230,
native 41/41; type checking, lint, targeted formatting, all four native
formatting/clang-tidy checks and `git diff --check`. All 77 desktop files still
match their pre-activation hashes. A final read-only process/listener snapshot
found zero activation engines and no listener on the diagnostic port; the
temporary credential directory was absent. The ordinary host build restored
`DEVELOPMENT_BUILD=false`. No commits or publication were performed.

Raw local evidence stays under ignored `packages/core/out/activation/b11306/evidence/`.
Runtime credentials are temporary, redacted from retained diagnostic logs, and
removed after confirmed exit. Private signing keys remain outside this checkout.

## Remaining gates

Production custody, other platforms, packaged presentation/grouping, network
workers, scheduling and inference equivalence remain separate gates. Chat/API
generation, persistent model import and custom settings are outside this first
desktop connection.

## Approved smaller budget and desktop connection, 2026-10-07

The user approved keeping reuse enabled with a smaller cache/checkpoint allowance
for this 24 GB system. The final fixed policy is `--cache-ram 768 --ctx-checkpoints 2`.
This changes reuse capacity, never the selected GGUF, 7,680-token context, one slot,
full GPU offload, Q8_0 K/V, seed or temperature. Cache eviction can require prompt
reprocessing. It is not permission to claim inference equivalence from these tests.

The exact development report reserves 6,618 MiB of physical RAM:

| Component                |   MiB | Basis                                                |
| ------------------------ | ----: | ---------------------------------------------------- |
| Host model               |   171 | Pinned planner, rounded upward                       |
| Host KV                  |     1 | Pinned planner, rounded upward                       |
| Runtime allowance        | 5,120 | Resident observations and development headroom       |
| Prompt-cache payload     |   768 | Fixed source-enforced cap                            |
| Two active checkpoints   |   302 | 151 MiB each, rounded above the observed 149.626 MiB |
| Cache/transient overhead |   256 | Development allowance, separate from payloads        |

The runtime, host weights and transient allowance total 5,547 MiB, above the
earlier observed 5,456.82 MiB resident peak sum; cache payloads are reserved
separately. Private commit includes pageable memory and is not physical RAM use.
The exact GPU allowance remains 4,365 MiB: model 3,447, context 405, compute 513.
These are development admission estimates backed by pinned source and bounded
observations, not a measured full-cache maximum or allocation guarantee. Fresh
availability can change after checking; native failure remains an honest failed
state. General model/device reports and production memory authority remain empty.

The first 2 GiB/four-checkpoint allowance was rejected by the real app when only
about 7 GiB of RAM was free. A 1 GiB/two-checkpoint attempt also lacked headroom;
the final 512 MiB/two-checkpoint budget was rejected after available RAM fell to
about 4.8 GiB. The user then closed unused applications, leaving about 11.4 GiB
available. Mining was neither stopped nor reconfigured. No resource assertion was
disabled to make these attempts pass. With 512 MiB, repeated-slot reuse worked,
but cross-prompt restoration failed: the saved prompts occupied 302.841 and
299.685 MiB, so the engine correctly evicted the oldest entry. The assertion
was retained and the cap increased to 768 MiB, rather than claiming restoration
from an enabled flag. Redacted failure evidence is retained in
`evidence/cache-512-eviction.{json,log}`. The diagnostic now uses the same exact
development admission report instead of its old fixed 8 GiB prelaunch guard;
the 1 GiB free-RAM and 8 GiB private-commit abort limits remain unchanged.

The 768 MiB/two-checkpoint lifecycle run exited 0. Repeated and RAM-restored
101-token prompts both reused 97 tokens and processed four; the pinned cache
restoration trace was required. Graceful stop, forced stop/recovery, independent
deployment survival, owner death and cancellation before readiness all passed.
The bounded cache cycle's retained-job private-commit peak was 6,266,216,448 bytes;
resident peak sum was 4,986,970,112 bytes. These remain bounded observations, not
full-cache saturation evidence. The final owner and cancellation receipts each
contained zero active processes. Raw results record the exact final cache policy
in `evidence/lifecycle.json` and `lifecycle-worker.json`.

The explicit unpackaged Electron development test now passes through existing
Import GGUF, model picker, Run and Stop controls using `realEngineAdapter`:

- OS-picked exact model is hashed and represented by an opaque renderer ID.
- Extra privileged renderer fields are rejected; paths/ports are not returned.
- Real authenticated readiness precedes the ready display.
- Stop confirms owned exit, and explicit reload succeeds.
- Terminating only the captured owned server produces an error while navigation
  remains usable; explicit recovery reloads the same configuration.
- Window close performs full Quit, exits Electron with code 0 and leaves zero
  listeners on the owned port.

The first successful lifecycle traversal exposed test-tool errors after Quit:
Playwright's disposed app wrapper could no longer provide its process, then an
empty PowerShell listener result returned exit 1 despite reporting count zero.
The test now retains the original process and counts matching listeners from a
successful query. The final complete harness exits 0. This was an owned forced
interruption test, not proof of every spontaneous native crash mode.

Evidence is ignored `packages/core/out/activation/b11306/evidence/desktop/runtime-desktop.json` and
`runtime-local-ready.png`. Desktop tests pass 56/56; core 236/236; native 41/41.
The source CSS is unchanged. Live status text replaces misleading demo/unassigned
messages without changing layout, fonts or colours. No commit or push was made.

Type checking, lint, targeted formatting, all four native formatting/clang-tidy
checks and 44 browser regressions also passed. Browser evidence includes system
and fallback fonts, the existing screen dimensions and scroll margins. Hosted
CI and release acceptance are not claimed by these local results.

Electron Forge's Windows demo package also built successfully. Its packaged
smoke test passed navigation, sandbox checks and owned app exit (1/1, exit 0).
Main and preload have distinct `index.cjs` and `preload.cjs` outputs; without
the explicit preload filename, both source entries named `index.ts` would collide.
This packaging check does not establish packaged live-runtime grouping. After
the live checks, the ordinary core build restored `DEVELOPMENT_BUILD=false`.
The final read-only snapshot found no activation engine, no listeners on
18476/18477/18478 and no temporary credential directories. HEAD remains
`3d8a038a4525170dddff0c2542853ae5c187aed4`; no files were staged.

To enable this local connection, build the core hosts, run the standalone
`packages/core/scripts/build-development.mjs`, then start the desktop normally.
This uses the existing signed workspace bundle and pinned public development
root; it never selects trust or launch settings from renderer input. A subsequent
ordinary core build resets `DEVELOPMENT_BUILD=false`, and packaged production
activation stays disabled regardless. Signing/metadata renewal is a separate
publisher operation and does not gain an expiry bypass from these instructions.

Sources: [pinned upstream fit implementation](https://github.com/ggml-org/llama.cpp/blob/4f31296a907d73f3409f720429bcf31111615d77/common/fit.cpp),
[pinned server cache options](https://github.com/ggml-org/llama.cpp/blob/4f31296a907d73f3409f720429bcf31111615d77/common/arg.cpp),
[pinned prompt-cache allocation and restoration](https://github.com/ggml-org/llama.cpp/blob/4f31296a907d73f3409f720429bcf31111615d77/tools/server/server-task.cpp),
[pinned active-slot checkpoint handling](https://github.com/ggml-org/llama.cpp/blob/4f31296a907d73f3409f720429bcf31111615d77/tools/server/server-context.cpp),
[official b11306 release](https://github.com/ggml-org/llama.cpp/releases/tag/b11306),
[CUDA 12.4 Update 1 driver minimum](https://docs.nvidia.com/cuda/archive/12.4.1/cuda-toolkit-release-notes/index.html).
