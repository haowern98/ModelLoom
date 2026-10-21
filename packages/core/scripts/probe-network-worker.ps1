param([switch]$RpcSmoke, [switch]$InstanceSmoke)
$ErrorActionPreference = 'Stop'
$probeExe = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../out/network-guard-probe/network-guard-probe.exe'))
if (-not (Test-Path -LiteralPath $probeExe)) { throw 'Build the isolated network guard diagnostic first.' }
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WorkerProbeIdentity {
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool GetNamedPipeClientProcessId(IntPtr pipe, out uint pid);
}
'@
$probeNonce = [Guid]::NewGuid().ToString('N')
$probePipe = [IO.Pipes.NamedPipeServerStream]::new("ModelLoom-guard-probe-$probeNonce", [IO.Pipes.PipeDirection]::InOut, 1,
    [IO.Pipes.PipeTransmissionMode]::Byte, ([IO.Pipes.PipeOptions]::Asynchronous -bor [IO.Pipes.PipeOptions]::CurrentUserOnly))
$probeProcess = $null
try {
    $probeMode = if ($RpcSmoke) { '--rpc-smoke' } else { '--separate-worker' }
    if ($InstanceSmoke) { $RpcSmoke = $true; $probeMode = '--instance-smoke' }
    $probeRounds = if ($RpcSmoke) { 1 } else { 4 }
    $probeProcess = Start-Process -FilePath $probeExe -ArgumentList @($probeNonce, "$PID", $probeMode) -Verb RunAs -WindowStyle Hidden -PassThru
    $null = $probePipe.WaitForConnectionAsync().WaitAsync([TimeSpan]::FromSeconds(15)).GetAwaiter().GetResult()
    [uint32]$probeClientPid = 0
    if (-not [WorkerProbeIdentity]::GetNamedPipeClientProcessId($probePipe.SafePipeHandle.DangerousGetHandle(), [ref]$probeClientPid) -or $probeClientPid -ne $probeProcess.Id) { throw 'Unexpected diagnostic reporter.' }
    $probeReader = [IO.StreamReader]::new($probePipe, [Text.Encoding]::UTF8, $false, 4096, $true)
    $probeCount = 0
    while ($probeCount -lt $probeRounds) {
        $probeLine = $probeReader.ReadLineAsync().WaitAsync([TimeSpan]::FromSeconds(20)).GetAwaiter().GetResult()
        if (-not $probeLine -or $probeLine.Length -gt 4096) { throw 'Missing or oversized worker diagnostic report.' }
        Write-Output $probeLine
        $probeReport = $probeLine | ConvertFrom-Json
        if ($probeReport.phase -ne 'worker-ready' -or $probeReport.port -lt 1024 -or $probeReport.port -gt 65535) { throw 'Separate-worker readiness failed.' }
        if (-not $probeReport.workerRestricted) { throw 'Worker was not launched with the required restricted token.' }
        if (-not $RpcSmoke -and $probeReport.scenario -ne 'startup-failure' -and -not $probeReport.privateFileDenied) { throw 'Restricted worker could access the private canary.' }
        if ($RpcSmoke -and ($probeReport.rpcVersion -ne '7.0.0' -or $probeReport.deviceCount -ne 1)) { throw 'Stock RPC handshake/device enumeration failed.' }
        if ($InstanceSmoke) {
            $cloneStart = [Diagnostics.ProcessStartInfo]::new($probeExe)
            $cloneStart.UseShellExecute = $false
            $cloneStart.CreateNoWindow = $true
            $cloneStart.ArgumentList.Add('--clone-client')
            $cloneStart.ArgumentList.Add("$($probeReport.port)")
            $clone = [Diagnostics.Process]::Start($cloneStart)
            try {
                $null = $clone.WaitForExitAsync().WaitAsync([TimeSpan]::FromSeconds(8)).GetAwaiter().GetResult()
                if ($clone.ExitCode -ne 0) { throw 'A separate process at the same executable path was not denied.' }
            } finally { $clone.Dispose() }
        }
        if ($probeReport.scenario -ne 'startup-failure' -and -not $probeReport.ownConnectionAllowed) { throw 'Owned client could not connect.' }
        if ($probeReport.scenario -eq 'startup-failure' -and $probeReport.ownConnectionAllowed) { throw 'Failed startup claimed a live worker.' }
        foreach ($probeIp in @('127.0.0.1', '::ffff:127.0.0.1')) {
            $probeAddress = [Net.IPAddress]::Parse($probeIp)
            $probeClient = [Net.Sockets.TcpClient]::new($probeAddress.AddressFamily)
            if ($probeAddress.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetworkV6) { $probeClient.Client.DualMode = $true }
            $probeDenied = $false
            try { $null = $probeClient.ConnectAsync($probeAddress, [int]$probeReport.port).WaitAsync([TimeSpan]::FromSeconds(3)).GetAwaiter().GetResult() }
            catch {
                $probeError = $_.Exception
                while ($probeError.InnerException) { $probeError = $probeError.InnerException }
                $probeDenied = ($probeError -is [Net.Sockets.SocketException]) -and ($probeError.SocketErrorCode -eq [Net.Sockets.SocketError]::AccessDenied)
            } finally { $probeClient.Dispose() }
            if (-not $probeDenied) { throw "Unrelated client was not denied for $probeIp" }
        }
        $probePipe.WriteByte([byte][char]'S')
        $probePipe.Flush()
        $probeResult = $probeReader.ReadLineAsync().WaitAsync([TimeSpan]::FromSeconds(15)).GetAwaiter().GetResult()
        if (-not $probeResult -or $probeResult.Length -gt 4096) { throw 'Missing teardown result.' }
        Write-Output $probeResult
        $probeOutcome = $probeResult | ConvertFrom-Json
        if ($probeOutcome.phase -ne 'worker-stopped' -or -not $probeOutcome.workerExited -or -not $probeOutcome.guardRetainedUntilExit -or -not $probeOutcome.filtersRemoved) { throw 'Separate-worker containment check failed.' }
        if (-not $RpcSmoke -and -not $probeOutcome.unrelatedProcessAlive) { throw 'Unrelated sentinel exited.' }
        if (-not $probeOutcome.freshSessionRecovery -or -not $probeOutcome.liveRecoveryDenied -or -not $probeOutcome.mismatchedRecoveryDenied) { throw 'Recovery scope and liveness assertions failed.' }
        $probeClosedClient = [Net.Sockets.TcpClient]::new()
        $probeRefused = $false
        # Windows took 2.07 s to report an observed refused connection; timeout is not a pass.
        try { $null = $probeClosedClient.ConnectAsync([Net.IPAddress]::Loopback, [int]$probeReport.port).WaitAsync([TimeSpan]::FromSeconds(5)).GetAwaiter().GetResult() }
        catch {
            $probeClosedError = $_.Exception
            while ($probeClosedError.InnerException) { $probeClosedError = $probeClosedError.InnerException }
            $probeRefused = ($probeClosedError -is [Net.Sockets.SocketException]) -and ($probeClosedError.SocketErrorCode -eq [Net.Sockets.SocketError]::ConnectionRefused)
        } finally { $probeClosedClient.Dispose() }
        if (-not $probeRefused) { throw 'A connection-refused result after listener/filter cleanup was not established.' }
        Write-Output "PASS: $($probeReport.scenario) listener closed after cleanup."
        $probeCount++
    }
    $null = $probeProcess.WaitForExitAsync().WaitAsync([TimeSpan]::FromSeconds(10)).GetAwaiter().GetResult()
    if ($probeProcess.ExitCode -ne 0) { throw "Diagnostic exited $($probeProcess.ExitCode)" }
    if ($RpcSmoke) { Write-Output 'PASS: restricted stock RPC handshake, outsider denial and guarded teardown.' }
    else { Write-Output 'PASS: normal stop, app-control loss, helper crash and pre-readiness startup failure.' }
} finally {
    $probePipe.Dispose()
    if ($probeProcess) { $probeProcess.Dispose() }
}
