# Development runtime signing custody

Date: 2026-10-07. Status: approved by the user for development only. Six keys
were created in the external DPAPI store and verified using signed challenges.
The first inspected Windows CUDA bundle has been signed and verified. This
addresses local activation on `feat/runtime-lifecycle`, not a public release.

The public-root SHA-256 is
`fa142094d12daccc01f8888051e97b6366d43c71f4e18583fa69c91734969f15`.
Only the public root is included in `packages/core/assets/development-root.json`.
The source development policy is disabled. An explicitly invoked development
build enables the pinned root in ignored compiled output; an ordinary host
build resets it. Production trust remains unprovisioned. Tests verify that the
development root cannot serve as a production root and fixture receipts cannot
gain live authority.

## Approved development arrangement

Use six distinct Ed25519 keys: three root keys with a two-signature threshold,
one targets key, one snapshot key and one timestamp key. Targets signs metadata
binding the exact runtime inventory; the inventory records the server, helper
and every dependency's length and SHA-256. Root keys never sign packages.
Use established TUF metadata/canonicalization and cryptographic libraries;
do not invent a signature format or reuse the ephemeral fixture keys.

For this single-machine development stage, store the private keys outside the
checkout, under `%LOCALAPPDATA%/ModelLoom-Publisher/development/`, protected by a
current-user/SYSTEM DACL and Windows current-user DPAPI encryption. The desktop
and runtime never receive private keys or publisher operations. Do not put
private material in Git, logs, command-line arguments, app assets or chat.
Signing is a separate, explicitly invoked local publisher operation; normal
builds, tests and runtime startup cannot sign or regenerate a root.

This is **development custody**, not offline or independent production custody.
All six keys are controlled by one Windows account. A compromise of that
account can reach all keys, so a two-of-three policy here exercises verification
and rotation but does not provide independent-custodian protection. A release
must use a separate root and offline root custody; these development keys must
never become the release keys.

## Public trust and artifact approval

Export only the public root and a key-ID/fingerprint register. Review its exact
SHA-256 before provisioning it as a development-only build input. Ordinary
release builds must retain an empty/unprovisioned release policy until release
custody is approved. There is no renderer-selected root, environment switch,
trust-on-first-use, fixture promotion or unsigned fallback.

A development build still requires real signature verification, version and
expiry checks, the exact signed package/dependency inventory and independently
validated memory reports. A valid development signature establishes local
publisher approval; it does not prove binary safety, GPU fit or inference
correctness. Do not sign an uninspected upstream download just to unblock launch.

The first package must identify its exact source revision, build provenance,
backend, NVIDIA driver minimum and private-console stop contract. Bonsai's
existing GGUF is a separate user-selected input and must retain its exact hash
and quantization. No model substitution or automatic context reduction.

## Expiry, rotation and recovery

Development metadata lifetimes are: root 90 days, targets 7 days, snapshot
2 days and timestamp 1 day. These are local development choices, not TUF
defaults. Expiry blocks activation until fresh metadata is explicitly signed;
never disable expiry or roll the clock backward. Each update advances versions
and preserves the client's clock/version floors.

Test root rotation with two old-root and two new-root signatures and retain the
numbered public root chain. Rotate a compromised targets/snapshot/timestamp key
through a threshold-signed new root, then reissue affected metadata. Losing one
root key permits rotation using the remaining two. Losing two, or compromising
the account holding this development store, requires retiring this development
trust and reviewing a replacement public root out of band. Do not reset cached
trust silently. DPAPI files are account/machine-bound; copying them is not a
portable recovery backup. Rebuilding development trust is acceptable at this
stage; preserving a production recovery quorum is a separate release requirement.

## Approval scope and remaining work

Approval authorized creating the six **development-only** keys in the
external protected store, exporting public metadata, implementing a separate
publisher command and provisioning a development-only public-root build input.
It does not authorize production signing, release publication, a network
updater, secret access elsewhere or changing the UI design.

Before general live admission: verify generated role separation/thresholds; exercise
wrong-root, altered inventory/dependency, expired/replayed metadata and rotation
rejection; inspect the actual Bonsai/runtime compatibility; validate its exact
memory report; then run the owned lifecycle tests with mining left running.
The current publisher supports initialization, identity checks and initial
publication into a new repository only. It refuses existing or partially
initialized stores and refuses repository reuse. Updates and custody recovery
remain planned; no command silently resets trusted metadata or regenerates keys.
Only after the live checks pass connect the existing controls to the tested core. Record
actual results, including incomplete gates, before committing or publishing.

Sources: [TUF roles and key management](https://theupdateframework.github.io/specification/latest/)
require secure offline root custody for the release arrangement; the single-account
development exception above is an explicit proposal.
[Windows DPAPI](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata)
documents the account/machine protection and its limits.
