# Bonsai residency diagnosis, 2026-10-27

The user reported 7 tok/s before and after deployment, using Bonsai at approximately 20k context across the 4060 Ti and 4070 SUPER. Investigation found that the deployed input codec can remove most repeated uploads while leaving much larger downloads, all native commands and significant owned-helper overhead in place. These are measured limitations of the chosen optimization. The completed diagnostic does not isolate the exact contribution of each cost to the live desktop's 7 tok/s.

## Recorded application configuration

The latest retained completed attempt reports 7.0152666886 generation tok/s. Its model is Bonsai-27B-Q1_0, SHA-256 `71d6871836886267f39f1ac69b1b1dd8a783970708d7a189960112ed02978901`, using runtime commit `4f31296a907d73f3409f720429bcf31111615d77`. Native context is 20,736 per slot with four slots, Q8 K/V, flash attention, batch 2,048 and microbatch 512. The selected context preference is 20,680 before native padding. Local layers are 0–30; remote layers are 31–63. The compiled output placement is remote.

The history database and its journal were copied to a diagnostic directory without changing the source. A second snapshot was checked using stable source hashes across the copy and SQLite integrity checking. Only configuration and timing summaries are retained; the temporary full history copies were removed afterward.

The most recent older completed 7.139 tok/s record in this history has all layers remote. It is not a matched pre-deployment baseline for the latest split. This does not disprove the user's reported earlier split-model result; it means the retained history alone cannot establish that comparison.

## Bounded two-machine diagnostic

The diagnostic used the recorded model, prompt, compiled placement, context/slots, server-cache policy and sampler settings. Both arms used the same SSH relay, current b11306 runtime candidates and physical GPUs. Residency-on used copies of the deployed TypeScript codec's compiled modules. Each arm generated two fixed 128-token completions with seed 7, temperature 0.8, top-k 40, top-p 0.95 and min-p 0.05. EOS was ignored only to obtain the same bounded sample length. Prompt caching was disabled consistently between requests.

This isolates the codec from the desktop transport. It does **not** reproduce the desktop's TLS, embedded overlay, IPC or restricted native helper path. Ordered two-repetition measurements are diagnostic observations, not a randomized performance acceptance test.

| Mode      | Run | Generation tok/s | Upload MB | Download MB | Reference hits |
| --------- | --: | ---------------: | --------: | ----------: | -------------: |
| Raw RPC   |   1 |            4.371 |    41.720 |     205.588 |              0 |
| Raw RPC   |   2 |            4.978 |    41.635 |     205.588 |              0 |
| Residency |   1 |            4.958 |     6.569 |     205.588 |            252 |
| Residency |   2 |            6.407 |     5.646 |     205.588 |            258 |

MB means decimal megabytes. Transfer counters include prompt processing, generation and checkpoint traffic and exclude SSH/Tailscale overhead. Residency eliminated approximately 84–86% of upload bytes. It did not reduce downloads. All four 128-token output sequences matched exactly, and bridge error counters remained empty. This is bounded byte/token evidence, not universal quality acceptance or a single-GPU equivalence result.

Each completion retained exactly 1,160 SET commands, 176 GET commands, three GRAPH_COMPUTE commands and 126 GRAPH_RECOMPUTE commands. The worker reconstructs every original SET, so native helper traffic and execution command counts remain unchanged. The codec is active in this controlled test; the original live desktop attempt has no retained per-stream cache-hit trace.

## Why the placement matters

The GGUF metadata contains 248,320 vocabulary entries. Returned generation settings confirm `backend_sampling: false`. The pinned `src/llama-context.cpp` extracts raw logits using `n_outputs * n_vocab * sizeof(float)`. With the output layer on the remote GPU, one generated token's raw logits require **993,280 bytes**, approximately 0.95 MiB, back to the coordinator. Across 128 tokens this alone is approximately 121.25 MiB. The measured additional download traffic includes prompt/checkpoint transfers; individual response sizes were not separately captured.

Input residency cannot reuse changing logits, eliminate their transfer or remove their causal execution wait. The successful earlier Qwen prototype used `RPC0,CUDA0`, placing the output on the local GPU. Its one-slot, 61,440-context, checkpoint-free configuration also differs from this four-slot Bonsai configuration. That earlier speedup was insufficient evidence for this app workload.

## Owned-helper overhead

A separate GPU-free probe sent 40 sequential DEVICE_COUNT requests after a real stock HELLO:

| Local path                                    | Mean request/response time |
| --------------------------------------------- | -------------------------: |
| Direct stock CPU RPC                          |                   0.157 ms |
| Existing owned session relay to stock CPU RPC |                  14.292 ms |

Both returned protocol 7 responses from the existing diagnostic fixture and performed no model inference. This measures the combined relay path overhead, not an isolated cost of one syscall. The helper source shared with the product, `packages/core/tests/native/network-session-relay.h`, polls its named pipe/socket and calls `Sleep(1)` when no movement occurs. Windows scheduling, PowerShell pumping and framing are therefore concrete areas to investigate. The probe does not prove that the entire difference comes from `Sleep(1)`, nor that protocol-8 GPU traffic incurs exactly the same timing.

## Outcome and remaining work

The shipped optimization addresses repeated uploads. It leaves the large output download and native helper command path intact; it does not implement full execution/output fusion. The diagnostic demonstrates useful compression and variable throughput improvement outside the desktop, while exposing substantial costs it cannot remove. Claiming an integrated desktop speedup from deployment/tests alone was premature.

The next desktop investigation should capture per-stream negotiation, reference hits, command/response sizes and time at the existing IPC/helper boundaries during a matched on/off Bonsai run. Candidate changes to test afterward are event-driven app-owned helper I/O and a separately agreed placement comparison with the output local. Neither requires changing llama.cpp binaries. Do not silently alter placement, model, quantization, sampling or concurrency to manufacture an improvement.

Both desktop apps were left running without a diagnostic restart. All test server, bridge and tunnel processes exited. Mining was restored and verified on both hosts. Hashes matched before/after for all 41 inspected runtime candidate executable/library files on each host. No runtime binaries or product source were changed by this diagnosis.

## Evidence

Ignored local directory: `packages/core/out/bonsai-residency-diagnosis-20261027/`.

- `summary.json`, `raw-1.json`, `raw-2.json`, `on-1.json`, `on-2.json`: native timings, token IDs, command counts and wire-counter snapshots.
- `stable-history-summary.json`, `config.json`: recorded app configuration and stable-snapshot provenance.
- `direct-latency.json`, `session-latency.json`: all 40 samples per local protocol probe.
- `run.ps1`, `bridge.mjs`, `remote.ps1`: bounded diagnostic orchestration. The first attempt failed before generation because SSH-owned child processes did not survive their launching command; it was repaired using the established detached-owner mechanism. First-attempt files are prefixed `attempt1-`.
- `cleanup.json`, `final-local.json`, `final-remote.json`: exact cleanup, mining restoration and native-hash verification.

Remote evidence is under the same relative directory in `D:\ModelLoom\ModelLoom-Project`. Mining lease `cd271029391b4378ba8ea16f641d62d2` retains its stop/restoration receipts under the earlier external-bridge diagnostic directories on both hosts.
