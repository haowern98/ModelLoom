param([Parameter(Mandatory)][ValidateSet('protect','unprotect')][string]$Operation)
$ErrorActionPreference = 'Stop'
$bytes = $null
$result = $null
try {
  Add-Type -AssemblyName System.Security
  $chars = New-Object char[] 65537
  $count = [Console]::In.ReadBlock($chars, 0, $chars.Length)
  if ($count -gt 65536) { throw 'INVALID_INPUT' }
  $bytes = [Convert]::FromBase64String([string]::new($chars, 0, $count))
  if ($bytes.Length -eq 0 -or $bytes.Length -gt 16384) { throw 'INVALID_INPUT' }
  $scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
  if ($Operation -eq 'protect') {
    $result = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, $scope)
  } else {
    $result = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, $scope)
  }
  [Console]::Out.Write([Convert]::ToBase64String($result))
} catch {
  [Console]::Error.Write('DPAPI_FAILED')
  exit 2
} finally {
  if ($bytes) { [Array]::Clear($bytes, 0, $bytes.Length) }
  if ($result) { [Array]::Clear($result, 0, $result.Length) }
  if ($chars) { [Array]::Clear($chars, 0, $chars.Length) }
}
