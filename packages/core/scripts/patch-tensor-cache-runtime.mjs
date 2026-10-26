// The pinned runtime owns tensor serialization. This patch changes only its
// content cache and HELLO compatibility, never a graph, kernel or model loader.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const pin = '4f31296a907d73f3409f720429bcf31111615d77';
const source = path.join(root, 'out/tensor-cache-source', `llama.cpp-${pin}`);
const archive = await readFile(path.join(root, 'out/tensor-cache-source/source.tar.gz'));
if (
  createHash('sha256').update(archive).digest('hex') !==
  'acbc1be00cc17559164f635af6d69df4798b64c2f6504fc90da58cf4f3b80f3b'
)
  throw Error('SOURCE_MISMATCH');
// Restore all compilation inputs from the verified archive. A cached checkout
// or a downloaded JSON tree cannot authorize modified source/header bytes.
execFileSync(
  'tar',
  [
    '-xzf',
    path.join(root, 'out/tensor-cache-source/source.tar.gz'),
    '-C',
    path.join(root, 'out/tensor-cache-source'),
  ],
  { stdio: 'inherit', windowsHide: true },
);
let code = await readFile(path.join(source, 'ggml/src/ggml-rpc/ggml-rpc.cpp'), 'utf8');
function replace(before, after, count = 1) {
  if (code.split(before).length - 1 !== count)
    throw Error(`PATCH_CONTEXT_MISMATCH: ${before.slice(0, 80)}`);
  code = code.replaceAll(before, after);
}
replace('#include "transport.h"', '#include "transport.h"\n#include "tensor-cache.h"');
replace(
  'const size_t HASH_THRESHOLD = 10 * 1024 * 1024;',
  'const size_t HASH_THRESHOLD = 256 * 1024;',
);
replace('    uint64_t hash;\n};', '    char hash[64];\n    uint64_t size;\n};');
replace(
  'static bool negotiate_hello(const std::shared_ptr<socket_t> & sock) {',
  'static bool negotiate_hello(const std::shared_ptr<socket_t> & sock, bool * cache_available = nullptr) {',
);
replace(
  '    sock->update_caps(response.conn_caps);',
  '    if (cache_available) *cache_available = response.padding == 1;\n    sock->update_caps(response.conn_caps);',
);
replace(
  '    void start(const std::string & endpoint);',
  '    bool cache_available = false;\n    void start(const std::string & endpoint);',
);
replace('    if (!negotiate_hello(sock)) {', '    if (!negotiate_hello(sock, &cache_available)) {');
replace(
  '    if (rpc_use_hash_cache(tensor, size)) {',
  '    if (ctx->dispatcher->cache_available && rpc_use_hash_cache(tensor, size)) {',
  2,
);
replace(
  '        request->hash = fnv_hash((const uint8_t*)data, size);',
  '        const auto hash = modelloom::tensor_cache::digest((const uint8_t*)data, size);\n        memcpy(request->hash, hash.data(), 64);\n        request->size = size;',
  2,
);
replace(
  '        : backends(std::move(all_backends)), cache_dir(cache_dir) {',
  '        : backends(std::move(all_backends)), cache_path(modelloom::tensor_cache::environment_root()), cache_owner(std::getenv("MODELLOOM_TENSOR_CACHE_OWNER") ? std::getenv("MODELLOOM_TENSOR_CACHE_OWNER") : ""), cache_dir(cache_path.empty() ? nullptr : cache_path.c_str()) {\n        (void)cache_dir;\n        if (!modelloom::tensor_cache::hash_name(cache_owner + ".tensor", ".tensor")) this->cache_dir = nullptr;',
);
replace(
  '    const char * cache_dir;',
  '    std::string cache_path;\n    std::string cache_owner;\n    const char * cache_dir;',
);
replace(
  '    bool get_cached_file(uint64_t hash, std::vector<uint8_t> & data);',
  '    bool get_cached_file(const char * hash, uint64_t length, std::vector<uint8_t> & data);',
);
replace(
  '    response.patch = RPC_PROTO_PATCH_VERSION;',
  '    response.patch = RPC_PROTO_PATCH_VERSION;\n    response.padding = cache_dir ? 1 : 0;',
);
const begin = code.indexOf(
  '    if (cache_dir && cache_flag) {',
  code.indexOf('bool rpc_server::set_tensor('),
);
const end = code.indexOf('    ggml_backend_tensor_set(tensor, data, offset, size);', begin);
if (begin < 0 || end < 0) throw Error('PATCH_CONTEXT_MISMATCH');
code =
  code.slice(0, begin) +
  `    if (offset > ggml_nbytes(tensor) || size > ggml_nbytes(tensor) - offset) return false;
    if (cache_dir && cache_flag == 1) {
        try {
            const char * limit = std::getenv("MODELLOOM_TENSOR_CACHE_LIMIT");
            const char * reserve = std::getenv("MODELLOOM_TENSOR_CACHE_RESERVE");
            const char * policy = std::getenv("MODELLOOM_TENSOR_CACHE_REPLACE");
            if (limit && reserve && policy) {
                modelloom::tensor_cache::store cache(fs::u8path(cache_dir), std::stoull(limit), std::stoull(reserve), std::strcmp(policy, "1") == 0, cache_owner);
                cache.put((const uint8_t*)data, size);
            }
        } catch (...) { /* Optional cache I/O never changes the original transfer. */ }
    }
` +
  code.slice(end);
