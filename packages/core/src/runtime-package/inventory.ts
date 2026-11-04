export interface PackageFile {
  readonly path: string;
  readonly length: number;
  readonly sha256: string;
}
export interface Inventory {
  readonly schemaVersion: 1;
  readonly packageId: string;
  readonly version: string;
  readonly upstreamCommit: string;
  readonly artifact: string;
  readonly platform: 'win32';
  readonly arch: 'x64';
  readonly backend: 'cpu' | 'cuda';
  readonly minimumDriver: string | null;
  readonly protocol: 1;
  readonly entrypoint: string;
  readonly helper: string;
  readonly stop: 'private-console-ctrl-c';
  readonly files: readonly PackageFile[];
}
/** Display identity from a verified manifest. This projection grants no launch authority. */
export function describeRuntime({
  packageId,
  version,
  artifact,
  platform,
  arch,
  backend,
  upstreamCommit,
}: Inventory) {
  return { packageId, version, artifact, platform, arch, backend, upstreamCommit };
}

export type RuntimePackageDescription = ReturnType<typeof describeRuntime>;

export const METADATA_LIMIT = 1024 * 1024;
export const PACKAGE_LIMIT = 8 * 1024 ** 3;
const bad = (): never => {
  throw new Error('INVALID_INVENTORY');
};
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(value, key))
  )
    return bad();
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(value)
    ? value
    : bad();
}
/** Portable slash paths only; Windows aliases, devices and streams cannot enter an inventory. */
export function packagePath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 240 || !/^[a-zA-Z0-9._/-]+$/u.test(value))
    return bad();
  if (
    value
      .split('/')
      .some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          /[. ]$/u.test(part) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),
      )
  )
    return bad();
  return value;
}
/** Validate signed data before it affects filesystem paths, compatibility or native arguments. */
export function parseInventory(value: unknown): Inventory {
  const v = record(value, [
    'schemaVersion',
    'packageId',
    'version',
    'upstreamCommit',
    'artifact',
    'platform',
    'arch',
    'backend',
    'minimumDriver',
    'protocol',
    'entrypoint',
    'helper',
    'stop',
    'files',
  ]);
  if (
    v.schemaVersion !== 1 ||
    v.platform !== 'win32' ||
    v.arch !== 'x64' ||
    v.protocol !== 1 ||
    v.stop !== 'private-console-ctrl-c' ||
    !['cpu', 'cuda'].includes(String(v.backend)) ||
    typeof v.upstreamCommit !== 'string' ||
    !/^[a-f0-9]{40}$/u.test(v.upstreamCommit) ||
    (v.backend === 'cpu'
      ? v.minimumDriver !== null
      : typeof v.minimumDriver !== 'string' ||
        !/^\d{1,3}(?:\.\d{1,3}){1,3}$/u.test(v.minimumDriver)) ||
    !Array.isArray(v.files) ||
    v.files.length < 2 ||
    v.files.length > 256
  )
    return bad();
  const paths = new Set<string>();
  let bytes = 0;
  const files = v.files.map((input: unknown): PackageFile => {
    const file = record(input, ['path', 'length', 'sha256']);
    const name = packagePath(file.path);
    if (
      paths.has(name.toLowerCase()) ||
      !Number.isSafeInteger(file.length) ||
      Number(file.length) < 1 ||
      typeof file.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(file.sha256)
    )
      return bad();
    bytes += Number(file.length);
    if (bytes > PACKAGE_LIMIT) return bad();
    paths.add(name.toLowerCase());
    return Object.freeze({ path: name, length: Number(file.length), sha256: file.sha256 });
  });
  const entrypoint = packagePath(v.entrypoint),
    helper = packagePath(v.helper);
  if (
    entrypoint === helper ||
    !/\.exe$/iu.test(entrypoint) ||
    !/\.exe$/iu.test(helper) ||
    !files.some((file) => file.path === entrypoint) ||
    !files.some((file) => file.path === helper)
  )
    return bad();
  return Object.freeze({
    schemaVersion: 1,
    packageId: id(v.packageId),
    version: id(v.version),
    upstreamCommit: v.upstreamCommit,
    artifact: id(v.artifact),
    platform: 'win32',
    arch: 'x64',
    backend: v.backend as 'cpu' | 'cuda',
    minimumDriver: v.minimumDriver as string | null,
    protocol: 1,
    entrypoint,
    helper,
    stop: 'private-console-ctrl-c',
    files: Object.freeze(files),
  });
}
