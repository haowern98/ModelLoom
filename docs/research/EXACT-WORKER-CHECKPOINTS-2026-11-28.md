# Exact worker checkpoints: implementation and evidence

**Evidence date:** 2026-11-28

**Authorization:** User-authorized exact worker checkpoint experiment, 2026-11-28.

This note records the authorized Windows NVIDIA experiment for exact prompt checkpoints. It describes the tested implementation and the evidence available at the time of writing. The comparison demonstrates exact output equality for the four tested scenarios; it does not establish behavior for all models, devices, drivers, or platforms.

## Implementation

Prompt checkpoints now keep independent, immutable backend buffers and serialized CPU metadata. The worker uses the backend's same-backend COPY_TENSOR operation to copy tensors into those buffers. A prompt-cache entry may share ownership of an immutable snapshot. The older speculative ON_DEVICE snapshot path remains independent.

The context-bound handle can be restored repeatedly, including across sequence slots in the same context. The native context-state test exercises A/B/A restores and cross-slot restore. When capture cannot complete, the existing host serializer is used at the same batch boundary. A failed restore stops execution rather than continuing with partially restored state.

Shared snapshot ownership is released on clear, replacement, eviction, and unload. Both the common context initialization/destruction path and server teardown release snapshots before the native contexts and backends are freed. Logical snapshot bytes count against the existing prompt-cache budget. The existing loading-progress callback is preserved, and the batch-splitting implementation is unchanged. The source-invariant suite passed both tests.

The build receipt lists only llama-common.dll and llama-server-impl.dll as changed. The pinned llama.dll, ggml binaries, and CUDA runtime DLLs were reused unchanged.

## Test configuration

- Model: Bonsai-27B-Q1_0.gguf; the exact file hash is recorded in gguf-evidence.json.
- Split: remote RTX 5060 Ti, layers 0–32; local RTX 4060 Ti, layers 33–63; RTX 3060 unused.
- Context: 7,680 tokens per slot, four slots, batch size 2,048, microbatch size 512.
- KV cache: Q8_0. Flash attention enabled. Speculative decoding and draft models disabled.
- Sampling: seed 7, temperature 0.8, top-k 40, top-p 0.95, min-p 0.05, repeat penalty 1.0.

The host-reference and device-checkpoint runs used the same GGUF, request bytes, context, sampling, layer split, checkpoint positions, and decode batch boundaries.

## Comparison results

The table reports native prompt prefill timings. The prefill ratio is reference prompt_ms divided by device prompt_ms. Request, answer, and reasoning hashes matched within every corresponding host/device scenario.

| Scenario   | prompt_n | cache_n | Reference prompt_ms | Device prompt_ms | Prefill ratio | Request / answer / reasoning hashes |
| ---------- | -------: | ------: | ------------------: | ---------------: | ------------: | ----------------------------------- |
| Fresh      |       24 |       0 |           7,495.582 |        1,470.889 |        5.096× | All equal                           |
| Repeat     |        4 |      20 |          11,302.918 |        1,955.549 |        5.780× | All equal                           |
| Follow-up  |       18 |     808 |          20,154.835 |        4,025.439 |        5.007× | All equal                           |
| Cross-slot |      826 |       0 |          26,582.894 |        8,393.257 |        3.167× | All equal                           |

The comparisons are per scenario. Outputs from different scenarios are not expected to match each other. The cross-slot row has cache_n=0; it is not a cache-hit result.

The separate cross-slot first-token measurement was 34.780 seconds for the reference and 16.149 seconds for the device run, a 2.154× reduction. Device prompt_ms covers 8.393 seconds of native prefill; the run log reports about 7.758 seconds of header work before the first token. Full prompt-cache transfer still uses the host path, so prompt_ms is not the full first-token or end-to-end latency.

## Test evidence and limits

The native context test returned code 0, and context.stdout.log records PASS. The tested cases include A/B/A restoration, cross-slot restores, the legacy ON_DEVICE path, and stale handles. CPU tensor-copy checks cover exact bit preservation for NaN and signed zero; allocation-failure/OOM and invalid-range cases are included. The source-invariant suite passed both tests.

The comparison artifact records matching request, answer, and reasoning values for each of the four scenarios. The GGUF evidence file records verification metadata; raw model and output hashes are not repeated here. The checkpoint-run cleanup record reports mining restored and the guard removed. A later installation smoke lease is separate from that comparison cleanup record.

Retained generated artifacts are ignored build outputs:

- packages/core/out/exact-checkpoints/comparison-final/reference.json
- packages/core/out/exact-checkpoints/comparison-final/device.json
- packages/core/out/exact-checkpoints/comparison-final/comparison.json
- packages/core/out/exact-checkpoints/context-result.json and context.stdout.log
- packages/core/out/exact-checkpoints/gguf-evidence.json
- packages/core/out/activation/b11306-exact-checkpoints/deployment.json

The dev17 runtime version b11306-dev17-exact-checkpoints-tensor-cache-v1 was installed and verified, and its bootstrap was promoted. The installation-time deployment receipt records peerRuntimeChanged=false and nativeActivated=false. The previous source coordinator and trust metadata were preserved in packages/core/out/exact-checkpoints/deployment-backup. No verifier history or clock floor was erased.

## ModelLoom application smoke check

After the user's normal development-app restart, the app started dev17 llama-server PID 12004. Its loaded llama-common.dll, llama-server-impl.dll, and llama.dll were independently hashed against the signed inventory. The user-copied runtime diagnostics record native.ready at 06:05:50 MYT on 2026-11-28, context 7,680, four slots, speculation off, and the intended remote/local GPU order.

The new-chat request started at 06:08:50 and completed at 06:10:15 with reason=STOP. Its native counters were prompt_n=24, prompt_ms=3450.662, cache_n=0: 3.451 seconds of uncached prompt processing, or about 6.955 tok/s. Both miners remained paused during that request; restoration began afterward. Both miners were then confirmed running and both temporary restoration guards were removed.

The earlier user-supplied application capture recorded 24 tokens in 7,632.76 ms. The new observation is about 2.21 times faster, but those app captures were not a controlled pair: the earlier capture had mining restored. The new isolated device-runtime fresh case took 1,470.889 ms; the app observation is 1,979.773 ms longer. That difference is not an isolated transport measurement, so its exact attribution remains open. The application smoke check establishes activation and successful completion, while exact full-output equality is established by the four matched native comparisons above. The app log alone does not contain answer/reasoning hashes.

The retained app artifacts are packages/core/out/exact-checkpoints/app-smoke/loaded-modules.json, user-counters.json, and cleanup.json. The later activation receipt is packages/core/out/activation/b11306-exact-checkpoints/activation.json; it supplements the installation-time receipt rather than rewriting that historical state.

These results cover the tested model, hardware split, settings, and scenarios only. They do not prove exactness for other models or platforms, or establish overall GPU-driver parity. The device-checkpoint prompt-prefill improvement also does not remove host-side prompt-cache transfer.
