# Stock two-GPU validation contract, 2026-10-16

Status: stock runtime comparison, allocation verification, application loading
and protected-store persistence audit passed for the recorded development profile.

The user authorized completing real two-GPU placement, inference correctness and cleanup validation. Production llama.cpp must remain unmodified. The isolated harness is `packages/core/out/activation/b11306/cluster-validation/probe.mjs`; it is ignored diagnostic code and is never imported by the app.

## Fixed inputs and limits

- Signed stock artifact: `b11306-cuda12.4-msvc14.44-dev1`, upstream commit `4f31296a907d73f3409f720429bcf31111615d77`.
- Existing Bonsai GGUF, SHA-256 `71d6871836886267f39f1ac69b1b1dd8a783970708d7a189960112ed02978901`. Native sealed file inspection must establish 64 repeating blocks. The explicit diagnostic cuts fail rather than silently adapting if the file differs.
- Captured settings: context 7,680 per slot, four slots, q8_0 K and V cache, evaluation batch 2,048, physical batch 512, flash attention enabled. No fitting, quantization, context reduction, CPU block fallback or model substitution is requested.
- Three sequential loads: RTX 4060 Ti alone; blocks 0 through 47 on 4060 Ti and 48 through 63 on 3060; blocks 0 through 15 on 3060 and 16 through 63 on 4060 Ti. The output slot follows the final block device through the shared placement compiler.
- Physical device UUIDs are passed as an ordered child-only visibility list through the existing native ownership binding. The helper captures the exact server image and PID; HTTP requests require an owned listener and authenticated readiness.
- Ten-minute whole-run deadline, 90-second startup and individual request limits, 4 MiB log cap per load, 256 KiB ordinary response cap, 2 GiB minimum available RAM, 12 GiB owned job commit ceiling. Initial available RAM must exceed 3 GiB.
- No other process is killed. A limit failure force-stops only the exact owned deployment. Every scenario requests graceful stop, requires zero active owned processes and a valid exit, and records cleanup evidence.

## Comparison workload

Three identical prompts are evaluated sequentially in each layout with greedy temperature zero, seed 7, maximum 32 generated tokens, returned token IDs and one probability entry. Each split must exactly match the single-GPU reference token IDs, text and finish fields. A difference fails this bounded comparison; it must not be described as unchanged quality.

Each layout also serves four concurrent short requests, cancels a streaming request after the first nonempty chunk, serves a subsequent recovery request and exits gracefully within five seconds. These are functional and cleanup checks, not a throughput benchmark.

## Evidence and interpretation

Each run writes a timestamped directory with a copied harness, one stock server log per layout and a machine-readable `result.json`. Secrets are not recorded. A temporary credential file lives in a native private directory, is unique to the run and is removed during cleanup.

The harness records full stock verbose logs and device memory snapshots. Those observations alone do not constitute an exhaustive tensor-residency manifest. Placement acceptance still requires the source-backed stock-log checks to identify repeating block assignments, output placement, cache placement and fallback indications. If stock evidence has a demonstrable gap, isolated test-only instrumentation may cross-check it; such a binary must never be installed as the app runtime.

Passing these three prompts and layouts establishes only the recorded bounded deterministic comparison. It does not establish universal mathematical equality across models, driver versions, prompts or unsupported hardware. The parent task must attach actual run results and the supported production admission envelope before claiming completion.

## Observed results

The first run, `run-1792086403145`, stopped during startup when available RAM
fell below 2 GiB. Its owned process count reached zero. After the user closed
applications, `run-1792086790984` passed all three allocations with the original
safety limits. Every layout matched the reference's three greedy token sequences,
text and finish fields. Four simultaneous requests, stream cancellation,
subsequent recovery and graceful exit within five seconds passed in each layout.
Every final owned process count was zero and every successful server exit code
was zero.

The complete stock logs passed `verifyStockPlacement`: physical PCI mapping,
all 64 repeating blocks and output slot, both cache kinds and the sole permitted
embedding fallback. No test-only llama.cpp instrumentation was needed. Neither
source nor binary was modified.

| Layout               | GPU budget, MiB (rounded) | Peak job working set, MiB | Peak job commit, MiB |
| -------------------- | ------------------------- | ------------------------- | -------------------- |
| 4060 Ti reference    | 6672                      | 4937                      | 7465                 |
| 4060 Ti 48 / 3060 16 | 4790 / 2570               | 5139                      | 8126                 |
| 3060 16 / 4060 Ti 48 | 1976 / 5384               | 5139                      | 8124                 |

The stock estimator took 7.9, 12.9 and 12.7 seconds respectively. Each fresh
resource check admitted its exact allocation. The host floor is 6500 MiB plus
a separate 1536 MiB available-RAM reserve. Host physical working set and private
commit are different measurements; the table does not equate them. GPU budgets
include rounded planner components, a 15 percent margin and 256 MiB per device.
They exceed the observed ready-device memory in these runs, without establishing
a universal allocation guarantee or physical WDDM residency.

The first application-path harness attempt rejected a test import timestamp
expressed in milliseconds instead of seconds. The corrected attempt,
`saved-1792087282107`, completed real Auto estimation, draft CAS and Save, then
loaded the saved manual 48/16 allocation through the native adapter and reached
verified readiness. Chat returned its configured token-limit outcome. The test
incorrectly required an EOS completion and attempted to read private provenance
from a deliberately restricted renderer reply. The revised harness checks valid
bounded completion and reads provenance through the protected history owner
after shutdown. A later retry was refused by fresh resource admission after
available RAM dropped to about 5 GiB; no runtime was launched by that retry.

The follow-up `saved-1792087282107/persistence-audit.json` verified the already
completed application run without another GPU launch. The protected history
contained 1848 characters of native reasoning, a correctly recorded
`limit-reached / OUTPUT_LIMIT` outcome and the exact saved two-GPU configuration.
No answer was completed before the configured output limit; this check establishes
transport/persistence, not answer quality. A new core owner recovered the exact
configuration, the model index and its available source file. Its snapshot was
stopped with no runtime child. Full Quit left zero utility processes. The earlier
harness errors remain in the evidence rather than being relabelled as passes.

Retained [result data](cluster-stock-validation-2026-10-16/result.json),
[application audit](cluster-stock-validation-2026-10-16/persistence-audit.json)
and diagnostic scripts accompany this report. The ignored original directories
retain complete stock logs, with their hashes in the retained result data.

Full unit suites passed 629 core tests across 63 files and 223 desktop tests
across 36 files. Later focused suites cover the bounded search and additional
shutdown races. These are local checks, with packaged Electron interaction,
other models/settings, remote workers and other-platform release acceptance
outside this evidence.
