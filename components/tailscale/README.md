# Embedded networking component

This Go component embeds Tailscale v1.104.2 using Go 1.27.3. It communicates
with the owning ModelLoom core through private process pipes. Enrollment state
is supplied by the desktop's protected storage provider; the component does not
use an OS credential library or write plaintext enrollment state to disk.

End users receive the component with ModelLoom. They never need to install Go,
compile this component, or start a separate networking process manually.

## Developer build

Install exactly Go 1.27.3 and Git, and use the repository's Node.js version. Set
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

The build applies `patches/gvisor-sack-outstanding.patch` to an isolated copy of
the pinned gVisor module using a temporary module-file replacement. It never
modifies the module cache or the checked-in dependency files, and removes the
build copy afterward. This is the runtime-only correction from upstream PR
[14101](https://github.com/google/gvisor/pull/14101), head
`df000e6d7a2ca32aea30416c12cf257c79806c50`: cumulatively acknowledged packets
must leave Outstanding even when they were selectively acknowledged outside
loss recovery. The upstream PR is unmerged; this is a maintained local patch.
The build then applies `patches/gvisor-spurious-recovery.patch`, the runtime
correction from [PR 14458](https://github.com/google/gvisor/pull/14458), head
`1af4ae880239496a8470baaa16f34b131d4fe045`. Its initial field-insertion context
is adjusted to coexist with the first patch; its logic is unchanged. It applies
the RFC 4015 congestion response after recovery identified as spurious, restores
the pre-loss growth threshold, bounds the immediate send allowance, and leaves
genuine loss reductions intact. This PR is also unmerged and maintained locally.

Every build runs the component tests with both corrections, including the CPU-only
`tcpreorder` regression for SACK outside loss recovery. A plain `go test ./...`
skips that regression because it uses the original dependency; `MODELLOOM_PATCHED_TCP_TEST=1`
requires the correction and makes the original dependency fail the test. The
fixture is not part of the shipped executable. `tcprecovery` covers genuine and
spurious fast/RTO recovery under Reno and CUBIC, bounded recovery bursts, and
unchanged delivered payloads. The manifest records both patch checksums, and
`--check` rejects artifacts from before the corrections. Production Go source
fingerprints exclude test files and normalize CRLF to LF so Git's Windows checkout
line endings do not invalidate an otherwise identical development installation. Revalidate the patches
and regression before changing the pinned gVisor version. Tests run
on the build host even when cross-compiling; they do not establish behavior on
the cross-compiled target. CI also builds and tests each native platform.

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
