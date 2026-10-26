import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { build } = require('esbuild');
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.resolve(desktop, '../..');
const core = path.join(workspace, 'packages/core');
const bootstrap = path.join(core, 'out/activation/b11306');
async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function files(root, relative = '') {
  const result = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error('INVALID_RUNTIME_TREE');
    if (entry.isDirectory()) result.push(...(await files(root, name)));
    else if (entry.isFile()) result.push(name);
    else throw new Error('INVALID_RUNTIME_TREE');
  }
  return result.sort();
}
async function copy(source, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

/** Build-only staging. A new output is mandatory; no signing, secret discovery or runtime path input. */
export async function stageDevelopment(output, candidate = path.join(bootstrap, 'candidate')) {
  await mkdir(output); // Never overwrite earlier artifacts or evidence.
  const { createDevelopmentRuntimeVerifier, packageEvidence } = await import(
    pathToFileURL(path.join(core, 'out/runtime-package/verifier.js')).href
  );
  const capability = await createDevelopmentRuntimeVerifier().verify(
    path.join(bootstrap, 'repository'),
    `${output}.verification`,
  );
  const inventory = packageEvidence(capability).inventory;
  if (
    inventory.artifact !== 'b11306-cuda12.4-msvc14.44-dev1' ||
    inventory.upstreamCommit !== '4f31296a907d73f3409f720429bcf31111615d77'
  )
    throw new Error('UNSUPPORTED_RUNTIME');
  const expected = inventory.files.map((file) => file.path).sort();
  if (JSON.stringify(await files(candidate)) !== JSON.stringify(expected))
    throw new Error('INVALID_RUNTIME_TREE');
  for (const file of inventory.files) {
    const source = path.join(candidate, file.path);
    if ((await lstat(source)).size !== file.length || (await digest(source)) !== file.sha256)
      throw new Error('FILE_MISMATCH');
    await copy(source, path.join(output, 'bootstrap/candidate', file.path));
  }
  for (const name of await files(path.join(bootstrap, 'repository'))) {
    if (!/^(?:root|[1-9][0-9]*\.root|timestamp|snapshot|targets|inventory)\.json$/.test(name))
      throw new Error('INVALID_METADATA');
    await copy(
      path.join(bootstrap, 'repository', name),
      path.join(output, 'bootstrap/repository', name),
    );
  }
  await copy(
    path.join(core, 'assets/development-root.json'),
    path.join(output, 'core/assets/development-root.json'),
  );
  for (const name of ['ownership.node', 'history.node', 'peer-identity.node', 'tensor-cache.node'])
    await copy(path.join(core, 'out/native', name), path.join(output, 'core/out/native', name));
  await copy(
    path.join(core, 'scripts/utility-entry.cjs'),
    path.join(output, 'core/scripts/utility-entry.cjs'),
  );
  await copy(
    path.join(core, 'scripts/peer-entry.cjs'),
    path.join(output, 'core/scripts/peer-entry.cjs'),
  );
  await copy(
    path.join(core, 'scripts/relay-rpc-worker.ps1'),
    path.join(output, 'core/scripts/relay-rpc-worker.ps1'),
  );
  const peerBootstrap = path.join(bootstrap, 'peers');
  let peerPackage = false;
  try {
    peerPackage = (await lstat(path.join(peerBootstrap, 'repository'))).isDirectory();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (peerPackage) {
    const receipt = await createDevelopmentRuntimeVerifier().verify(
      path.join(peerBootstrap, 'repository'),
      `${output}.peer-verification`,
    );
    const peerInventory = packageEvidence(receipt).inventory;
    if (
      peerInventory.upstreamCommit !== inventory.upstreamCommit ||
      peerInventory.artifact !== inventory.artifact ||
      !['ModelLoom-peer-host.exe', 'ggml-rpc-server.exe'].every((name) =>
        peerInventory.files.some((file) => file.path === name),
      )
    )
      throw new Error('UNSUPPORTED_RUNTIME');
    const candidate = path.join(peerBootstrap, 'candidate');
    if (
      JSON.stringify(await files(candidate)) !==
      JSON.stringify(peerInventory.files.map((file) => file.path).sort())
    )
      throw new Error('INVALID_RUNTIME_TREE');
    for (const file of peerInventory.files) {
      const source = path.join(candidate, file.path);
      if ((await lstat(source)).size !== file.length || (await digest(source)) !== file.sha256)
        throw new Error('FILE_MISMATCH');
      await copy(source, path.join(output, 'bootstrap/peers/candidate', file.path));
    }
    for (const name of await files(path.join(peerBootstrap, 'repository'))) {
      if (!/^(?:root|[1-9][0-9]*\.root|timestamp|snapshot|targets|inventory)\.json$/.test(name))
        throw new Error('INVALID_METADATA');
      await copy(
        path.join(peerBootstrap, 'repository', name),
        path.join(output, 'bootstrap/peers/repository', name),
      );
    }
  }
  await writeFile(
    path.join(output, 'core/package.json'),
    JSON.stringify({ type: 'module', private: true }),
  );

  // Bundle both fixed entry graphs, including their pinned JS dependencies; unused fixture launchers disappear.
  const result = await build({
    absWorkingDir: workspace,
    entryPoints: [
      'packages/core/out/hosts/development-desktop.js',
      'packages/core/out/hosts/utility.js',
    ],
    outdir: path.join(output, 'core/out/hosts'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    metafile: true,
    banner: {
      js: "import { createRequire as makeRequire } from 'node:module'; const require = makeRequire(import.meta.url);",
    },
    legalComments: 'eof',
  });
  const retained = Object.values(result.metafile.outputs)
    .flatMap((entry) => Object.entries(entry.inputs))
    .filter(([, info]) => info.bytesInOutput > 0)
    .map(([file]) => file);
  // This entry keeps installation identity outside the model-specific utility.
  const peers = await build({
    absWorkingDir: workspace,
    entryPoints: ['packages/core/out/peers/utility.js'],
    outdir: path.join(output, 'core/out/peers'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    banner: {
      js: "import { createRequire as makeRequire } from 'node:module'; const require = makeRequire(import.meta.url);",
    },
    metafile: true,
    legalComments: 'eof',
  });
  retained.push(
    ...Object.values(peers.metafile.outputs)
      .flatMap((entry) => Object.entries(entry.inputs))
      .filter(([, info]) => info.bytesInOutput > 0)
      .map(([file]) => file),
  );
  if (retained.some((file) => /fixture-engine|publisher\/|diagnostic-rpc/.test(file)))
    throw new Error('FORBIDDEN_CORE_GRAPH');
  const dependencies = new Map();
  for (const file of retained.filter((file) => file.includes('node_modules/'))) {
    let directory = path.dirname(path.resolve(workspace, file));
    while (directory !== path.dirname(directory)) {
      try {
        const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
        if (pkg.name && pkg.version) {
          dependencies.set(pkg.name, { directory, version: pkg.version });
          break;
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      directory = path.dirname(directory);
    }
  }
  for (const [name, info] of dependencies) {
    const licenses = (await readdir(info.directory)).filter((file) =>
      /^(LICENSE|NOTICE|COPYING)(\.|$)/i.test(file),
    );
    if (!licenses.length) throw new Error(`MISSING_DEPENDENCY_LICENSE:${name}`);
    for (const file of licenses)
      await copy(
        path.join(info.directory, file),
        path.join(output, 'licenses', name.replaceAll('/', '__'), file),
      );
  }
  const staged = [];
  for (const file of await files(output))
    staged.push({
      path: file,
      sha256: await digest(path.join(output, file)),
      length: (await lstat(path.join(output, file))).size,
    });
  const git = (...args) =>
    execFileSync('git', args, { cwd: workspace, encoding: 'utf8', windowsHide: true }).trim();
  const manifest = {
    schemaVersion: 1,
    developmentOnly: true,
    sourceRevision: git('rev-parse', 'HEAD'),
    dirtyFiles: git('status', '--porcelain').split('\n').filter(Boolean),
    lockfileSha256: await digest(path.join(workspace, 'pnpm-lock.yaml')),
    electron: require('electron/package.json').version,
    buildNode: process.version,
    nativeBuild: { msvc: '14.44.35207', nodeHeaders: '24.7.0', arch: 'x64' },
    dependencies: Object.fromEntries([...dependencies].map(([name, info]) => [name, info.version])),
    files: staged,
  };
  await writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
