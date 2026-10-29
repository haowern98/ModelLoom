# Speculative decoding integration progress

User approved the existing app flow and implementation. Device assignment belongs to Cluster; model settings own method and companion choices. No device roles are hardcoded.

- [x] Map configuration, Cluster, runtime arguments and native estimator paths.
- [x] Confirm that existing estimator is target-only; speculative flags do not extend its accounting.
- [x] Versioned settings and legacy Off migration, Save/reload and immutable requests.
- [x] Cluster placement persistence, dirty/undo/save/discard and effective identity.
- [x] Existing-style model editor and discovered-device Cluster controls.
- [x] Admission guard against target-only estimates and silent native fallback.
- [x] Targeted regression tests, typechecks, lint and interface review.

The subsequent user PROCEED authorizes native integration, isolated builds, controlled GPU tests with mining paused/restored and updating both apps.

Native argument compilation, asset validation/sealing, combined no-allocation estimation, target/proposer device union, resource reservations and positive startup verification are now wired. Embedded MTP capability is populated from inspected NextN metadata. Shared-weight heads follow target output placement; unbounded native retrieval variants remain explicitly unavailable.

Foundation verification covered configuration, Cluster, history, generation, local API and desktop controls. Review corrected physical GPU label lookup, retrieval-only conversion and the target-assignment guard for proposer-only edits. Implementation was kept in the isolated feature worktree.

Native integration verification: 546 core and 173 desktop tests passed; both TypeScript projects and scoped lint passed. The native ownership argument-bound regression passed after an observed failure. Actual target-only, standalone draft, MTP and DFlash startup/generation passed with matching 64-token smoke outputs. Both apps were updated through normal-profile launch, with all 45 payload/backup hashes verified and original E: Git HEAD/index preserved. Detailed test/deployment receipts remain in ignored `packages/core/out/speculative-native-20261029`. No speed gain is claimed from smoke tests.

The 512-token WAN comparison did not complete. The first attempt disconnected; the retry log ends after target-only memory admission, before readiness or generation. The user reported a laptop hang, and Windows recorded an unclean restart. These records do not identify the hang's cause or establish a WAN throughput result. After restart, no test inference processes remained on either PC, mining was restored on both, and the laptop app was relaunched without loading a model. No further GPU test was run.

Follow-up UI work added a viewport-bounded floating device menu, matching Cluster hover gutters and a 4 px gap below the device pill. Live native generation/prefill rates now pass through the owned channel and history, including stopped/interrupted replies. The live-rate change passed 264 core and 34 chat UI tests; the final spacing change passed 12 focused control tests. Both existing app installations received these updates. These checks used synthetic streams and ordinary UI rendering, without new GPU inference. Reported disconnects and the stale Off/MTP summary remain follow-up issues.
