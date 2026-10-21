# Windows network guard primitive check

**Status:** Bounded local primitive check passed on 2026-10-20. The user accepted an on-demand elevated helper. This check does not implement or enable a product helper, native RPC, pairing or distributed inference.

## Purpose and limits

Test whether a user-mode elevated executable can install temporary Windows Filtering Platform rules that permit its own loopback TCP client while denying a different, unelevated executable. No service or kernel driver is installed. No GGUF, GPU, remote PC, credential or existing application listener is used.

The dedicated diagnostic binds an exclusive IPv4 loopback socket to an OS-selected free port before installing filters. It listens only after installing the rules. The socket accepts no commands and runs no native inference parser. Rules cover only TCP connections to that exact loopback port, including the IPv4-mapped IPv6 address. The application-ID allow condition refers only to the diagnostic executable.

Build only this diagnostic into ignored `packages/core/out/network-guard-probe/`; do not rebuild or replace the existing ownership binding or runtime package. It is excluded from all ordinary desktop/native build and package paths.

## Control and evidence

The unelevated runner creates a unique, current-user-only named pipe before asking Windows to elevate the diagnostic. The closed diagnostic command accepts only a hexadecimal nonce and the runner PID. It verifies the pipe server PID before installing any filter and sends bounded JSON reports. The runner verifies the connected client PID against the retained elevated process before using the reports. No arbitrary path, port, executable or firewall operation is accepted by the diagnostic.

The normal probe sequence is:

1. The diagnostic reports whether elevation is available. An unelevated check must make no filter changes.
2. With UAC approval, create the harmless exclusive socket and a dynamic WFP session, install the narrow rules, and test its own connection.
3. Report the selected port. The unelevated runner tests IPv4 and IPv4-mapped IPv6 connections and expects denial.
4. On a fixed stop byte or loss of the control pipe, close the listener and end the dynamic session. Report cleanup only after checking that its filter IDs no longer exist.
5. Repeat with a new listener, then use a fixed forced-exit byte to terminate only the diagnostic itself. Confirm the retained process exited and an unrelated replacement listener/client can communicate on the same port within five seconds.
6. Preserve diagnostic evidence/source; never label a cancelled prompt or missing report as success.

All sockets, pipes, processes and WFP sessions need bounded waits and owned cleanup. The runner reports explicit failures. It must not weaken the machine's existing firewall configuration or remove any filter other than the diagnostic's own dynamic objects.

## What a pass does not prove

- Application-ID matching identifies an executable path, not a unique allowed process instance. Product startup must authenticate the owned elevated helper and restrict its operations.
- Dynamic filters disappear when their owning process ends. A native child might still be exiting then. This harmless single-process listener avoids that native-parser exposure, but a production design must separately prove safe ordering/default denial across helper crashes.
- Restricted runtime privileges, credential isolation, CUDA access, exact runtime compatibility and advisory containment remain untested.
- This check does not establish Task Manager grouping, a one-time UAC installation journey, or platform/release readiness.

