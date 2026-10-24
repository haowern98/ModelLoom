# Two-desktop failure and recovery acceptance, 2026-10-21

This records actual development-desktop observations between HAOWERNSLAPPY
(Singapore, 100.77.238.117) and PTSS (Malaysia, 100.69.84.91). It does not
establish release readiness, broader network security, or numerical equivalence
with another GPU topology.

## Fixed assets and setup

- Singapore coordinator and Malaysia worker used the packaged development app,
  authenticated pairing, and explicit verification of both installation fingerprints.
- Model: existing Qwen2.5 Coder 3B Instruct Q4_K_M, model digest
  `4a188102020e9c9530b687fd6400f775c45e90a0d7baafe65bd0a36963fbb7ba`.
  All 36 blocks were assigned to PTSS's RTX 4070 SUPER.
- Test settings: context 512, threads 4, evaluation/physical batch 64,
  concurrency 1, temperature 0, seed 1234, response limit 128.
- Runtime: `b11306-dev5-peer`; stock llama.cpp b11306,
  commit `4f31296a907d73f3409f720429bcf31111615d77`.
- Product helper SHA-256:
  `07394831c191a82135cfad2be3eb925d0e19998a6025ba78ff6da9dc12c06685`.
  The former job RAM quota was absent. Restricted-token, single-process,
  kill-on-close job and endpoint guards remained enabled.
- Singapore used an isolated test runtime installation directory on E:.
  Existing model files and identity keys were retained. Original model settings
  were captured before each run and restored in each harness's cleanup block.
- Only PTSS mining was paused for these runs, under an independent timed lease.
  The lease restored mining afterward. Singapore mining was left running.

## Connection loss: passed

The desktop first loaded the remote model and returned exactly `RPC_OK`.
During a second response, the diagnostic deleted the single retained,
established app TCP connection from Singapore to PTSS port 49302. It checked
the owning app image and connection tuple before deletion. It did not disable
Tailscale, SSH, an adapter or a firewall profile.

The request changed from running to interrupted with `SESSION_STOPPED`.
Its partial text survived, the remote native worker exited, the coordinator
remained responsive, and no automatic replay occurred. An explicit subsequent
load returned the model to ready.

Evidence: ignored `packages/core/out/peer-failure-20261021/connection-loss.json`
and `workflow-retry.log`. That combined harness later stopped on its own
revocation-result assertion, so it is not recorded as a passing combined run.

## Revocation and unapproved reconnect: passed

A separate desktop run returned exactly `RPC_OK`, then revoked the approved
Singapore request while another response was streaming. Partial text `Sure`
was preserved as `Sure,`, with interrupted state and `SESSION_STOPPED`. The
worker exited and the runtime reported failure.

An explicit retry failed without creating a worker. A new invitation created a
fresh pending request with both verification flags false. Retrying again still
failed without a worker. Revocation therefore could not be bypassed merely by
reconnecting.

The first combined harness incorrectly required a declined request to remain
listed after its original pairing expiry. The product deletes expired,
non-approved requests. The corrected harness accepts absence or a declined
record with both verification flags cleared, and separately requires real
access rejection. No product authorization check was weakened.

Evidence: `revocation.json`, `workflow-revocation.log` (exit 0),
`original-settings-revocation.json`, and `test-configuration-revocation.json`
under the same ignored output directory. Cleanup restored mining and original
settings and removed the temporary named configuration.

## Full app/helper crash and restart: passed

After a fresh load returned `RPC_OK`, the diagnostic retained handles to the
actual desktop main process, its worker helper, the native worker and five
desktop children. A separate live product helper was kept as a sentinel. Both
helpers used the same verified runtime image. No second model was loaded.

The diagnostic abruptly terminated the retained app main process and its
active helper. The old worker and all five desktop children exited. The old
endpoint remained blocked by its static guard after the crash. A fresh,
unmodified product helper launch automatically recovered that stale guard;
the old endpoint then returned connection refused. Recovery preserved both the
separate live sentinel and its guard. Repeated recovery reported zero stale
assignments/filters, and final cleanup reported no live jobs.

The app then restarted normally. Its installation fingerprint was unchanged,
sharing was off and its approval list was empty. Singapore preserved the
streamed partial output as interrupted.

Evidence: `crash-recovery.json`, `crash-owner-output.log` and
`workflow-crash.log` (exit 0). Native helper recovery does not rely on the
diagnostic observer to supply old rule IDs. The observer only injected the
fault, checked outcomes and retained ownership of its sentinel.

## First-use Windows firewall permission: passed

The initial PTSS baseline was Private firewall disabled, UAC consent policy 0
and secure desktop policy 0. The user authorized temporary changes and
restoration. An independent SYSTEM scheduled task contained the complete
fixed rollback code in its action; it did not load an elevated script from a
user-writable file. It imposed a 480-second deadline and preserved the existing
OpenSSH rule.

The first strict-settings run revealed two existing `Tailscale-In` rules that
allowed all traffic to PTSS's Tailscale addresses. With separate user approval,
a subsequent task temporarily disabled exactly those two rules and enabled
the Private firewall. Access to the app was initially blocked. Normal Windows
permission created the app's TCP/UDP Private-profile rules, after which actual
desktop pairing and explicit fingerprint approval succeeded. This check loaded
no model and left mining running. No test allow rule was inserted.

