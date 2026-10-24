# ADR-0007: Windows multi-desktop development

**Status:** Six-step product flow, user-verified identity fingerprint pairing, exclusive shared-GPU reservation and an app-managed on-demand elevated helper accepted by the user on 2026-10-20. Windows development integration is implemented and under acceptance testing. Remote model generation, correctness and release readiness remain unverified.

## Accepted behavior

1. Both PCs start as independent coordinators.
2. Malaysia enables Share this PC and selects the GPU Singapore may use.
3. Singapore uses Add device and enters Malaysia's Tailscale address.
4. Malaysia explicitly approves Singapore, bound to the application's identity.
5. Singapore can assign layers to Malaysia's approved GPU.
6. Stopping sharing or losing the connection interrupts affected generation and preserves partial output.

The implementation branch is `feat/multi-desktop`. Preserve the current screen layouts, manual Save/Discard placement behavior, model weights, quantization and request settings. The initial development target is two Windows x64 installations using their existing Tailscale clients. Embedded enrollment, LAN discovery, Headscale integration and release readiness are separate work.

## Current implementation boundary

- Demo transitions remain illustrative. Ordinary builds use the dedicated peer utility owner and the live Share/Add/Requests views. Participation requests appear only on the sidebar Requests page; its badge counts pending incoming requests.
- Cluster assignments accept local physical GPU UUIDs or installation-fingerprint-qualified remote GPU UUIDs. The current stock profile permits two runs.
- The trusted owner compiles local CUDA and owned-loopback RPC ordinals, obtains fresh compatible resources and reservations, and checks startup placement against physical PCI IDs or the exact owned RPC endpoint. Actual remote model readiness is still an acceptance gate.
- `hosts/headless.ts` runs a fixture. It is not a remotely deployable production worker.
- The separate development worker package adds the unmodified stock RPC executable and a restricted native launcher. The helper owns process-specific filtering, restricted worker lifetime and bounded crash recovery. Native containment evidence is development-scoped and does not close production security review.

## Accepted pairing behavior and proposed mechanism

Use the existing TypeScript core for peer control and Node's maintained TLS implementation for encrypted authenticated sessions. Do not add embedded tsnet or a second scheduling service in this slice.

Each installation owns a durable application identity, separate from its device name, IP address, Tailscale account and API credentials. Keep identity secrets outside the renderer, protect them with the Windows credential boundary, and fail closed when protection is unavailable. Certificate generation, renewal and protected storage need their own reviewed implementation; no plaintext fallback or new cryptographic protocol is proposed.

The user approved the Electron compatibility correction on 2026-10-20: preserve the existing RSA identity key and SPKI fingerprint, issue a non-CA TLS leaf under a disposable local CA, and exchange the bounded public CA/leaf chain. Only the identity private key persists, protected in the existing DPAPI domain. Dispose the CA private key after issuance. Validate the chain before trusting its explicit issuer in the private TLS context, retain exact leaf-key pinning and full TLS verification, and make no Windows/global trust-store changes. Old bootstrap messages without the chain fail closed. Standalone Node verification is insufficient; test the actual Electron TLS implementation too.

Initial manual pairing must authenticate both ends. Accepted user interaction: show each application's full identity fingerprint on both machines and require confirmation that both fingerprints match before approval becomes effective. Incoming invitations and join requests appear in Cluster > Requests, with identity verification available in the approval flow. An Add device invitation appears on the invited PC; a Join cluster request appears on the coordinator. Both provide Approve/Decline. A pending request is not a trusted connection. Do not silently trust the first certificate received, accept a changed identity at a familiar IP, or forward native data while awaiting confirmation. Use a reviewed certificate/pinning verification path; never globally disable TLS verification.

