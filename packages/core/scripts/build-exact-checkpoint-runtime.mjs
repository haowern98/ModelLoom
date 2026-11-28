// Isolated coordinator build. Existing CUDA/ggml kernels and verified packages
// remain untouched. No signing, installation, process launch or mining control.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const core = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(core, 'out/exact-checkpoints');
const resume = process.argv.length === 3 && process.argv[2] === '--resume';
if (process.argv.length !== 2 && !resume)
  throw Error('Use no arguments or --resume for an existing isolated build');
if (!resume)
  execFileSync(process.execPath, [path.join(core, 'scripts/patch-exact-checkpoints.mjs')], {
    stdio: 'inherit',
    windowsHide: true,
  });
const source = path.join(out, 'llama.cpp-4f31296a907d73f3409f720429bcf31111615d77');
const runtime = path.join(core, 'out/activation/b11306/candidate');
const progressSource = path.join(core, 'out/model-load-progress/server.cpp');
if (
  createHash('sha256').update(readFileSync(progressSource)).digest('hex') !==
  '44cc28c7553f7f9928c153f9828135ced12444bce3a67824799edb142a719692'
)
  throw Error('PROGRESS_SOURCE_MISMATCH');
if (!resume) copyFileSync(progressSource, path.join(source, 'tools/server/server.cpp'));
const raw = execFileSync(
  'cmd.exe',
  ['/d', '/c', path.join(core, 'out/native/compiler-environment.cmd')],
  { encoding: 'utf8', windowsHide: true },
);
const env = Object.fromEntries(
  raw.split(/\r?\n/u).flatMap((line) => {
    const at = line.indexOf('=');
    return at > 0 ? [[line.slice(0, at), line.slice(at + 1)]] : [];
  }),
);
if (!resume) {
  for (const name of ['ggml', 'ggml-base', 'llama', 'mtmd']) {
    const exports = execFileSync(
      'dumpbin.exe',
      ['/nologo', '/exports', path.join(runtime, `${name}.dll`)],
      { env, encoding: 'utf8', windowsHide: true },
    );
    const symbols = exports.split(/\r?\n/u).flatMap((line) => {
      const match = /^\s*\d+\s+[0-9A-F]+\s+[0-9A-F]+\s+(\S+)/u.exec(line);
      return match ? [match[1]] : [];
    });
    if (!symbols.length) throw Error('IMPORT_LIBRARY_REQUIRED');
    writeFileSync(
      path.join(out, `${name}.def`),
      `LIBRARY ${name}.dll\nEXPORTS\n${symbols.join('\n')}\n`,
    );
    execFileSync(
      'lib.exe',
      [
        '/nologo',
        '/machine:x64',
        `/def:${path.join(out, `${name}.def`)}`,
        `/out:${path.join(out, `${name}.lib`)}`,
      ],
      { env, cwd: out, windowsHide: true, stdio: 'inherit' },
    );
  }
  // Same generated, asset-free UI used by the current development coordinator.
  for (const [name, expected] of [
    ['ui.cpp', '8d4f2e2e51b9744bf14739835e175bd549605e2ce78650c762514a16038574df'],
    ['ui.h', '629b2bf69f622cdcd3d74842421eae4e5b49a7209555f4fd2c51e00a701cb943'],
  ]) {
    const file = path.join(core, 'out/model-load-progress', name);
    if (createHash('sha256').update(readFileSync(file)).digest('hex') !== expected)
      throw Error('UI_INPUT_MISMATCH');
    copyFileSync(file, path.join(out, name));
  }
  const p = (value) => value.replaceAll('\\', '/');
  const s = p(source),
    o = p(out),
    c = p(core),
    r = p(runtime);
  const flags = readFileSync(path.join(source, 'cmake/common.cmake'), 'utf8');
  if (!flags.startsWith('include("ggml/cmake/common.cmake")')) throw Error('CMAKE_INPUT_MISMATCH');
  writeFileSync(
    path.join(out, 'llama-common-flags.cmake'),
    flags.replace('include("ggml/cmake/common.cmake")', `include("${s}/ggml/cmake/common.cmake")`),
  );
  writeFileSync(
    path.join(out, 'CMakeLists.txt'),
    `
cmake_minimum_required(VERSION 3.21)
project(modelloom_exact_checkpoints LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 17)
add_compile_options(/utf-8)
add_compile_definitions(LLAMA_SHARED GGML_SHARED NOMINMAX)
include_directories("${c}/native")
list(APPEND CMAKE_MODULE_PATH "${s}")
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
set(LLAMA_COMMIT "4f31296a907d73f3409f720429bcf31111615d77")
set(LLAMA_VERSION_BASE "0.0.0")
set(LLAMA_VERSION_MAJOR 0)
set(LLAMA_SUBPROCESS ON)
set(LLAMA_LLGUIDANCE OFF)
add_library(ggml SHARED IMPORTED GLOBAL)
add_library(ggml-base SHARED IMPORTED GLOBAL)
add_library(llama SHARED IMPORTED GLOBAL)
add_library(mtmd SHARED IMPORTED GLOBAL)
set_target_properties(ggml PROPERTIES IMPORTED_IMPLIB "${o}/ggml.lib" IMPORTED_LOCATION "${r}/ggml.dll" INTERFACE_INCLUDE_DIRECTORIES "${s}/ggml/include" INTERFACE_LINK_LIBRARIES ggml-base)
set_target_properties(ggml-base PROPERTIES IMPORTED_IMPLIB "${o}/ggml-base.lib" IMPORTED_LOCATION "${r}/ggml-base.dll" INTERFACE_INCLUDE_DIRECTORIES "${s}/ggml/include")
set_target_properties(mtmd PROPERTIES IMPORTED_IMPLIB "${o}/mtmd.lib" IMPORTED_LOCATION "${r}/mtmd.dll" INTERFACE_INCLUDE_DIRECTORIES "${s}/tools/mtmd")
set_target_properties(llama PROPERTIES IMPORTED_IMPLIB "${o}/llama.lib" IMPORTED_LOCATION "${r}/llama.dll" INTERFACE_INCLUDE_DIRECTORIES "${s}/include" INTERFACE_LINK_LIBRARIES ggml)
include("${o}/llama-common-flags.cmake")
include("${s}/cmake/license.cmake")
license_add_file("llama.cpp" "${s}/LICENSE")
add_subdirectory("${s}/vendor" upstream/vendor)
add_subdirectory("${s}/common" upstream/common)
target_sources(llama-common PRIVATE "${c}/native/exact-checkpoint.cc")
target_include_directories(llama-common PRIVATE "${s}/src" "${s}/ggml/src")
target_compile_definitions(llama-common PRIVATE MODELLOOM_CHECKPOINT_BUILD)
license_generate(llama-common)
file(GLOB server_sources "${s}/tools/server/server-*.cpp")
add_library(llama-server-impl SHARED "${s}/tools/server/server.cpp" \${server_sources} "${o}/ui.cpp")
set_target_properties(llama-server-impl PROPERTIES WINDOWS_EXPORT_ALL_SYMBOLS ON)
target_include_directories(llama-server-impl PRIVATE "${s}" "${s}/tools/server" "${s}/tools/mtmd" "${s}/vendor" "${o}")
target_link_libraries(llama-server-impl PRIVATE llama-common llama mtmd ggml ggml-base cpp-httplib ws2_32)
add_executable(exact-checkpoint-context-test "${c}/tests/native/exact-checkpoint-context-test.cc")
target_link_libraries(exact-checkpoint-context-test PRIVATE llama-common llama ggml)
foreach(target llama-common llama-server-impl exact-checkpoint-context-test)
 set_target_properties(\${target} PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${o}/bin")
endforeach()
`,
  );
}
if (resume) {
  const configured = readFileSync(path.join(out, 'CMakeLists.txt'), 'utf8');
  if (
    !configured.includes('add_library(llama SHARED IMPORTED GLOBAL)') ||
    !configured.includes('native/exact-checkpoint.cc')
  )
    throw Error('NOT_AN_EXACT_CHECKPOINT_HOST_BUILD');
}
const cmake =
  'C:/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe';
