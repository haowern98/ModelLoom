# Imported GGUF and model settings validation, 2026-10-16

The user's PROCEED authorized compatible imported GGUF models, operational model
configuration controls and overridable RAM/VRAM warnings in the Windows
development app. The later clarification requires the existing app Dialog,
including Cancel and Load anyway. No publication or production activation is
part of this change.

## Implemented behavior

- Imports and restoration use the selected GGUF identity instead of the Bonsai
  digest. Signature verification, sealed model identities, supported runtime
  checks, physical GPU identity and complete placement validation remain.
- RAM/VRAM shortage opens the shared app dialog. Consent belongs to one pending
  operation, uses a fresh resource observation and cannot survive Cancel, Stop
  or Quit. A shortage first discovered immediately before native creation uses
  that same dialog. Cancel there settles the load quietly.
- Model generation defaults apply to subsequent requests. Context, threads,
  evaluation/physical batch, concurrency, flash attention, RoPE frequency
  base/scale, reasoning budget/message and custom Jinja template are compiled
  into the next load. Arbitrary command-line overrides, unsupported overflow
  transformations, speculative decoding and automatic tuning remain unavailable.
- Saved Cluster configurations retain their captured load and advanced settings
  when model defaults change. Native admission follows the configured slot count
  with eight pending requests and exact native settlement before capacity release.
- A verifier-issued runtime installation can be reused by the same dependency
  owner. Each estimate and launch still independently verifies and seals its
  installed files. This avoids repeatedly copying the same runtime package.

## Live Qwen evidence

Successful isolated run:
`packages/core/out/activation/b11306/qwen-validation/run-1792149761310/result.json`.
It ran from 11:22:41 to 11:29:12 UTC, or 19:22:41 to 19:29:12 in Kuala Lumpur.
The harness used separate protected test storage and did not replace the user's
library or saved configurations.

| Item                        | Observed value                                                             |
| --------------------------- | -------------------------------------------------------------------------- |
| GGUF                        | `E:/ModelLoom/.remote/llama-b10964-k56/Qwen3.8-27B-UD-IQ4_XS.gguf`         |
| SHA256                      | `40fac4050e940397dbf13087afd50f4734a11805bf9d65ef8ddd7483470e6199`         |
| Size                        | 14,252,845,984 bytes                                                       |
| Architecture / quantization | qwen35 / IQ4_XS                                                            |
| Model context limit         | 262144                                                                     |
| Allocation / execution      | 65 allocation blocks, 64 ordinary inference blocks, one unused NextN block |
| Runtime artifact            | `b11306-cuda12.4-msvc14.44-dev1`                                           |
| Pinned upstream             | `4f31296a907d73f3409f720429bcf31111615d77`                                 |

The saved manual configuration used 4096 tokens per slot, two slots, eight
threads, batch 512, physical batch 128, flash attention and q8_0 caches. Layers
0 through 48 were assigned to the RTX 4060 Ti; 49 through 64 to the RTX 3060
Laptop GPU. Owned authenticated readiness and stock allocation verification
passed, followed by an actual completed answer: `Hello from Qwen.`

The second load used the saved model-default path at its actual configuration
revision: context 2048, one slot, batch 256 and physical batch 128. Auto planning
selected the RTX 4060 Ti alone for all 65 allocation blocks. The run recorded an
accepted memory warning, loaded with those settings and completed the same
answer. Both requests used temperature 0, seed 7, an explicit 256-token response
limit and thinking disabled through the supported template control.

Stop and Quit confirmed no remaining owned runtime or utility processes. Owner
reopening confirmed the saved model settings, unchanged manual Cluster
configuration, imported model source and private chat provenance. Reopening did
not start an engine.

## Diagnostic findings

Earlier attempts are retained as failed evidence. The test's original physical
RAM cutoff interrupted preparation/loading; it was removed from the diagnostic,
while its finite deadline and owned cleanup remain. The successful run observed
a minimum of 184,008,704 available RAM bytes. That is an observation of this
shared machine, not a capacity guarantee or a recommended memory requirement.

