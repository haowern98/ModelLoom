param([switch]$LocalTest, [switch]$TimeoutSelfTest, [switch]$StartupOnly, [switch]$VerifiedStartup, [string]$Lease = '')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function Wait-MiningLease([string]$StopFile, [int]$Milliseconds) {
    $watch = [Diagnostics.Stopwatch]::StartNew()
    while (-not [IO.File]::Exists($StopFile) -and $watch.ElapsedMilliseconds -lt $Milliseconds) { Start-Sleep -Milliseconds 20 }
}
Add-Type -TypeDefinition @'
using System;
using System.Threading.Tasks;
public static class MiningLeaseInput {
    // Console.In.ReadLineAsync on .NET Framework may block synchronously.
    public static bool Wait(int milliseconds) {
        return Task.Run(() => Console.In.ReadLine()).Wait(milliseconds);
    }
}
'@
if ($TimeoutSelfTest) {
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $completed = [MiningLeaseInput]::Wait(100)
    if ($completed -or $watch.ElapsedMilliseconds -gt 2000) { throw 'Input deadline failed' }
    $watch.Restart()
    Wait-MiningLease (Join-Path $PSScriptRoot ("../out/lease-self-test-" + [Guid]::NewGuid().ToString('N') + '.stop')) 100
    if ($watch.ElapsedMilliseconds -gt 2000) { throw 'Independent lease deadline failed' }
    $fixture = Start-Process -FilePath "$env:SystemRoot\System32\cmd.exe" -ArgumentList @('/d', '/c', 'exit 0') -WindowStyle Hidden -PassThru
    try {
        $null = $fixture.Handle
        if (-not $fixture.WaitForExit(2000) -or $fixture.ExitCode -ne 0) { throw 'Exit receipt failed' }
    } finally { $fixture.Dispose() }
    [Console]::Out.WriteLine('lease-timeout-confirmed')
    return
}
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Elevated test owner required' }
if ($env:COMPUTERNAME -notin @('HAOWERNSLAPPY', 'PTSS')) { throw 'Unexpected diagnostic host' }
$taskName = 'KryptexElevationV2'
$task = Get-ScheduledTask -TaskName $taskName
if ($task.Actions.Count -ne 1 -or $task.Actions[0].Execute.Trim('"') -ne 'C:\Program Files\Kryptex\Kryptex.exe') { throw 'Unexpected mining restart task' }
$processes = @(Get-Process | Where-Object { $_.ProcessName -match '^(Kryptex|KryptexService|kryptex_[a-zA-Z0-9_-]+)$' })
if (-not $processes.Count) { throw 'Mining state changed before diagnostic' }
foreach ($item in $processes) {
    $image = [IO.Path]::GetFullPath($item.Path)
    $roots = @('C:\Program Files\Kryptex\', (Join-Path $env:APPDATA 'Kryptex\'))
    if (-not ($roots | Where-Object { $image.StartsWith($_, [StringComparison]::OrdinalIgnoreCase) })) { throw 'Unexpected miner image' }
    $null = $item.Handle # Retain the process object/handle, never reselect by image name to terminate.
}
try {
    foreach ($item in ($processes | Sort-Object @{Expression={if ($_.ProcessName -eq 'KryptexService') {0} elseif ($_.ProcessName -eq 'Kryptex') {1} else {2}}})) {
        if (-not $item.HasExited) { $item.Kill(); if (-not $item.WaitForExit(5000)) { throw 'Miner did not stop' } }
    }
    Start-Sleep -Seconds 2
    if (Get-Process | Where-Object { $_.ProcessName -match '^(Kryptex|KryptexService|kryptex_[a-zA-Z0-9_-]+)$' }) { throw 'Mining restarted during pause' }
    [Console]::Out.WriteLine('{"phase":"mining-paused"}')
    [Console]::Out.Flush()
    if ($LocalTest -or $StartupOnly) {
        $node = if ($StartupOnly) { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../node.exe')) } else { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../out/tooling/node-v24.21.0-win-x64/node.exe')) }
        $log = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../out/peer-acceptance'))
        if ($StartupOnly) { $log = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../out')) }
        $args = if ($StartupOnly -and $VerifiedStartup) { @((Join-Path $PSScriptRoot '../out/peers/start-verified.mjs'), '--start-verified') } elseif ($StartupOnly) { @((Join-Path $PSScriptRoot '../out/peers/start-cuda.mjs'), '--start-cuda') } else { @((Join-Path $PSScriptRoot 'probe-peer-pairing.mjs'), '--gpu') }
        $child = Start-Process -FilePath $node -ArgumentList $args -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $log 'controller-output.log') -RedirectStandardError (Join-Path $log 'controller-errors.log')
        $null = $child.Handle
        try {
            $limit = if ($StartupOnly) { 45000 } else { 240000 }
            if (-not $child.WaitForExit($limit)) {
                $child.Kill()
                if (-not $child.WaitForExit(5000)) { throw 'Diagnostic owner exit unconfirmed' }
                throw 'Diagnostic owner exceeded total deadline'
            }
            if ($child.ExitCode -ne 0) { throw 'Two-PC GPU test failed' }
        } finally { $child.Dispose() }
    } else {
        # OpenSSH's Windows input handle is not a reliable stop signal. Poll
        # a fixed owned lease path, with an independent total expiry.
        if ($Lease -notmatch '^[a-f0-9]{32}$') { throw 'Invalid mining lease' }
        $stopFile = Join-Path $PSScriptRoot "../out/mining-$Lease.stop"
        try {
            Wait-MiningLease $stopFile 240000
        } finally { if ([IO.File]::Exists($stopFile)) { [IO.File]::Delete($stopFile) } }
    }
} finally {
    Start-ScheduledTask -TaskName $taskName
    $deadline = [DateTime]::UtcNow.AddSeconds(35)
    do {
        Start-Sleep -Seconds 1
        $restored = @(Get-Process | Where-Object { $_.ProcessName -like 'kryptex_*' })
    } while (-not $restored.Count -and [DateTime]::UtcNow -lt $deadline)
    if (-not $restored.Count) { throw 'Mining restart requires attention' }
    [Console]::Out.WriteLine('{"phase":"mining-restored"}')
    [Console]::Out.Flush()
    foreach ($item in $processes) { $item.Dispose() }
}
