#include "arg.h"
#include "common.h"
#include "exact-checkpoint-api.h"
#include "ggml-backend.h"
#include <cstdio>
#include <stdexcept>

static void require(bool value, const char *message) {
  if (!value)
    throw std::runtime_error(message);
}
static std::vector<uint8_t> host_state(llama_context *ctx, llama_seq_id seq,
                                       llama_state_seq_flags flags) {
  std::vector<uint8_t> bytes(llama_state_seq_get_size_ext(ctx, seq, flags));
  require(llama_state_seq_get_data_ext(ctx, bytes.data(), bytes.size(), seq,
                                       flags) == bytes.size(),
          "host capture");
  return bytes;
}
static void decode(llama_context *ctx, const std::vector<llama_token> &tokens) {
  auto batch = llama_batch_get_one(const_cast<llama_token *>(tokens.data()),
                                   static_cast<int32_t>(tokens.size()));
  require(llama_decode(ctx, batch) == 0, "decode failed");
}
int main(int argc, char **argv) {
  try {
    common_params params;
    require(common_params_parse(argc, argv, params, LLAMA_EXAMPLE_SERVER),
            "arguments");
    auto init = common_init_from_params(params);
    require(init && init->context(), "model context");
    auto *ctx = init->context();
    constexpr auto flags = LLAMA_STATE_SEQ_FLAGS_PARTIAL_ONLY;
    auto tokens = common_tokenize(ctx, "hello exact checkpoint", true, true);
    decode(ctx, tokens);
    const auto a = host_state(ctx, 0, flags);
    auto legacy = host_state(ctx, 0, flags | LLAMA_STATE_SEQ_FLAGS_ON_DEVICE);
    std::unique_ptr<modelloom_checkpoint, decltype(&modelloom_checkpoint_free)>
        first(modelloom_checkpoint_create(ctx, 0), modelloom_checkpoint_free);
    require(first != nullptr, "snapshot A");
    require(modelloom_checkpoint_bytes(first.get()) == a.size(),
            "logical byte accounting");
    decode(ctx, {tokens.back()});
    const auto b = host_state(ctx, 0, flags);
    std::unique_ptr<modelloom_checkpoint, decltype(&modelloom_checkpoint_free)>
        second(modelloom_checkpoint_create(ctx, 0), modelloom_checkpoint_free);
    require(second != nullptr, "snapshot B");
    decode(ctx, {tokens.front()});
    for (const auto *saved : {first.get(), second.get(), first.get()}) {
      require(modelloom_checkpoint_restore(ctx, 0, saved), "snapshot restore");
      require(host_state(ctx, 0, flags) == (saved == second.get() ? b : a),
              "serialized recurrent state differs");
    }
    // New snapshots must not overwrite the legacy speculative snapshot.
    require(llama_state_seq_set_data_ext(
                ctx, legacy.data(), legacy.size(), 0,
                flags | LLAMA_STATE_SEQ_FLAGS_ON_DEVICE) == legacy.size(),
            "legacy restore");
    require(host_state(ctx, 0, flags) == a, "legacy snapshot overwritten");
    require(llama_state_seq_set_data_ext(ctx, a.data(), a.size(), 1, flags) ==
                a.size(),
            "reference cross-slot restore");
    const auto other = host_state(ctx, 1, flags);
    require(modelloom_checkpoint_restore(ctx, 1, second.get()), "cross-slot B");
    require(modelloom_checkpoint_restore(ctx, 1, first.get()), "cross-slot A");
    require(host_state(ctx, 1, flags) == other,
            "cross-slot serialized state differs");
    first.reset();
    require(modelloom_checkpoint_restore(ctx, 0, second.get()),
            "freeing A invalidated B");
    // Keep B retained past context destruction: its backend buffers must
    // already be freed, and stale restore must fail even at a reused address.
    auto *old_context = ctx;
    init.reset();
    require(!modelloom_checkpoint_restore(old_context, 0, second.get()),
            "stale context restore accepted");
    second.reset();
    std::puts("PASS exact recurrent bytes A/B/A, cross-slot restore, legacy "
              "isolation and context teardown");
    return 0;
  } catch (const std::exception &e) {
    std::fprintf(stderr, "FAIL %s\n", e.what());
    return 1;
  }
}
