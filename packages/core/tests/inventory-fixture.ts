export const inventory = {
  schemaVersion: 1,
  packageId: 'llama-cpu',
  version: '1.0.0',
  upstreamCommit: '4f31296a907d73f3409f720429bcf31111615d77',
  artifact: 'release-cpu-1',
  platform: 'win32',
  arch: 'x64',
  backend: 'cpu',
  minimumDriver: null,
  protocol: 1,
  entrypoint: 'llama-server.exe',
  helper: 'ModelLoom-runtime-host.exe',
  stop: 'private-console-ctrl-c',
  files: [
    { path: 'llama-server.exe', length: 3, sha256: 'a'.repeat(64) },
    { path: 'ModelLoom-runtime-host.exe', length: 4, sha256: 'b'.repeat(64) },
  ],
};
