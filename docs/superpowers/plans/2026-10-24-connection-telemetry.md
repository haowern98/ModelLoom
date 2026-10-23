# Connection telemetry implementation plan

**Goal:** Clickable canvas latency circles open the existing side panel with measured connection facts. Automatic bandwidth tests run only while both ends are idle; runtime work uses passive RPC transfer rates.

**Authorization:** User approved the panel mockup and automatic idle testing, then said PROCEED. Subsequent requests authorized deployment to both PCs, the local-read recovery fix and its deployment, and then commit/push. No inference benchmark is included.

**Architecture:** Extend the existing authenticated peer listener and optional peer inventory metadata. Diagnostics require the same approved, exact pinned identity as inventory. No new public ports, unauthenticated test endpoints, renderer-selected test sizes or process launches. Parent-owned runtime activity, local reservations and RPC streams cancel tests before admission. Latency is control-request round-trip time, including connection setup, not ICMP or inference latency. Pure canvas placement between two remote workers does not establish a measured link.

**Implementation choices:** Serial probes; 60-second bandwidth cooldown, offset to 75 seconds for the higher fingerprint to avoid repeated reciprocal collisions; three-second latency sampling. Each direction uses at most 16 MiB, a 500ms sample window and a 1.5-second deadline, with backpressure. Display unavailable/unsupported/stale facts honestly. Loading, planning, token counting and generation count as busy; a loaded idle model permits tests. The retained runtime parent waits for local and participating remote cancellation acknowledgements before dispatching native generation. Preserve sampling, weights, inference protocol and existing security controls.

- [x] Add failing scheduler and wire validation tests; implement optional telemetry and cancellation/rate accounting.
- [x] Add bounded mTLS diagnostics transport and approval/idle/rate admission, with cancellation on load, RPC open, revocation and Quit.
- [x] Wire trusted parent runtime activity and peer owner background monitoring, independent of open panels.
- [x] Add clickable midpoint circles and live connection panel with examples kept explicitly simulated.
- [x] Run affected core/desktop tests, typechecks, lint/format and browser inspection; record actual evidence and limits.

## Verification

- 58 affected core unit tests passed across eight files, covering scheduling, cancellation, rate accounting, optional wire metadata, strict parent activity messages, transport dispatch and GPU reservations.
- 31 Windows native integration tests passed across four files. The final three diagnostics integration tests also passed after adding loaded-idle/active activity acknowledgement and actual RPC byte-count checks. Tests use local TLS listeners and fake RPC streams, not GPU inference. Coverage includes unapproved rejection, real authenticated throughput, cooldown, immediate cancellation and a deliberately slow TLS stream returning a partial sample.
- Desktop run: 62 tests passed; the existing saved-configuration test at `ClusterConfigurations.test.tsx:181` exceeded its unchanged five-second deadline in the combined run. All three tests in that file passed when run alone. No deadline or assertion was weakened.
- Desktop and core TypeScript checks, scoped ESLint, scoped Prettier and whitespace checks passed.
- Browser fixture inspection confirmed a real midpoint button, click-through to the existing right panel, idle measurements and live transfer-rate updates. An initial empty SVG path crashed browser geometry measurement; a RED regression and guard fixed it. The repeated browser flow then completed with no page errors. Inspected screenshots: ignored `packages/core/out/connection-telemetry-idle-preview.png` and `packages/core/out/connection-telemetry-active-preview.png`.
- Review identified slow-link sampling, loaded-idle suppression and reciprocal collision issues. Fixes were inspected locally and covered by focused tests. Final independent re-review was unavailable, so no independent sign-off is claimed.
- No new inference run or tokens-per-second comparison was performed; monitoring overhead is not yet measured.

## Deployment and local-read recovery

- Both apps were rebuilt and opened on HAOWERNSLAPPY and PTSS. Automatic idle telemetry was observed between the actual PCs: approximately 78ms control latency, 153Mbps sending and 170Mbps receiving. These are one observed sample, not a performance guarantee.
- A later revoke/disconnect exposed local inventory reads waiting behind remote network checks. The fix returns cached local facts immediately and continues checking pending and verified peers in the background. Failed UI reads retain the last inventory and expose Retry instead of indefinite loading.
- Regression tests failed before the fix and passed afterward, including a blocked remote status check, decline before code verification, initial read failure/retry and retained GPUs after a later failure. The affected 49 tests, both typechecks, scoped lint and formatting passed. Independent review of this recovery slice found no remaining blocking issues.
- The recovery build was deployed to both PCs. PTSS verified all 187 package files; its app archive SHA-256 matched `3b123802a71da2b34572b9c7cd256caa6133cea28405cd7c90a97b16b3ed8dc5`. Both actual UIs displayed their GPUs without loading placeholders. Five local reads on HAOWERNSLAPPY, while PTSS was disconnected, completed in 76–159ms; PTSS reads completed in 1–2ms. Fresh pairing and inference were not rerun for this deployment.
- Deployment manifests, rollback receipts, timing samples and screenshots remain under ignored `packages/core/out/connections-read-update-20261024/`. Unrelated staged research/reference files are outside this publication scope.
