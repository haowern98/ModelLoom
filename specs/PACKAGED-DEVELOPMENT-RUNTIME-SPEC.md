# Packaged Windows development runtime

**Date:** 2026-10-14

**Status:** Approved by the user on 2026-10-14, followed by PROCEED for implementation and testing. No packaged runtime acceptance is claimed. Private signing, production activation and publication remain separate operations.

## 1. Purpose and scope

Provide a separately built Windows x64 development package that runs the existing verified Bonsai runtime without requiring the source checkout, a terminal, a user-installed Node runtime or compilation by the user. This enables evidence for packaged process presentation, native loading, request isolation, shutdown and recovery. It retains the existing GUI/main/utility/native-engine separation.

Preserve [ADR-0004](decisions/0004-runtime-lifecycle-proposal.md), [ADR-0005](decisions/0005-local-generation-development.md), [ADR-0006](decisions/0006-model-configuration-and-local-api.md), [runtime development custody](../docs/runtime-development-custody.md), [API behavior](API-SPEC.md), [UI requirements](UI-SPEC.md), [security requirements](SECURITY-SPEC.md) and [testing requirements](TESTING-SPEC.md). Production trust, independent updates, distribution, other platforms and inference equivalence retain their separate gates.

The current ordinary package disables runtime dependencies through `app.isPackaged`. Forge's `preStart` builds the workspace development host, but packaging does not stage or activate it. The 2026-10-14 package smoke report under `packages/core/out/activation/b11306/evidence/PACKAGED-WINDOWS-REPORT-20261014.md` records navigation and normal shell exit only. This proposal supplies the missing development packaging contract; it does not reinterpret that report as runtime evidence.

## 2. Approach

| Option                                       | Consequence                                                                                                                                       | Recommendation                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Explicit, self-contained development package | Stages reviewed code and verified runtime inputs; supports relocation and isolated local testing. Requires packaging and path-resolution changes. | Selected proposal.             |
| Package that discovers this workspace        | Smaller initial change, but depends on ambient paths and developer tooling and cannot establish self-contained package behavior.                  | Reject.                        |
| Enable ordinary production packaging         | Requires production custody and release decisions beyond this test scope.                                                                         | Defer to the release contract. |

The implemented development command is `package:development`, distinct from `package` and `package:demo`. Only its explicitly selected build compiles packaged development activation into the desktop and enables the matching compiled core development policy. No runtime environment variable, command-line option, presence of a marker file or renderer command may turn an ordinary build into a development build. Ordinary packaging regenerates disabled policy and cannot reuse enabled compiled output from a prior development build.

The development executable/product name is `ModelLoom Development`, with a separate output directory. Preserve the supplied application layouts and controls. Development identification must not require a screen redesign. This is a local unpacked development artifact, without an installer, OS code-signing claim or release publication.

## 3. Packaged resources and authority

Use a fixed main-selected resource root below Electron's `process.resourcesPath`. The proposed staged tree is:

```text
resources/
  app.asar                         desktop main, preload and renderer
  modelloom-development/
    core/
      package.json                 explicit ESM boundary
      out/                         required compiled core modules
      scripts/utility-entry.cjs    fixed utility entry
      assets/development-root.json public root only
      out/native/ownership.node    main-owned Windows broker
      out/native/history.node      utility-owned storage/DPAPI binding
    licenses/                      licenses for bundled production dependencies
    bootstrap/
      repository/                  signed public metadata and inventory
      candidate/                   exact inventory-listed engine/helper/dependencies
```

This is a packaging layout, not a new generic runtime path API. Main resolves the fixed core entry and trusted asset locations. Existing relative references in the utility entry, verifier and native loaders must resolve within this tree after relocation; narrow internal path changes may be needed. Do not expose executable, repository, trust-root, storage or native-module paths through IPC. Do not ship duplicate workspace directories solely to satisfy accidental relative paths.

Keep executable/native files and the external core outside ASAR so they have real paths for loading, process ownership and file locking. The two fixed core entry graphs bundle their production JavaScript dependencies using the already installed build tool; native bindings, the fixed utility entry and public root retain their existing relative layout. Preserve the pinned TUF client and its required dependency closure, including used subpath imports and license notices. App resources are read-only inputs after build; verifier caches, installation receipts and databases never write there. A missing module must fail visibly without searching global modules or falling back to the checkout.

