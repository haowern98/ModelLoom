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
