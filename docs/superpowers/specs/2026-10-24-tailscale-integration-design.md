# Embedded Tailscale integration design

**Status:** Implementation authorized by user PROCEED on 2026-10-24; live/platform/release acceptance remains open.  
**Date:** 2026-10-24  
**Branch/base:** `feat/tailscale-integration` at `e96c30e19354fd53d8ce40fc128909938a5e3af7`.  
**Implementation plan:** [Tailscale integration](../plans/2026-10-24-tailscale-integration.md).

## Intent and authorization

Make ModelLoom PCs discoverable and connectable across networks without a separate Tailscale installation or manual IP entry. Users enroll ModelLoom into their own tailnet. Each installation becomes its own Tailscale node, with its own address; the user explicitly accepted this behavior.

The user approved the design and gave implementation-scoped PROCEED on 2026-10-24. [ADR-0008](../../../specs/decisions/0008-embedded-tailscale.md) records the bounded contracts and Go 1.27.3/Tailscale v1.104.2 source pin `e26db7a5797683ec99ad1516c40b628c7f2dfd71`. Headscale remains deferred and D02/D03 remain open overall. No actual enrollment, deployment, hosted CI run, commit or GPU workload is established by this update.

Read with [PRODUCT-SPEC](../../../specs/PRODUCT-SPEC.md), [TECHNICAL-SPEC](../../../specs/TECHNICAL-SPEC.md), [INTEGRATION-SPEC](../../../specs/INTEGRATION-SPEC.md), [SECURITY-SPEC](../../../specs/SECURITY-SPEC.md), [UI-SPEC](../../../specs/UI-SPEC.md), [TESTING-SPEC](../../../specs/TESTING-SPEC.md), [ADR-0007](../../../specs/decisions/0007-multi-desktop-development.md) and the [networking investigation](../../research/NETWORKING-AND-RUNTIME-UPDATES.md). This proposal extends ADR-0007's existing-client development scope; it does not silently replace it.

## User flow

1. Open Settings > Network and select **Connect to Tailscale**.
2. ModelLoom starts its bundled component and opens Tailscale's browser enrollment page. The user chooses their account/tailnet there. If administrator approval is required, ModelLoom reports that state.
3. After enrollment, Network shows the account, tailnet, ModelLoom node address and actual connection state. Restart reuses protected enrollment if still valid.
4. Connections > Add device automatically lists reachable ModelLoom PCs whose sharing is ready. The user need not type an IP. Tailnet membership and permissions determine which peers can be discovered; login does not reveal every device unconditionally.
5. Selecting a PC starts the current six-digit verification and explicit receiving-PC approval. Successful discovery grants no GPU permission.
6. Pairing makes a device available. Adding it to the canvas remains a separate action. Only canvas members contribute to configuration counts and layer assignment.

Preserve Share this PC / Add device, manual private IPv4 entry, manual LAN operation without Internet, GPU selection, both-GPU sharing, live inventory, directional approval and explicit Save/Discard. Enrollment may reconnect on restart; **sharing still starts off** under the existing contract.

### Scope boundaries

- User clarification: the integration must support Windows, macOS and Linux and interoperable mixed-platform peers. HAOWERNSLAPPY/PTSS is the first validation milestone, not the complete delivery scope or proof of cross-platform compatibility.
- Tailscale-hosted coordination only. Headscale, custom control URLs, managed customer tailnets, auth-key provisioning and a ModelLoom account service are deferred.
- User-confirmed scope on 2026-10-24: automatic discovery in this slice covers Tailscale peers. Preserve current manual LAN/IP connections. Automatic LAN discovery is deferred to a separate follow-up.
- No exit-node/subnet-router controls, system VPN changes, public Funnel/Serve, raw RPC exposure or generic port forwarding.
- Do not enroll or alter the separately installed Tailscale client. Existing OS-routed manual connections remain usable. Embedded and existing nodes can coexist.

## Network UI and state

Use the existing Settings > Network column, shared card/row controls and typography tokens. Keep the API settings link. Add one Tailscale section; omit Headscale controls in this slice. A Network settings link from Connections opens this category without changing pairing or placement drafts.

