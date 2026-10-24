# Sharing helper approval: Windows acceptance

On 2026-10-21 the actual desktop workflow passed between HAOWERNSLAPPY
(Singapore) and PTSS (Malaysia), with Windows approval prompts enabled.

## Result

One sharing session produced exactly **one Windows consent process, one helper
process and 32 restricted stock RPC workers**. Two consecutive model loads each
completed generation with exactly `RPC_OK`. The helper retained PID 19968 and
the same creation time across both loads. Stopping the first model did not end
sharing or restart the helper.

The test used the existing Qwen2.5 Coder 3B Instruct Q4_K_M GGUF, assigning all
36 blocks to PTSS's RTX 4070 SUPER. Context was 512, threads 4, batches 64/64,
concurrency 1, temperature 0, seed 1234 and response limit 128. The original
model settings were restored and both test conversations and the temporary
configuration were removed afterward.

A live token inspection during the repeat load established that the desktop
was unelevated and the retained helper was elevated. The final response was
followed by a fresh query confirming Private firewall enabled, administrator
consent policy 5 and secure desktop policy 1. The independent Windows rollback
had not expired during either successful load.

## Implementation and artifact

Share this PC starts the helper before advertising availability. Remote RPC
connections reuse that helper and each start a fresh restricted worker. Worker
exit and owned guard removal are confirmed before accepting another Open.
Stop sharing closes the helper. A remote request cannot launch another helper
after failure.

The existing private, PID-checked owner pipe carries bounded Open, opaque Data
and Close envelopes. Commands cannot select paths, executable images, ports or
GPUs; the GPU remains fixed at helper launch. Installation seals remain held
until helper shutdown is confirmed. Late readiness during cancellation still
requires the normal cleanup acknowledgement.

Local sharing approval has a 120-second budget, with management IPC margin.
Ordinary management commands and per-worker startup retain their original
limits. There is no installed Windows service or elevated desktop.

- Development package: `b11306-dev7-peer`, metadata roles version 6.
- Helper SHA-256: `ccefd498aee6d72db18eef36a0401e54533d501f1091abdf122ea54b9a936ac7`.
- Stock RPC remains upstream commit `4f31296a907d73f3409f720429bcf31111615d77`,
  SHA-256 `f530f12b421e5966fe04fccf7def04441b796d34480a83f0f59f60061d1d4e09`.
- Development trust root unchanged:
  `fa142094d12daccc01f8888051e97b6366d43c71f4e18583fa69c91734969f15`.
- Both updated desktop packages passed their 112-file manifest verification.

## Regression checks and failed attempts

Fresh focused checks passed: 72 core unit tests, 20 native integration tests,
and two native argument/framing fixtures. They cover helper reuse, sealed-file
lifetime, malformed/fragmented envelopes, cleanup acknowledgements, unexpected
worker EOF, replacement workers without new elevation, and cancellation during
worker startup. Type checking, the core build, native builds, affected ESLint
and formatting checks are recorded separately from the live desktop evidence.

Earlier attempts exposed the old 20-second sharing deadline, a 45-second UI
test wait and a reused evidence-file path. These failed attempts are not counted
as passing loads. The first framing implementation also yielded after each
header, throttling the small IPC fragments. A failing native parser fixture
reproduced that defect; the corrected parser drains an already-buffered frame
in one wake. The successful two-load run used the corrected helper.

## Cleanup and evidence limits

Fresh product recovery reported zero assignments, zero filters, zero live
entries and empty jobs. The helper, workers and owned desktop exited. The normal
PTSS launcher was restored byte-for-byte, debugging disabled, and temporary
desktop and Windows rollback tasks removed. Original firewall/UAC settings,
both Tailscale rules and the two mining worker processes were confirmed restored.

Only validated runtime copies created by these tests were removed: four on
Singapore (4.44 GiB) and five on PTSS (5.55 GiB). Canonical runtime assets,
user GGUF models, app identity and normal settings were preserved. Small logs
and package-change receipts remain in ignored output.

Evidence is under `packages/core/out/peer-helper-session-20261021-r2/`:
`attended2/attended.log`, `attended2/two-load-result.json`,
`attended2/prompt-count.json`, `elevation-during-load.json`,
`attended2/strict-attended-ready-windows-state.json`,
`attended2/strict-attended-settings-restored.json`, `final-guard-result.json`
and the two `cleanup-*-result.json` receipts.

This verifies approval reuse and the repeated desktop GPU workflow on these two
Windows PCs. Full two-PC revocation/crash cases from the preceding acceptance
were not all repeated against this helper version. Native EOF/startup cleanup
was tested freshly. This is not a throughput benchmark, universal numerical
parity result or release-readiness claim. No commit or push was performed.

## Subsequent cross-device acceptance

[Cross-device acceptance](CROSS-DEVICE-ACCEPTANCE-2026-10-21.md) records the
later 18/18 split across Singapore and PTSS, three-output stock comparison,
combined-capacity Auto assign, connection loss, revocation and a fresh full
desktop/helper crash repeat. It also records a stale-connection selection
defect found after fresh approval, its failing/passing TLS regression and
successful two-PC recovery after the fix. The native helper remains dev7.
That follow-up supersedes the outstanding live crash/revocation repeat limit
above, while preserving the stated model, platform and release limits.