A separate stock startup diagnostic reached authenticated readiness in about
25 seconds but reproduced `PLACEMENT_MISMATCH`. The mixed embedding tensor type
was logged as `q3_K`; the old parser admitted only lowercase quantization names.
The case was corrected without accepting additional fallback tensors. The
filtered, non-secret native observations are retained in
`packages/core/src/cluster/fixtures/qwen35-stock-startup.log` and exercised by
`qwen-startup.test.ts`. Its negative case still rejects an extra fallback tensor.
The same native log reports that no speculative-decoding implementation was
specified. No draft-model or MTP decoding path was enabled.

Readiness rejection now reaches the core immediately. A captured engine remains
correlated until its owned exit receipt arrives, so a verification failure does
not wait for the generic startup deadline or lose cleanup evidence.

## Validation and limits

The complete core test run passed 681 tests across 66 files. The complete desktop
unit/UI run passed 257 tests across 38 files with the GPU diagnostic stopped.
Earlier overlapping runs had two five-second UI test timeouts; both isolated
reruns and the final complete run passed without increasing their timeouts or
removing assertions. Type checking, targeted lint and the renderer build passed.
Eight Chromium cases checked the
shared warning dialog at 1280 by 720 and 700 by 650, including initial Cancel
focus, both decisions, Escape, close and viewport containment. The visual capture
is `plans/memory-warning-preview.png`.

This is local Windows development evidence for the selected GGUF and settings.
It is not hosted CI, packaged release acceptance, other-platform coverage, a
throughput benchmark or universal inference-equivalence evidence. No llama.cpp
source or runtime binary was changed for this work. Production trust catalogs
remain empty. The pre-existing staged index was preserved and no commit or push
was performed.

## Model library correction, 2026-10-16

The original integration projected only the latest import. The correction restores
every indexed source through a main/core-only cursor, retaining per-model last use
and unavailable-file status. Import, usage refresh, metadata refresh and load
failure update one entry without replacing the library. Older models can open
their own settings, load, and run saved placements. Failed owner creation can be
retried without restarting; opening another model's settings does not reload the
active model.

The new integration regression first reproduced the missing Bonsai row, then
passed through two imports, settings save, owner-switch failure/retry, refresh,
reimport and restart. A separate regression runs an older saved configuration
after importing a second model. The complete core run passed 684 tests; after
adding the inactive-model reload regression, 25 relevant core tests passed.
Desktop main/shared and Models indexing checks passed 107 tests. Type checks,
the core development build and targeted lint passed.

After gracefully closing the old development app, a read-only query of the actual
model-source index confirmed both Bonsai-27B and Qwen3.8-27B were retained. No
model, settings or history records were rewritten for recovery. This correction
does not add inference-equivalence or throughput evidence.

## Disabled reply-length limit correction, 2026-10-16

The disabled response-length setting incorrectly fell back to 512 tokens. It now
captures `max_tokens: -1` for new requests. The closed captured-settings decoder
accepts that sentinel, while public request overrides still require a positive
token count. Enabled saved limits and explicit positive API limits remain enforced.
Existing captured attempts, including Retry, keep their original settings.

Chat and API admission require at least one remaining context token for uncapped
requests instead of reserving 512 output tokens. Both native server launch paths
disable context shifting, preserving the existing stop-at-capacity policy rather
than silently dropping earlier context. The installed pinned runtime's `--help`
confirmed unlimited prediction and the context-shift control. Its
[versioned implementation](https://github.com/ggml-org/llama.cpp/blob/4f31296a907d73f3409f720429bcf31111615d77/tools/server/server-context.cpp)
defines the unlimited sentinel and stops at capacity when shifting is disabled.

The regression first failed against the 512-token fallback, then passed. Coverage
includes native request payloads, captured-settings round-trip, near-full/full
context admission, persisted Retry settings, output usage above 512 tokens and
explicit-limit enforcement. The full core suite passed 694 tests across 66 files.
The affected desktop main/shared, Models and Chat checks passed 162 tests across
18 files. Type checking, targeted lint, formatting and the core development build
passed. The desktop was gracefully stopped, its owned runtime exited, and the
development app was relaunched with the rebuilt core.
This correction was not a new live GPU generation or throughput experiment.