The timed owner restored both existing Tailscale rules, the original firewall
state and both original UAC values. A cleanup assertion rejected Windows'
long, generated rule names, so final cleanup was completed separately against
the exact app image in PersistentStore. The two new app rules and the task were
removed; a fresh read confirmed the original settings and no test app rules or
rollback tasks remained.

Evidence: `firewall-first-use-block-observed.json`,
`firewall-permission-result.json`, `firewall-final-restoration.json` and
`workflow-firewall-retry.log`. The desktop check passed, but the wrapper's exit
was 1 because its cleanup assertion failed. Do not report that wrapper itself
as passing.

## UAC startup deadline regression

The first actual GPU load with Private firewall and UAC approval prompts enabled
failed during repeated helper launches. The user confirmed every prompt was
approved. Original Windows/model settings and mining were restored afterward.

Two new regression tests reproduced incompatible startup budgets: an approved
16-second mTLS worker launch and a 17-second owned gateway connection failed
before the worker's existing 20-second startup window had elapsed. The raw
accepted TCP socket also retained a 10-second admission timer underneath TLS.

The source fix gives approved launches a 21-second socket deadline, a
25-second upgrade deadline, a 31-second desktop IPC deadline and a 32-second
gateway deadline. The outer IPC budget includes the preceding five-second
approved-status check. Both TLS and raw
socket startup timers are cleared after successful admission; existing
heartbeat/reservation handling continues. Unauthenticated connections retain
their original admission deadline, and the native worker's 20-second startup
and cleanup/security restrictions remain unchanged.

Both regressions failed before the fix. All 10 focused native networking tests
passed afterward; core build, type checking and focused lint passed. The three
development bundles were rebuilt from source, their complete diffs inspected,
and all 112 Malaysia package-manifest files verified. Native assets and trust
metadata were unchanged.

A subsequent actual UAC run completed all 16 permissioned startup connections
and began transferring weights, then hit the existing 180-second model-start
deadline. A separate source change gives only validated remote placements a
300-second startup budget, with a matching desktop watchdog five seconds
outside that budget. Local loads retain 180 seconds. Serialized commands cannot
supply a startup budget. Stop/forced-exit deadlines are unchanged.

Session, supervisor, captured-placement and desktop-watchdog tests cover local
expiry, remote readiness after the local deadline, bounded remote expiry,
invalid values and rejected serialized overrides. The original watchdog and
remote session behavior failed their regressions before the fix. The combined
focused suite passed 62 tests; a fresh native networking run passed all 10 tests.
Core build, type checking and focused lint passed.

One later first startup expired while the PTSS approval prompt remained open
for more than 24 seconds. Its late approval did not revive the cancelled load;
a subsequent process check found no workers or consent prompt and confirmed
restored Windows settings. This is a cancelled attempt, not a passing UAC load.

## Attended UAC and remote GPU run: passed

The final attended run completed the real sharing, invitation, both identity
confirmations, approved worker launches, model loading and chat workflow.
All 36 model blocks were assigned to PTSS's RTX 4070 SUPER, and the response
was exactly `RPC_OK`. A fresh Windows-settings query immediately after that
response confirmed Private firewall enabled, consent policy 5 and secure
desktop policy 1. The rollback had not expired before the successful response.

Evidence: `workflow-strict-attended.log`, `strict-attended-remote-response.json`,
`strict-attended-ready-windows-state.json` and
`strict-attended-settings-restored.json`. The outer workflow exited 0. Its
cleanup restored original model settings and mining and removed its temporary
configuration. The independent Windows owner restored the original firewall
and UAC values, then its scheduled task was removed.

In this earlier run, repeated administrator prompts were a usability issue: the stock
startup sequence opens six placement-query connections and ten runtime
connections, each launching a helper. This result verifies successful prompt
handling with an attentive user; it does not establish a good final approval
experience or tolerance for leaving a prompt open beyond the worker deadline.

The subsequent [sharing-helper acceptance](SHARING-HELPER-ACCEPTANCE-2026-10-21.md)
verified one approval and one helper across two complete model loads and 32
restricted workers. Its evidence and cleanup are separate from this earlier run.

## Final cleanup

The final product recovery check reported zero assignments, zero filters,
zero live entries and empty jobs before runtime files were removed.
Cleanup selected only runtime copies created after this acceptance session
started, validated resolved roots and flat executable/library contents, and
refused deletion while any selected image was running.

- Singapore: 14 test runtime copies removed, 15.54 GiB recovered.
- PTSS: eight test runtime copies removed, 8.88 GiB recovered.
- PTSS's original launcher was restored byte-for-byte, without debugging
  arguments. Its temporary desktop task and all Windows rollback tasks were
  removed. No test native processes or listeners on ports 49301/49302/9224/9225
  remained. The SSH debug forwarding listeners were also gone.
- Both original Tailscale firewall rules were enabled again; the app-specific
  test permission rules were removed. Private firewall and UAC policy values
  matched the captured baseline.
- PTSS mining was running again. Singapore mining was not paused by these runs.
- Existing model weights, identity keys, normal app data and reference checkout
  were not deleted. Small test logs and before/after bundles remain in ignored
  output as diagnostic evidence.

Evidence: `final-guard-result.json`, `cleanup-singapore-result.json`,
`cleanup-malaysia-result.json`, and `final-malaysia-environment.json`.

No commit, push or PR was performed during these acceptance checks.
