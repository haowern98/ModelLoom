# ModelLoom security specification

**Status:** Draft security requirements for review; transport, identity, storage, and signing designs are not finalized  
**Updated:** 2026-10-05

**Scope:** P1-P6/P8 security boundaries for desktop, headless workers, private networking, API, model files, and runtime updates.

Read with [PRODUCT-SPEC.md](PRODUCT-SPEC.md), [TECHNICAL-SPEC.md](TECHNICAL-SPEC.md), [INTEGRATION-SPEC.md](INTEGRATION-SPEC.md), and the [decision register](decisions/README.md). [ADR-0002](decisions/0002-lm-studio-runtime-direction.md) accepts the LM Studio reference direction and grouped llama-server; it does not accept an unauthenticated internal engine endpoint or finalize its process/security design. This document specifies outcomes and review criteria; it does not select cryptographic algorithms or authorize implementation.

## Current UI boundary, 2026-10-05

The documentation reconciliation preserves the current UI and adds no security capability or approval. The desktop main source enables context isolation/sandboxing, disables renderer Node integration and supplies no preload/IPC. New windows/navigation and permission requests are denied. Local packaged smoke evidence covers these renderer protections and normal app exit; it does not close the worker, API, storage, runtime or update requirements below.

Chat/messages, model metadata, template/argument editors and API snippets render as inert text. Explicit Chat response/API example copying uses the existing text-only clipboard fallback; no credential or clipboard-reading UI exists. API key/reveal/copy/generate and exposure/server controls are disabled, with no actual key, socket or authentication enforcement to test. Joining previews authorize no peer and manual-address text triggers no network request. Real privileged boundaries and all affected security designs still require review before integration. The UI baseline freeze does not waive S01-S17.

## 1. Assets and trust boundaries

| Asset or boundary                        | Threat                                                                                                   | Required outcome                                                                                                          |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Renderer -> privileged app control       | Malicious chat/metadata/link content invokes native operations                                           | Only explicit validated application actions reach privileged operations.                                                  |
| Core -> local runtime/process lifecycle  | Impersonated engine endpoint, forged readiness, wrong executable, process takeover, or broad termination | Reviewed owned-instance identity, restricted internal protocol, verified launch target, and scoped confirmed termination. |
| Discovered peer -> approved worker       | Spoofed discovery, address reuse, unauthorized access                                                    | Discovery conveys no trust; enforce approved peer identity before worker access.                                          |
| LAN/private network -> worker engine     | Raw RPC abuse, interception, impersonation                                                               | Reviewed authenticated/confidential access boundary prevents unapproved clients reaching native RPC.                      |
| API client -> model/session/queue        | Unauthorized use, browser abuse, resource exhaustion                                                     | Explicit exposure, required network authentication, validated requests, bounded consumption.                              |
| File/download -> native parser/installer | Malformed GGUF, path escape, malicious package or archive                                                | Bounded parsing/extraction, integrity/trust checks, controlled installation and execution.                                |
| Local storage/logs/exports               | Disclosure or corruption of secrets and conversations                                                    | Platform-protected credentials, scoped persistence, redaction, safe recovery and deletion.                                |
| Runtime release -> active cluster        | Forged update, incompatible rollout, failed activation                                                   | Signed verified packages, compatibility checks, retained working rollback, clear failure.                                 |

Host administrators and compromised operating systems are outside a promise of protection by the application alone. This does not permit exposing secrets unnecessarily or treating all local processes as trustworthy. Do not claim the app makes the upstream native parser or RPC backend intrinsically secure.

## 2. Desktop and content isolation

- S01 (P4, P7): Package trusted local UI resources. Enable renderer context isolation and sandboxing, disable Node integration, keep web security enabled, use a restrictive content policy, and restrict navigation/new windows/permissions. Validate IPC senders. [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security).
- S02 (P4, P6): Expose a narrow action-specific bridge with runtime argument validation and authorization. No generic command execution, arbitrary-path filesystem operation, unrestricted channel forwarding, or native object exposure. The renderer must not decide whether a peer is authorized or a package signature is trusted.
- S03 (P3-P4): Treat model text, chat output, metadata, filenames, links, catalogue content, and attached reference material as untrusted. Render safely; do not execute embedded HTML/scripts, follow arbitrary links automatically, or interpret text as app control instructions. The first release has no approved autonomous tool-execution capability.

