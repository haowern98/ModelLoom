#include "exact-checkpoint-tensors.h"
#include "ggml-backend.h"
#include <array>
#include <cstdio>
#include <cstring>
#include <stdexcept>

static void require(bool value, const char *message) {
  if (!value)
    throw std::runtime_error(message);
}

int main(int argc, char **argv) {
  try {
    require(argc == 2, "CPU backend path required");
    require(ggml_backend_load(argv[1]) != nullptr, "backend load");
    auto dev = ggml_backend_dev_by_type(GGML_BACKEND_DEVICE_TYPE_CPU);
    require(dev != nullptr, "CPU device");
    auto buft = ggml_backend_dev_buffer_type(dev);
    ggml_init_params params{8 * ggml_tensor_overhead(), nullptr, true};
    ggml_context_ptr ctx(ggml_init(params));
    auto *live = ggml_new_tensor_1d(ctx.get(), GGML_TYPE_F32, 12);
    auto *other = ggml_new_tensor_1d(ctx.get(), GGML_TYPE_F32, 12);
    ggml_backend_buffer_ptr buffer(
        ggml_backend_alloc_ctx_tensors_from_buft(ctx.get(), buft));
    require(buffer != nullptr, "live buffer");
    std::array<float, 12> a{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12};
    const uint32_t exact_bits[]{0x80000000, 0x7fc01234, 0x00000001};
    std::memcpy(a.data(), exact_bits, sizeof(exact_bits));
    const std::array<float, 12> b{21, 22, 23, 24, 25, 26,
                                  27, 28, 29, 30, 31, 32};
    const std::array<float, 12> zero{};
    using modelloom::checkpoint::row;
    // Save chunk boundaries differ from restore chunk boundaries.
    const std::vector<row> saved{{live, 0, 16}, {live, 16, 32}};
    const std::vector<row> restored{{live, 0, 32}, {live, 32, 16}};
    ggml_backend_tensor_set(live, a.data(), 0, sizeof(a));
    auto first = modelloom::checkpoint::capture(saved);
    ggml_backend_tensor_set(live, b.data(), 0, sizeof(b));
    auto second = modelloom::checkpoint::capture(saved);
    require(first.bytes() == sizeof(a), "payload accounting");
    for (const auto *snapshot : {&first, &second, &first}) {
      ggml_backend_tensor_set(live, zero.data(), 0, sizeof(zero));
      modelloom::checkpoint::restore(*snapshot, restored);
      std::array<float, 12> actual{};
      ggml_backend_tensor_get(live, actual.data(), 0, sizeof(actual));
      const auto &expected = snapshot == &second ? b : a;
      require(std::memcmp(actual.data(), expected.data(), sizeof(actual)) == 0,
              "snapshot was overwritten or consumed");
    }
    modelloom::checkpoint::restore(first, {{other, 0, sizeof(a)}});
    std::array<float, 12> elsewhere{};
    ggml_backend_tensor_get(other, elsewhere.data(), 0, sizeof(elsewhere));
    require(std::memcmp(elsewhere.data(), a.data(), sizeof(a)) == 0,
            "different sequence destination");
    bool allocation_failed = false;
    try {
      (void)modelloom::checkpoint::capture(
          saved,
          [](ggml_context *, ggml_backend_buffer_type_t)
              -> ggml_backend_buffer_t { return nullptr; });
    } catch (const std::exception &) {
      allocation_failed = true;
    }
    require(allocation_failed, "allocation failure not reported");
    std::array<float, 12> after_failure{};
    ggml_backend_tensor_get(live, after_failure.data(), 0,
                            sizeof(after_failure));
    require(std::memcmp(after_failure.data(), a.data(), sizeof(a)) == 0,
            "failed capture mutated live state");
    bool rejected = false;
    try {
      (void)modelloom::checkpoint::capture({{live, sizeof(a), 4}});
    } catch (const std::exception &) {
      rejected = true;
    }
    require(rejected, "out of range capture accepted");
    rejected = false;
    try {
      modelloom::checkpoint::restore(first, {{live, 0, 4}});
    } catch (const std::exception &) {
      rejected = true;
    }
    require(rejected, "incomplete restore accepted");
    std::puts(
        "PASS independent exact checkpoints and repeated rechunked restore");
    return 0;
  } catch (const std::exception &e) {
    std::fprintf(stderr, "FAIL %s\n", e.what());
    return 1;
  }
}
