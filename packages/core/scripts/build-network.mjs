import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { Buffer } from 'node:buffer';

const component = fileURLToPath(new URL('../../../components/tailscale/', import.meta.url));
const targets = new Set([
  'windows-amd64',
  'linux-amd64',
  'linux-arm64',
  'darwin-amd64',
  'darwin-arm64',
]);
const hostOS = process.platform === 'win32' ? 'windows' : process.platform;
const hostArch = process.arch === 'x64' ? 'amd64' : process.arch;
let target = `${hostOS}-${hostArch}`;
let check = false;
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--check' && !check) check = true;
  else if (args[index] === '--target' && args[index + 1]) target = args[++index];
  else throw new Error('Usage: build-network.mjs [--target os-arch] [--check]');
}
if (!targets.has(target)) throw new Error(`Unsupported networking target: ${target}`);
const [os, arch] = target.split('-');
const output = path.join(component, 'out', target);
const binary = path.join(output, `modelloom-network${os === 'windows' ? '.exe' : ''}`);
const manifestPath = path.join(output, 'manifest.json');
const digest = (value) => createHash('sha256').update(value).digest('hex');
const sourceText = (file) => readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
const moduleFile = sourceText(path.join(component, 'go.mod'));
const patchFile = path.join(component, 'patches/gvisor-sack-outstanding.patch');
const recoveryPatch = path.join(component, 'patches/gvisor-spurious-recovery.patch');
if (
  !/^go 1\.27\.3\s*$/m.test(moduleFile) ||
  !/^require tailscale\.com v1\.104\.2\s*$/m.test(moduleFile)
)
  throw new Error('Networking module does not match the approved Go/Tailscale pins');
