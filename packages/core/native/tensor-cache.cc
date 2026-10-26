#define NODE_API_NO_EXTERNAL_BUFFERS_ALLOWED
#include "tensor-cache.h"
#include <node_api.h>

namespace {
napi_value operation(napi_env env, napi_callback_info info) {
  size_t count = 2;
  napi_value arguments[2]{};
  void *kind = nullptr;
  if (napi_get_cb_info(env, info, &count, arguments, nullptr, &kind) !=
          napi_ok ||
      count != 1) {
    napi_throw_error(env, nullptr, "INVALID_CONTROL");
    return nullptr;
  }
  size_t length = 0;
  if (napi_get_value_string_utf8(env, arguments[0], nullptr, 0, &length) !=
          napi_ok ||
      !length || length > 4096) {
    napi_throw_error(env, nullptr, "INVALID_CONTROL");
    return nullptr;
  }
  std::vector<char> text(length + 1);
  if (napi_get_value_string_utf8(env, arguments[0], text.data(), text.size(),
                                 &length) != napi_ok ||
      std::strlen(text.data()) != length) {
    napi_throw_error(env, nullptr, "INVALID_CONTROL");
    return nullptr;
  }
  try {
    const auto root = std::filesystem::u8path(text.data());
    if (reinterpret_cast<uintptr_t>(kind) == 1)
      modelloom::tensor_cache::prepare(root);
    modelloom::tensor_cache::store cache(root, UINT64_MAX, 0, false);
    if (!cache.ready())
      throw std::runtime_error("CACHE_BUSY");
    if (reinterpret_cast<uintptr_t>(kind) == 3)
      cache.clear();
    napi_value result;
    if (napi_create_double(env, static_cast<double>(cache.usage()), &result) !=
        napi_ok)
      throw std::runtime_error("CACHE_LOCATION_UNAVAILABLE");
    return result;
  } catch (const std::exception &error) {
    napi_throw_error(env, nullptr,
                     !std::strcmp(error.what(), "CACHE_BUSY")
                         ? "CACHE_BUSY"
                         : "CACHE_LOCATION_UNAVAILABLE");
    return nullptr;
  }
}
napi_value initialize(napi_env env, napi_value exports) {
  const char *names[] = {"prepare", "inspect", "clear"};
  for (uintptr_t i = 0; i < 3; ++i) {
    napi_value function;
    if (napi_create_function(env, names[i], NAPI_AUTO_LENGTH, operation,
                             reinterpret_cast<void *>(i + 1),
                             &function) != napi_ok ||
        napi_set_named_property(env, exports, names[i], function) != napi_ok)
      return nullptr;
  }
  return exports;
}
} // namespace
NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