const cacheBegin = code.indexOf('bool rpc_server::get_cached_file(');
const cacheEnd = code.indexOf('bool rpc_server::set_tensor_hash(', cacheBegin);
if (cacheBegin < 0 || cacheEnd < 0) throw Error('PATCH_CONTEXT_MISMATCH');
code =
  code.slice(0, cacheBegin) +
  `bool rpc_server::get_cached_file(const char * hash, uint64_t length, std::vector<uint8_t> & data) {
    if (!cache_dir) return false;
    try {
        const char * limit = std::getenv("MODELLOOM_TENSOR_CACHE_LIMIT");
        const char * reserve = std::getenv("MODELLOOM_TENSOR_CACHE_RESERVE");
        if (!limit || !reserve) return false;
        const char * policy = std::getenv("MODELLOOM_TENSOR_CACHE_REPLACE");
        modelloom::tensor_cache::store cache(fs::u8path(cache_dir), std::stoull(limit), std::stoull(reserve), policy && std::strcmp(policy, "1") == 0, cache_owner);
        data = cache.get(std::string(hash, 64), length);
        return !data.empty();
    } catch (...) { return false; }
}

` +
  code.slice(cacheEnd);
replace(
  'get_cached_file(request.hash, cached_file)',
  'get_cached_file(request.hash, request.size, cached_file)',
);
// Do not format a digest as an integer, or log cache paths/content identifiers.
const debugBegin = code.indexOf('    LOG_DBG(', code.indexOf('bool rpc_server::set_tensor_hash('));
const debugEnd = code.indexOf('    // sanitize tensor->data', debugBegin);
code = code.slice(0, debugBegin) + code.slice(debugEnd);
replace(
  '    std::vector<uint8_t> cached_file;\n    if (!get_cached_file',
  `    // Validate the declared range before a file is allocated/read.
    if (request.offset > UINT64_MAX - request.size) return false;
    std::vector<uint8_t> cached_file;
    if (!get_cached_file`,
);
replace('size=%zu, hash=0x%" PRIx64 ") out of buffer bounds', 'size=%zu) out of buffer bounds');
replace('request.offset, size, request.hash, p0, p1);', 'request.offset, size, p0, p1);');
replace(
  '    ggml_backend_tensor_set(tensor, cached_file.data(), request.offset, size);',
  '    if (request.offset > ggml_nbytes(tensor) || size > ggml_nbytes(tensor) - request.offset) return false;\n    ggml_backend_tensor_set(tensor, cached_file.data(), request.offset, size);',
);
replace(
  `    std::vector<uint8_t> cached_file;
    if (!get_cached_file(request.hash, request.size, cached_file)) {
        response.result = 0;
        return true;
    }
    size_t size = cached_file.size();`,
  `    response.result = 0;
    if (!cache_dir) return true;
    if (request.size > SIZE_MAX) return false;
    const size_t size = (size_t)request.size;`,
);
replace(
  '    ggml_backend_tensor_set(tensor, cached_file.data(), request.offset, size);',
  '    std::vector<uint8_t> cached_file;\n    if (!get_cached_file(request.hash, request.size, cached_file)) return true;\n    ggml_backend_tensor_set(tensor, cached_file.data(), request.offset, size);',
);
const output = path.join(root, 'out/tensor-cache-native/runtime-source');
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'ggml-rpc.cpp'), code);
const header = await readFile(path.join(source, 'ggml/include/ggml-rpc.h'), 'utf8');
await writeFile(
  path.join(output, 'ggml-rpc.h'),
  header.replace('RPC_PROTO_MAJOR_VERSION    7', 'RPC_PROTO_MAJOR_VERSION    8'),
);
console.log(
  'Prepared protocol 8 SHA-256 tensor cache patch at pinned b11306; numerical code unchanged',
);