| State                     | Presentation and action                                                           |
| ------------------------- | --------------------------------------------------------------------------------- |
| Not connected / paused    | Connect to Tailscale; explain that it connects ModelLoom to the user's network.   |
| Starting                  | Inline spinner and Connecting to Tailscale; cancel is available.                  |
| Awaiting browser login    | Finish signing in in your browser; Open sign-in page and Cancel.                  |
| Awaiting administrator    | Waiting for approval from your Tailscale administrator; no false Connected badge. |
| Connected                 | Account, tailnet, node address; Disconnect and secondary Sign out.                |
| Reconnecting              | Reconnecting to Tailscale; cancel/disconnect remains available.                   |
| Authentication expired    | Sign in again; retain safe local facts and do not advertise availability.         |
| Component/storage failure | Specific safe error and Retry; local GPU inventory remains usable.                |

Disconnect pauses this app's overlay, cancels discovery, closes its overlay sessions and retains enrollment. Sign out stops admission/work and the node before locally forgetting enrollment. Upstream logout failure retains an explicit recovery error rather than claiming the administrator's device record was deleted. Do not affect a separate Tailscale client or independent remote app.

Sign-in URLs stay in privileged memory. Main validates HTTPS and the permitted Tailscale authentication origin before opening the external browser; no credentials, arbitrary URL or generic browser-opening method is exposed to the renderer. Browser dismissal/navigation cannot mark enrollment complete. Completion comes from the component's current state. Provider redirects take place in the external browser, not an embedded credential form.

Preserve the agreed spinner beside Allow connections and its Starting sharing description. That indicator represents sharing readiness, not Tailscale account enrollment. Connecting to a tailnet alone must not enable sharing or select a different GPU set.

## Approved implementation architecture

Bundle an ordinary Go executable using `tailscale.com/tsnet`, outside ASAR. The existing peer utility/core owns its process and lifetime. Electron main brokers OS-protected enrollment through safeStorage; the renderer receives only sanitized views and narrow actions, never keys or general LocalAPI/dial/listen access. Ship the executable with the app for the first slice; independent networking-component updates are not added here.

```text
Settings / Connections
    -> validated existing Electron and peer-utility boundaries
    -> core network owner -> owned Go tsnet component -> user's tailnet

Peer control / pinned TLS / approved RPC streams
    -> LAN OS sockets, or private component byte streams
    -> existing receiving peer authorization and native containment
```

tsnet uses a userspace network. Its address cannot simply replace a host in current Node `listen()` calls or native RPC arguments. Introduce a small peer-transport boundary used by both ordinary control requests and RPC upgrades. LAN keeps its current OS socket behavior. Tailscale uses component-owned `Listen`/`Dial` streams; Node's existing TLS and identity checks wrap those streams end to end. Go forwards opaque application bytes and does not become a second ModelLoom certificate authority.

Proposed local bridge: inherited process pipes, framed control plus stream data, strict schemas, stream/request IDs, backpressure and bounded buffers. Separate stderr is redacted diagnostics. No TCP management port, caller-selected local target, shell command or peer-supplied executable path. Reuse existing IPC stream discipline where suitable; do not copy its small fragment size into the new bulk path without reviewing throughput consequences.

ADR-0008 records the approved framing, child admission and protected-store contracts; implementation evidence remains separate. Inbound bootstrap/secure channels must be delivered to fixed core-owned handlers without replacing remote peer identity with an untrusted local address. Native RPC continues through the existing approved worker gate and local process restrictions.

Current `PeerNode.upgradeRpc` identifies the tracked raw transport through the TLS socket's local/remote address and port tuple. An overlay stream does not inherently provide that OS tuple. The reviewed transport must instead bind each TLS session to its exact core-owned stream handle, preserving per-session revocation and cleanup; do not populate fabricated socket addresses or drop tracking to make upgrades pass.

### Durable enrollment and ownership