const ninja =
  'C:/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/Common7/IDE/CommonExtensions/Microsoft/CMake/Ninja/ninja.exe';
if (!resume)
  execFileSync(
    cmake,
    [
      '-S',
      out,
      '-B',
      path.join(out, 'build-host'),
      '-G',
      'Ninja',
      `-DCMAKE_MAKE_PROGRAM=${ninja}`,
      '-DCMAKE_BUILD_TYPE=Release',
    ],
    { env, windowsHide: true, stdio: 'inherit' },
  );
execFileSync(
  cmake,
  [
    '--build',
    path.join(out, 'build-host'),
    '--target',
    'llama-server-impl',
    'exact-checkpoint-context-test',
    '--parallel',
    '2',
  ],
  { env, windowsHide: true, stdio: 'inherit' },
);
const bundle = path.join(out, 'candidate');
mkdirSync(bundle, { recursive: true });
for (const name of readdirSync(runtime)) {
  const replacement = ['llama-common.dll', 'llama-server-impl.dll'].includes(name);
  copyFileSync(
    path.join(replacement ? path.join(out, 'bin') : runtime, name),
    path.join(bundle, name),
  );
}
const inventory = readdirSync(bundle).map((name) => {
  const data = readFileSync(path.join(bundle, name));
  return {
    path: name,
    length: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
  };
});
writeFileSync(
  path.join(out, 'build-receipt.json'),
  JSON.stringify(
    {
      upstreamCommit: '4f31296a907d73f3409f720429bcf31111615d77',
      changedFiles: ['llama-common.dll', 'llama-server-impl.dll'],
      signed: false,
      installed: false,
      files: inventory,
    },
    null,
    2,
  ),
);
console.log('Built isolated exact-checkpoint coordinator; original runtime untouched');