The user's 2026-10-22 PROCEED supersedes the manual fingerprint-comparison UI:
retain LAN/Tailscale private IP entry and all Connections tabs, use a six-digit
receiver-displayed code, then one explicit receiver Allow/Deny. The peer utility
uses pinned `@serenity-kit/opaque` 1.1.0 with protocol version, request ID, both
stable identity fingerprints, names and roles in authenticated identifiers. Its
server finish consumes one attempt; a session-key HMAC receipt confirms that
exact attempt to the initiator. Codes expire in five minutes, permit five attempts
per request, and share aggregate ten-starts/minute and eight-new-requests/minute
admission budgets. A new request cannot bypass the aggregate budget. Codes,
OPAQUE registration records and session keys are never network reply fields or
persisted trust. No old fingerprint-confirm path grants authority.

Remember successful directional approval in a fixed private, CurrentUser-DPAPI
file bound to this installation identity; preserve the approved physical GPU set.
Fresh reconnect validates the current certificate chain and saved stable key,
and intersects saved GPU permission with present sharing selection. Sharing stays
off on startup. A changed identity requires fresh pairing; discovering a private
address alone grants nothing. Revocation immediately denies all sessions for that
identity, interrupts owned native work, then awaits durable removal before success
acknowledgment. Failures remain denied and visible. This bounded development change
does not close D03 overall, constitute a security audit of the composed protocol,
or establish packaged/two-PC/release evidence for the new flow.

Record approval by stable peer identity, cluster identity, direction/role and allowed GPU identities. Address and display-name changes do not grant or transfer approval. A replacement identity requires fresh pairing. Reject expired/replayed requests. Rate-limit and bound unauthenticated pairing requests without exposing GPU inventory or native operations.

Sharing availability and peer approval are distinct. Turning on sharing permits pairing requests; it does not start an engine, assign layers or grant every tailnet device access. Revocation closes active sessions and denies reconnect until fresh explicit approval. Turning sharing off releases work and stops accepting worker operations. Sharing defaults off on a fresh launch; whether approvals remain stored is separate from sharing availability.

## Accepted resource reservation

An approved coordinator receives inventory only for GPUs selected for sharing. Qualify every device by installation identity plus GPU UUID; never accept a remote CUDA ordinal as a local identity.

Accepted first-version rule: one coordinator holds a worker reservation at a time. Reject reservation if an existing local model uses a requested shared GPU. While reserved, reject local model loads that overlap reserved GPUs; do not unload existing local work without consent. Malaysia's UI remains usable and other unreserved devices remain independent. Sharing alone reserves no GPU.

Save validates placement, identities and coverage; it does not reserve remote hardware. Run obtains fresh approval, compatibility and resource evidence, then acquires reservations before launching. Recheck configuration revisions and sharing state before native readiness. Reject stale or unavailable workers with an actionable error. Keep one active model scope and the existing captured-request behavior.

## Native RPC gate

Logical path:

`owned coordinator runtime -> restricted local forwarder -> authenticated peer session -> worker gate -> owned native RPC runtime`

An encrypted tunnel does not authenticate a native loopback listener against other local processes. Job Objects establish lifecycle ownership, not that access restriction. A random port, a UI approval flag, or a credential on a different channel does not close this gap.

Before native worker launch is implemented, resolve and review:

1. An enforceable Windows boundary that restricts both local native endpoints to their owned processes, including port reuse and same-user access. Demonstrate it with denied direct connections. Do not silently add elevated firewall changes, a service, or a custom native runtime.
2. Native privilege/resource containment that protects peer credentials and app data from a compromised engine while preserving CUDA access. Record its actual Windows limitations.
3. Advisory applicability/remediation or accepted containment for the exact runtime source and package. A newer build number is not proof of remediation.
4. Native TCP only, with RDMA/other paths unable to bypass the authenticated route.
5. A verified runtime package containing the required stock RPC artifacts. Do not copy extra binaries into an already signed local-only package or bypass inventory checks.

Production llama.cpp remains unmodified, as required by TECHNICAL-SPEC section 6. If adequate containment requires modifying it or an elevated component, return that conflict for an explicit decision. Native execution remains disabled until this gate passes; control-plane tests cannot close it.

