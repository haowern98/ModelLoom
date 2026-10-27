# External RPC bridge investigation

Authorized isolated experiment, 2026-10-27. Runtime executables/libraries stay unchanged. No application integration, commit or publication.

## Boundary map

Reference: existing upstream Git object b29c606e28a01b1bc8c1351026a0fa6e616bf6c4 from the frozen fused checkout. `stock-rpc-reference.cpp` is source evidence only.

The stock request is command byte, uint64 payload length and payload. Responses have uint64 length and payload. Commands 0/1/2/3/7/8/9/11/13/14/15 require real responses; commands 4/5/6/10/12/16/17 do not. SET, graph compute/recompute and GET are already asynchronously queued by stock RPC, so batching alone cannot be assumed to remove a WAN flight.

The pinned tensor serialization is 296 bytes. SET appends uint64 offset and original bytes. GET appends uint64 offset and size. Inputs received in SETs can be retained outside the engine and reconstructed into the identical local SET command. GPU graph writes do not invalidate this owned RAM copy; they do invalidate any assumption that the GPU still holds it.

The patched scheduler supplies all input/output descriptors before the fused call. Stock RPC does not expose that full scheduler contract. The external candidate can learn bounded GET descriptors from successful prior executions of an identical serialized graph. It can perform those same read-only GETs immediately after the next graph and return their real results without another coordinator request. This is opportunistic output prefetch, not a claim of complete scheduler-level fusion.

Every non-GET command conservatively invalidates output results. Graph descriptions are keyed by exact serialized bytes and buffer-lifetime epoch; free invalidates all plans. Unknown graphs have no read set and use ordinary GETs. Inputs changing shape/metadata naturally receive different exact cache keys. Connections never share cached state. Dropped execution responses close the connection without replay.

The first GPU run must verify the exact HELLO version and command layout of the retained stock assets. Different-runtime translation is not part of this diagnostic. Neither additional reads nor compatible wire versions establish cross-version numerical equivalence.

## GPU result, 2026-10-27 Malaysia time

Run `2241f978dcae43c1a33e3a91f40e29f0` completed with exit 0. Evidence: [summary.json](runs/2241f978dcae43c1a33e3a91f40e29f0/summary.json), the original requests/responses and launch manifests in that directory, and before/after runtime hashes on both endpoints.

| Mode                              | Three sampled decode rates, tok/s |   Mean | Median |
| --------------------------------- | --------------------------------- | -----: | -----: |
| Stock RPC, observation-only relay | 8.918, 9.189, 8.867               |  8.991 |  8.918 |
| External exact input residency    | 11.475, 11.936, 11.742            | 11.718 | 11.742 |
| Residency plus output prefetch    | 11.863, 11.897, 11.491            | 11.750 | 11.863 |

Residency improved mean decode throughput by 30.32% against the observation-only relay. Prefetch added only 0.28% to the mean versus residency, below what this ordered natural-link experiment can establish as a separate benefit. Do not claim that full scheduler-level fusion was reproduced, or compare these arms directly with historical patched-runtime results as a matched experiment.

Every arm completed one 64-token greedy check and three 512-token sampled runs. All greedy token IDs and all same-seed sampled token IDs matched the baseline; the complete returned generation settings and request settings also matched. Residency reconstructed the complete original stock-command transcript byte for byte. Fusion preserved the non-GET command transcript and served 1,588 output requests from 1,588 actual prefetched worker reads, with no invented output or extra graph execution.

The mean sampled uplink counter fell from approximately 177.80 MB to 28.16 MB with residency, about 84% less. These counters cover prompt processing plus generation, not decode-only NIC traffic, and exclude SSH/Tailscale overhead. Snapshot counters are periodic, not packet captures. In the last two baseline repetitions, 513 response-bearing stock requests crossed the helper link; residency retained 513; prefetch forwarded only 4 or 5 while returning about 509 prefetched reads. Those are request counters, **not a measured reduction of 513 physical WAN round trips to 4**: prefetched graph results still cross the link. The one-output-per-graph trace explains why prefetch need not remove a fundamental causal flight. Physical RTT/NIC flight accounting was not captured.

Client CPU use was approximately 1.45 to 2.36 seconds per sampled completion across the arms, for wall times around 45.5 to 60.7 seconds. End-of-arm helper RSS was approximately 60/87 MiB client/worker for baseline, 241/190 MiB for residency, and 261/187 MiB for prefetch. These are observed snapshots, not peak-memory bounds. Worker CPU counters are retained in every before/after metrics file and the generated summary.

