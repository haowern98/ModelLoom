# Native RPC bridge readiness

The app-owned session helper forwards private framed bytes between its owner's
pipe and a restricted stock RPC worker. It now opens that pipe for overlapped
I/O and waits for pipe completion, socket readiness, or owner-process exit.
It no longer uses `Sleep(1)` to poll for model data.

The request/reply formats, residency codec, frame bounds and command ordering are
unchanged. A pending read or write is cancelled and completed before its buffer
is released. Explicit Close, owner EOF and worker EOF still end the session.
Partial frames retain the five-second bound; an otherwise idle model does not
time out. A 100 ms maintenance wake drains bounded worker logs and checks owner
EOF under backpressure. It does not gate data delivery: I/O completion wakes the
forwarder immediately.

Only the framed session path used by the app changes. The legacy raw diagnostic
relay remains separate. No llama.cpp executable, numerical library or model
weight is changed by this repair.

## Verification

Build and run on Windows x64 with the existing pinned MSVC and Node toolchains:

```powershell
node packages/core/scripts/build-network-guard-probe.mjs
node --test packages/core/scripts/session-frame.test.mjs
$env:MODELLOOM_BUILD_PEER_HOST='1'
node packages/core/scripts/build-network-guard-probe.mjs
Remove-Item Env:MODELLOOM_BUILD_PEER_HOST
node --test packages/core/scripts/peer-host-arguments.test.mjs
```

The ordinary-token native fixture needs no model, GPU, WFP filters or WAN. It
checks fragmented headers, exact bytes, reply backpressure, explicit Close,
owner EOF, worker EOF, malformed lengths, partial-frame timeout, pending-I/O
cancellation and repeated control Open/report/close-signal exchanges.
The product helper continues to reject diagnostic modes and invalid GPU IDs
before its privilege gate.

On 30 October 2026, the same 8 MiB loopback fixture (4 KiB owner pipe, 128
sequential 64 KiB messages, including a deliberate 50 ms reply-reader pause)
took 3,704 / 3,765 / 4,297 ms with the preceding polling forwarder, and
109 / 109 / 110 ms with the readiness forwarder on HAOWERNSLAPPY. PTSS completed
the readiness fixture in 78 / 94 / 94 ms. All payload comparisons passed. The
existing residency/session test subset passed 57 tests.

These are isolated bridge measurements, not WAN model-load or token-generation
benchmarks.

The development peer package is `b11306-dev15-readiness-tensor-cache-v1`.
Its helper SHA-256 is
`7467d777cbcc04c63787157ad6ed62c6564e464382e17612d93ebbb5157bde1f`.
The other 41 inventory entries are unchanged from the prior peer package.
Both normal development apps received verified package metadata and the helper;
the peer backend installs the package when next admitted. No automatic model
load was performed. Deployment manifests, backups and isolated measurements are
retained under `packages/core/out/bridge-readiness-20261030` in the feature
checkout and `D:/ModelLoom/bridge-readiness-20261030` on PTSS.
