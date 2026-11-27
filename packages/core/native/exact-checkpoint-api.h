#pragma once
#include "llama.h"

struct modelloom_checkpoint;
#if defined(_WIN32)
#if defined(MODELLOOM_CHECKPOINT_BUILD)
#define MODELLOOM_CHECKPOINT_API __declspec(dllexport)
#else
#define MODELLOOM_CHECKPOINT_API __declspec(dllimport)
#endif
#else
#define MODELLOOM_CHECKPOINT_API __attribute__((visibility("default")))
#endif

/** Process-local immutable sequence snapshots. The owning context serializes
 * access. Restore can target another sequence in that context, repeatedly.
 * The common/server owner releases the context before native destruction,
 * invalidating handles and releasing backend allocations;
 * free remains valid afterward. No handle or tensor pointer crosses IPC. */
extern "C" {
MODELLOOM_CHECKPOINT_API modelloom_checkpoint *
modelloom_checkpoint_create(llama_context *ctx, llama_seq_id seq);
MODELLOOM_CHECKPOINT_API bool
modelloom_checkpoint_restore(llama_context *ctx, llama_seq_id seq,
                             const modelloom_checkpoint *saved);
MODELLOOM_CHECKPOINT_API size_t
modelloom_checkpoint_bytes(const modelloom_checkpoint *saved);
MODELLOOM_CHECKPOINT_API void
modelloom_checkpoint_free(modelloom_checkpoint *saved);
MODELLOOM_CHECKPOINT_API void
modelloom_checkpoint_release_context(llama_context *ctx);
}