### Accepted on-demand Windows helper direction

The user accepted an app-managed on-demand helper after clarification that Windows elevation is needed for the proposed filtering operations. The normal desktop/core remains unelevated. The helper runs during multi-PC use and exits after confirmed cleanup; no permanent Windows service is accepted. UAC approval is required when the elevated helper starts. Task Manager grouping is not promised and requires actual observation.

Its proposed scope is limited to installing/removing owned network restrictions and owning restricted native process lifetime. It must expose no arbitrary command, executable path, destination or firewall-edit interface. Pair approval, identity secrets and user interaction stay in the ordinary app/core. An independently launched malicious copy of an allowed executable must not inherit access merely by having the same file name/path.

On 2026-10-21 the user approved one elevated helper per sharing session. Start it
when sharing is enabled, before advertising availability, and reuse it for
sequential RPC connections. Each connection still gets a fresh restricted stock
worker and its own confirmed cleanup. Stop sharing closes the helper. Remote
requests must never silently launch or restart an elevated helper. The private
owner envelope is bounded and carries only Open, opaque Data and Close; selected
GPU authority stays fixed at helper launch.

On 2026-10-23 the user approved sharing both selected physical GPUs at the same
time. The development implementation admits one existing verified helper per
selected GPU before publishing availability, with one shared two-minute approval
budget. Windows may request approval for each helper. Each helper still owns at
most one restricted worker, with its GPU fixed at launch; remote requests cannot
start an elevated helper. An approved coordinator can open disjoint GPU workers
concurrently. Competing coordinators and overlapping local work remain blocked.

The authenticated RPC upgrade selects an exact allowed physical UUID through
`X-ModelLoom-GPU`; each worker has its own heartbeat and release handle. Missing
selectors are accepted only for a single allowed GPU. Revocation and stopping
sharing close every affected worker. A failed partial admission closes earlier
helpers and retains package seals whenever cleanup cannot be confirmed. Both
PCs need the updated development build for multi-GPU connections. This sharing
change does not expand the existing two-execution-GPU placement limit or establish
real two-PC inference correctness or performance.

On 2026-10-21 the user directed removal of the worker's RAM cap entirely. Do not impose a worker Job Object RAM quota or a minimum-free-RAM launch gate in the helper. Preserve the restricted token, single-worker limit, process-bound network restrictions and confirmed lifecycle cleanup. Model resource admission remains separate; this decision does not claim that an uncapped worker cannot exhaust system memory.

Before product implementation, review caller authentication, exact owned-instance binding, native access to app credentials/files, CUDA compatibility, crash ordering, fail-closed filters, bounded cleanup, update/uninstall behavior and effects on unrelated software. WFP application/user filtering is a candidate primitive, not proof of those properties. A bounded diagnostic may test this primitive using a harmless loopback listener and temporary filters; it cannot enable native RPC or establish production containment.

