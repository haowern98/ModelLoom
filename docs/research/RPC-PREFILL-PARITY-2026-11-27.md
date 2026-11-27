# RPC prefill investigation — 2026-11-27

## Finding and evidence limits

ModelLoom disables the restricted CUDA worker's disk JIT cache with
`CUDA_CACHE_DISABLE=1`. The pinned CUDA 12.4 binary does not contain native
compute-12.0 kernels for the RTX 5060 Ti. Its PTX compilation therefore adds
substantial work, including repeated work after worker restarts. Stock's
persistent NVIDIA cache can reuse these compiled kernels.

Changing only that environment flag on the stock remote worker reproduced most
of the observed gap. These are individual measurements, not a throughput target
or a statistically repeated benchmark. No post-fix ModelLoom measurement had
been made at the time of this initial report; later UI observations are recorded
below.

| Fresh-process run, same short input    | Input tokens |           Prompt processing |                First token | Output tokens |
| -------------------------------------- | -----------: | --------------------------: | -------------------------: | ------------: |
| Stock, default persistent JIT cache    |           11 |  7,458.276 ms / 1.475 tok/s |               7,468.343 ms |           253 |
| Stock, remote `CUDA_CACHE_DISABLE=1`   |           11 | 31,875.793 ms / 0.345 tok/s |                  31,883 ms |           253 |
| ModelLoom, existing authenticated path |   same input |                 0.320 tok/s | not independently captured |           253 |

ModelLoom's reported rate implies approximately 34.4 seconds for the same
11-token prompt. Its native duration was not independently captured in this
run. All three completed responses had identical answer and reasoning SHA-256
hashes. This is exact agreement for this case, not a general inference-equivalence
proof. The stock default cache had prior use; “fresh process” does not mean an
empty disk JIT cache.

For a second, 24-token input in the same worker session, stock with caching
disabled took 11,958.211 ms / 2.007 tok/s. ModelLoom reported 1.667 tok/s and
produced the same answer/reasoning hashes and 785 output tokens. A separate
stock cached diagnostic took 7,626.027 ms / 3.147 tok/s with an output cap of one;
that capped run provides prefill evidence only, not output equivalence.

The larger stock UI samples used different rendered input/token counts. Their
7–24 tok/s rates should not be compared directly to the bare short request.
Persistent JIT caching explains a large measured delay; it does not establish
that transport overhead or all remaining delays are solved.

## Controlled configuration

- Same Bonsai-27B Q1_0 GGUF, 3,803,452,576 bytes; SHA-256
  `71d6871836886267f39f1ac69b1b1dd8a783970708d7a189960112ed02978901`.
- Pinned b11306, upstream `4f31296a907d73f3409f720429bcf31111615d77`.
  CUDA DLL and server implementation DLL hashes matched stock and ModelLoom.
- Remote RTX 5060 Ti: blocks 0–32. Local RTX 4060 Ti: blocks 33–63 plus output.
  RTX 3060 remained unassigned. GPU order and tensor split were preserved.
- Four slots; 7,680 context tokens each; total context 30,720; batch 2,048;
  microbatch 512; Q8_0 KV; flash attention on; speculative decoding off.
- Seed 7, temperature 0.8, top-k 40, top-p 0.95, min-p 0.05, repeat penalty 1,
  presence penalty 0, no stop strings, unlimited output except the explicitly
  capped diagnostic above.
- Stock used direct OS Tailscale RPC; ModelLoom used its authenticated embedded
  path. Both miners were paused for GPU comparisons and restored afterward.

The local small-RPC TCP_NODELAY experiment did not show a benefit, so its
candidate patch was removed. Local helper framing transferred 64 MiB at about
52.46 MiB/s; that result alone does not establish WAN throughput or rule out
other network costs.

## Implemented fix, not yet activated