const expected = {
  protocol: 1,
  target,
  goVersion: '1.27.3',
  tailscaleVersion: '1.104.2',
  gvisorPatchSha256: digest(readFileSync(patchFile)),
  gvisorRecoveryPatchSha256: digest(readFileSync(recoveryPatch)),
  goModSha256: digest(moduleFile),
  goSumSha256: digest(sourceText(path.join(component, 'go.sum'))),
  sourceSha256: digest(
    Buffer.concat(
      readdirSync(component, { recursive: true })
        .filter(
          (name) =>
            name.endsWith('.go') &&
            !name.endsWith('_test.go') &&
            !name.startsWith(`out${path.sep}`),
        )
        .sort()
        .flatMap((name) => [
          Buffer.from(`${name.replaceAll(path.sep, '/')}\0`),
          Buffer.from(sourceText(path.join(component, name))),
        ]),
    ),
  ),
};
if (check) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const [key, value] of Object.entries(expected))
    if (manifest[key] !== value) throw new Error(`Networking manifest mismatch: ${key}`);
  if (manifest.sha256 !== digest(readFileSync(binary)))
    throw new Error('Networking executable checksum mismatch');
  if (manifest.noticesSha256 !== digest(readFileSync(path.join(output, 'THIRD-PARTY-NOTICES.txt'))))
    throw new Error('Networking notices checksum mismatch');
  console.log(`Verified networking artifact: ${target}`);
} else {
  const go = process.env.MODELLOOM_GO || 'go';
  const env = {
    ...process.env,
    GOTOOLCHAIN: 'local',
    CGO_ENABLED: '0',
    GOOS: os,
    GOARCH: arch,
    GOFLAGS: '',
  };
  const run = (options, overrides = {}) =>
    execFileSync(go, options, {
      cwd: component,
      env: { ...env, ...overrides },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    });
  if (run(['env', 'GOVERSION']).trim() !== 'go1.27.3')
    throw new Error(
      'Networking build requires exactly Go 1.27.3; automatic toolchain downloads are disabled',
    );
  process.stdout.write(run(['mod', 'verify']));
  mkdirSync(output, { recursive: true });
  // Carry the tested upstream correction without editing the shared module cache.
  const scratch = mkdtempSync(path.join(component, 'out', '.tcp-'));
  try {
    const gvisor = JSON.parse(run(['list', '-mod=readonly', '-m', '-json', 'gvisor.dev/gvisor']));
    if (gvisor.Version !== 'v0.0.0-20260915211658-a6f909f08a72')
      throw new Error('Revalidate the TCP patch before changing gVisor');
    const relative = 'pkg/tcpip/transport/tcp/snd.go';
    const original = path.join(gvisor.Dir, relative);
    if (
      digest(readFileSync(original)) !==
      '88620ed933425efa34baf809b6920567bf1e05d99159845427894f0eb98d33c9'
    )
      throw new Error('Unexpected gVisor TCP source');
    const patchedModule = path.join(scratch, 'gvisor');
    cpSync(gvisor.Dir, patchedModule, { recursive: true });
    chmodSync(path.join(patchedModule, relative), 0o644);
    const rackFile = path.join(patchedModule, 'pkg/tcpip/transport/tcp/rack.go');
    if (
      digest(readFileSync(rackFile)) !==
      '83def4904896210a5343b69287eaa8c2b246511b3e02f83de3e09d586a792482'
    )
      throw new Error('Unexpected gVisor RACK source');
    chmodSync(rackFile, 0o644);
    // An enclosing checkout otherwise makes Git silently skip this ignored build directory.
    const patchEnv = { ...process.env, GIT_CEILING_DIRECTORIES: scratch };
    delete patchEnv.GIT_DIR;
    delete patchEnv.GIT_WORK_TREE;
    delete patchEnv.GIT_INDEX_FILE;
    const patchOptions = { cwd: patchedModule, env: patchEnv };
    // Keep patched source bytes independent of the host's Git line-ending configuration.
    const apply = ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'apply', '--no-index'];
    execFileSync('git', [...apply, '--check', patchFile], patchOptions);
    execFileSync('git', [...apply, patchFile], patchOptions);
    if (
      digest(readFileSync(path.join(patchedModule, relative))) !==
      'a22521bd4f5d0727f167071cbef0ec932e595309d477ab5cfea4dd644521ad4a'
    )
      throw new Error('TCP patch did not produce the validated source');
    execFileSync('git', [...apply, '--check', recoveryPatch], patchOptions);
    execFileSync('git', [...apply, recoveryPatch], patchOptions);
    if (
      digest(readFileSync(path.join(patchedModule, relative))) !==
        '3091b338e7aa074c9c04b05a3800a83e408b03dfe9c49b85f60e8488d840839f' ||
      digest(readFileSync(rackFile)) !==
        '4d6d3fa2f310c32835627d2943994c27a98893935e7a2a7b89fd1ee91a24a3ad'
    )
      throw new Error('Recovery patch did not produce the validated source');
    const modfile = path.join(scratch, 'network.mod');
    const replacement = `./${path.relative(component, patchedModule).replaceAll(path.sep, '/')}`;
    writeFileSync(modfile, `${moduleFile}\nreplace gvisor.dev/gvisor => ${replacement}\n`);
    copyFileSync(path.join(component, 'go.sum'), path.join(scratch, 'network.sum'));
    const moduleFlag = `-modfile=${modfile}`;
    env.MODELLOOM_PATCHED_TCP_TEST = '1';
    process.stdout.write(
      run(['test', moduleFlag, '-trimpath', '-mod=readonly', '-count=1', '-timeout=60s', './...'], {
        GOOS: hostOS,
        GOARCH: hostArch,
      }),
    );
    run([
      'build',
      moduleFlag,
      '-mod=readonly',
      '-trimpath',
      '-buildvcs=false',
      '-ldflags=-buildid=',
      '-o',
      binary,
      '.',
    ]);
    // Use the binary's module metadata, not every module present in the download cache.
    const dependencies = new Map();
    for (const row of run([
      'list',
      moduleFlag,
      '-mod=readonly',
      '-deps',
      '-f',
      '{{if .Module}}{{.Module.Path}}\t{{.Module.Version}}\t{{.Module.Dir}}{{end}}',
      '.',
    ]).split(/\r?\n/)) {
      const [modulePath, version, directory] = row.split('\t');
      if (directory) dependencies.set(`${modulePath}@${version}`, directory);
    }
    const notices = ['ModelLoom embedded networking third-party notices', ''];
    const goRoot = run(['env', 'GOROOT']).trim();
    notices.push('Go 1.27.3 standard library', readFileSync(path.join(goRoot, 'LICENSE'), 'utf8'));
    for (const row of run(['version', '-m', binary]).split(/\r?\n/)) {
      const fields = row.trim().split(/\s+/);
      if (fields[0] !== 'dep') continue;
      const [, modulePath, version] = fields;
      const directory = dependencies.get(`${modulePath}@${version}`);
      if (!directory) throw new Error(`Cannot locate compiled dependency notices: ${modulePath}`);
      const legalFiles = readdirSync(directory)
        .filter(
          (name) =>
            /^(licen[sc]e|copying|notice|copyright)([.\-_]|$)/i.test(name) &&
            statSync(path.join(directory, name)).isFile(),
        )
        .sort();
      if (!legalFiles.length) throw new Error(`Missing compiled dependency license: ${modulePath}`);
      notices.push(`\n${modulePath} ${version}`);
      for (const name of legalFiles)
        notices.push(`\n--- ${name} ---\n`, readFileSync(path.join(directory, name), 'utf8'));
    }
    const noticesText = `${notices.join('\n')}\n`;
    writeFileSync(path.join(output, 'THIRD-PARTY-NOTICES.txt'), noticesText);
    writeFileSync(
      manifestPath,
      `${JSON.stringify({ ...expected, sha256: digest(readFileSync(binary)), noticesSha256: digest(noticesText) }, null, 2)}\n`,
    );
    console.log(`Built networking artifact: ${target}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
