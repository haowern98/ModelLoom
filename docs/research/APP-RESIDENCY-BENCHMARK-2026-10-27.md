# Bonsai app residency measurements, 27 October 2026

Residency was active and reduced uploaded RPC bytes. These automated measurements did not show a generation speedup; they do not establish its general effect on application throughput.

Afterward, the user manually measured 8.2 tok/s with residency disabled, compared with an earlier approximately 12 tok/s enabled result. This is an observed difference of approximately 46% in favour of residency in those manual runs. It supports a possible application speed benefit, but their complete conditions were not independently matched. Preserve these observations separately from the automated samples below. Neither the small automated comparison nor the manual observation establishes a general causal speed ratio.

| Mode | Request | Generation tok/s | Uploaded MB | Downloaded MB | Cache references |
| ---- | ------- | ---------------: | ----------: | ------------: | ---------------: |
| Off  | First   |            4.661 |      41.553 |        81.336 |                0 |
| Off  | Second  |            7.351 |     118.710 |        81.131 |                0 |
| On   | First   |            4.672 |       5.360 |        81.336 |              302 |
| On   | Second  |            4.483 |      82.517 |        81.131 |              302 |

MB means 1,000,000 bytes. Uploads fell from 160,262,879 to 87,876,802 bytes across the two requests, a 45.17% reduction. The codec reused 72,426,712 native bytes through 604 references; framing accounts for the difference between reused bytes and net savings. Downloaded bytes were identical for each corresponding request. Counters cover each request, including prompt processing, and exclude model loading. They count RPC application bytes, excluding TCP/TLS packet overhead.

Mean generation throughput was 6.006 tok/s off and 4.577 tok/s on, 23.79% lower in the on samples. The first pair was essentially unchanged, while the second on request was slower. Two sequential samples per mode, measured in separate fresh app sessions over the live network, cannot isolate a causal slowdown or establish a general speed ratio. The shipped feature preserves command waits and does not implement fused execution or eliminate RPC round trips.

The test used the actual source desktop app, launched through the normal `npm run electron dev` workflow and normal Windows profile. It called existing controller operations for placement, loading and chat. Each mode loaded once and generated two fresh conversations using the same prompt, `whatas uppp`, and a 128-token output limit. This limit was the temporary measurement bound; the user's original unlimited setting was restored afterward.

Configuration: Bonsai-27B-Q1_0, SHA-256 `71d6871836886267f39f1ac69b1b1dd8a783970708d7a189960112ed02978901`; requested context 20,680, native context 20,736; four slots; batch 2,048, physical batch 512; flash attention; Q8 K/V; PTSS RTX 4070 SUPER layers 0–30; HAOWERNSLAPPY RTX 4060 Ti layers 31–63, including the output placement. Sampling remained temperature 0.8, top-k 40, top-p 0.95, min-p 0.05, seed 7, penalties disabled, with the existing chat template and thinking behavior.

All four requests reached the output limit and produced identical visible text and reasoning. This is bounded observational evidence, not proof of general equivalence to a single-GPU reference. The test did not record native token IDs successfully and makes no token-ID equivalence claim.

The initial harness attempt generated once but failed its token-ID recording assertion. Windows subsequently logged an unclean reboot with bugcheck code zero; these records do not establish its cause. Further attempts encountered one native startup exit and one interrupted second load. Their failure records are retained and excluded from the throughput comparison. The completed off and on arms used separate app sessions. No runtime binary was patched for this measurement.

Mining was stopped on both hosts before inference, and both hosts recorded successful restoration after inference stopped. The feature checkpoint remains `462390ff914d16d9d068134baf3d39026f864243` on `feat/rpc-input-residency`.

Raw observations are under `packages/core/out/app-residency-benchmark-20261027/`. The completed comparison is in `retry/results/comparison.json`; its four source records are `retry/off-results-and-failed-on-load/run-1-{1,2}.json` and `retry/results/run-2-{1,2}.json`. Original settings, restoration receipts, capability negotiation, stream counters, and failed-attempt diagnostics are retained alongside them. Temporary benchmark code and source restoration are tracked separately in cleanup receipts.

Cleanup verified: all temporary benchmark source, scripts, compiled hooks and source backups were removed. The edited application files match their pre-test bytes, settings were restored, the Git index was unchanged, and no benchmark scheduled tasks remained. The restored core compilation exited successfully. SHA-256 checks found no changes or missing files among 281 original local runtime binaries and 164 original PTSS runtime binaries. The completed measurements are also preserved in the adjacent `APP-RESIDENCY-BENCHMARK-2026-10-27.json` record. No further GPU benchmark is running.
