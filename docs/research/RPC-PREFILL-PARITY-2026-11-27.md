# RPC prefill investigation — 2026-11-27

## Finding and evidence limits

ModelLoom disables the restricted CUDA worker's disk JIT cache with
`CUDA_CACHE_DISABLE=1`. The pinned CUDA 12.4 binary does not contain native
compute-12.0 kernels for the RTX 5060 Ti. Its PTX compilation therefore adds
substantial work, including repeated work after worker restarts. Stock's
persistent NVIDIA cache can reuse these compiled kernels.

Changing only that environment flag on the stock remote worker reproduced most
of the observed gap. These are individual measurements, not a throughput target
or a statistically repeated benchmark. No post-fix ModelLoom measurement has
been made yet.

| Fresh-process run, same short input | Input tokens | Prompt processing | First token | Output tokens |
| --- | ---: | ---: | ---: | ---: |
| Stock, default persistent JIT cache | 11 | 7,458.276 ms / 1.475 tok/s | 7,468.343 ms | 253 |
| Stock, remote `CUDA_CACHE_DISABLE=1` | 11 | 31,875.793 ms / 0.345 tok/s | 31,883 ms | 253 |
| ModelLoom, existing authenticated path | same input | 0.320 tok/s | not independently captured | 253 |

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

### Proposed recovery, awaiting separate authorization

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