References: Microsoft [WFP access control](https://learn.microsoft.com/en-us/windows/win32/fwp/access-control) and [Application Layer Enforcement](https://learn.microsoft.com/en-us/windows/win32/fwp/application-layer-enforcement--ale-). Under the documented default permissions, ordinary everyone access grants OPEN/CLASSIFY; adding filters requires additional rights. This inspection's process was not elevated.

## Runtime, data and lifecycle

Require an approved compatible runtime build set on both computers before load. Protocol handshake success alone is insufficient. Manage startup and teardown in ModelLoom, with no user SSH commands or manually launched native worker.

Keep the canonical GGUF at the coordinator and send tensor data required by stock RPC. Initially leave persistent native tensor caching disabled: upstream cache naming is not the product's cryptographic integrity/quota contract. Include transferred weights and ephemeral KV/state in memory/privacy accounting. Do not promise resumable transfer.

Use bounded authenticated liveness and expiring worker reservations. The worker must tear down its assignment after coordinator loss even when the coordinator cannot send a stop message. Late data from an old session cannot complete a new request. Interrupt affected active requests, preserve partial output and explicitly fail/cancel dependent queued requests. Do not replay them automatically.

Coordinator Quit stops its own runtime and releases remote assignments. The remote desktop remains open. Worker Quit, Stop sharing and revocation close admission immediately and tear down owned native work with bounded, confirmed cleanup. Reconnect requires fresh compatibility/resource checks; it cannot resurrect an interrupted generation or a revoked approval.

## Acceptance evidence

The [21 October timeout audit](../../docs/research/MULTI-DESKTOP-TIMEOUT-AUDIT-2026-10-21.md) records the accepted 30-minute distributed execution budget, indefinite healthy RPC idle lifetime, bounded cancellation/cleanup and remote-loss invalidation. Longer execution limits do not waive ownership or native exit confirmation.

- Two real Windows desktops: share selected GPU, pair, approve, show actual inventory, assign, Save, Run, stream, Stop and Quit.
- Unknown peer, changed identity at the same address, replay, wrong role, unshared GPU and revoked peer cannot obtain native access.
- Direct access to native listeners from LAN, tailnet and unrelated local processes is denied. Owned endpoint replacement is detected.
- Sharing off, revocation, app exit and network loss interrupt affected output and settle queued work; workers release reservations after timeout.
- Incompatible/tampered packages fail before native load, without destroying the local working setup.
- Compare identical GGUF/settings through ModelLoom and stock RPC on the same two-PC topology. Separately compare one-GPU versus distributed behavior; earlier local-loopback evidence does not establish WAN parity or universal output equivalence.
- Report tests, actual desktop interaction, native containment, inference correctness and throughput separately. No throughput benchmark is included here.

### Automatic Windows sharing network admission (2026-10-23)

The accepted development direction adds a separate verified network-mode helper
for automatic sharing admission, without a Windows service. The helper derives
the allowed executable from retained owner ancestry rather than accepting an
arbitrary executable path. Its owned firewall rule is restricted to the exact
selected local address and interface, TCP ports 49301 and 49302, and the applicable
remote scope: LocalSubnet for LAN or 100.64.0.0/10 for Tailscale.

Normal pairing and mTLS remain the authorization boundary. Restricted worker WFP
filtering remains the native isolation boundary; the sharing firewall allowance
does not replace either. Confirm removal of the owned rule during teardown.
Recover stale rules only from matching ownership records whose owners are
provably dead. The network helper and every selected GPU helper share the existing
120-second approval budget; no helper receives a fresh independent budget.

Native PTSS checks confirmed TCP reachability on both ports and confirmed cleanup.
A later human-approved startup in the actual Electron app loaded the verified
helper update with both GPUs selected; PTSS reached both app listeners through the
scoped rule. Fresh pairing approval, inference and production release readiness
remain separate evidence gates. Sharing was left on for the user's pairing check.

## Source evidence and decision status

On 2026-10-20 the [upstream RPC advisory](https://github.com/ggml-org/llama.cpp/security/advisories/GHSA-j8rj-fmpv-wcxw) listed affected versions through b7991 and no patched version. This does not determine whether the current local b11306 pin is vulnerable or remediated. The [RPC documentation at the local source pin](https://github.com/ggml-org/llama.cpp/blob/4f31296a907d73f3409f720429bcf31111615d77/tools/rpc/README.md) describes its experimental security limitations.

Read with [SECURITY-SPEC](../SECURITY-SPEC.md), [networking research](../../docs/research/NETWORKING-AND-RUNTIME-UPDATES.md), and the [readiness investigation](../../docs/research/IMPLEMENTATION-READINESS-INVESTIGATION.md). D02/D03/D04/D09/D11 remain open overall. User acceptance of the six-step product flow does not claim approval of an unstated cryptographic design or completion of native containment.
