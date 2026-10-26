# Embedded Tailscale developer notes

This is internal build guidance. End users receive the networking executable inside ModelLoom and do not install Go, compile it or start networking separately.

## One interactive development app

From `E:\ModelLoom-Project`, start ordinary manual sessions only with:

```powershell
npm run electron dev
```

Use this same source development app and persistent profile on every restart.
On Windows its application data is `%APPDATA%\ModelLoom`, including the
`embedded-tailscale` enrollment directory, and its core profile remains
`.modelloom`. Packaged development apps have separate profiles; this launch policy
does not merge or migrate their enrollments. Do not use packaged `.exe` files,
`pnpm dev`, direct Electron/Forge commands or profile overrides for ordinary
manual sessions. pnpm remains the dependency, build and test tool. Packaging, CI
and isolated test launches are separate validation paths; historical evidence
retains the commands actually used at the time.

## Peer monitoring during model loading

The Add device discovery row matches an existing outgoing peer by its stable
fingerprint, including when its LAN and Tailscale addresses differ. A mutually
verified online peer shows **Connected**. Hover or keyboard focus reveals the
**Disconnect** action. Pending pairing stays disabled as **Pending**; its code
verification remains available in Invitations and shared PCs.

Disconnect is distinct from Forget device and Tailscale sign-out. It stops the
selected worker's local control/RPC traffic and remembers a local disconnected
preference alongside its existing encrypted outgoing trust. Polling, queued
background retries and app restart cannot resume it. Explicit Connect resumes
the existing approval after the normal live identity and approval checks. A
revoked remote approval still requires the existing pairing flow.

For a manual IP that belongs to an already-connected worker, show **Already
connected** and keep the working route. A different LAN/Tailscale address is
resolved through read-only discovery when necessary, then checked using mutual
TLS with the saved identity pin and existing approved request. Public discovery
alone cannot establish that it is connected. No new pairing introduction is
sent for a confirmed connected alias. If that address cannot be authenticated,
the error leaves the existing connection untouched. The alternate address must
be reachable under the worker's existing sharing/listener policy; this control
does not widen interface or firewall access.

When the selected worker is involved in a model load, planning or a running
model, trusted main first returns `PEER_IN_USE`. The UI asks before stopping the
model and disconnecting. Cancellation changes nothing. Confirmation uses the
existing model Stop/cleanup path before dispatching the peer disconnect.

Validated on 2026-10-27: the connected/disconnect slice passed the full portable
core suite (1,066 tests) and desktop suite (459 tests). Final alias/control
checks passed 84 focused UI/controller tests, 48 native pairing/owner/RPC and
multi-GPU tests, plus the focused wrong-identity and reconnect race regressions.
Type checks, scoped ESLint and formatting passed. Both source apps were updated
with matching source/build hashes and launched with `npm run electron dev`.
The live Connections row showed Connected; an authenticated second Tailscale
address returned ALREADY_CONNECTED with the same request ID and original
route. LAN alias handling was verified with integration fixtures. No model
benchmark or mining change was performed. Temporary tasks, inspectors and SSH
forwarding were removed; no commit or push was made.

Inventory watches have a ten-second request budget, including the server's
three-second long-poll. After one classified transport failure, an already
approved peer is checked again after 250 ms using fresh authenticated status and
inventory. A second consecutive failure publishes disconnection. Authentication,
authorization and malformed-message failures do not receive this grace; confirmed
GPU removal and revocation are still published immediately.

RPC heartbeats remain three seconds apart, with at most one request in flight.
One classified transport failure is confirmed by the next heartbeat; two
consecutive failures close the stream. The worker's independent fifteen-second
lease and its revocation/cleanup rules are unchanged.

Windows development verification on 2026-10-26: Bonsai-27B reached the app's
`ready` phase with layers 0–63 assigned exclusively to PTSS's RTX 4070 SUPER.
HAOWERNSLAPPY remained the coordinator with no local GPU assignments. The active
cluster receipt confirmed that placement, and the model remained ready after
removing the temporary in-memory diagnostics. Both PCs had matching compiled
peer-owner, peer-node and deadline modules. Debugger-interrupted attempts were
excluded from this result; this was a functional check, not a speed benchmark.
The focused regression cases cover delayed inventory replies, one transient
failure, sustained loss, revocation and GPU removal. A new split-placement or
reverse-coordinator live run was not part of this check.

## Networking component builds

Use exactly Go 1.27.3 and the repository Node version. `components/tailscale/go.mod` pins Tailscale v1.104.2; ADR-0008 records source commit `e26db7a5797683ec99ad1516c40b628c7f2dfd71`. Set `MODELLOOM_GO` to the Go executable if it is not on PATH. On Windows, use existing E: locations for `GOPATH`, `GOCACHE`, `GOTMPDIR`, `TEMP` and `TMP` to avoid exhausting C:. Do not change global cache locations or delete existing caches as part of a build.

From the repository root:

```powershell
node packages/core/scripts/build-network.mjs --target windows-amd64
node packages/core/scripts/build-network.mjs --target windows-amd64 --check
```

Other build targets are `darwin-amd64`, `darwin-arm64`, `linux-amd64` and `linux-arm64`. Build and check the chosen target before packaging. Packaging consumes prebuilt checked artifacts outside ASAR; it does not install Go or compile the networking component. A local checksum manifest is not a release signature. See [component build details](../components/tailscale/README.md) for artifact paths and notices.

Enrollment protection runs through Electron main safeStorage. Linux `basic_text`, unknown or unavailable providers are rejected; no plaintext fallback is permitted. The helper holds its OS lock before the broker reads enrollment and performs atomic ciphertext I/O. Disconnect stops tsnet while the inert helper retains its lock. Sign out locally forgets state after stopping the node; an upstream failure is reported without claiming removal of an administrator's device record.

Desktop enrollment uses `embedded-tailscale` under the trusted application data directory, separately from Chromium's `Network` directory. Resolve the actual directory before helper launch and protection-domain binding so Windows application virtualization does not cause an unsafe replacement identity. A directly linked enrollment directory is still rejected. Do not move or delete Chromium's networking files as an enrollment recovery step.

All five helper targets cross-built locally, but cross-compilation does not validate native credential providers or worker security. Existing Windows-specific identity and native RPC containment have not been ported. Real macOS/Linux protected-storage/lifecycle and mixed-platform GPU-worker evidence remains pending. Headscale and automatic LAN discovery remain outside this slice; manual LAN/IP pairing remains.

For exact local results and failed/pending attempts, see [dated evidence](superpowers/plans/2026-10-24-tailscale-integration.md#local-evidence-2026-10-24). The authorized Windows deployment reached browser sign-in on both PCs; completed enrollment and pairing remain unverified. These developer checks do not establish hosted CI or real distributed inference.
