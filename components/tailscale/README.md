# Embedded networking component

This Go component embeds Tailscale v1.104.2 using Go 1.27.3. It communicates
with the owning ModelLoom core through private process pipes. Enrollment state
is supplied by the desktop's protected storage provider; the component does not
use an OS credential library or write plaintext enrollment state to disk.

End users receive the component with ModelLoom. They never need to install Go,
compile this component, or start a separate networking process manually.

## Developer build

Install exactly Go 1.27.3 and use the repository's Node.js version. Set
`MODELLOOM_GO` to an executable path if Go is not on PATH. Set `GOPATH`,
`GOCACHE`, and `GOTMPDIR` to suitable local cache directories when needed.
The build script does not install or download Go toolchains.

From the repository root:

```sh
node packages/core/scripts/build-network.mjs --target windows-amd64
node packages/core/scripts/build-network.mjs --target windows-amd64 --check
```

Supported targets are `windows-amd64`, `linux-amd64`, `linux-arm64`,
`darwin-amd64`, and `darwin-arm64`. The default target is the current host.
Builds disable CGO, verify downloaded modules, use read-only dependency metadata,
and strip local source paths and VCS metadata. Dependencies can be downloaded by
Go if absent from the module cache. Run tests separately from this component:

```sh
cd components/tailscale
go test ./...
```

Artifacts are written to `out/<os>-<arch>/modelloom-network` (with `.exe` on
Windows). Adjacent `manifest.json` records protocol version 1, target, pinned
Go/Tailscale versions, source/dependency-file hashes, and executable SHA-256. `--check`
validates the existing artifact without invoking Go or installing anything.
This checksum manifest detects local mismatches; it is not a release signature.

The build also generates `THIRD-PARTY-NOTICES.txt` from the binary's compiled
module metadata and the corresponding module license/notice files, including
the Go standard library license. Its checksum is included in the manifest.
Missing dependency license material fails the build.

Both Forge packaging configurations verify the artifacts before packaging and
stage only the executable, manifest, and notices under `out/<os>-<arch>/tailscale`.
Electron copies that directory to `resources/tailscale`. Packaging does not
install Go, rebuild the component, or change the original artifacts. Build the
appropriate target explicitly before packaging.

CI builds and tests native Windows, macOS, and Linux hosts and retains platform
artifacts. Cross-compilation alone does not establish native runtime behavior.
Actual enrollment, protected storage providers, cleanup, authenticated peer/RPC
integration, and mixed-platform GPU sharing require separate runtime evidence.
No successful mixed-platform deployment or inference is claimed by this build.