- Supply a protected `tsnet.Server.Store` behind the Electron-main safeStorage broker; do not accept the default plaintext state file. Use OS-backed Windows DPAPI/macOS Keychain/Linux keyring providers and reject Linux basic_text or unavailable protection. The broker plaintext map is at most 4 MiB. The helper acquires its OS lock and reports ready before broker loading; it retains the lock while the app is open, including while Disconnect stops the node. Go owns atomic ciphertext vault I/O through private read/begin/append/commit commands with 32,768-byte chunks, an 8 MiB limit, and a 16-command queue on an independent control worker, avoiding main-process writes outliving the lock. All providers require per-deployment separation, atomic updates and a single-writer lock, with no plaintext temporary files or fallback. A missing/locked Linux keyring is a visible blocked state; independently launched headless Linux needs an explicitly reviewed non-interactive protection provider before claiming support.
- Enrollment is protected locally on each platform and is not a portable file to copy between operating systems. Each installation enrolls its own node. Discovery, protocol versions and authenticated app pairing must interoperate across operating systems; local storage mechanisms must not leak into the network protocol.
- Keep enrollment separate from ModelLoom's existing application identity, trust records and system Tailscale state. A corrupt/locked store produces recovery UI and closed admission, not silent identity replacement.
- Disable inherited auth-key, custom-control and debug settings unless explicitly part of the reviewed component contract. Set diagnostic-upload opt-out before initialization and verify it against the selected source pin. Local log replacement alone is insufficient.
- Network initialization is cancellable and cannot hold the read path or GPU enumeration behind login/network operations. Teardown invalidates outstanding generations of login/discovery work so late replies cannot restore availability.
- Disconnect, parent loss, helper crash and Quit close owned streams and stop admission. Graceful cleanup has a bounded deadline followed by existing scoped process ownership escalation. No name-based process termination or permanent service.
- An explicitly independent headless deployment needs its own store/lifetime. This desktop milestone must not claim headless or cross-platform acceptance.

Cross-platform work also needs native equivalents for existing Windows-specific application identity protection, child ownership and local RPC access restrictions. A portable tsnet executable does not make those existing boundaries portable. Resolve and test the corresponding platform adapters before claiming mixed-platform GPU sharing; do not bypass these checks on macOS/Linux.

## Discovery and identity

Use the embedded node's local peer status and change notifications. No tailnet admin/API token is required merely to read the local visible-peer set. Check permitted candidates for a small versioned ModelLoom discovery response containing only protocol capability, untrusted display name, public application identity and sharing-ready state. Do not reveal GPU inventory, codes or trust secrets before existing approval permits them.

Discovery must not call the current introduction handler: today that handler starts pairing. Add a read-only capability operation with independent limits. Validate it, then repeat the authoritative identity checks during pairing. An advertisement is a candidate, never proof of ownership or approval.

Approved discovery defaults for current allowed IPv4 tailnet peers on fixed bootstrap/secure ports 49301/49302: four simultaneous capability checks, three-second deadlines, one check per unchanged candidate per 60 seconds, immediate invalidation on explicit peer removal/sharing-off events, and a periodic reconciliation fallback. Walk large peer sets in a bounded queue rather than silently dropping devices. Expose a Refresh action; coalesce refreshes instead of bypassing limits. Status can trigger discovery, but a timeout cannot prove an ACL is the cause.

Deduplicate verified routes by stable ModelLoom installation identity, never name/IP alone. Before pairing, treat matching advertised identities only as provisional grouping and do not transfer trust. Exclude this installation, suppress unsupported/closed services, retain manual entry, and paginate/virtualize presentation if needed without truncating the candidate set. Multiple nodes for one physical machine can legitimately represent independent deployments.

Add device shows a compact Tailscale label per route. When no candidates exist, distinguish not signed in, still searching and no reachable sharing PCs. Do not claim a particular invisible peer exists or that an ACL blocked it unless evidence establishes that fact.

## Pairing, route selection and measurements

Keep current OPAQUE six-digit verification, expiry/attempt budgets, certificate validation and directional persisted app approval. Tailnet login supplies connectivity only. A changed public application identity requires fresh pairing. No privileged inventory, reservation, runtime start or RPC before the current worker authorization gate.

Keep validated route identity separate from the transport IP. Manual entry may resolve to an existing OS route or a known embedded peer route; choose explicitly in core and retain normal private-address restrictions. Discovery-driven connection uses a core-retained candidate ID, not renderer-supplied arbitrary dialing parameters. IPv6 peer endpoints need a typed internal form rather than weakening the existing IPv4 manual parser. Friendly DNS name entry is deferred.

