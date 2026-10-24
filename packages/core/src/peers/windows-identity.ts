import { execFile } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ownershipBinding } from '../hosts/windows-ownership.js';

// Fixed platform operation. Protected bytes travel on stdin, never command-line
// arguments. No caller script, subject, key algorithm or DPAPI scope is accepted.
const script = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$rsa = $null; $old = $null; $cert = $null; $plain = $null
$rootKey = $null; $root = $null; $publicRoot = $null; $unsigned = $null; $loaded = $null
$entropy = [Text.Encoding]::UTF8.GetBytes('ModelLoom.peer-identity.v1')
try {
  $saved = [Console]::In.ReadToEnd()
  if ($saved.Length -gt 90000) { throw 'size' }
  if ($saved.Length) {
    $plain = [Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($saved), $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    $flags = [Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet -bor [Security.Cryptography.X509Certificates.X509KeyStorageFlags]::Exportable
    $loaded = [Security.Cryptography.X509Certificates.X509Certificate2Collection]::new()
    $loaded.Import($plain, '', $flags)
    $private = @($loaded | Where-Object { $_.HasPrivateKey })
    if ($loaded.Count -gt 2 -or $private.Count -ne 1) { throw 'key' }
    $old = $private[0]
    $previousRsa = [Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($old)
    if (-not $previousRsa -or $previousRsa.KeySize -ne 3072) { throw 'key' }
    $parameters = $null
    try {
      # Framework cannot CopyWithPrivateKey an imported ephemeral CNG handle.
      # Clone in memory into a fresh ephemeral handle, preserving the key.
      if (-not ($previousRsa -is [Security.Cryptography.RSACng]) -or -not $previousRsa.Key.IsEphemeral) { throw 'key' }
      $exportPolicy = [int]([Security.Cryptography.CngExportPolicies]::AllowExport -bor [Security.Cryptography.CngExportPolicies]::AllowPlaintextExport)
      $previousRsa.Key.SetProperty([Security.Cryptography.CngProperty]::new('Export Policy', [BitConverter]::GetBytes($exportPolicy), [Security.Cryptography.CngPropertyOptions]::None))
      $parameters = $previousRsa.ExportParameters($true)
      $rsa = [Security.Cryptography.RSACng]::new(3072)
      $rsa.ImportParameters($parameters)
    } finally {
      if ($parameters) { foreach ($field in @('D','DP','DQ','InverseQ','P','Q','Modulus','Exponent')) { $bytes=$parameters.$field; if($bytes){[Array]::Clear($bytes,0,$bytes.Length)} } }
      $previousRsa.Dispose()
    }
  } else { $rsa = [Security.Cryptography.RSACng]::new(3072) }
  # Only the peer identity key persists. A disposable CA supplies a conventional
  # TLS chain for Electron/BoringSSL without adding trust to Windows or Node.
  $rootKey = [Security.Cryptography.RSACng]::new(3072)
  $rootRequest = [Security.Cryptography.X509Certificates.CertificateRequest]::new(('CN=ModelLoom trust anchor ' + [Guid]::NewGuid().ToString('N')), $rootKey, [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
  $rootRequest.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true, $true, 0, $true))
  $rootRequest.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new([Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyCertSign, $true))
  $root = $rootRequest.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5), [DateTimeOffset]::UtcNow.AddYears(1))
  $publicRoot = [Security.Cryptography.X509Certificates.X509Certificate2]::new($root.RawData)
    $request = [Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=ModelLoom peer', $rsa, [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true))
    $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new([Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature, $true))
    $oids = [Security.Cryptography.OidCollection]::new()
    $null = $oids.Add([Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1'))
    $null = $oids.Add([Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.2'))
    $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($oids, $true))
    $unsigned = $request.Create($root, [DateTimeOffset]$root.NotBefore.ToUniversalTime(), [DateTimeOffset]$root.NotAfter.ToUniversalTime(), [Guid]::NewGuid().ToByteArray())
    $cert = [Security.Cryptography.X509Certificates.RSACertificateExtensions]::CopyWithPrivateKey($unsigned, $rsa)
  if ($plain) { [Array]::Clear($plain, 0, $plain.Length) }
  $chain = [Security.Cryptography.X509Certificates.X509Certificate2Collection]::new()
  $null = $chain.Add($cert); $null = $chain.Add($publicRoot)
  $plain = $chain.Export([Security.Cryptography.X509Certificates.X509ContentType]::Pkcs12, '')
  $protected = [Security.Cryptography.ProtectedData]::Protect($plain, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  @{certificate=[Convert]::ToBase64String($cert.RawData); authority=[Convert]::ToBase64String($root.RawData); protectedIdentity=[Convert]::ToBase64String($protected)} | ConvertTo-Json -Compress
} finally {
  if ($plain) { [Array]::Clear($plain, 0, $plain.Length) }
  if ($cert -and $cert -ne $old) { $cert.Dispose() }
  if ($unsigned) { $unsigned.Dispose() }
  if ($publicRoot) { $publicRoot.Dispose() }
  if ($root) { $root.Dispose() }
  if ($rootKey) { $rootKey.Dispose() }
  if ($loaded) { foreach ($item in $loaded) { $item.Dispose() } }
  if ($rsa) { $rsa.Dispose() }
}
`;

export interface WindowsPeerIdentity {
  readonly fingerprint: string;
  readonly certificate: Buffer;
  readonly authority: Buffer;
  readonly protectedIdentity: Buffer;
  /** Core-only TLS material. Never serialize into a renderer/network snapshot. */
  readonly pfx: Buffer;
  close(): void;
}

/** Stable public-key identity, including certificate renewal without changing approval. */
export function peerFingerprint(certificate: Buffer): string {
  const cert = new X509Certificate(certificate);
  const now = Date.now();
  if (
    certificate.length > 8192 ||
    cert.ca ||
    cert.publicKey.asymmetricKeyType !== 'rsa' ||
    cert.publicKey.asymmetricKeyDetails?.modulusLength !== 3072 ||
    Date.parse(cert.validFrom) > now ||
    Date.parse(cert.validTo) <= now
  )
    throw new Error('INVALID_PEER_CERTIFICATE');
  return createHash('sha256')
    .update(cert.publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex');
}

/** Validate only the two-certificate private chain. Pinning still binds the leaf
 * key, so possessing its disposable issuer key could not impersonate that peer. */
export function validatePeerCertificate(certificate: Buffer, authority: Buffer): string {
  try {
    const fingerprint = peerFingerprint(certificate);
    if (!authority.length || authority.length > 8192) throw Error('INVALID_PEER_CERTIFICATE');
    const leaf = new X509Certificate(certificate),
      root = new X509Certificate(authority);
    const now = Date.now();
    if (
      !root.ca ||
      root.publicKey.asymmetricKeyType !== 'rsa' ||
      root.publicKey.asymmetricKeyDetails?.modulusLength !== 3072 ||
      root.subject !== root.issuer ||
      !root.verify(root.publicKey) ||
      !leaf.checkIssued(root) ||
      !leaf.verify(root.publicKey) ||
      Date.parse(root.validFrom) > now ||
      Date.parse(root.validTo) <= now ||
      Date.parse(leaf.validFrom) < Date.parse(root.validFrom) ||
      Date.parse(leaf.validTo) > Date.parse(root.validTo) ||
      leaf.keyUsage?.length !== 2 ||
      !leaf.keyUsage.includes('1.3.6.1.5.5.7.3.1') ||
      !leaf.keyUsage.includes('1.3.6.1.5.5.7.3.2')
    )
      throw Error('INVALID_PEER_CERTIFICATE');
    return fingerprint;
  } catch {
    throw Error('INVALID_PEER_CERTIFICATE');
  }
}

/** Windows-only identity generation/loading. Corrupt protection never triggers regeneration. */
export async function openWindowsPeerIdentity(saved?: Buffer): Promise<WindowsPeerIdentity> {
  try {
    if (
      process.platform !== 'win32' ||
      (saved !== undefined &&
        (!Buffer.isBuffer(saved) || saved.length < 32 || saved.length > 65536))
    )
      throw new Error('INVALID_IDENTITY');
    const powershell = path.join(
      ownershipBinding().systemDirectory(),
      'WindowsPowerShell/v1.0/powershell.exe',
    );
    const output = await new Promise<string>((resolve, reject) => {
      const child = execFile(
        powershell,
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(script, 'utf16le').toString('base64'),
        ],
        { windowsHide: true, timeout: 15_000, maxBuffer: 100_000, encoding: 'utf8' },
        (error, stdout) =>
          error ? reject(new Error('PEER_IDENTITY_UNAVAILABLE')) : resolve(stdout),
      );
      child.stdin?.on('error', () => reject(new Error('PEER_IDENTITY_UNAVAILABLE')));
      child.stdin?.end(saved?.toString('base64') ?? '');
    });
    const value: unknown = JSON.parse(output.replace(/^\uFEFF/u, '').trim());
    if (
      !value ||
      typeof value !== 'object' ||
      typeof Reflect.get(value, 'certificate') !== 'string' ||
      typeof Reflect.get(value, 'authority') !== 'string' ||
      typeof Reflect.get(value, 'protectedIdentity') !== 'string'
    )
      throw new Error('INVALID_IDENTITY');
    const certificate = Buffer.from(Reflect.get(value, 'certificate') as string, 'base64');
    const authority = Buffer.from(Reflect.get(value, 'authority') as string, 'base64');
    const protectedIdentity = Buffer.from(
      Reflect.get(value, 'protectedIdentity') as string,
      'base64',
    );
    const fingerprint = validatePeerCertificate(certificate, authority);
    const native: unknown = createRequire(import.meta.url)(
      fileURLToPath(new URL('../../out/native/peer-identity.node', import.meta.url)),
    );
    if (
      !native ||
      typeof native !== 'object' ||
      typeof Reflect.get(native, 'unprotectPeerIdentity') !== 'function'
    )
      throw new Error('INVALID_NATIVE_BINDING');
    const binding = native as { unprotectPeerIdentity(value: Buffer): Buffer };
    const pfx = binding.unprotectPeerIdentity(protectedIdentity);
    if (!Buffer.isBuffer(pfx) || !pfx.length || pfx.length > 16384)
      throw new Error('INVALID_IDENTITY');
    return Object.freeze({
      fingerprint,
      certificate,
      authority,
      protectedIdentity,
      pfx,
      close() {
        pfx.fill(0);
      },
    });
  } catch {
    throw new Error('PEER_IDENTITY_UNAVAILABLE');
  }
}