### Exact configuration

- Existing stock official b10964 CUDA 12.4 assets, upstream commit `b29c606e2`. Original release archive hashes matched the prior records. No runtime compilation, injection, DLL substitution or binary modification.
- Target `E:\ModelLoom\.remote\llama-b10964-k56\Qwen3.8-27B-UD-IQ4_XS.gguf`, 14,252,845,984 bytes; SHA-256 recorded in the run directory.
- Laptop RTX 4060 Ti 16 GB, UUID `GPU-22c23971-dacf-2123-2169-ad70d8f6729a`; PTSS RTX 4070 SUPER, UUID `GPU-d42a520b-020b-2673-9923-6906e674e243`. The laptop 3060 was not used for inference.
- `RPC0,CUDA0`, `--split-mode layer --tensor-split 50,50 -ngl all -c 61440 -np 1 -ctk q8_0 -ctv q8_0 -fa on -fit off -b 2048 -ub 512 -t 14 -tb 14 --ctx-checkpoints 0 --spec-type none --no-context-shift`.
- Saved 784-token input; no prompt-cache reuse. Sampled seed 4242, temperature 1, top-k 20, top-p .95, min-p .05, typical-p 1, top-n-sigma -1, repeat penalty 1, additive penalties 0, DRY multiplier 0. Original sampler ordering preserved. Greedy uses temperature 0, top-k 1, top-p 1 and min-p 0.
- All three arms use identical helper framing and SSH transport with raw stock RPC loopback-bound on PTSS. This controls relay overhead between arms; a fourth helper-free stock comparison was not run.
- Local Node 24.21.0 and existing remote Node 24.11.1. This is an isolated Windows diagnostic, not proof of the application's supported Node-version floor or cross-platform release readiness.

### Verification and remaining limits

Thirteen node:test checks passed, covering fragmentation, reference integrity, overwritten/overlapping inputs, cache eviction, graph/write/free invalidation, fresh connections, dropped execution without replay, real socket exchanges against a labeled fake worker, dependent output reads, and report rejection of altered/missing results. These are protocol checks, not CPU model inference. Real GPU evidence is the separate nine sampled and three greedy completions above.

Both runtime directories had identical executable/library hashes before and after. An additional archive-content check matched all 54 executable/library files on each PC to the original official release archives; see `official-archive-verification.json`. Local and remote mining restoration was verified, both test worker ports and all local test ports were closed, and no native test server/worker remained. Remote helpers were staged in `D:\ModelLoom-External-Rpc-Bridge-20261027`; binaries stayed at their original paths. There were no app/core/UI edits, dependency installations, commits or publication. Existing 116 modified and 157 staged files remained in their prior Git-status categories.

The bridge is a bounded research prototype for the pinned protocol-6 layout. It is not a production worker authorization/lifecycle layer, a cross-release translator, a speculative decoder, a universal equivalence proof, or the historical 50,000-input acceptance gate. Read-only output prefetch remains optional; sparse tensor deltas, GPU-write skipping and scheduler hooks were not added. No single-GPU reference run was performed. The tested single model, fixed prompt and samplers do not establish all model/configuration correctness.

The helper files were formatted after the GPU run; the benchmark's original helper hashes are retained in `helper-source-hashes.json`. The post-format protocol/report suite passed. A local code review found no observed token/transcript failures; independent review using the requested Luna/max model was unavailable through this session's agent tool.

## Reproduction

Run protocol checks without loading a model:

```powershell
packages/core/out/tooling/node-v24.21.0-win-x64/node.exe --test docs/research/external-rpc-bridge-2026-10-27/bridge.test.mjs docs/research/external-rpc-bridge-2026-10-27/summarize.test.mjs
```

`run-gpu.ps1` is the recorded GPU harness, not an app launch command. It needs the already staged remote helpers, existing official assets, the exact named hosts/GPUs, free diagnostic ports, and the existing mining-control authorization. It does not automatically stage files or alter runtime installations. Review current authorization and state before another run. Everyday app launch remains `npm run electron dev`.

`summarize.mjs <run-directory>` verifies saved evidence and regenerates the summary without GPU work. `UPSTREAM-LICENSE` applies to the copied stock source reference.
