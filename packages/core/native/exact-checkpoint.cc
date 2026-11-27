#include "exact-checkpoint-api.h"
#include "exact-checkpoint-tensors.h"
#include "llama-io.h"
#include "llama-memory.h"
#include <cstring>
#include <mutex>
#include <set>

struct modelloom_checkpoint_owner {
  llama_context *context = nullptr;
  std::set<modelloom_checkpoint *> handles;
};

static std::mutex checkpoint_mutex;
static std::map<llama_context *, std::shared_ptr<modelloom_checkpoint_owner>>
    checkpoint_owners;

struct modelloom_checkpoint {
  std::shared_ptr<modelloom_checkpoint_owner> owner;
  std::vector<uint8_t> metadata;
  modelloom::checkpoint::snapshot tensors;
  size_t logical_bytes = 0;
};

// Device bytes are collected without copying them to the coordinator host.
// Finalization is explicitly fallible, never hidden in a noexcept destructor.
class modelloom_checkpoint_writer final : public llama_io_write_i {
public:
  std::vector<uint8_t> metadata;
  std::vector<modelloom::checkpoint::row> rows;
  void write(const void *src, size_t size) override {
    const auto *p = static_cast<const uint8_t *>(src);
    metadata.insert(metadata.end(), p, p + size);
  }
  void write_tensor(ggml_tensor *tensor, size_t offset, size_t size) override {
    if (size)
      rows.push_back({tensor, offset, size});
  }
  size_t n_bytes() override { return metadata.size(); }
};

class modelloom_checkpoint_reader final : public llama_io_read_i {
public:
  explicit modelloom_checkpoint_reader(const std::vector<uint8_t> &bytes)
      : metadata(bytes) {}
  std::vector<modelloom::checkpoint::row> rows;
  void read(void *dst, size_t size) override {
    if (size > metadata.size() - cursor)
      throw std::runtime_error("checkpoint metadata truncated");
    std::memcpy(dst, metadata.data() + cursor, size);
    cursor += size;
  }
  void read_tensor(ggml_tensor *tensor, size_t offset, size_t size) override {
    if (size)
      rows.push_back({tensor, offset, size});
  }
  void discard() override { rows.clear(); }
  size_t n_bytes() override { return cursor; }

private:
  const std::vector<uint8_t> &metadata;
  size_t cursor = 0;
};

modelloom_checkpoint *modelloom_checkpoint_create(llama_context *ctx,
                                                  llama_seq_id seq) {
  if (!ctx || seq < 0)
    return nullptr;
  const std::lock_guard<std::mutex> lock(checkpoint_mutex);
  try {
    llama_synchronize(ctx);
    modelloom_checkpoint_writer io;
    auto *memory = llama_get_memory(ctx);
    if (memory)
      memory->state_write(io, seq, LLAMA_STATE_SEQ_FLAGS_PARTIAL_ONLY);
    auto result = std::make_unique<modelloom_checkpoint>();
    result->tensors = modelloom::checkpoint::capture(io.rows);
    result->metadata = std::move(io.metadata);
    // Match the host serializer's magic/sequence header for cache accounting.
    result->logical_bytes = sizeof(uint32_t) + sizeof(llama_seq_id) +
                            result->metadata.size() + result->tensors.bytes();
    auto found = checkpoint_owners.find(ctx);
    if (found == checkpoint_owners.end()) {
      auto next = std::make_shared<modelloom_checkpoint_owner>();
      next->context = ctx;
      found = checkpoint_owners.emplace(ctx, std::move(next)).first;
    }
    auto &owner = found->second;
    result->owner = owner;
    owner->handles.insert(result.get());
    return result.release();
  } catch (const std::exception &) {
    return nullptr;
  }
}

bool modelloom_checkpoint_restore(llama_context *ctx, llama_seq_id seq,
                                  const modelloom_checkpoint *saved) {
  const std::lock_guard<std::mutex> lock(checkpoint_mutex);
  if (!ctx || seq < 0 || !saved || !saved->owner ||
      saved->owner->context != ctx)
    return false;
  try {
    llama_synchronize(ctx);
    modelloom_checkpoint_reader io(saved->metadata);
    auto *memory = llama_get_memory(ctx);
    if (memory)
      memory->state_read(io, seq, LLAMA_STATE_SEQ_FLAGS_PARTIAL_ONLY);
    if (io.n_bytes() != saved->metadata.size())
      return false;
    modelloom::checkpoint::restore(saved->tensors, io.rows);
    return true;
  } catch (const std::exception &) {
    // The caller must stop: state metadata may already have been restored.
    return false;
  }
}

size_t modelloom_checkpoint_bytes(const modelloom_checkpoint *saved) {
  return saved ? saved->logical_bytes : 0;
}

void modelloom_checkpoint_free(modelloom_checkpoint *saved) {
  if (!saved)
    return;
  const std::lock_guard<std::mutex> lock(checkpoint_mutex);
  if (saved->owner)
    saved->owner->handles.erase(saved);
  delete saved;
}

void modelloom_checkpoint_release_context(llama_context *ctx) {
  const std::lock_guard<std::mutex> lock(checkpoint_mutex);
  const auto found = checkpoint_owners.find(ctx);
  if (found == checkpoint_owners.end())
    return;
  auto &owner = found->second;
  // Run before context backends/dispatchers are destroyed, even if a prompt
  // cache retains shared handles beyond unload. Later restore fails closed.
  for (auto *saved : owner->handles)
    saved->tensors.buffers.clear();
  owner->context = nullptr;
  owner->handles.clear();
  checkpoint_owners.erase(found);
}
