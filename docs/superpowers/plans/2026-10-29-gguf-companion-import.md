# GGUF companion import implementation plan

**Goal:** One native GGUF importer registers full models and recognized EAGLE-3, DFlash and DSpark companions, with All/Models/Speculative heads filtering.

**Architecture:** Keep content identity and original file locations. Add an optional bounded speculativeHead field to existing source JSON records. Legacy records remain valid; the subsequent [classification correction](2026-10-29-gguf-head-classification.md) adds one-time header reconciliation for older imports. A caller-bound main-only registerCompanion owner command accepts only classified companions without changing the target owner. No runtime inference, training, conversion or download changes.

**Tech stack:** Existing TypeScript, Electron, React and SQLite owners.

**Approved scope:** User's GGUF-only import agreement in this conversation; import classification does not grant inference compatibility.

## Tasks

- [x] Add failing bounded GGUF classification tests, including DSpark tensor detection and embedded-MTP target preservation. Implement content-based identification and reject non-GGUF files.
- [x] Add failing owner/storage tests. Extend strict source JSON and main-only wire validation, add scoped companion registration, and restore the latest full target independently of companion rows. Keep SQL schema and legacy records unchanged.
- [x] Add failing desktop tests. Register companions without changing the selected target or history owner, restore head-only libraries, reject target loading/configuration for companions, and retain non-destructive removal.
- [x] Add renderer filtering/import tests. Enable the shared importer on every tab, display head type badges, keep companions out of target configuration and Cluster choices, and show import results in All.
- [x] Run affected core and desktop suites, typecheck, lint and formatting. Deploy reviewed files with backups and hash checks to both source apps, using supported application restart for main/core changes.

Verified: 48 core tests and 125 desktop tests initially passed; after adding the Cluster admission regression, 44 affected desktop tests passed including the new case. Final strict-decoder checks, typechecks, build and scoped lint/format checks passed. Both normal-profile source apps were restarted and deployed source/backup hashes plus rebuilt main/core markers verified. Browser verification used mock library metadata. No real-head native import or speculative inference run was performed.

## Invariants

- Paths stay in trusted main/core records; renderer supplies no path or classification.
- Classification uses GGUF architecture/tensor metadata, never filenames.
- A full target containing MTP remains a target.
- DFlash and DSpark both use dflash architecture; the subsequent classifier validates a complete compatible Markov pair for DSpark.
- Importing a companion does not select or load it as a target.
- Removing an entry never deletes the original GGUF.
- Unknown or malformed companion metadata is rejected; importing never claims successful inference compatibility.
- Preserve current busy-state rules, file seals, index ownership and unrelated work.

## Verification focus

First-import companion with no target; newest import is a companion on restart; malformed/forged owner commands; duplicate content; changed or missing original files; target-only paths attempted with a companion ID; every tab's shared import behavior.
