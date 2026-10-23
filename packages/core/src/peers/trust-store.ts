import { execFile } from 'node:child_process';
import { open, rename, unlink, lstat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash, X509Certificate } from 'node:crypto';
import { ownershipBinding } from '../hosts/windows-ownership.js';
import { privatePeerHost } from './wire.js';

export interface PeerTrust {
  direction: 'incoming' | 'outgoing';
  fingerprint: string;
  name: string;
  certificate: string;
  authority: string;
  gpuIds: string[];
  address?: string;
  securePort?: number;
}
type Protection = (data: Buffer, protect: boolean) => Promise<Buffer>;
const MAX_BYTES = 262144;
function decode(value: unknown): PeerTrust[] {
  if (!Array.isArray(value) || value.length > 16) throw Error('PEER_TRUST_UNAVAILABLE');
  const keys = new Set<string>();
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw Error('PEER_TRUST_UNAVAILABLE');
    const v = entry as Record<string, unknown>;
    const allowed = [
      'direction',
      'fingerprint',
      'name',
      'certificate',
      'authority',
      'gpuIds',
      ...(v.direction === 'outgoing' ? ['address', 'securePort'] : []),
    ];
    if (
      Object.keys(v).length !== allowed.length ||
      Object.keys(v).some((key) => !allowed.includes(key)) ||
      !['incoming', 'outgoing'].includes(String(v.direction)) ||
      typeof v.fingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(v.fingerprint) ||
      typeof v.name !== 'string' ||
      !v.name.length ||
      v.name.length > 80 ||
      [...v.name].some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      typeof v.certificate !== 'string' ||
      typeof v.authority !== 'string' ||
      v.certificate.length > 12000 ||
      v.authority.length > 12000 ||
      !Array.isArray(v.gpuIds) ||
      v.gpuIds.length > 16 ||
      v.gpuIds.some((id: unknown) => typeof id !== 'string' || !id.length || id.length > 160)
    )
      throw Error('PEER_TRUST_UNAVAILABLE');
    // Stored public certificates can expire while the stable key remains trusted.
    // The live TLS path always validates a fresh chain before accepting renewal.
    const cert = new X509Certificate(Buffer.from(v.certificate, 'base64'));
    const identity = createHash('sha256')
      .update(cert.publicKey.export({ type: 'spki', format: 'der' }))
      .digest('hex');
    const key = `${String(v.direction)}:${identity}`;
    if (identity !== v.fingerprint || keys.has(key)) throw Error('PEER_TRUST_UNAVAILABLE');
    keys.add(key);
    if (
      v.direction === 'outgoing' &&
      (typeof v.address !== 'string' ||
        !privatePeerHost(v.address) ||
        !Number.isInteger(v.securePort) ||
        (v.securePort as number) < 1024 ||
        (v.securePort as number) > 65535)
    )
      throw Error('PEER_TRUST_UNAVAILABLE');
    return {
      direction: v.direction as PeerTrust['direction'],
      fingerprint: identity,
      name: v.name,
      certificate: v.certificate,
      authority: v.authority,
      gpuIds: v.gpuIds.map((id: unknown) => String(id)),
      ...(v.direction === 'outgoing'
        ? { address: v.address as string, securePort: v.securePort as number }
        : {}),
    };
  });
}
const script = `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$raw=[Convert]::FromBase64String([Console]::In.ReadToEnd())
$entropy=[Text.Encoding]::UTF8.GetBytes('ModelLoom-peer-trust-v1')
try {
 if($args[0] -eq 'protect') { $result=[Security.Cryptography.ProtectedData]::Protect($raw,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser) }
 else { $result=[Security.Cryptography.ProtectedData]::Unprotect($raw,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser) }
 [Console]::Out.Write([Convert]::ToBase64String($result))
} finally { [Array]::Clear($raw,0,$raw.Length); if($result){[Array]::Clear($result,0,$result.Length)} }
`;
/** Current-user DPAPI, fixed entropy and executable. Data travels on stdin only. */
async function windowsProtection(data: Buffer, protect: boolean): Promise<Buffer> {
  const source = script.replace("$args[0] -eq 'protect'", protect ? '$true' : '$false');
  return new Promise((resolve, reject) => {
    const child = execFile(
      path.join(ownershipBinding().systemDirectory(), 'WindowsPowerShell/v1.0/powershell.exe'),
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(source, 'utf16le').toString('base64'),
      ],
      { windowsHide: true, timeout: 15000, maxBuffer: MAX_BYTES * 2 },
      (error, out) => {
        if (error) reject(Error('PEER_TRUST_UNAVAILABLE'));
        else {
          const result = Buffer.from(out.trim(), 'base64');
          if (!result.length || result.length > MAX_BYTES) reject(Error('PEER_TRUST_UNAVAILABLE'));
          else resolve(result);
        }
      },
    );
    child.stdin?.on('error', () => reject(Error('PEER_TRUST_UNAVAILABLE')));
    child.stdin?.end(data.toString('base64'));
  });
}