A lost overlay removes unavailable devices from active inventory/canvas presentation under the existing disconnection rules, without erasing persisted approval or silently saving a new configuration. Readiness/resource checks run again before new work. Route changes reconnect only after authenticating the same approved application identity. Do not migrate or replay an active native session or silently rerun generation.

An explicit account/tailnet switch invalidates all overlay candidates, endpoints and active sessions. Do not reuse old tailnet node IDs/IPs as authority. Revalidate the current stable app identity and permission before reconnecting; retain LAN-only operation and application trust according to the existing directional contract.

Connection details reuse existing typography and measurements. Add observed Tailscale direct/relayed/unknown path, with freshness. A configured relay or physical endpoint is not proof of the current path. Idle tests stay bounded and stop during runtime activity; busy displays use actual transfers. Do not promise zero overhead or equate connectivity with inference performance.

## License and hosted-service conditions

Source review on 2026-10-24: BSD-3-Clause permits source/binary redistribution subject to notices and non-endorsement. Audit the actual compiled dependency set and distribute its required notices. Official Tailscale documentation encourages embedded apps, including a local AI example. These facts do not by themselves settle the separate hosted-service agreement.

The current Terms, dated 2026-08-25, sections 2.1-2.3 contain personal/internal-business use and broad commercial-exploitation/resale/competition restrictions. The Personal plan is non-commercial. Obtain written clarification before commercial distribution of this exact own-account integration. Do not market universally free connectivity, resell connectivity, pool unrelated customers in our tailnet, or infer permission from a source license. No contact has been made and this is not legal clearance.

## Acceptance and unresolved review

First milestone: two packaged Windows installations enroll through ModelLoom, reconnect after restart and discover each other with no IP entry, without an externally installed client being required. Full slice also proves both pairing directions, both shared GPUs, hardware changes, revocation, helper/network loss, unchanged canvas membership rules, owned cleanup and no raw RPC bypass. Fixtures and local tests do not establish this real two-PC evidence.

The user authorized implementation under ADR-0008 and the existing shared Settings layout with unchanged CSS; keep D02/D03 open overall. Windows, macOS and Linux packaging, protected persistence, lifecycle and mixed-platform pairing/worker validation are required for complete compatibility acceptance. Automatic LAN discovery, Headscale and commercial release remain separate work. Before any GPU performance/equivalence run, agree its workload/budget and evidence contract separately.

Documentation review on 2026-10-24: a fresh read-only reviewer checked the design/plan against current Settings, peer listeners and RPC admission. No material ambiguities were found beyond the enumerated prerequisite contracts and automatic-LAN scope confirmation. The user subsequently confirmed Tailscale discovery first, with manual LAN/IP retained, resolving that scope question. Local relative links were checked. That review did not establish security acceptance or passing product tests; subsequent user PROCEED authorized implementation.

## Primary sources

- [tsnet overview and browser enrollment](https://tailscale.com/docs/features/tsnet).
- [tsnet API, Store, Listen/Dial and LocalClient](https://pkg.go.dev/tailscale.com/tsnet).
- [Local peer status and notifications](https://pkg.go.dev/tailscale.com/client/local).
- [Device visibility and access policy](https://tailscale.com/docs/concepts/device-visibility).
- [Embedding guidance, including private AI service example](https://tailscale.com/blog/easier-building-with-tailscale).
- [Source license](https://github.com/tailscale/tailscale/blob/main/LICENSE), [hosted-service terms](https://tailscale.com/terms) and [plan conditions](https://tailscale.com/pricing).

Links establish source feasibility and documented conditions. ADR-0008 records selected pins; actual target-platform credential/native-worker evidence remains pending. The five Go build targets alone do not prove full GPU compatibility.

## Dated implementation evidence

Local implementation and fixture evidence are recorded in the [implementation plan](../plans/2026-10-24-tailscale-integration.md). The final Go suite and all five cross-build checks passed; actual Windows helper tests covered opaque transfer and owned cleanup. Passive path reporting uses fresh LastWrite and CurAddr/PeerRelay evidence, never configured DERP alone or an added Ping. Full local core/desktop suite counts, timeout retries and the ENOSPC packaging failure are recorded there. Packaging retry and final lint/format verification were pending at this update. No live enrollment, deployment, hosted CI or macOS/Linux native-worker acceptance is claimed. D02/D03 remain open.