Stage from a fresh allowlisted directory. Include only the compiled production dependency graph, fixed utility entry, two required native bindings, public development root, signed repository and the exact expanded runtime inventory. Do not copy the entire `out` directory. Exclude private keys, publisher tooling, fixture hosts/binaries, models, databases, credentials, logs, evidence, tooling downloads, caches and unrelated source/build files. Fail packaging on missing or unexpected staged files. Retain required license notices from the approved distribution; do not trim the signed inventory to save space.

The public development root remains pinned to SHA-256 `fa142094d12daccc01f8888051e97b6366d43c71f4e18583fa69c91734969f15`. Runtime inputs remain artifact `b11306-cuda12.4-msvc14.44-dev1`, upstream commit `4f31296a907d73f3409f720429bcf31111615d77`. `ModelLoom-runtime-host.exe`, `llama-server.exe` and every dependency must match the signed inventory. Build provenance must record the desktop/core revision and dirty status, lockfile hash, Electron version, native build inputs and staged file hashes. The artifact manifest documents this local build; it is not a substitute for runtime signatures or an OS signature.

## 4. Writable state and activation

Separate trusted read-only bootstrap locations from writable deployment locations in the internal development-host contract. The current single `base` argument combines repository/candidate inputs with cache/install output and cannot be used unchanged against read-only resources.

