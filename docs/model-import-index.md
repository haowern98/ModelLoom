# Model import indexing

Models imports have a saved index separate from engine loading. The current Windows development connection still accepts only the approved Bonsai 27B Q1_0 GGUF. Index persistence does not grant arbitrary-model activation or change runtime verification and resource gates.

## Import and restart behavior

Selecting a file adds a pending row showing its actual filename and a spinner with **Indexing…**. Existing rows remain visible, and pending model controls are unavailable. Model logos are removed. A successful import replaces the pending row with inspected metadata; a rejected import does not replace the previously saved entry.

Indexing inspects the GGUF and verifies its full content digest under the existing native file-ownership checks. The utility-owned configuration store saves the source location, byte size, modification time and actual model metadata under that digest. Reimporting identical content updates the source record while preserving its original API import time and saved configuration. Import references the selected file; it does not copy or move it.

On startup, **Updating library…** indicates restoration. The saved entry returns with the engine stopped. Startup checks source ownership, file availability, size and modification time without hashing the entire model or loading an engine. An unavailable or changed source keeps its cached entry but is flagged unavailable. Choose the valid standalone file again to refresh that entry.

Explicit Load performs full content inspection again before the existing configuration, resource and verified-runtime checks. Cached metadata and matching size/time alone never authorize loading.

## Storage and authority

The existing protected configuration database advances from schema 1 to schema 2. It accepts only the exact supported schema and migrates transactionally, retaining configuration, protected API credentials and import timestamps. The new `model_sources` table stores the bounded source record. Earlier imports have no source paths to migrate and require one re-import.

`readImportSource` and source-bearing `registerImport` are main/core owner operations. The public renderer management decoder rejects them. Renderer model replies expose filenames and display metadata, not private source paths. The utility remains the database writer; rendering an index entry does not add filesystem authority to the renderer.

## Limits and validation

This is a persistent index for the approved model identity, not whole-folder discovery or filesystem watching. Startup reconciliation does not detect a same-size, same-time content substitution; the required full inspection on explicit Load handles content identity. Availability is checked at startup and loading checks the file again; this change does not promise immediate updates after moving a file while the app is open.

Validation on 2026-10-15: the full desktop suite passed 181 tests and the core
suite passed 543 tests. After the final picker-Quit safeguard, all 23 controller
tests passed. Eight native storage/protection/API recovery tests passed, including
guarded database close/reopen with indexed source metadata. An additional ignored
fixture verified a protected source record written by one Node process and read
by a separate process. Renderer tests cover progress, retained rows, metadata,
remount restoration without loading, missing-file messaging and logo removal.

Desktop/core type checking, scoped ESLint, the core host build, main compile and
renderer production build passed. Static review found an import/load overlap;
the corrected admission/epoch checks have deferred-operation regressions. No
native Electron window import/restart or new inference workload was exercised.
This evidence does not establish other-platform or inference-equivalence results.
Ignored reports are in `apps/desktop/out/model-index-audit/`.

Quantization labels decode observed `general.file_type` using the pinned
[llama.cpp file-type enumeration](https://github.com/ggml-org/llama.cpp/blob/4f31296a907d73f3409f720429bcf31111615d77/include/llama.h#L106).
Missing metadata stays Unknown instead of using fixed Bonsai display fields.