The helper now creates a dedicated persistent `modelloom-rpc-cuda-jit-v1`
directory beside installed runtime versions. It never uses a caller-supplied
CUDA path or the global NVIDIA cache. Its protected ACL allows the current
user, SYSTEM, and a separate restricting capability. An explicit medium
integrity label permits the real medium-integrity worker to write it even when
the helper is elevated. The CUDA driver receives a 256 MiB cache-size setting;
this is its managed-cache limit, not a general filesystem quota.

All path ancestors and the root remain pinned until contained processes exit.
Existing roots with unexpected ownership, permissions, integrity labels, or
reparse points are rejected. Rejected storage retains the original restricted
worker with disk JIT caching disabled. The tensor-cache capability and directory
remain separate. No weights, quantization, model math, context or sampling were
changed. First use can still compile kernels; later workers can reuse them.

Native tests passed for persistent restricted write/read, denial without the
JIT capability, private-file denial, ancestor pinning, invalid ACLs, and parent
and root junctions. They explicitly lower the worker token to medium integrity
and passed with both ordinary and elevated test hosts. The four worker lifecycle
probes and stock CPU RPC instance-isolation/teardown probe passed. These checks
do not exercise the CUDA driver's own cache implementation.

An unsigned `b11306-dev16-cuda-jit-tensor-cache-v1` candidate was prepared: only
`ModelLoom-peer-host.exe` changed; all 41 other files were checked byte-identical
to the verified dev15 peer package. No signing, installation or activation was
performed. Live acceptance still requires actual cache creation/reuse through
the rebuilt restricted helper, fresh-worker repeat comparisons, unchanged
settings/output checks, and mining restoration on both PCs.

## Reproduction and retained evidence

Commands from the repository root:

```powershell
node --test packages/core/scripts/rpc-prefill-evidence.test.mjs
node packages/core/scripts/test-cuda-jit-cache.mjs
node packages/core/scripts/build-network-guard-probe.mjs
$env:MODELLOOM_BUILD_PEER_HOST='1'
node packages/core/scripts/build-network-guard-probe.mjs
Remove-Item Env:MODELLOOM_BUILD_PEER_HOST
pwsh -NoProfile -File packages/core/scripts/probe-network-worker.ps1
pwsh -NoProfile -File packages/core/scripts/probe-network-worker.ps1 -InstanceSmoke
node packages/core/scripts/prepare-cuda-jit-runtime.mjs
```

Use the pinned Node 24.21.0 toolchain. Native scripts require the existing MSVC
development setup. Preparation fails instead of overwriting an earlier output.
GPU requests and mining control are intentionally separate from these commands.

Local validation after implementation:

- `pnpm test`: exit 0; 24 Node tests, 635 desktop tests, 1,270 core tests
  (1,929 total).
- `pnpm typecheck`: exit 0 for desktop and core.
- ESLint over all changed JavaScript/TypeScript: exit 0.
- `clang-format --dry-run --Werror` over all four changed native files: exit 0.
- Both native helper builds: exit 0 with MSVC `/W4 /WX`.
- Native cache tests in ordinary and elevated contexts: exit 0.
- Lifecycle and instance-isolation probes above: exit 0.
- `pnpm format:check` on this Windows working tree: exit 1, reporting 376
  CRLF-converted files (`core.autocrlf=true`). A read-only check of the same
  configured formatting scope after CRLF-to-LF normalization checked 661 files
  with zero formatting failures. No unrelated files were reformatted.

Branch CI was dispatched separately; its completion is not inferred from these
local results.

Ignored local evidence is in
`packages/core/out/stock-bonsai-tailscale-20261127/`: collector JSON files,
native logs, ownership records and mining lease logs. The collector reports
timings, counts and hashes without saving response text or credentials. Native
timing summaries now have prompt-free structured logging. Elevated filesystem
test evidence is in `packages/core/out/cuda-jit-cache-test/elevated-result.txt`
and `elevated-exit.txt` (PASS, exit 0). The unsigned preparation receipt and
inventory are in `packages/core/out/activation/b11306-cuda-jit/`.

