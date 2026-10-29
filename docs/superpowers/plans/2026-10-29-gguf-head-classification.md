# GGUF head classification correction

Approved scope: detect extracted MTP across the common NextN layouts, validate recognized EAGLE-3/DFlash/DSpark structures, and repair existing imported classifications. No inference, runtime binary, sampling or placement changes.

- [x] Write failing metadata/tensor fixtures for supported family signatures, head-only/full/trunk-only layouts, malformed structures, reduced vocabularies, multiple heads and DFlash2 groups.
- [x] Add bounded tensor-directory classification shared by full import and metadata-only header inspection. No filename or fixed block index heuristics. Preserve the metadata byte/operation budgets.
- [x] Extend bounded source/view types with MTP and an optional classificationVersion=1 hint. Legacy JSON and SQL schema remain valid.
- [x] Reconcile legacy sources once under file seals using metadata-only inspection with saved size/mtime checks. A main-only caller-bound reinspectImport command updates only the existing identity's metadata, preserving registration order/time. Select the latest full target after repair. Failed reconciliation leaves an unavailable entry; never invent a classification.
- [x] Run targeted core/desktop regressions, typechecks and scoped lint; inspect actual cached MTP/DFlash2/target headers without loading models. Deploy reviewed files with backups and hashes, rebuild and restart both normal-profile source apps.

Classification describes file structure, not execution compatibility or complete tensor-data validation. Unknown NextN signatures and inconsistent/truncated directories are rejected. Dense/MoE and architecture-specific runtime support remain separate.

Verification: 108 core regression tests and 131 desktop tests passed. After the final header-return type cleanup, the 78 GGUF tests passed again. Typechecks, core host build, scoped lint and formatting passed. Actual cached extracted MTP, DFlash2, full Qwen, Bonsai and Qwen0.6B headers classified correctly in 0.2–0.4 seconds each without payload hashing. Eleven reviewed production source files were deployed to both PCs with hashes/backups, normal-profile source apps restarted and rebuilt main/core markers verified. No inference or runtime binary changes were made.
