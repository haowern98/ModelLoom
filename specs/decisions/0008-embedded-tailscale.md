# ADR-0008: Embedded Tailscale desktop connectivity

Status: Implementation authorized by the user's approval and subsequent PROCEED on 2026-10-24. D02/D03 remain open overall; cross-platform acceptance and release evidence remain open.

Pinned development dependencies: Go 1.27.3; Tailscale v1.104.2 at commit `e26db7a5797683ec99ad1516c40b628c7f2dfd71`. These pins do not establish target-platform or live enrollment acceptance.

## Contracts

Use a bundled Go tsnet executable supervised by the privileged TypeScript network owner. Both are independent of renderer and native inference. The node belongs to this installation, not an existing system client. Use private inherited pipes only; never expose the helper's management API over TCP. EOF terminates helper admission and all streams. No networking account secrets enter renderer views.

Electron main brokers the protected `ipn.StateStore` through private request/reply messages; its plaintext state map is bounded to 4 MiB and never exposed to the renderer. Reuse Electron's OS protection adapter rather than introducing three Go credential libraries: DPAPI on Windows, Keychain on macOS, and an explicitly checked Secret Service/keyring backend on Linux. Reject `basic_text`, unknown/unavailable protection and corrupted ciphertext. This is the same approved platform-protection design with a shared desktop adapter. Headless needs a separately supplied secure protection adapter and is not silently given plaintext persistence.

Persist an encrypted, bounded state map atomically in a fixed per-deployment directory. Paths and keys are never renderer inputs. The helper acquires an OS-released single-owner lock and reports ready before the main broker loads enrollment. The inert helper retains that lock while the app remains open; Disconnect stops the node, not the lock owner. Go performs all fixed-path ciphertext I/O and atomic replacement so a main-process write cannot outlive the helper's lock. Private vault read/begin/append/commit commands use chunks of at most 32,768 bytes, at most 8 MiB of ciphertext and a 16-command queue on an independent control worker. Symlink rejection, restrictive permissions and ciphertext-only temporary files are required. Separate node enrollment from app peer identity and approval. Disconnect retains enrollment and disables automatic connection; sign out stops streams and locally forgets enrollment after stopping the node. Upstream logout failure retains a recovery error; it does not imply the administrator's device record was removed. Corruption never generates a replacement identity implicitly.

The helper uses protocol version 1, newline-delimited strict JSON capped at 128 KiB/frame. Data chunks are at most 32 KiB with one acknowledged chunk per stream, at most 64 streams. Command IDs and stream IDs are monotonic, non-reusable within a helper lifetime. Fixed destination ports are bootstrap 49301 and secure 49302; dial targets must be visible embedded-node peers. No arbitrary target or listener port. Partial frames, duplicate IDs, unknown fields and malformed base64 close the channel. Backpressure is per stream and writes use a serialized bounded queue; control cannot wait for an unbounded bulk backlog.

Public actions: read, connect, disconnect, sign-out, refresh and open-login. Public state: disconnected, starting, needs-login, needs-approval, connected, reconnecting, expired or failed; sanitized account, tailnet, app addresses and safe error codes. Auth URLs remain privileged, HTTPS-only with an exact login.tailscale.com origin check before trusted browser opening. Explicit core candidate IDs initiate existing pairing; no automatic authorization.

Discovery covers only current allowed IPv4 tailnet peers on fixed ports 49301/49302. It is read-only and separate from introduction/pairing: protocol version, untrusted name, stable public app fingerprint, sharing-ready flag. Four concurrent checks, three-second deadlines and 60-second per-peer cooldown; peer updates invalidate removed routes. No inventory before approval. The queue processes all visible candidates and coalesces refreshes. Discovery cannot claim unseen ACL-denied devices exist.

Overlay duplex streams enter existing Node HTTP/TLS handlers. TLS pinning, OPAQUE verification, receiver consent, reservations and restricted native gateways retain authority. Map TLS sessions to exact owned streams; do not fabricate OS socket tuples or widen raw native exposure. Connection loss stops affected streams/work and never replays generation. Existing manual LAN/IP paths stay.

## Scope and evidence

The Go build targets are windows-amd64, darwin-amd64, darwin-arm64, linux-amd64 and linux-arm64. Build targets alone do not prove runtime compatibility. Windows, macOS and Linux networking/storage/lifecycle adapters must share protocol semantics and have target-platform checks; actual macOS/Linux credential-provider and native-worker evidence remains pending. Existing Windows-specific worker identity/containment code is not made portable by tsnet and cannot be bypassed on another OS. First live milestone is HAOWERNSLAPPY/PTSS. Full mixed-platform worker acceptance remains incomplete until native security/platform evidence exists.

No Headscale, automatic LAN discovery, public listener, exit-node/subnet-router feature, control-plane resale, commercial release, account enrollment or deployment is authorized by this ADR alone. Preserve both shared GPUs, current Settings typography and canvas membership behavior.

No actual enrollment, deployment, hosted CI run or commit is recorded by this update. Local test evidence is recorded separately after inspection.

Sources: [tsnet](https://pkg.go.dev/tailscale.com/tsnet), [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage). The exact pins above are recorded with the implementation; test results are not inferred from these moving reference links.

## Dated implementation evidence

Local implementation and fixture evidence are recorded in the [implementation plan](../../docs/superpowers/plans/2026-10-24-tailscale-integration.md). The final Go suite and all five cross-build checks passed; actual Windows helper tests covered opaque transfer and owned cleanup. Passive path reporting uses fresh LastWrite and CurAddr/PeerRelay evidence, never configured DERP alone or an added Ping. Full local core/desktop suite counts, timeout retries and the ENOSPC packaging failure are recorded there. Packaging retry and final lint/format verification were pending at this update. No live enrollment, deployment, hosted CI or macOS/Linux native-worker acceptance is claimed. D02/D03 remain open.

Subsequent authorized Windows deployment and browser sign-in reached live tailnet status. The dated plan records the AppData namespace/canonicalization fixes and the failed-dial retirement regression discovered during live discovery. The updated Windows helper passed its build/manifest check and was installed with matching hashes on both PCs. Both reconnected with retained enrollments; sharing was off on both, so sharing-enabled discovery and live pairing remain unverified. Earlier five-target compilation evidence must not be attributed to the newer source. Sustained discovery, hosted CI and native macOS/Linux worker acceptance remain open.
