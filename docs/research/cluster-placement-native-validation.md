# Cluster placement native delivery and validation

Date: 2026-10-16, Asia/Kuala_Lumpur. Status: bounded stock-runtime implementation
and dated local multi-GPU/application-host evidence; release gates remain open.

## User decision: production llama.cpp stays unmodified

The user permits llama.cpp source modifications **for tests only** and forbids
them in the production app. This supersedes the earlier proposal to ship a
replacement runtime with custom placement reporting.

- An instrumented build may collect diagnostic placement evidence in an isolated
  test setup. Keep its artifacts and results separate from app runtime installs.
- Never package, publish, select or launch that modified build as an application
  runtime, including through the development app's normal load path.
- Production must use unmodified llama.cpp with the existing package signature,
  file-integrity, process-ownership and cleanup checks preserved.
- A custom diagnostic receipt cannot become a required production runtime
  interface or independently grant production admission. Establish what the
  unmodified runtime can demonstrate, cross-check it against diagnostic findings
  and record any remaining uncertainty before revising admission requirements.

The original boundary decision permitted test instrumentation in principle without
authorizing a live run by itself. The later separately authorized stock-runtime
validation is recorded below. No llama.cpp source or binary was modified.

## Implemented stock verification, 2026-10-16

The implemented Windows development slice uses the verified, unmodified b11306
runtime for the exact Bonsai 64-block profile: context 7680 per slot, four slots,
q8_0 K/V caches, flash attention on, batch 2048/microbatch 512 and one or two
NVIDIA GPUs on this PC.
Other load tuples remain rejected. It does not open production root custody,
change signatures or modify llama.cpp. Auto place refreshes resources and runs the
stock fit estimator, preferring one GPU, then checking both GPU orders and cuts
from the centre outward until the first feasible proposal. Review, Save and Run
remain separate actions. Run captures the saved ID/revision, model, load settings
and ranges, preflights before stopping an active model, and rechecks dirty state
and revision in core. Exact UUID launch and complete stock debug startup checks
bind PCI identities, all 64 blocks, output, cache/state and allowed input fallback.
The UI shows verified active ranges. Quit joins estimator cleanup.

## Dated evidence and remaining limits

Existing diagnostic run `run-1792086790984` exercised single 4060 Ti, 48/16 and
reversed 16/48 placements. The stock parser accepted all 64 blocks and output in
both orders. Three prompts matched exactly with a 32-token maximum, producing
32, 7 and 32 tokens respectively in every allocation. The run also
covered four concurrent requests, cancellation/recovery and zero owned processes
within five seconds of exit. Actual stock estimator times were 7.9, 12.9 and 12.7
seconds. This is bounded functional evidence, not a throughput target or universal
quality equivalence. Full core checks passed 629 tests across 63 files and desktop
checks passed 223 tests across 36 files before the latest three search tests.

The application path completed Auto estimation, draft Save, manual 48/16 Save,
actual-adapter readiness and native Chat transport. The follow-up
`saved-1792087282107/persistence-audit.json` verified 1848 characters of native
reasoning and the configured `limit-reached / OUTPUT_LIMIT` outcome through the
protected history owner, with exact cluster provenance. No answer completed before
the output limit. A new core owner recovered the exact saved configuration, model
index and available source; its snapshot was stopped with no engine children.
Full Quit left zero utility processes. This independent audit checked the already
completed native work without another GPU run. Earlier harness timestamp, EOS and
renderer-provenance assumptions remain recorded failures.

The latest focused main-process suite passed 18 race tests; earlier full-suite
counts above remain dated snapshots. See the
[detailed stock validation report](cluster-stock-validation-2026-10-16.md).
These results do not establish production/release, other platforms, other models or
settings, every execution operation's device, or WDDM physical VRAM residency.
Unexpected or incomplete stock placement evidence fails admission. Keep existing
signature, ownership, model verification and cleanup checks. No modified llama.cpp
build, new signature or broader root admission is introduced.
