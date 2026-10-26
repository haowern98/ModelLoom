// Tests the actual patched RPC handlers against the unchanged CPU backend.
// No network listener, remote process, model, GPU or inference is started.
#include "ggml-rpc.cpp"
#include <cassert>
#include <fstream>
#include <iostream>

int main(int argc, char **argv) {
  assert(argc == 3);
  namespace fs = std::filesystem;
  const fs::path root = fs::u8path(argv[1]);
  fs::create_directories(root);
  modelloom::tensor_cache::prepare(root);
  _putenv_s("MODELLOOM_TENSOR_CACHE", argv[1]);
  _putenv_s("MODELLOOM_TENSOR_CACHE_LIMIT", "1073741824");
  _putenv_s("MODELLOOM_TENSOR_CACHE_RESERVE", "1073741824");
  _putenv_s("MODELLOOM_TENSOR_CACHE_REPLACE", "1");
  _putenv_s("MODELLOOM_TENSOR_CACHE_OWNER", std::string(64, 'a').c_str());
  const auto reg = ggml_backend_load(argv[2]);
  assert(reg != nullptr);
  const auto backend =
      ggml_backend_dev_init(ggml_backend_reg_dev_get(reg, 0), nullptr);
  assert(backend != nullptr);
  const size_t size = 16 * 1024 * 1024;
  std::vector<uint8_t> expected(size);
  for (size_t i = 0; i < size; ++i)
    expected[i] = static_cast<uint8_t>((i * 31 + 13) % 251);
  const auto hash = modelloom::tensor_cache::digest(expected.data(), size);
  const auto domain =
      "ModelLoom/rpc-v8/weights/v1:" + std::string(64, 'a') + ":" + hash;
  const auto entry = modelloom::tensor_cache::digest(
      reinterpret_cast<const uint8_t *>(domain.data()), domain.size());
  {
    rpc_server server({backend}, nullptr);
    rpc_msg_hello_rsp hello{};
    server.hello(hello);
    assert(hello.major == 8 && hello.padding == 1);
    rpc_msg_alloc_buffer_rsp allocation{};
    assert(server.alloc_buffer({0, size}, allocation) && allocation.remote_ptr);
    rpc_msg_buffer_get_base_rsp base{};
    assert(server.buffer_get_base({allocation.remote_ptr}, base));
    rpc_tensor tensor{};
    tensor.id = 1;
    tensor.type = GGML_TYPE_F32;
    tensor.buffer = allocation.remote_ptr;
    tensor.data = base.base_ptr;
    tensor.ne[0] = static_cast<uint32_t>(size / 4);
    tensor.nb[0] = 4;
    for (int i = 1; i < 4; ++i) {
      tensor.ne[i] = 1;
      tensor.nb[i] = static_cast<uint32_t>(size);
    }
    rpc_msg_set_tensor_hash_req lookup{};
    lookup.tensor = tensor;
    lookup.size = size;
    std::memcpy(lookup.hash, hash.data(), 64);
    rpc_msg_set_tensor_hash_rsp found{};
    assert(server.set_tensor_hash(lookup, found) && !found.result);
    size_t input_size = 0;
    const auto input =
        serialize_set_tensor(tensor, 1, 0, expected.data(), size, input_size);
    assert(server.set_tensor(
        std::vector<uint8_t>(input.get(), input.get() + input_size)));
    assert(fs::file_size(root / (entry + ".tensor")) == size);
    assert(server.buffer_clear({allocation.remote_ptr, 0}));
    assert(server.set_tensor_hash(lookup, found) && found.result);
    std::vector<uint8_t> actual;
    assert(server.get_tensor({tensor, 0, size}, actual));
    assert(actual == expected);
    {
      std::fstream corrupt(root / (entry + ".tensor"),
                           std::ios::in | std::ios::out | std::ios::binary);
      corrupt.put('x');
    }
    assert(server.set_tensor_hash(lookup, found) && !found.result);
    assert(server.set_tensor(
        std::vector<uint8_t>(input.get(), input.get() + input_size)));
    assert(server.set_tensor_hash(lookup, found) && found.result);
    lookup.size--;
    assert(server.set_tensor_hash(lookup, found) && !found.result);
    lookup.size++;
    _putenv_s("MODELLOOM_TENSOR_CACHE", "");
    rpc_server uncached({backend}, nullptr);
    uncached.hello(hello);
    assert(hello.major == 8 && hello.padding == 0);
    // No cache authority is inferred from the RPC client's cache flag.
    assert(uncached.set_tensor_hash(lookup, found) && !found.result);
  }
  ggml_backend_free(backend);
  std::cout << "native RPC cache: cold miss, warm exact bytes, corruption "
               "repair, length mismatch, off negotiation passed\n";
}
