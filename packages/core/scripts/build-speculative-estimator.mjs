// Isolated estimator build: existing ggml/CUDA DLLs remain unchanged.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const core = fileURLToPath(new URL('../', import.meta.url));
const reference = process.env.MODELLOOM_ESTIMATOR_REFERENCE_CORE || core;
const pin = '4f31296a907d73f3409f720429bcf31111615d77';
const archive = path.join(reference, 'out/tensor-cache-source/source.tar.gz');
if (
  createHash('sha256').update(readFileSync(archive)).digest('hex') !==
  'acbc1be00cc17559164f635af6d69df4798b64c2f6504fc90da58cf4f3b80f3b'
)
  throw Error('SOURCE_MISMATCH');
const output = path.join(core, 'out/speculative-estimator');
mkdirSync(output, { recursive: true });
execFileSync('tar', ['-xzf', archive, '-C', output], { stdio: 'inherit', windowsHide: true });
const source = path.join(output, `llama.cpp-${pin}`);
const candidate =
  process.env.MODELLOOM_ESTIMATOR_RUNTIME ||
  path.join(reference, 'out/activation/b11306/candidate');
const environment = execFileSync(
  'cmd.exe',
  ['/d', '/c', path.join(reference, 'out/native/compiler-environment.cmd')],
  { encoding: 'utf8', windowsHide: true },
);
const env = Object.fromEntries(
  environment.split(/\r?\n/u).flatMap((line) => {
    const at = line.indexOf('=');
    return at > 0 ? [[line.slice(0, at), line.slice(at + 1)]] : [];
  }),
);
for (const name of ['ggml', 'ggml-base']) {
  const dll = path.join(candidate, `${name}.dll`);
  const exports = execFileSync('dumpbin.exe', ['/nologo', '/exports', dll], {
    env,
    encoding: 'utf8',
    windowsHide: true,
  });
  const symbols = exports.split(/\r?\n/u).flatMap((line) => {
    const match = /^\s*\d+\s+[0-9A-F]+\s+[0-9A-F]+\s+(\S+)/u.exec(line);
    return match ? [match[1]] : [];
  });
  if (!symbols.length) throw Error('IMPORT_LIBRARY_REQUIRED');
  writeFileSync(
    path.join(output, `${name}.def`),
    `LIBRARY ${name}.dll\nEXPORTS\n${symbols.join('\n')}\n`,
  );
  execFileSync(
    'lib.exe',
    [
      '/nologo',
      '/machine:x64',
      `/def:${path.join(output, `${name}.def`)}`,
      `/out:${path.join(output, `${name}.lib`)}`,
    ],
    { env, stdio: 'inherit', windowsHide: true },
  );
}
const header = path.join(source, 'src/llama-context.h');
const text = readFileSync(header, 'utf8');
const marker = '    void sched_reserve();';
if (text.split(marker).length !== 2) throw Error('PATCH_CONTEXT_MISMATCH');
writeFileSync(
  header,
  text.replace(
    marker,
    `${marker}\n    void estimator_reserve() { sched_need_reserve = true; sched_reserve(); }\n    size_t estimator_output_bytes() const;`,
  ),
);
const context = path.join(source, 'src/llama-context.cpp');
writeFileSync(
  context,
  readFileSync(context, 'utf8') +
    `
// Estimator-only API. No inference graph or numerical operation is changed.
size_t llama_context::estimator_output_bytes() const {
    const size_t rows = std::max<uint32_t>(cparams.n_outputs_max, n_seq_max());
    const size_t vocab = model.vocab.n_tokens();
    size_t floats = vocab * rows;
    if (cparams.embeddings) floats += model.hparams.n_embd_out() * rows;
    if (cparams.embeddings_nextn) floats += model.hparams.n_embd_out() * (cparams.embeddings_nextn_masked ? rows : cparams.n_batch);
    for (bool enabled : cparams.embeddings_layer_inp) if (enabled) floats += (size_t)model.hparams.n_embd * cparams.n_batch;
    size_t tokens = 0;
    if (!sampling.samplers.empty()) { floats += 2 * vocab * rows; tokens += (1 + vocab) * rows; }
    return floats * sizeof(float) + tokens * sizeof(llama_token) + cparams.n_batch * sizeof(int32_t);
}
extern "C" __declspec(dllexport) size_t modelloom_estimator_reserve(llama_context * ctx) {
    ctx->estimator_reserve();
    return ctx->estimator_output_bytes();
}
`,
);
const cmakePath = (value) => value.replaceAll('\\', '/');
writeFileSync(
  path.join(output, 'CMakeLists.txt'),
  `
cmake_minimum_required(VERSION 3.21)
project(modelloom_speculative_estimator LANGUAGES C CXX)
set(BUILD_SHARED_LIBS ON CACHE BOOL "" FORCE)
set(LLAMA_BUILD_COMMON ON CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_MTMD OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_BORINGSSL OFF CACHE BOOL "" FORCE)
set(LLAMA_OPENSSL OFF CACHE BOOL "" FORCE)
set(LLAMA_CURL OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_NUMBER 11306)
set(LLAMA_BUILD_COMMIT "${pin}")
add_library(ggml SHARED IMPORTED GLOBAL)
add_library(ggml-base SHARED IMPORTED GLOBAL)
set_target_properties(ggml PROPERTIES IMPORTED_IMPLIB "${cmakePath(path.join(output, 'ggml.lib'))}" IMPORTED_LOCATION "${cmakePath(path.join(candidate, 'ggml.dll'))}" INTERFACE_INCLUDE_DIRECTORIES "${cmakePath(path.join(source, 'ggml/include'))}" INTERFACE_LINK_LIBRARIES ggml-base)
set_target_properties(ggml-base PROPERTIES IMPORTED_IMPLIB "${cmakePath(path.join(output, 'ggml-base.lib'))}" IMPORTED_LOCATION "${cmakePath(path.join(candidate, 'ggml-base.dll'))}" INTERFACE_INCLUDE_DIRECTORIES "${cmakePath(path.join(source, 'ggml/include'))}")
add_subdirectory("${cmakePath(source)}" upstream)
set_target_properties(llama PROPERTIES OUTPUT_NAME modelloom-llama-estimator)
set_target_properties(llama-common PROPERTIES OUTPUT_NAME modelloom-common-estimator)
add_executable(modelloom-speculative-estimator "${cmakePath(path.join(core, 'native/speculative-estimator.cc'))}")
target_compile_features(modelloom-speculative-estimator PRIVATE cxx_std_17)
target_include_directories(modelloom-speculative-estimator PRIVATE "${cmakePath(path.join(source, 'src'))}")
target_compile_definitions(modelloom-speculative-estimator PRIVATE LLAMA_SHARED GGML_SHARED)
target_link_libraries(modelloom-speculative-estimator PRIVATE llama-common llama ggml)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY "${cmakePath(path.join(output, 'bin'))}")
foreach(target llama llama-common modelloom-speculative-estimator)
 set_target_properties(\${target} PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${cmakePath(path.join(output, 'bin'))}")
endforeach()
`,
);
const cmake =
  process.env.CMAKE ||
  'C:/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe';
