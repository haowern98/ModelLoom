#pragma once
#include "ggml-backend.h"
#include "ggml-cpp.h"
#include <algorithm>
#include <limits>
#include <map>
#include <stdexcept>
#include <vector>

namespace modelloom::checkpoint {
struct row {
  ggml_tensor *tensor;
  size_t offset;
  size_t size;
};
struct bucket {
  ggml_context_ptr context;
  ggml_backend_buffer_ptr buffer;
  std::vector<ggml_tensor *> tensors;
  size_t payload = 0;
};
struct snapshot {
  std::map<ggml_backend_buffer_type_t, bucket> buffers;
  size_t bytes() const {
    size_t total = 0;
    for (const auto &entry : buffers)
      total += entry.second.payload;
    return total;
  }
};
inline void validate(const row &value) {
  if (!value.tensor || !value.tensor->buffer ||
      !ggml_is_contiguous(value.tensor) ||
      ggml_blck_size(value.tensor->type) != 1 || !value.size ||
      value.offset > ggml_nbytes(value.tensor) ||
      value.size > ggml_nbytes(value.tensor) - value.offset ||
      value.offset % ggml_element_size(value.tensor) ||
      value.size % ggml_element_size(value.tensor))
    throw std::runtime_error("invalid checkpoint tensor range");
}

/** Allocate every destination before copying. A failed capture leaves live
 * state untouched. Only same-backend tensor copies are used; RPC retains bytes
 * on its worker and no graph or floating-point operation is introduced. */
inline snapshot
capture(const std::vector<row> &rows,
        ggml_backend_buffer_t (*allocate)(ggml_context *,
                                          ggml_backend_buffer_type_t) =
            ggml_backend_alloc_ctx_tensors_from_buft) {
  snapshot result;
  std::map<ggml_backend_buffer_type_t, std::vector<row>> groups;
  for (const auto &value : rows) {
    validate(value);
    groups[ggml_backend_buffer_get_type(value.tensor->buffer)].push_back(value);
  }
  for (const auto &entry : groups) {
    auto &saved = result.buffers[entry.first];
    ggml_init_params params{2 * entry.second.size() * ggml_tensor_overhead(),
                            nullptr, true};
    saved.context.reset(ggml_init(params));
    if (!saved.context)
      throw std::runtime_error("checkpoint metadata allocation failed");
    for (const auto &value : entry.second) {
      if (value.size > std::numeric_limits<size_t>::max() - saved.payload)
        throw std::runtime_error("checkpoint size overflow");
      saved.payload += value.size;
      saved.tensors.push_back(ggml_new_tensor_1d(
          saved.context.get(), value.tensor->type,
          static_cast<int64_t>(value.size / ggml_element_size(value.tensor))));
    }
    saved.buffer.reset(allocate(saved.context.get(), entry.first));
    if (!saved.buffer)
      throw std::runtime_error("checkpoint device allocation failed");
  }
  for (const auto &entry : groups) {
    auto &saved = result.buffers.at(entry.first);
    for (size_t i = 0; i < entry.second.size(); ++i) {
      const auto &value = entry.second[i];
      auto *view = ggml_view_1d(
          saved.context.get(), value.tensor,
          static_cast<int64_t>(value.size / ggml_element_size(value.tensor)),
          value.offset);
      ggml_backend_view_init(view);
      ggml_backend_tensor_copy(view, saved.tensors[i]);
    }
  }
  return result;
}

/** Restore immutable saved bytes, including when sequence-cell chunking
 * changes. Validate and allocate all view metadata before writing any live
 * tensor. */
inline void restore(const snapshot &saved, const std::vector<row> &rows) {
  std::map<ggml_backend_buffer_type_t, std::vector<row>> groups;
  for (const auto &value : rows) {
    validate(value);
    groups[ggml_backend_buffer_get_type(value.tensor->buffer)].push_back(value);
  }
  if (groups.size() != saved.buffers.size())
    throw std::runtime_error("checkpoint backend mismatch");
  struct copies {
    ggml_context_ptr context;
    std::vector<std::pair<ggml_tensor *, ggml_tensor *>> views;
  };
  std::vector<copies> pending;
  for (const auto &entry : groups) {
    const auto found = saved.buffers.find(entry.first);
    if (found == saved.buffers.end())
      throw std::runtime_error("checkpoint backend missing");
    const auto &source = found->second;
    size_t bytes = 0;
    for (const auto &value : entry.second) {
      if (value.size > std::numeric_limits<size_t>::max() - bytes)
        throw std::runtime_error("checkpoint size overflow");
      bytes += value.size;
    }
    if (bytes != source.payload)
      throw std::runtime_error("checkpoint payload mismatch");
    copies group;
    ggml_init_params params{2 * (entry.second.size() + source.tensors.size()) *
                                ggml_tensor_overhead(),
                            nullptr, true};
    group.context.reset(ggml_init(params));
    if (!group.context)
      throw std::runtime_error("checkpoint restore metadata allocation failed");
    size_t index = 0, cursor = 0;
    for (const auto &value : entry.second) {
      size_t offset = 0;
      while (offset < value.size) {
        if (index >= source.tensors.size())
          throw std::runtime_error("checkpoint tensor missing");
        auto *src = source.tensors[index];
        const size_t count =
            std::min(value.size - offset, ggml_nbytes(src) - cursor);
        if (src->type != value.tensor->type || count % ggml_element_size(src))
          throw std::runtime_error("checkpoint tensor type mismatch");
        const auto n = static_cast<int64_t>(count / ggml_element_size(src));
        auto *from = ggml_view_1d(group.context.get(), src, n, cursor);
        auto *to = ggml_view_1d(group.context.get(), value.tensor, n,
                                value.offset + offset);
        ggml_backend_view_init(from);
        ggml_backend_view_init(to);
        group.views.emplace_back(from, to);
        offset += count;
        cursor += count;
        if (cursor == ggml_nbytes(src)) {
          cursor = 0;
          ++index;
        }
      }
    }
    pending.push_back(std::move(group));
  }
  for (const auto &group : pending)
    for (const auto &pair : group.views)
      ggml_backend_tensor_copy(pair.first, pair.second);
}
} // namespace modelloom::checkpoint