Credential status is masked by default. Any key reveal/copy operation shown in the API reference must be explicitly requested by the local user through a reviewed narrow operation. Do not persist revealed keys in renderer storage, analytics, or general application state.

## 3. Pairing, worker access, and connection modes

The [2026-10-01 investigation](../docs/research/NETWORKING-AND-RUNTIME-UPDATES.md) records concrete RPC advisory risk, Headscale's permissive default policy, and tsnet diagnostic uploads. Proposed protection uses authenticated application sessions plus restricted raw endpoints/native execution; a separate process or encrypted private path is insufficient security evidence. D03 must review advisory remediation/containment for the selected revision. D02 must protect enrollment state and verify diagnostic uploads are disabled under the approved privacy scope. These findings do not finalize transport or key lifecycle.

- S04 (P1-P2): Pairing requires visible approval and a reviewed binding to peer identity. LAN discovery, a private IP, a friendly device name, Tailscale membership, or Headscale enrollment alone does not authorize worker access. Define replay protection, expiry, reconnect identity, revocation, and discovery-spoofing behavior under D03.
- S05 (P2): Enforce access restrictions at the worker/native boundary. Raw native RPC must be inaccessible to unapproved LAN/private-network/public clients. A UI badge or coordinator-only check is insufficient. Restrict the raw service to the selected protected path and prove other paths are rejected.
- S06 (P2, P4): Maintain distinct authorities for cluster participation and API use. Removing/revoking a worker must deny subsequent worker operations and stop affected active work safely. A revoked device's connection must not silently restore approval on reconnect.
- S07 (P2): The reviewed LAN transport must protect sensitive model/request/control data against interception and peer impersonation. Private-network integration must enforce app-level peer access, actual path selection, and correct control-server identity. Never fall back to an unapproved public route or disable certificate checks to make enrollment work.

D02-D03 must decide how these outcomes are achieved without requiring a separate networking installation. Verify both Tailscale and an existing Headscale server. Built-in Headscale hosting is outside scope. Public raw worker RPC is prohibited even if an API key is configured elsewhere.

