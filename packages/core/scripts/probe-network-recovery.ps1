param([switch]$RecoverOnly)
$ErrorActionPreference = 'Stop'
$probeExe = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../out/network-guard-probe/network-guard-probe.exe'))
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RecoveryProbeIdentity {
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool GetNamedPipeClientProcessId(IntPtr pipe, out uint pid);
}
'@
function Invoke-RecoveryProbe([string]$Mode, [scriptblock]$Action) {
    $nonce = [Guid]::NewGuid().ToString('N')
    $pipe = [IO.Pipes.NamedPipeServerStream]::new("ModelLoom-guard-probe-$nonce", [IO.Pipes.PipeDirection]::InOut, 1,
        [IO.Pipes.PipeTransmissionMode]::Byte, ([IO.Pipes.PipeOptions]::Asynchronous -bor [IO.Pipes.PipeOptions]::CurrentUserOnly))
    $process = $null
    try {
        $process = Start-Process -FilePath $probeExe -ArgumentList @($nonce, "$PID", $Mode) -Verb RunAs -WindowStyle Hidden -PassThru
        $null = $pipe.WaitForConnectionAsync().WaitAsync([TimeSpan]::FromSeconds(15)).GetAwaiter().GetResult()
        [uint32]$clientPid = 0
        if (-not [RecoveryProbeIdentity]::GetNamedPipeClientProcessId($pipe.SafePipeHandle.DangerousGetHandle(), [ref]$clientPid) -or $clientPid -ne $process.Id) { throw 'Wrong recovery reporter.' }
        $reader = [IO.StreamReader]::new($pipe, [Text.Encoding]::UTF8, $false, 4096, $true)
        & $Action $pipe $reader $process
    } finally {
        $pipe.Dispose()
        if ($process) { $process.Dispose() }
    }
}
function Read-RecoveryReport($Reader) {
    $line = $Reader.ReadLineAsync().WaitAsync([TimeSpan]::FromSeconds(20)).GetAwaiter().GetResult()
    if (-not $line -or $line.Length -gt 4096) { throw 'Missing/big recovery report.' }
    Write-Host $line
    return ($line | ConvertFrom-Json)
}
function Assert-RecoveryConnection([int]$Port, [Net.Sockets.SocketError]$Expected) {
    $client = [Net.Sockets.TcpClient]::new()
    $observed = $null
    try { $null = $client.ConnectAsync([Net.IPAddress]::Loopback, $Port).WaitAsync([TimeSpan]::FromSeconds(5)).GetAwaiter().GetResult() }
    catch {
        $errorValue = $_.Exception
        while ($errorValue.InnerException) { $errorValue = $errorValue.InnerException }
        if ($errorValue -is [Net.Sockets.SocketException]) { $observed = $errorValue.SocketErrorCode }
    } finally { $client.Dispose() }
    if ($observed -ne $Expected) { throw "Expected $Expected on $Port; observed $observed" }
}
if ($RecoverOnly) {
    Invoke-RecoveryProbe '--recover-crash' {
        param($pipe, $reader, $process)
        $result = Read-RecoveryReport $reader
        if ($result.phase -ne 'crash-recovered' -or -not $result.jobsEmpty) { throw 'Stale diagnostic recovery failed.' }
        $null = $process.WaitForExitAsync().WaitAsync([TimeSpan]::FromSeconds(8)).GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) { throw 'Recovery helper failed.' }
    }
    return
}
$script:crashPort = 0
Invoke-RecoveryProbe '--crash-owner' {
    param($pipe, $reader, $process)
    $ready = Read-RecoveryReport $reader
    if ($ready.phase -ne 'worker-ready' -or -not $ready.workerRestricted -or $ready.rpcVersion -ne '7.0.0') { throw 'Crash fixture never became ready.' }
    $script:crashPort = [int]$ready.port
    Assert-RecoveryConnection $script:crashPort ([Net.Sockets.SocketError]::AccessDenied)
    Invoke-RecoveryProbe '--recover-crash' {
        param($livePipe, $liveReader, $liveProcess)
        $liveResult = Read-RecoveryReport $liveReader
        if ($liveResult.phase -ne 'crash-recovered' -or $liveResult.assignments -ne 0 -or $liveResult.filters -ne 0 -or $liveResult.live -ne 1) { throw 'Recovery touched a live owner.' }
        $null = $liveProcess.WaitForExitAsync().WaitAsync([TimeSpan]::FromSeconds(8)).GetAwaiter().GetResult()
        if ($liveProcess.ExitCode -ne 0) { throw 'Live-owner check failed.' }
    }
    $pipe.WriteByte([byte][char]'C')
    $pipe.Flush()
    $null = $process.WaitForExitAsync().WaitAsync([TimeSpan]::FromSeconds(8)).GetAwaiter().GetResult()
    if ($process.ExitCode -ne 12) { throw 'Owner did not crash as requested.' }
}
# The original elevated owner and all its handles are now gone. No filter IDs,
# process handles or recovery record are passed to this fresh helper.
Assert-RecoveryConnection $script:crashPort ([Net.Sockets.SocketError]::AccessDenied)
Invoke-RecoveryProbe '--recover-crash' {
    param($pipe, $reader, $process)
    $result = Read-RecoveryReport $reader
    if ($result.phase -ne 'crash-recovered' -or $result.assignments -ne 1 -or $result.filters -ne 6 -or -not $result.jobsEmpty) { throw 'Fresh-process recovery failed.' }
    $null = $process.WaitForExitAsync().WaitAsync([TimeSpan]::FromSeconds(8)).GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0) { throw 'Fresh recovery helper failed.' }
}
Assert-RecoveryConnection $script:crashPort ([Net.Sockets.SocketError]::ConnectionRefused)
Invoke-RecoveryProbe '--recover-crash' {
    param($pipe, $reader, $process)
    $result = Read-RecoveryReport $reader
    if ($result.phase -ne 'crash-recovered' -or $result.assignments -ne 0 -or $result.filters -ne 0) { throw 'Recovery was not idempotent.' }
    $null = $process.WaitForExitAsync().WaitAsync([TimeSpan]::FromSeconds(8)).GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0) { throw 'Second recovery helper failed.' }
}
Write-Output 'PASS: full-owner crash, fresh-process scoped recovery and idempotent restart.'