/** Fixed installation-bound, encrypted trust file. No caller-supplied IPC path. */
export class PeerTrustStore {
  private operations: Promise<void> = Promise.resolve();
  constructor(
    private readonly directory: string,
    private readonly fingerprint: string,
    private readonly protection: Protection = windowsProtection,
    private readonly guard?: Pick<
      ReturnType<typeof ownershipBinding>,
      'sealFiles' | 'releaseFiles'
    >,
  ) {}
  private filename(): string {
    return path.join(this.directory, 'trust.dpapi');
  }
  async read(): Promise<PeerTrust[]> {
    let file;
    let lock: object | undefined;
    try {
      const stat = await lstat(this.filename());
      if (stat.isSymbolicLink()) throw Error('PEER_TRUST_UNAVAILABLE');
      lock = this.guard?.sealFiles([this.filename()]);
      file = await open(this.filename(), 'r');
    } catch (error: unknown) {
      if (lock) this.guard?.releaseFiles(lock);
      if (error && typeof error === 'object' && Reflect.get(error, 'code') === 'ENOENT') return [];
      throw Error('PEER_TRUST_UNAVAILABLE', { cause: error });
    }
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size < 1 || stat.size > MAX_BYTES)
        throw Error('PEER_TRUST_UNAVAILABLE');
      const plain = await this.protection(await file.readFile(), false);
      try {
        const data: unknown = JSON.parse(plain.toString('utf8'));
        if (
          !data ||
          typeof data !== 'object' ||
          Array.isArray(data) ||
          Object.keys(data).length !== 3 ||
          Reflect.get(data, 'version') !== 1 ||
          Reflect.get(data, 'installation') !== this.fingerprint
        )
          throw Error('PEER_TRUST_UNAVAILABLE');
        return decode(Reflect.get(data, 'peers'));
      } finally {
        plain.fill(0);
      }
    } catch {
      throw Error('PEER_TRUST_UNAVAILABLE');
    } finally {
      await file.close();
      if (lock) this.guard?.releaseFiles(lock);
    }
  }
  write(peers: readonly PeerTrust[]): Promise<void> {
    const captured = decode(peers);
    const operation = this.operations.then(async () => {
      const plain = Buffer.from(
        JSON.stringify({ version: 1, installation: this.fingerprint, peers: captured }),
      );
      let protectedValue: Buffer;
      try {
        if (plain.length > MAX_BYTES - 4096) throw Error('PEER_TRUST_UNAVAILABLE');
        protectedValue = await this.protection(plain, true);
      } finally {
        plain.fill(0);
      }
      const temporary = path.join(this.directory, `trust-${randomUUID()}.tmp`);
      try {
        try {
          const existing = await lstat(this.filename());
          if (existing.isSymbolicLink() || !existing.isFile() || existing.nlink !== 1)
            throw Error('PEER_TRUST_UNAVAILABLE');
          const lock = this.guard?.sealFiles([this.filename()]);
          if (lock) this.guard?.releaseFiles(lock);
        } catch (error: unknown) {
          if (!error || typeof error !== 'object' || Reflect.get(error, 'code') !== 'ENOENT')
            throw error;
        }
        const file = await open(temporary, 'wx', 0o600);
        try {
          await file.writeFile(protectedValue);
          await file.sync();
        } finally {
          await file.close();
          protectedValue.fill(0);
        }
        await rename(temporary, this.filename());
      } catch {
        await unlink(temporary).catch(() => undefined);
        throw Error('PEER_TRUST_UNAVAILABLE');
      }
    });
    this.operations = operation.catch(() => undefined);
    return operation;
  }
}