Sources: Microsoft [WFP permissions](https://learn.microsoft.com/en-us/windows/win32/fwp/access-control), [dynamic sessions](https://learn.microsoft.com/en-us/windows/win32/api/fwpmu/nf-fwpmu-fwpmengineopen0), and [ALE filtering](https://learn.microsoft.com/en-us/windows/win32/fwp/application-layer-enforcement--ale-).

## Observed result

The isolated runner/build/source are `packages/core/scripts/probe-network-guard.ps1`, `packages/core/scripts/build-network-guard-probe.mjs` and `packages/core/tests/native/network-guard-probe.cc`. They are not referenced by ordinary native/desktop packaging.

| Check                       | Actual result                                                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Initial runner before build | Exit 1: missing diagnostic executable.                                                                                                                                                                       |
| Build                       | MSVC 14.44.35207, C++17, `/W4 /WX`; exit 0.                                                                                                                                                                  |
| Unelevated runner           | Executable exit 740, reported `filtersInstalled:false`; runner exit 0.                                                                                                                                       |
| Initial elevated run        | Own connection and IPv4 denial passed; normal filter-ID removal passed. IPv6 client failed with invalid-address context, so runner correctly exited 1 rather than claiming denial.                           |
| Correction                  | Enable dual-stack mode for the IPv4-mapped IPv6 test client. No denial assertion was relaxed. Add a second forced-exit round.                                                                                |
| Final elevated runner       | Exit 0, all assertions below passed.                                                                                                                                                                         |
| Round 1, port 56865         | Own client allowed. Unrelated IPv4 and mapped-IPv6 clients both received access denied. Both owned filter IDs absent after normal session closure.                                                           |
| Round 2, port 56869         | Own client allowed. Unrelated IPv4 and mapped-IPv6 clients both received access denied. Deliberate self-termination exited 12. An unrelated replacement IPv4 listener/client then communicated successfully. |
| Post-run process check      | Zero `network-guard-probe.exe` processes remained.                                                                                                                                                           |
| Static checks               | Focused clang-format, clang-tidy, build-script ESLint and Prettier all exited 0.                                                                                                                             |

An intermediate clang-format pass reordered Windows/WFP includes and caused compilation errors. Keeping WFP declarations after their required Windows headers corrected the build; the final build and native static checks passed unchanged warnings-as-errors settings.

Successful invocation used the bundled PowerShell 7 host to run `probe-network-guard.ps1 -Elevate`. The build used the repository's Node 24.21.0 and pinned MSVC tooling. No installed service, permanent filter, native inference runtime or remote machine was involved.

Artifact SHA-256 values for the successful run:

- Native source: `432FC1840160403E062A5957A1A3D9813A0D3C6FC9A241E0B9AB3CB621EDBDB5`.
- PowerShell runner: `C1A6BF0A0154755EEDE756B93024660C062652B74391A50BB4613FCAA1127078`.
- Diagnostic executable: `E180B8584A05AAE348598F17240D9AE681292E76FF7414C64A09C158FC76F935`.

A cleanup command included checks for the resolved workspace path and absence of a running probe, but automatic approval review rejected that command before execution as blocked by policy without a more specific reason. The earlier independent process check found no running probe. The compiler environment script, object file and executable remain in the ignored output directory (293,033 bytes total); no successful deletion is claimed.

This establishes that the filtering primitive can operate in an on-demand elevated process without a permanent ModelLoom service. It does not establish a production security boundary. In particular, automatic removal after helper termination cannot be treated as safe ordering relative to a separate native child's exit. That remaining case must be resolved before stock RPC is exposed through a product helper.

## Separate-worker diagnostic contract

The user authorized the next bounded diagnostic on 2026-10-20. `network-worker-probe.h`, compiled only through the existing isolated diagnostic source, adds a harmless socket-holding child and a simulated helper process. `probe-network-worker.ps1` is the separate runner; the original single-process evidence remains historical evidence for its earlier source hash.

The elevated test controller is an observer/recovery owner, not a proposed extra product service. It installs exact-port **static, nonpersistent** WFP filters, closes their creation session and verifies they remain. Unlike dynamic rules, these survive their creator's process/session exit. They last until explicit deletion or BFE/system shutdown; see Microsoft's [object lifetime documentation](https://learn.microsoft.com/en-us/windows/win32/fwp/object-management).

The observer launches a simulated helper into an owned kill-on-close Job Object at process creation. That helper launches its socket-only worker into a nested kill-on-close job, also at creation. Explicit inherited-handle lists exclude job/control handles from the worker. The observer captures the reported worker process and checks membership in its retained root job. No PID/name-wide termination is used.

Four scenarios run once per frozen diagnostic candidate:

1. Normal stop: tell the helper to stop; it signals the worker and waits for exit.
2. App-control loss: close the helper's control pipe; it stops the worker and waits for exit. This models app/core connection loss, not an actual Electron Quit test.
3. Helper crash: the simulated helper self-terminates without destructors; closure of its last job handle terminates its worker. The observer verifies both retained process handles signal.
4. Startup failure: create the worker suspended in its job, capture its identity, then abort before it is resumed or opens a listener. Do not label this scenario as successful readiness.

Before each scenario's teardown, the unelevated runner must receive access denied for both IPv4 and mapped-IPv6 connections. Except for the deliberately suspended startup case, an allowed observer connection must succeed. After process exit, the observer verifies both filter IDs still exist, explicitly removes only those filters, and confirms their absence. The runner then requires connection refused on that exact port. A separate sentinel process outside the tested helper/worker job must remain alive throughout; it is stopped explicitly at the end.

Error paths retain filters if owned-process exit cannot be confirmed. Filter installation uses a transaction so a partial IPv4/IPv6 installation cannot leave an unrecorded rule. The observer's root job provides cleanup for diagnostic descendants on observer loss; this is not proof of production recovery from BFE restart, observer death or a malicious runtime. No persistent filter, service, GPU use, RPC listener or remote access is included.

The fixture inherits elevation for this socket-only test. This is **not** an approved way to launch stock RPC; reduced-privilege native launch, credential/file isolation, executable-instance authorization and recovery of static filters after an owner crash remain required before product integration. Static rules favor denial after a crash but may leave a stale exact-port block until reviewed recovery removes it. Do not claim the elevated observer represents a complete single-helper architecture.

### Separate-worker results, 2026-10-20

The final runner exited 0. No model, GPU, native RPC, remote machine or installed service was involved. MSVC `/W4 /WX`, focused clang-format and clang-tidy checks passed. The existing build script's ESLint/Prettier checks passed. Ordinary app tests/builds were not rerun because this diagnostic is outside those entry points.

| Scenario                     | Port  | Observed outcome                                                                                                                                                                                                                                                                 |
| ---------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Normal stop                  | 56697 | Allowed observer connection; unrelated IPv4/mapped-IPv6 denied. Helper and worker exited; rules still present until explicit removal; sentinel alive. After rule removal, connection refused.                                                                                    |
| App-control pipe loss        | 56701 | Same assertions passed; this models control loss without claiming actual Electron Quit coverage.                                                                                                                                                                                 |
| Helper self-termination      | 56707 | Same assertions passed after helper exit 12 without destructors. Worker exit was confirmed through its retained process handle.                                                                                                                                                  |
| Failure before worker resume | 56711 | Worker was captured in the owned job but never resumed/listening. Unrelated clients were denied by the guard. Helper exited 21; worker exit, rule retention/removal, sentinel survival and connection refusal passed. No owned connection success is claimed for failed startup. |

The first new runner invocation against the previous executable timed out because separate-worker mode did not exist yet. After implementation the four scenarios passed. Error-path review then added transactional filter installation and a post-cleanup listener assertion. That assertion's two-second deadline expired on a closed port; a separate check found no listener and measured `ConnectionRefused` after 2074 ms. The corrected evaluator allows five seconds but still requires `ConnectionRefused`; access denial, success or timeout all fail. The final four-scenario run passed. No assertion was removed to make the result pass.

The final diagnostic binary SHA-256 is `88CC8F99059C5D11998CE9835FAC940E74AD81CEC34F2AE597E8CAB1D4F6340B`; main source `33CBF773A7F4D9626FAD1EF7546A55BB1AD6777C009E42603CA6D44C7DEEB62F`; separate-worker header `5FB7BD37400155B88AE23899F0C48E1773D86A530E3D22237FE33AD7F8A8DF49`; runner `59CFDCF69EACC4B39FD1C545914392128A7D33040F72D3E58B939DD2424E8E75`. The earlier hashes above identify the earlier single-process diagnostic, not this candidate.

A post-run process inventory found zero diagnostic/helper/worker/sentinel processes. Each round confirmed deletion of its exact static filter IDs. Generated executable/object/compiler artifacts and content-free test receipts remain under ignored output; no deletion retry was attempted after the previously recorded cleanup rejection. No credentials, user configuration or existing staged references were changed.

Accepted evidence is recorded through agent-churn-control for the exact binary, runner, requirements and OS identity; unchanged earlier results were reused rather than rerun. The only added reruns followed changed error cleanup or evaluator code. This is diagnostic lifecycle evidence, not completion of D03.

## Restricted launch and recovery follow-up, 2026-10-20

This follow-up supersedes the elevated-fixture limitation above for the new diagnostic candidate. It does not change the historical results or enable product RPC.

The simulated helper now launches its worker using `CreateRestrictedToken` with `DISABLE_MAX_PRIVILEGE | LUA_TOKEN`, restricting Users/Everyone SIDs, medium integrity and `CreateProcessAsUserW`. The actual child token must report restricted, unelevated and at most medium integrity. An isolated window station/desktop allows this token to start without granting access to the interactive desktop. Failure never falls back to an elevated worker.

The helper creates an empty synthetic file accessible only to its user and SYSTEM. The resumed fixture must receive `ERROR_ACCESS_DENIED` when reading it. No real credential is used. Delete-on-close removes this canary on owner exit/crash. This proves one file-denial case, not comprehensive credential isolation. The diagnostic desktop and default object DACL grant Users access and require tighter review before product reuse.

Recovery opens a new WFP session, verifies both recorded rules' exact port, application ID, loopback address, TCP protocol, layer and block action, then deletes them transactionally. It refuses recovery while an owned process is alive, while the owned job is nonempty, or when the expected port differs. Closing the original WFP session does not remove the static nonpersistent rules. The simulated helper crashes without destructors; a surviving diagnostic observer confirms child termination before recovery. This is fresh-session recovery using retained process/job handles and in-memory rule IDs. It does **not** establish durable recovery after every observer/helper dies or after an app restart.

The first new assertion rejected the previous elevated fixture as intended. Restricted startup initially failed in the Windows loader; a private desktop and access to public Windows resources resolved this. No elevated fallback was added. Recovery then exposed a real ordering issue: process handles can signal before job accounting reaches zero. The corrected code retains the guard until the whole job is empty.

The four-scenario restricted run exited 0: normal stop on port 64278, control loss on 64282, helper crash on 64290 and suspended startup failure on 64295. Every child token passed the restriction checks. All resumed fixtures were denied the private canary; startup failure truthfully reports that check as not exercised. Owned connections, unrelated IPv4/mapped-IPv6 access denial, rule retention, live/mismatched recovery rejection, fresh-session removal, sentinel survival and post-cleanup connection refusal passed.

### Bounded stock RPC handshake

`stage-network-rpc-probe.mjs` copies a fixed CPU-only subset into ignored diagnostic output, checking source and destination hashes against the existing local development inventory. The existing stock RPC executable hash must be `f530f12b421e5966fe04fccf7def04441b796d34480a83f0f59f60061d1d4e09`. This is diagnostic hash checking, not a new signed production RPC package or fresh TUF verification. The existing candidate directory and its ACLs are unchanged. The copy totals 3,575,712 bytes; no large CUDA DLLs or model weights are copied.

`network-rpc-probe.h` launches only that fixed stock executable with CPU, one thread, loopback and an OS-selected guarded port. It uses the same restricted token, private desktop and kill-on-close job. Before sending protocol bytes, the probe checks the actual listener's address/port/PID against the retained child. The guard is installed before launch. The only native commands are HELLO and DEVICE_COUNT at [upstream pin 4f31296](https://github.com/ggml-org/llama.cpp/blob/4f31296a907d73f3409f720429bcf31111615d77/ggml/src/ggml-rpc/ggml-rpc.cpp); zero transport capabilities select TCP. There are no tensor allocations, graphs, cache writes or inference requests.

The runner `probe-network-worker.ps1 -RpcSmoke` exited 0 on port 55475. It observed restricted stock RPC, protocol 7.0.0 and one CPU device. Unrelated IPv4/mapped-IPv6 clients received access denied. Live recovery and mismatched-port recovery were rejected. The owned job was terminated and confirmed empty before fresh-session rule removal. The exact port then returned connection refused. This is the first real stock RPC launch in this diagnostic; it is not a GPU, WAN, desktop sharing or output-equivalence result.

Remaining product gates include owned-instance endpoint authorization, protected identity storage, authenticated peer transport, verified RPC packaging, CUDA compatibility and durable crash recovery. Application-path filtering does not distinguish another process running the same allowed executable. The diagnostic remains outside normal app/native packaging, with no permanent service or persistent WFP rules.

### Final candidate verification

After adding the fixed stock-RPC launch path, the shared worker-launch code was rebuilt and all four lifecycle scenarios rerun: ports 55521 (normal), 55525 (control loss), 55531 (helper crash) and 55537 (startup failure), all passed with runner exit 0. The stock-RPC smoke then passed again on port 55541 with exit 0. MSVC warnings-as-errors, clang-tidy, clang-format dry-run, and focused JavaScript ESLint/Prettier checks passed. Formatting initially reordered dependent diagnostic headers and caused a build failure; an explicit include boundary corrected it before the successful rebuild and final runs.

Final SHA-256 values: executable `C7FAF86580BD7D587C893718FD85147B670D157E8AF11BC64349786EB119C0C7`; main source `62B457AA76A36538C5A4E07983E3F45657E65A3B5007E8B95070AE27671CB835`; worker header `5C66B522AE287515C8E8125A398634349F32294FEF29414155968B2D40D79A01`; RPC header `2B343B79C53B052FC1550F584AFD38A7751508E316FC72DDED00358856F8E032`; runner `A22C28C5034AAC067A0745FFC78A39BD1F4D82F74B5B2CD0AEB18BF0A7A421E7`.

Post-run inventories found no `network-guard-probe` or `ggml-rpc-server` process and no generated private canary. Each successful round confirmed deletion of its exact owned filter IDs. Ignored build/staged diagnostic assets remain; the previously rejected generated-artifact cleanup was not retried. No commit or push was performed.
