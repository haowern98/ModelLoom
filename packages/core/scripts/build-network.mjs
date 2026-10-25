import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
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
const moduleFile = readFileSync(path.join(component, 'go.mod'), 'utf8');
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
  goModSha256: digest(moduleFile),
  goSumSha256: digest(readFileSync(path.join(component, 'go.sum'))),
  sourceSha256: digest(
    Buffer.concat(
      readdirSync(component)
        .filter((name) => name.endsWith('.go'))
        .sort()
        .flatMap((name) => [Buffer.from(`${name}\0`), readFileSync(path.join(component, name))]),
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
  const run = (options) =>
    execFileSync(go, options, {
      cwd: component,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    });
  if (run(['env', 'GOVERSION']).trim() !== 'go1.27.3')
    throw new Error(
      'Networking build requires exactly Go 1.27.3; automatic toolchain downloads are disabled',
    );
  process.stdout.write(run(['mod', 'verify']));
  mkdirSync(output, { recursive: true });
  run([
    'build',
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
}
