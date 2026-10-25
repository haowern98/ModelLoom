const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/** Validate prebuilt networking artifacts before exposing a narrowly staged resource. */
function prepareNetworkResource(config, platform, architecture) {
  const os = platform === 'win32' ? 'windows' : platform;
  const arch = architecture === 'x64' ? 'amd64' : architecture;
  const target = `${os}-${arch}`;
  if (
    !['windows-amd64', 'linux-amd64', 'linux-arm64', 'darwin-amd64', 'darwin-arm64'].includes(
      target,
    )
  )
    throw new Error(`Unsupported networking package target: ${target}`);
  const root = path.resolve(__dirname, '../../..');
  childProcess.execFileSync(
    process.execPath,
    [path.join(root, 'packages/core/scripts/build-network.mjs'), '--target', target, '--check'],
    { cwd: root, stdio: 'inherit', windowsHide: true },
  );
  const artifactRoot = path.join(root, 'components/tailscale/out', target);
  const resource = path.join(artifactRoot, 'tailscale');
  // Recreate only this exact owned staging directory so old artifacts cannot leak into a package.
  fs.rmSync(resource, { recursive: true, force: true });
  fs.mkdirSync(resource, { recursive: true });
  const binary = `modelloom-network${platform === 'win32' ? '.exe' : ''}`;
  for (const name of [binary, 'manifest.json', 'THIRD-PARTY-NOTICES.txt'])
    fs.copyFileSync(path.join(artifactRoot, name), path.join(resource, name));
  const existing = config.packagerConfig.extraResource ?? [];
  config.packagerConfig.extraResource = [
    ...(Array.isArray(existing) ? existing : [existing]),
    resource,
  ];
}

module.exports = { prepareNetworkResource };