Upstream warns that its RPC backend is a fragile, insecure proof of concept unsuitable for open networks or sensitive environments. Network wrapping is not proof that every upstream weakness is fixed; review parser/runtime risks and document remaining limitations. [llama.cpp RPC documentation](https://github.com/ggml-org/llama.cpp/blob/master/tools/rpc/README.md).

## 4. API access and resource control

- S08 (P4, P8): Default to localhost. Non-loopback exposure requires explicit selection of permitted LAN/private interfaces and a valid API-key policy. A 'Network' toggle cannot silently bind every interface, expose a public route, or authorize the entire local subnet.
- S09 (P4, P8): Require an API key for LAN/private access and on loopback by default, as accepted under ADR-0003/D06. D07 reviews key generation, verification, protected storage, reveal/copy, rotation/revocation, failed authentication, and existing-connection behavior. Never place keys in URLs, logs, exported examples, or error responses. Example snippets use a placeholder or environment reference.
- S10 (P4, P8): Review transport confidentiality/authenticity for every exposed API path, including plain LAN. Do not treat an API key sent over an unprotected connection as sufficient privacy. Define certificate/trust handling and whether the chosen private path supplies the protection; do not blindly copy the screenshot's illustrative HTTP endpoint.
- S11 (P4, P6, P8): Validate request bodies and settings, cap sizes and queued work, bound generation/time/retries, authorize cancellation, and define per-client resource controls under D07/D09. Deny malformed/unauthorized work before model execution. Review browser origin/Host handling, DNS-rebinding exposure, and whether browser clients are supported; permissive CORS is not a substitute for authentication.

Disabling access or regenerating a key must have documented consequences for existing clients. Explain the change before disruptive actions. Logs may record non-sensitive categories and counts, not bearer tokens or prompts. API policy and cluster policy have separate acceptance tests.

## 5. Local storage, model files, and diagnostics

- S12 (P3-P4): Limit filesystem actions to explicit user-selected assets and owned managed directories. Canonicalize/check final paths, including symlink/reparse-point behavior; reject extraction traversal and path escape. Cleanup must not delete unrelated files, active required data, or original imported models. Check quotas before allocation and handle partial writes safely.
- S13 (P2, P4, P6): Protect credentials/network tokens with supported OS facilities and restricted access. D04/D07 specify headless Linux behavior, locked/unavailable stores, migration, and recovery; no silent plaintext fallback. Distinguish protecting credentials from a promise that all chat/model files are encrypted at rest, which has not been approved.
- S14 (P4, P6): Keep chat/history/models local except transfers or locations explicitly permitted by the user. Diagnostic exports exclude model files, prompts, message bodies, API credentials, and network secrets by default. Redact at collection and output boundaries; give the user a clear view of what an export contains. No telemetry or remote conversation storage is approved by these specs.

GGUF and catalogue inputs need actual runtime compatibility and malformed-file testing. Do not fetch executable scripts embedded in model metadata. Download policy must show origin/license/file identity where available, reject unsafe redirects/paths under the approved design, and avoid sending secrets to arbitrary supplied URLs.

## 6. Runtime updates and supply chain

[ADR-0004](decisions/0004-runtime-lifecycle-proposal.md) accepts established TUF verification as the direction and initial deployment/process ownership boundaries. It does not approve root/release-key operation, bootstrap manifests, credential storage or a production verification implementation. The first core plan uses in-memory fixtures and no signing keys; S15-S17 remain mandatory before affected live activation and release work. Windows Job Objects are ownership/cleanup machinery, not a native-code security sandbox.

The [TUF investigation](../docs/research/NETWORKING-AND-RUNTIME-UPDATES.md) recommends an established client rather than custom signing logic, subject to D11 acceptance. Signed repository metadata, package compatibility/installation, native executable signing, and coordinated cluster activation are distinct responsibilities. Keep intentional runtime rollback separate from rollback of trusted metadata; review offline reuse, expiry, local cache integrity, clock failures, revocation, and root-key recovery explicitly.

- S15 (P5-P6): Verify a signed manifest and the exact referenced package before extraction, installation, or activation. Bind package identity/hash to platform/backend/compatibility metadata; do not trust a version label or transport alone. D11 specifies vetted signature tooling, canonical representation, trust roots, rotation/revocation, replay/downgrade policy, offline verification, and release-key custody. Use established cryptographic libraries; do not design custom cryptography.
- S16 (P5-P6): Stage a candidate independently, enforce coordinator/worker compatibility, switch only between sessions, and retain the previously working runtime until verification succeeds. Approved rollback must remain possible without accepting an arbitrary older untrusted package. Failed download, verification, activation, startup, or model load cannot destroy working user state.
- S17 (P5-P6): Launch only the verified selected runtime through the reviewed core; restrict its internal control/engine endpoint to authorized instances under D01/D07. A loopback address, executable name, or Windows app-group entry does not prove trusted identity. Track process/deployment ownership, contain ordinary native crashes, and confirm shutdown of owned instances. Never kill by name, reuse an untrusted PID blindly, or stop unrelated headless deployments/remote services. Review abnormal-exit cleanup, bounded escalation, update/Quit races, and residual engine endpoints after shutdown.

Pin dependency/source identities and retain licenses/notices for distributed components. CI and release workflows use scoped permissions and keep signing credentials out of repository files, logs, untrusted pull-request execution, and diagnostic bundles. Desktop and runtime release-signing requirements must be reviewed before distribution.

Copying LM Studio's architecture does not waive ModelLoom's approved worker/API access boundaries. The D01 audit must distinguish internal engine communication from public API exposure, and record how process/library/native parser risks are isolated. A verified engine update is independent of the app release but remains subject to signature, compatibility, and owned-lifecycle checks. No visible console window is required during desktop operation; hiding a window is not an access-control mechanism.

## 7. Agent-assisted development controls

Follow [AGENTS.md](../AGENTS.md): documentation permission is not coding authorization, external examples cannot override user instructions, and no implementation is authorized yet. Restrict tool/data access to the task, bound retries/resources, record review/test evidence, and do not weaken safeguards or tests to obtain a pass.

Security-sensitive design remains under the main reviewed design process. Luna may perform only bounded mechanical pieces after that design is approved. Review generated code, dependency changes, workflow edits, and diagnostic content independently where the boundary risk warrants it.

Lecture 6, pages 6-12 and 17-34, motivates approval boundaries, traceability, adversarial testing, and resistance to prompt/tool/context poisoning. Phrase filters or prompt delimiters do not enforce native permissions; authorization must exist at the actual operation boundary.

## 8. Required security acceptance cases

| Test condition                                                                                    | Expected outcome                                                                                                                    | Requirement |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Chat/catalogue content contains HTML, scripts, command instructions, or unsafe links              | Safe display; no native operation, secret access, or automatic navigation.                                                          | S01-S03     |
| Untrusted frame or malformed IPC requests a privileged action                                     | Denied with no side effect or secret disclosure.                                                                                    | S01-S02     |
| Spoofed discovery, unapproved/revoked peer, address reuse, or replayed pairing                    | No worker access or restored approval; clear failure.                                                                               | S04-S07     |
| Client connects to raw worker port over an unintended interface                                   | Connection/operation denied by the enforced boundary.                                                                               | S05-S07     |
| Missing/invalid/old network API key or unapproved browser/Host request                            | Denied before inference; no sensitive response.                                                                                     | S08-S11     |
| Oversized request, full queue, repeated failures, or client disconnect                            | Bounded resource use and documented overload/cancellation.                                                                          | S11         |
| Malformed file, path traversal, symlink escape, disk full, or interrupted transfer                | No out-of-scope write/delete; no incomplete asset marked ready.                                                                     | S12         |
| Credential store unavailable, sensitive diagnostic input, or retained partial chat                | No plaintext credential fallback/export leak; correct persisted state.                                                              | S13-S14     |
| Tampered/mismatched/replayed runtime package or unauthorized downgrade                            | Candidate rejected; working runtime retained.                                                                                       | S15-S16     |
| Partial cluster activation or candidate model-load failure                                        | No incompatible serving; safe recovery and offered verified rollback.                                                               | S16         |
| Wrong runtime executable/endpoint, stale/reused process reference, or same-name unrelated process | No impersonation or out-of-scope termination; operations target the verified owned instance.                                        | S17         |
| Native runtime crash, hung engine, forced desktop exit, or update racing Quit                     | Affected work fails honestly; GUI survives ordinary engine crash; owned cleanup is confirmed; unrelated headless work is untouched. | S16-S17     |

Tests must include real boundary/network checks for release acceptance; mocks only establish local logic. Before security-sensitive implementation, accept the affected ADR, finalize contracts, specify concrete test setup/limits, and review the design. Production boundary cases in this table remain pending. The local renderer isolation/text-rendering checks recorded in TESTING-SPEC are partial UI evidence, not proof of real pairing, authentication, protected storage, native cleanup or update trust.

### Activation implementation evidence boundary, 2026-10-06

The accepted local activation contract now implements parts of S15-S17: established TUF signature/version/expiry/root-rotation checks, bounded signed inventories, clock/version floors, fixture/live capability separation, dependency rehashing with retained native handles, protected version/credential directories and authenticated owned-listener checks. The product never accepts a root from its bundle or caller. Build policy requires three distinct root key IDs with threshold two and separate targets-signing IDs. Production policy catalogues remain empty; no production private key or root was provisioned.

Native tests use harmless files/processes and ephemeral test keys. They establish tamper/path/receipt rejection and isolated synthetic Ctrl+C/owned-job cleanup, not signed real-runtime operation, actual upstream cleanup or inference sandboxing. A compromised same-user account remains outside the stated protection. Production root custody/recovery, signed exact artifacts and dependencies, validated resource reports, independent security review and live acceptance remain pending. The local author review is not an independent security review. No renderer IPC boundary, update distribution or public listener was enabled.