NVIDIA documents the disk-cache switch in its
[CUDA environment variables](https://docs.nvidia.com/cuda/cuda-programming-guide/05-appendices/environment-variables.html)
and the PTX/native-kernel distinction in its
[Blackwell compatibility guide](https://docs.nvidia.com/cuda/blackwell-compatibility-guide/).

## Activation attempt — 2026-11-28

The user authorized development signing, installation on both PCs, and the
matched GPU comparison. Preflight rehashed all 42 candidate files: only the
helper differs from dev15. The version label was corrected to
`b11306-dev16-cuda-jit-tensor-cache-v1` before signing so the existing
`-tensor-cache-v1` capability gate continues to enable weight-transfer caching.
The two verified-RPC test files passed all 27 tests; the preparation script's
targeted formatting check and `git diff --check` passed.

Signing stopped with `INVALID_CUSTODY`. The expected development publisher
directory is empty; no matching development key files were found in the checked
local profile/project locations, and PTSS has no development publisher public
root at the expected location. The user confirmed that no backup is available.
The trusted development root remains unexpired, but its public metadata cannot
replace the missing private signing keys. The existing production publisher has
a different trust root and was not used. No candidate was signed, installed, or
activated. Mining was left running on both PCs; no GPU comparison was started.

### Recovery procedure (approved 2026-11-28)

Retire the old development signing identity explicitly and retain its public
metadata, existing installations, verification state, and clock floors. Use the
existing publisher's initialization procedure to create six fresh development
keys with the established role separation and two-of-three root threshold.
Verify and record the new public-root fingerprint, then provision it as the
development-only build input on both PCs. Do not change production trust or
keys. The verifier already namespaces cached metadata by the root fingerprint;
there is no need to erase the old trust cache or bypass rollback checks.

Re-sign the unchanged coordinator inventory and the inspected dev16 peer
inventory under the new development root into new repositories. Verify signatures,
file inventories and rejection cases before promoting those public assets to
the normal development bootstraps. Restart through the supported development
launcher and verify the installed helper. Only then pause mining under bounded
leases, run cold/warm/fresh-worker comparisons with unchanged inference settings,
and restore mining in cleanup. The prior approval to use the existing signing
key does not silently authorize this replacement of the development trust root.

The user subsequently approved replacement development signing trust. The
unchanged publisher initialization created six DPAPI-protected development keys
with the existing role separation and two-of-three root threshold. The new
public-root SHA-256 is
`2fc689679e8b20fa9cf806e8ec3df68d9ed2feee1f12918e6ef1783a3ac4e5a8`.
The retired root and all four previous development repositories were retained.
The production public-root hash remains
`055cefc8ef6eb9906522514b8cebf8cc4d2e14deb9d40b3c8f90f54a796d886b`;
production keys and trust were not changed.

All candidate files were rehashed before signing. Coordinator, Vulkan and paired
inventories remained unchanged; the peer inventory contains only the previously
reviewed helper/version change. All four re-signed repositories verified. Actual
checks rejected retired-root metadata and an altered inventory under the new
development pin. The verifier/policy tests passed 16 tests; the native publisher
suite passed all four tests, including renewal/update rollback and custody checks.

Only public metadata, the public root and the inspected helper were transferred
to PTSS. Both development checkouts were rebuilt with the new pin, and both PCs
verified coordinator dev14 and installed/revalidated peer dev16 through the
existing runtime installer. Each deployment retained backups. Remote test-pin
synchronization preserved the rest of that source file. No trust-cache or clock
floor was erased. Evidence is in `trust-recovery/`, `deployment-result.json` and
`installed.json` beneath the local and remote `out/rpc-prefill-live-20261128/`.

At this checkpoint the existing development apps still need a normal restart
to release their cached trust pins. GPU comparisons have not started and mining
remains on. The source launch guard requires a normal Windows terminal outside
Codex; touching the main source did not restart the existing apps because hot
restart is not enabled. The user was asked to restart with `npm run electron dev`
from each normal development checkout. No alternate launcher or profile override
was used. This is the state before the later UI and checkpoint-isolation checks
recorded below.

## Follow-up UI and checkpoint evidence — 2026-11-28

After the normal development-app restart, two ModelLoom UI completions were
captured. Both returned 785 output tokens and matched the direct stock warm
reference's answer and reasoning SHA-256 hashes. These are individual
observations, not a repeated benchmark or a general equivalence proof.

| Run                                          | Prompt count and prefill                                                                                                                                  | Completion evidence                                                                                                                                                  |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stock, two context checkpoints, bare request | 24 tokens; 7,273.408 ms / 3.29969 tok/s                                                                                                                   | 785 tokens; content `d870d8a4ea0542f90eceab17436df2b72750caf479e2b3b4c1151d7d00b3c988`; reasoning `18f4b84e1a4aceda0c1fc4bb590f3c400399eab7c5848be1bf27f2ff704d6d65` |
| ModelLoom UI completion 1                    | 2.650849 tok/s; 24-token denominator inferred from the matching request/output; about 9,053.703 ms derived from that rate, not observed by a native timer | 785 tokens; both hashes match the stock reference                                                                                                                    |
| ModelLoom UI cached repeat                   | 0.3422303 tok/s as captured; exact `prompt_n` was not retained, so no prompt duration or 24-token comparison is inferred                                  | 785 tokens; both hashes match the stock reference                                                                                                                    |

The stock desktop UI log separately records a 346-token prompt and 15,824.21 ms
of prompt evaluation (21.87 tok/s). CPU-only `/apply-template` plus `/tokenize`
on the restored stock server confirmed the exact same user message renders to
24 tokens without built-in tools and 346 tokens with the pinned `get_datetime`
and `get_info` UI tool definitions. This count is measured, not inferred. The
two checkpoint-created log intervals were 6,187.555 ms and 7,544.762 ms,
13,732.317 ms combined. Their boundaries include surrounding checkpoint
bookkeeping; they are not isolated serialization, transfer, or CPU-only costs.
The longer rendered UI prompt is not directly comparable with the bare
24-token request.

The retained ignored evidence is under
`packages/core/out/rpc-prefill-live-20261128/`: `warm-repeat-results.json`,
`stock-warm-emperor.json`, `checkpoint-isolation/result.json`,
`checkpoint-isolation/coordinator-args.json`, `kernel-miss-evidence.json`, and
`template-token-comparison.json`. The stock desktop-UI log is
`packages/core/out/stock-bonsai-manual-20261128-032107/stock-coordinator.stderr.log.before-repeat`.

### Checkpoint diagnostic and correctness boundary

For the same bare request hash
`09e924ebd8d5e76975b69abf2a23713db07008e67a37cd59f0b97377d92b1c05`, the
stock coordinator run with `--ctx-checkpoints 0` processed 24 prompt tokens in
411.967 ms (58.25709 tok/s), versus 7,273.408 ms with two checkpoints. It
produced 915 completion tokens, with content hash
`7505c67ae573487f5224e1969c785fe84bdeb151661f5a9912163a26ec7aad0c` and
reasoning hash
`ab44a5cfe9cfd120b8dafc2f1b8a14aa019d20cf3c7b93f35660aa7e263e3ea8`; these
differ from the 785-token reference. The zero-checkpoint result is diagnostic
only and is not a quality-preserving fix.

At pinned upstream commit
`4f31296a907d73f3409f720429bcf31111615d77`, the checkpoint path crosses
`tools/server/server-context.cpp:2344`, `common/common.cpp:2296-2300`,
`src/llama-memory-hybrid.cpp:190-194`, `src/llama-memory-recurrent.cpp:904-956`, `src/llama-context.cpp:2669-2672`, and
`ggml-rpc.cpp:743-749`. The recurrent-state checkpoint measured 598.5 MiB
across four sequence cells (149.625 MiB per sequence); about 79 MiB was
remote. The current `ON_DEVICE` path has one `mem_storage[seq_id]` slot and
overwrites the prior snapshot, so it is not a safe two-checkpoint
implementation.

Disabling context checkpoints also changes batch boundaries in
`server-context.cpp:3530-3558`, which changes floating-point arithmetic. The
exact first divergent operation has not been identified. The large prefill
change therefore cannot be treated as an inference-equivalent optimization.

The earlier slow case reported 1.88487 tok/s; its 24-token denominator and
12,732.94 ms prompt duration are inferred. A private JIT module was written
during that request at 2026-11-27 19:17:38.6216719 UTC and was byte-identical
to a 5,367,427-byte module already present in the stock cache. The approximately
3.68-second difference from the first UI capture is unpaired and may reflect
different worker/cache state; the evidence does not fully attribute it to JIT
work. Application transport overhead remains unisolated, so these results make
no ModelLoom/stock parity claim.

Both miners were restored and their actual processes checked. The
`--ctx-checkpoints 0` diagnostic coordinator was stopped. The stock stage was
restored with two context checkpoints and reported healthy on port 8080; no
benchmark was run on that restored stage with mining active. No source or
persistent runtime-setting changes were made for these checks.

### Native prompt counters for the next matched comparison

The next diagnostic change retains `prompt_n`, `prompt_ms`, and optional
`cache_n` from the owned native SSE response and emits one numeric summary only
after valid stream completion. It does not change renderer events, request
settings, model execution, checkpoint policy, or output. The callback excludes
native text and cannot fail inference if its diagnostic sink throws. This
avoids inferring evaluated token counts from a displayed rate; it does not
itself optimize prefill. Live verification requires the normal development-app
restart so the running main process loads the rebuilt core modules.

The next adjacent stock capture (`adjacent-stock-emperor.json`) reused an
existing checkpoint: native counters were `prompt_n=4`, `cache_n=20`, and
`prompt_ms=10643.962` (0.3757999 tok/s). Its request and output hashes match the
24-token bare reference. The native log records roughly 3.77 seconds restoring
the recurrent checkpoint and 6.44 seconds saving its replacement. This is a
cached-repeat observation, not the requested fresh-slot comparison, and must
not be substituted for the uncached 24-token baseline. It directly demonstrates
why cached prompt rates can be very low even in stock RPC. An earlier request
on that slot had been cancelled; its provenance was not established by this
capture. Both owned stock processes were stopped afterward for the ModelLoom
test.

The user restarted the local app with the new counters. Native Windows Computer
Use then became unavailable (the tool inventory exposed Chrome only), so the
ModelLoom request and log-copy step were handed to the user. No browser demo or
alternate app launch was substituted for the actual desktop deployment.

### User-supplied native counter capture — 04:57 MYT

The supplied runtime viewer export records a completed request starting at
04:56:32 and the following numeric summary at 04:57:39 on 2026-11-28:
`prompt_n=24 prompt_ms=7632.76 cache_n=0`. This establishes 7.633 seconds of
uncached native prompt work (3.14434 tok/s), rather than inferring the count
from a rate. The same model/context/four slots, speculation off, and remote
5060 Ti followed by local 4060 Ti are recorded during loading.

Compared with the earlier uncached stock capture (24 tokens / 7,273.408 ms),
this observation is 359.352 ms, or 4.94 percent, longer. This replaces the
earlier inferred 1.78-second residual as the latest observed difference, but
does not establish a controlled parity result: mining had already been
restored before this user-run request, and the export does not prove an
identical background workload or repeat variance. The earlier setup RPC
aborts precede `native.ready` at 04:50:30; this chat request completes with
`reason=STOP`. Their error label alone does not establish a chat disconnect.

### Exact worker checkpoint implementation

The subsequent authorized implementation keeps separate immutable checkpoint
tensors on each backend while preserving checkpoint positions and decode batch
boundaries. The four matched native comparisons reduced prompt processing by
3.17–5.78 times, with identical request, full answer, and reasoning hashes in
every corresponding case. The real-model A/B/A and cross-slot state test also
matched serialized state bytes and preserved the legacy speculative snapshot.
See [the implementation and evidence report](EXACT-WORKER-CHECKPOINTS-2026-11-28.md)
for settings, timings, lifecycle checks, deployment status, and limitations.
