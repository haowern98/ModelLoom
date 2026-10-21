# Cross-device desktop acceptance, 21 October 2026

## Scope and fixed inputs

This continues the persistent sharing-helper acceptance on HAOWERNSLAPPY
(Singapore) and PTSS (Malaysia), connected through their existing Tailscale
addresses. The desktop apps remain unelevated. No firewall or UAC settings are
changed by these tests. Mining is paused under independently expiring leases
and restored afterward.

The model is the existing Qwen2.5 Coder 3B Instruct Q4_K_M GGUF, SHA-256
`4a188102020e9c9530b687fd6400f775c45e90a0d7baafe65bd0a36963fbb7ba`.
The stock runtime is b11306, upstream commit
`4f31296a907d73f3409f720429bcf31111615d77`, with the verified dev7 peer
helper. No model, quantization or sampling substitutions are made.

The manual configuration assigns blocks 0–17 to Singapore's RTX 4060 Ti
and blocks 18–35 plus the output layer to Malaysia's RTX 4070 SUPER.
Settings are 512 context tokens, one slot, four threads, batch/microbatch
64/64, flash attention enabled, q8_0 K/V cache, temperature zero, seed 1234
and a 128-token output limit. The compiled tensor split is
`0.4729729890823364,0.5270270109176636`; using `1,1` would select a
different block boundary in this pinned runtime.

## Desktop split and stock comparison

The actual packaged desktops completed invitation, Requests approval and
identity confirmation. Saving and running the split configuration reached
the product's owned readiness gate, which verifies native model/cache
allocation against the selected GPUs.

Three fresh conversations produced `RPC_OK`, `391` for 17 times 23, and
a lighthouse passage. The passage was a single sentence despite asking for
two; this test establishes comparison parity, not universal instruction
following or model quality.

An independently launched, hash-verified stock llama-server coordinator used
the same model, compiled split, load flags and native request parameters.
Its responses matched all three desktop outputs exactly. Stock RPC bytes
travelled through the existing authenticated ModelLoom transport to the
unchanged stock RPC worker. This is not a separate unsecured WAN RPC test.

Allocation evidence comes from a second stock run with verbosity 5. The
existing `verifyStockPlacement` verifier accepted all 36 blocks, cache
placement, output placement and CPU input buffer. That verbose repeat
completed the first request but hit a later response timeout; it is not
counted as a completed three-request repeat. The successful three-request
run and the allocation run have identical compiled load settings apart
from logging verbosity and ephemeral ports. An earlier test-script path
format failure occurred before loading and is not passing evidence.

Auto assign also succeeded with the ordinary small-model settings. It
selected Singapore's RTX 4060 Ti alone because the model fits there.
Selecting two devices when one suffices is not required for this case.

Evidence is in ignored `packages/core/out/cross-device-20261021/`:
`attempt3/split-generation.json`, `attempt3/auto-small.json`,
`attempt4/workflow.log`, `attempt4/stock-load-flags.json`,
`attempt5/stock-native.log`, `attempt5/stock-load-flags.json` and
`stock-combined-evidence.json`.

## Interruption and access checks

With the split model generating, the test drops only its retained peer TCP
connection. Generation becomes interrupted, existing text survives, the
remote worker exits and the desktop remains responsive. There is no automatic
replay. An explicit reload subsequently reaches owned readiness.

Revoking the approved coordinator while it generates also interrupts the
request and preserves existing text. A reload cannot reach readiness and no
remote worker is created. A new invitation has pending status with both
verification flags false; another reload still cannot use the remote GPU.
The test explicitly approves and confirms the new identity relationship
before subsequent loading.

Evidence: `attempt6/connection-loss.json`, `attempt6/revocation.json` and
`attempt6/workflow.log`.

## Combined-capacity planning

Combined-capacity Auto assign passed after temporarily saving and confirming
32,768 context tokens and 28 slots in the model settings. Native estimation
selected blocks 0–20 on Singapore and 21–35 on Malaysia. This is a planning
test, not a load or generation test at that large context/slot budget. The
temporary draft was discarded and the 512-token, one-slot settings restored
before loading. Evidence: `attempt7/auto-confirmed-capacity.json`.

An initial attempt to change capacity only in a cluster draft did not change
the authoritative model defaults and therefore repeated the small-model
case. It is not counted as a combined-capacity result.

## Reconnection defect found during acceptance

After successful revocation and a new explicit approval, a stale outgoing
connection still retained its local identity pin. Runtime resource and RPC
selection counted both the stale and fresh pinned records, rejecting the
newly approved connection as ambiguous. The desktop test therefore could
not reload after reapproval; this is a product defect, not passing recovery
evidence.

`PeerOwner.resources` and `openRpc` now use the existing authenticated peer
view and require exactly one currently approved connection with both
verification flags. Revoked, disconnected and pending records cannot supply
access. Multiple currently approved records remain an error. The actual
resource/RPC operation still checks authorization remotely, so revocation
between selection and use is not bypassed.

A real TLS regression first failed with `PEER_NOT_APPROVED` after fresh
approval, then passed after the fix. The owner and node integration suites
passed 12 tests. Type checking, the core build, affected ESLint, formatting
and focused whitespace checks also passed. Three development JS bundles and
their manifest entries were rebuilt consistently on both test desktops;
the native runtime/helper packages and their identities were preserved.
`reconnect-bundle-receipt.json` records the source and bundle hashes.

The two-PC repeat passed with both the old stale record and the newly
approved record present. Revoked and pending retries were rejected; after
fresh approval, the saved 18/18 split reached owned readiness and generated
`RPC_OK`. Evidence: `attempt7/fresh-approval-recovery.json` and
`attempt7/workflow.log`.

## Full crash and restoration

While the split model generated, the test retained exact process identities
and terminated the PTSS desktop and its persistent helper. The worker and
five desktop children exited. Singapore kept the partial text as interrupted.
The old static guard remained until recovery, preventing unguarded port reuse.

A fresh product helper started through `--rpc-session-cuda`, automatically
recovered the stale record and completed a stock RPC handshake. An independent
live worker remained usable throughout. Recovery reported zero assignments,
zero filters, zero live entries and empty jobs after teardown, and a second
recovery was also empty. The restarted desktop retained the same public
identity, started sharing off and had no incoming approvals. Evidence:
`attempt7/crash-recovery.json` and `attempt7/crash-owner-output.log`.

The final desktop workflow exited successfully. Settings were restored and
the temporary saved configuration and conversations removed. Mining resumed
on both PCs, with two worker processes observed on each. PTSS's normal
launcher was restored byte-for-byte, debugging disabled and the temporary
desktop task removed. Original Windows firewall/UAC settings and Tailscale
rules were confirmed unchanged. No test native processes or listeners remain.

Validated runtime copies created by this task were deleted: six on Singapore
(6.66 GiB) and seven on PTSS (7.77 GiB). Canonical runtime assets, development
packages, user GGUFs and app identities were preserved. Final receipts are
`cleanup-local-result.json`, `cleanup-local-empty.json`,
`cleanup-remote-audit.jsonl`, `cleanup-remote-result.jsonl` and
`final-local-state.json`. Automatic approval review blocked recursive cleanup
of temporary folders without stating a reason; a subsequent read confirmed
those folders contain no files. Small diagnostic logs remain as evidence.

This pass verifies the 3B model and the described two-PC flows. No 27B model
was loaded. No commit or push was performed.

These machine-specific checks are not a throughput benchmark, a universal
numerical equivalence result, cross-platform acceptance or release approval.