- Runtime verification state and fresh version installations: `%LOCALAPPDATA%\ModelLoom-Development\runtime\`, with separate `desktop-verification` and `installed` children. Preserve native private-directory checks and existing install/file-lock protections.
- Protected Chat/configuration/key profile: `%USERPROFILE%\.modelloom-packaged-development`, derived by trusted main through the existing home-path mechanism. Reuse the existing fixed database purposes, identity/DACL guards, schema checks and DPAPI protection.
- Chromium application data: `%LOCALAPPDATA%\ModelLoom-Development\chromium`, configured before browser/session initialization. It is separate from protected core storage.

These are proposed fixed development locations. Do not read or migrate the current `%USERPROFILE%\.modelloom` profile. Do not silently reset cached metadata floors, repair databases, overwrite installed versions or delete a prior test profile. Reject overlapping active ownership rather than allowing competing writers; test a second instance. Rebuilding or moving the package must retain the same test profile and verification floors for this Windows user.

At startup, main may create the contained utility for history/configuration. The engine remains stopped until explicit import and Run; the public API never autostarts. Before engine launch, verify the signed local repository, expiry and rollback floors; install the exact inventory into a fresh protected version directory; inspect/lock the selected GGUF; check the reviewed resource report; and prove owned authenticated readiness. Missing, altered, expired, incompatible or insufficient-resource inputs must leave activation unavailable with an actionable safe error, without unsigned fallback or quality reduction. Preserve readable history when the failure only concerns engine activation; do not claim runtime readiness from history availability.

Build/startup never signs, renews metadata, regenerates trust or accesses the publisher store. Expired metadata blocks activation. Any required renewal is a separate explicitly authorized publisher operation under the existing custody contract. This document authorizes no such operation.

## 5. Native compatibility and inference behavior

Build against the repository's pinned dependencies, currently Electron 44.5.1 and build-tool Node 24.21.0 within the supported major version. The package uses Electron's embedded runtime. Demonstrate that both Windows x64 native bindings load in their actual main/utility processes and that utility `node:sqlite`, DPAPI, retained directory guards and job ownership work. A successful load under standalone Node or Forge development alone is insufficient. Do not assume Node header compatibility proves Electron compatibility; do not change toolchain/dependency pins without recording and reviewing the need.

The model remains user-selected and outside the package: approved standalone Bonsai-27B-Q1_0 GGUF, SHA-256 `71d6871836886267f39f1ac69b1b1dd8a783970708d7a189960112ed02978901`. Import remains session-only. After restart, the library is empty until reimport; the same verified digest recovers saved defaults and first-import identity. Completed Chat history and protected API key persist in the isolated profile. No automatic engine reload, persistent model-path registry or copying of the user's original model is added.

Preserve the approved four-slot profile, 7,680 context tokens per slot, 512-token output ceiling, full GPU offload and existing cache/sampling behavior. The reviewed GPU/resource tuple remains machine-specific; this package is not permission to run an unreviewed GPU or silently select a different model, backend, context or quantization. Current preflight must pass before every admitted load. Product smoke results do not establish inference equivalence or a throughput benchmark.

The user subsequently requested lower RAM admission on October 14. The four-slot
host allowance is now 4 GiB, with complete cache/checkpoint reserves retained:
6,500 MiB (6.35 GiB) physical RAM and the existing 5,579 MiB VRAM. Boundary tests
and a fresh bounded four-slot run support this revision. Model settings remain
unchanged; resource observations do not guarantee native allocation.

The key-required public API remains on `127.0.0.1:8000`, with explicit Start, the existing Host/Origin/bounds checks and no automatic alternate port. The private native port remains owner-selected at the existing fixed 18478; a conflict fails safely. Neither listener is exposed to the network. No new key creation or rotation is implicit in this documentation task.

## 6. Ownership, shutdown and recovery

Main retains the exact deployment capabilities. The utility performs policy/storage/generation; the separate helper/server stay in the existing owned containment. Window X performs full Quit, while minimize leaves the deployment running. Quit closes admission, resolves/cancels active and queued requests, stops the public listener, requests graceful native shutdown, escalates only after the existing bounded deadline and confirms owned exits and credential cleanup. Acknowledged shutdown alone does not pass.

Abnormal main/utility exit must not orphan owned engine/helper processes. Preserve unrelated or independently launched deployments. Never locate shutdown targets by executable name. Test startup/loading/ready/generating/queued transitions and Quit races. Record graceful stop and forced escalation separately, including exact captured process identities and deadlines.

Engine failure preserves partial output as interrupted, does not label it complete, and leaves the GUI usable. Controlled termination establishes failure handling only. A genuine native fault requires separate evidence; fixture faults must be labeled synthetic and cannot substitute for an ordinary native crash. Recovery is explicit and bounded, with fresh verification/preflight, and must not silently resume interrupted work or duplicate history. Do not introduce a public or renderer-accessible crash command.

The 2026-10-14 user decision preserves the original `llama-server.exe` name and allows its own Task Manager row outside ModelLoom. Grouping is no longer a gate. Verify actual server/helper paths, captured ownership, cleanup and absence of a visible console on the packaged artifact. Do not rename launch copies for grouping or infer cleanup from parent PIDs. Report unavailable presentation checks honestly without bypassing privilege boundaries.

## 7. Acceptance checklist

The checklist remains the acceptance contract. The October 14 reports under
ignored `packages/core/out/activation/b11306/evidence/packaged-development-20261014`
must be read in order: `PACKAGED-DEVELOPMENT-REPORT.md`,
`CONTINUATION-REVIEW.md`, then `ORIGINAL-PATHS-RESTORED.md`. The old grouping failure
is superseded by the user's decision allowing separate original process rows.
The former credential-file cleanup gap is addressed by the private pipe; native
and actual packaged startup/owner-death checks pass. The latest loaded-model
check also passes real Chat, normal unload, reload and owner death during loading
with the pipe and original filenames. First-run and P06 coverage
reconciliation are complete with recorded test-host qualifications. An ordinary
native fault remains unverified. Earlier clipboard, loaded utility-death and
real-model checks retain their original scope. The staging-lint and test-cache
cleanup findings are fixed. The first low-memory live attempt was refused by the
unchanged preflight. After freeing memory and correcting the test's launcher-PID
selection, the complete live check passed. Broader API/security/release acceptance
retains its separate limits. Current
review results and remaining live acceptance limits are recorded in
[the follow-up review](../docs/LOCAL-API-REVIEW-2026-10-14.md).

| ID  | Required check and result                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P01 | Build ordinary, demo and explicit development profiles in both relevant orders. Only explicit development has runtime authority. Ambient environment, marker files and retained enabled build output cannot enable ordinary packaging.                                                                                                                                                                      |
| P02 | Audit staged files, hashes, dependencies and licenses. No publisher/private material, user data, model, fixture authority or workspace tooling ships. Missing/unexpected files fail packaging.                                                                                                                                                                                                              |
| P03 | Copy to a separately named path containing spaces and launch from another working directory with developer environment variables removed. Prove every core/native/dependency/bootstrap path stays under staged resources and every write stays under the proposed state roots. The approved external GGUF is the sole intentional model input. Do not move/delete the source checkout to conduct this test. |
| P04 | Load ownership binding in main and history/DPAPI binding plus SQLite in utility. Verify real file/ancestor guards and core/engine ownership on the packaged processes. No visible terminal.                                                                                                                                                                                                                 |
| P05 | On a new isolated profile, open all relevant pages; history is empty, library connected but empty, engine stopped, API stopped and no key present. Current development data remains unchanged.                                                                                                                                                                                                              |
| P06 | Reuse rejection tests for wrong root, changed inventory/dependency, expired/replayed metadata, backwards clock, unsafe paths and missing native/dependency inputs. Test mutations use disposable copies only and launch no unverified engine. Retained verification floors survive relaunch/rebuild.                                                                                                        |
| P07 | Reject hard-linked/unsafe GGUF and resource shortage with safe feedback. Import approved standalone model and Run after successful preflight; verify exact engine/build/model readiness and actual profile.                                                                                                                                                                                                 |
| P08 | Complete real Chat with separate thinking/answer and accurate terminal state. Stop, Retry and late events preserve caller isolation and existing history semantics.                                                                                                                                                                                                                                         |
| P09 | After separately authorized creation of an isolated test key, explicitly Start API. Verify authentication, model listing, JSON/SSE/usage, invalid requests and bounds. Secrets never enter evidence.                                                                                                                                                                                                        |
| P10 | Disconnect an API stream while Chat is generating; Chat continues, a subsequent API request succeeds, and no unintended engine restart occurs. Retain deterministic writer-rejection regression evidence separately from live socket-disconnect evidence. API Stop leaves Chat usable.                                                                                                                      |
| P11 | Save supported defaults, complete a test Chat, stop API and Quit. Relaunch with no automatic API/engine start. History/key/defaults persist; model import does not. Reimport same model to recover digest-bound defaults and start API using retained key.                                                                                                                                                  |
| P12 | Verify original server/helper launch paths, exact captured ownership and no visible console. The server may appear outside the ModelLoom app group; no renamed launch copies are permitted.                                                                                                                                                                                                                 |
| P13 | Quit while idle, preparing/loading, generating and queued, including transition races. All captured owned processes/listeners and temporary native credentials exit/clean up within recorded bounds. Preserve unrelated test deployment.                                                                                                                                                                    |
| P14 | Verify bounded hung-engine escalation and abnormal main/utility exit cleanup. Use a reviewed disposable fixture for the hang if necessary; label fixture evidence and retain actual packaged native-engine abnormal-exit evidence separately.                                                                                                                                                               |
| P15 | Controlled captured engine termination produces interruption and usable GUI. Explicit recovery succeeds after fresh checks. Separately record an ordinary native fault if available; without it, native-crash acceptance remains open.                                                                                                                                                                      |
| P16 | Second-instance/storage-lock failures are actionable, do not change protected records or reset trust, and do not terminate the existing deployment. Port conflicts never change ports or take over another listener.                                                                                                                                                                                        |
| P17 | Ordinary package still opens safely with runtime disabled after development packaging. Full tests/typechecking and relevant native/package checks pass on the final code. Inspect actual results and reconcile failures; demo-only smoke tests do not cover the live artifact.                                                                                                                              |

## 8. Evidence and next gate

Keep local reports under ignored package-test output. Record source revision/dirty files, build command and exit result, tool versions, artifact/staged hashes, OS/driver/resource snapshot, test configuration, process identities, terminal outcomes and remaining gaps. Exclude keys, credential headers/files, private model paths and existing user conversation content. Use dedicated harmless test prompts. Fixture, real native, UI, process and hosted CI evidence must remain distinct.

The user approved this contract and its implementation/testing scope. The local plan records focused tasks and validation. No new product library, runtime pin, signing-root operation, profile migration, persistent model registry or release channel is approved by this contract. Independent security review and full release readiness remain open even if every development package check passes.
