# ADR-0009: Bounded worker tensor cache

Status: Implementation authorized by PROCEED on 2026-10-26 after the user approved the Storage page, configurable limits and both full-cache policies. This accepts the weight-cache slice of D04, not all persistence/storage decisions or cross-platform release readiness.

## Product contract

Settings > Storage uses the existing settings sections, rows, typography, switches, number controls and the same ConfigurationSelect component used by the connection-address menu. Tensor caching defaults on. Initial device-local values are 10 GiB maximum and 5 GiB free-space reserve; both are editable positive whole GiB values. The upper input bound is 1,048,576 GiB. A native directory picker selects an empty, dedicated managed subdirectory, or reopens a directory with the correct ownership marker. Changing location does not move or delete the old cache.

When full, the default policy replaces least recently used complete entries. Keep existing entries instead skips new writes. Neither policy prevents an ordinary load when caching is unavailable. Disabling caching preserves files and bypasses cache use for subsequently opened workers; coordinator-off also requests uncached workers. A worker always retains its own enablement, location and disk limits. Settings changes do not mutate an already admitted worker. Clear unused cache removes only recognized cache entries while holding the same lease as native reads/writes; it never opens or deletes original GGUF files. A tensor already copied to native memory/GPU no longer depends on its disk cache entry.

## Runtime and storage contract

The pinned b11306 runtime at upstream `4f31296a907d73f3409f720429bcf31111615d77` continues to own tensor serialization. Its separate protocol-8 patch replaces FNV-only weight cache lookup with expected SHA-256 plus exact byte length. HELLO advertises local cache availability; uncached peers avoid cache lookup/hash overhead. The weight-only predicate remains mandatory, with a 256 KiB minimum payload. Compute/activation buffers, KV state, prompts, samplers, model weights/quantization, CUDA kernels and numerical libraries are unchanged.

Cache keys include a fixed protocol/format domain, the authenticated coordinator fingerprint, and the content digest. Identical raw bytes can be reused within that namespace because every read checks the new request's exact length and digest before applying the bytes to the new tensor metadata/range. A different coordinator identity cannot select that namespace merely by supplying a header. Remote requests carry only enablement; the approved server derives the coordinator fingerprint after authentication. Native parent control carries the local owner's captured path/quota/reserve/policy and that identity, separately from opaque RPC Data. No renderer or remote peer supplies a worker filesystem path, executable or command line.

There is one persistent managed store per PC. A nonblocking OS-released interprocess lease serializes reads, writes, eviction and cleanup across GPUs/processes. A busy cache is a miss. Writers reserve quota/free space before writing, count temporary entries, flush complete temporary files, recheck the reserve and publish by rename. A later lease can reclaim unpublished partial files after a crash. Corrupt, truncated or mismatched entries are misses and can be replaced by an ordinary transfer. External programs can consume free space concurrently; the reserve is checked, not a filesystem reservation against other applications.

The native cache implementation and N-API maintenance binding use shared C++17 source. Windows uses no-follow/reparse checks, a pinned directory handle, exclusive file leases and a protected DACL for the current user, SYSTEM and a restricting cache SID. Only cache-enabled restricted workers receive that restricting SID and explicit cache environment. Model/credential directories gain no cache ACE. POSIX uses private directories, no-follow file opens, owner/link checks and flock. Platform-native acceptance is separate from these source branches.

The 2026-10-27 private-directory fix moves the Windows ancestor checks into the
trusted helper. It retains non-delete-shared handles to every checked directory
until its contained worker exits. The explicit worker handle allowlist includes
only a read-attributes handle for the selected cache root; the worker validates
its directory attributes and opened path before using it. Missing capability
retains full path validation, and invalid or mismatched capabilities fail closed.
Profile-parent ACLs are unchanged. Optional setup failures are recorded by the
trusted worker owner in a bounded atomic availability record beside preferences;
Storage uses its existing unavailable-location error and clears it after a
successful admission. These records cannot authorize paths or worker operations.

Runtime packages must be separately verified and identify this protocol change. The development version suffix is `-tensor-cache-v1`; old verified helpers receive the original empty Open and remain uncached. Coordinator/worker compatibility checks both the exact worker runtime identities and the shared RPC dependency identities of the actual coordinator installation. Cache-enabled packages reject legacy reports without that coordinator compatibility evidence. No unsigned candidate can be launched through these changes, and metadata rollback protections are unchanged.

## Evidence and outstanding gates

See the implementation plan and `docs/tensor-cache.md` for commands and current evidence. Windows filesystem/maintenance tests and a 16 MiB byte-exact test of the patched native RPC handlers are distinct from a live two-PC Bonsai load. Native macOS/Linux acceptance, independent security review, signed activation and the cold/warm Ready-time comparison remain required before claiming those results. No generation performance or inference-equivalence result is implied by a successful cache test.