execFileSync(
  cmake,
  [
    '-S',
    output,
    '-B',
    path.join(output, 'build'),
    '-G',
    'NMake Makefiles',
    '-DCMAKE_BUILD_TYPE=Release',
  ],
  { env, stdio: 'inherit', windowsHide: true },
);
execFileSync(
  cmake,
  [
    '--build',
    path.join(output, 'build'),
    '--target',
    'modelloom-speculative-estimator',
    '--parallel',
    '2',
  ],
  { env, stdio: 'inherit', windowsHide: true },
);
for (const name of readdirSync(candidate))
  if (name.endsWith('.dll') && !name.startsWith('llama'))
    copyFileSync(path.join(candidate, name), path.join(output, 'bin', name));
const files = [
  'modelloom-speculative-estimator.exe',
  'modelloom-llama-estimator.dll',
  'modelloom-common-estimator.dll',
].map((name) => {
  const bytes = readFileSync(path.join(output, 'bin', name));
  return {
    path: name,
    length: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
});
writeFileSync(
  path.join(output, 'build-receipt.json'),
  JSON.stringify(
    {
      version: 1,
      upstreamCommit: pin,
      sourceArchiveSha256: 'acbc1be00cc17559164f635af6d69df4798b64c2f6504fc90da58cf4f3b80f3b',
      files,
    },
    null,
    2,
  ),
);
console.log(
  `Isolated estimator built: ${path.join(output, 'bin/modelloom-speculative-estimator.exe')}`,
);
