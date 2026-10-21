param([switch]$Elevate)
$ErrorActionPreference = 'Stop'
$probeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../out/network-guard-probe'))
$probeExe = Join-Path $probeRoot 'network-guard-probe.exe'
if (-not (Test-Path -LiteralPath $probeExe)) { throw 'Build the isolated network guard probe first.' }
if (-not $Elevate) {
    & $probeExe
    if ($LASTEXITCODE -ne 740) { throw "Expected unelevated exit 740; received $LASTEXITCODE" }
    Write-Output 'PASS: unelevated probe requested elevation without installing filters.'
    exit 0
}
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class GuardProbePipeIdentity {
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool GetNamedPipeClientProcessId(IntPtr pipe, out uint pid);
}
'@
function Test-BlockedConnection([string]$Address, [int]$Port) {
    $probeAddress = [Net.IPAddress]::Parse($Address)
    $probeClient = [Net.Sockets.TcpClient]::new($probeAddress.AddressFamily)
    if ($probeAddress.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetworkV6) { $probeClient.Client.DualMode = $true }
    try {
        $null = $probeClient.ConnectAsync($probeAddress, $Port).WaitAsync([TimeSpan]::FromSeconds(5)).GetAwaiter().GetResult()
        return @{ address = $Address; denied = $false; reason = 'Connection unexpectedly succeeded' }
    } catch {
        $probeError = $_.Exception
        while ($probeError.InnerException) { $probeError = $probeError.InnerException }
        $probeDenied = ($probeError -is [Net.Sockets.SocketException]) -and ($probeError.SocketErrorCode -eq [Net.Sockets.SocketError]::AccessDenied)
        return @{ address = $Address; denied = $probeDenied; reason = $probeError.Message }
    } finally { $probeClient.Dispose() }
}
$probeNonce = [Guid]::NewGuid().ToString('N')
$probePipeName = "ModelLoom-guard-probe-$probeNonce"
$probePipe = [IO.Pipes.NamedPipeServerStream]::new($probePipeName, [IO.Pipes.PipeDirection]::InOut, 1,
    [IO.Pipes.PipeTransmissionMode]::Byte, ([IO.Pipes.PipeOptions]::Asynchronous -bor [IO.Pipes.PipeOptions]::CurrentUserOnly))
$probeProcess = $null
try {
    Write-Output 'Waiting for the Windows UAC prompt for the isolated loopback probe.'
    $probeProcess = Start-Process -FilePath $probeExe -ArgumentList @($probeNonce, "$PID") -Verb RunAs -WindowStyle Hidden -PassThru
    $null = $probePipe.WaitForConnectionAsync().WaitAsync([TimeSpan]::FromSeconds(15)).GetAwaiter().GetResult()
    [uint32]$probeClientPid = 0
    if (-not [GuardProbePipeIdentity]::GetNamedPipeClientProcessId($probePipe.SafePipeHandle.DangerousGetHandle(), [ref]$probeClientPid) -or $probeClientPid -ne $probeProcess.Id) {
        throw 'The report pipe was not connected by the retained elevated probe.'
    }
    $probeReader = [IO.StreamReader]::new($probePipe, [Text.Encoding]::UTF8, $false, 4096, $true)
    $probeReady = $probeReader.ReadLineAsync().WaitAsync([TimeSpan]::FromSeconds(10)).GetAwaiter().GetResult()
    if (-not $probeReady -or $probeReady.Length -gt 4096) { throw 'Missing or oversized probe report.' }
    Write-Output $probeReady
    $probeState = $probeReady | ConvertFrom-Json
    if ($probeState.phase -ne 'ready' -or -not $probeState.ownConnectionAllowed -or $probeState.port -lt 1024 -or $probeState.port -gt 65535) { throw 'The elevated probe did not become ready.' }
    $probeResults = @((Test-BlockedConnection '127.0.0.1' $probeState.port), (Test-BlockedConnection '::ffff:127.0.0.1' $probeState.port))
    $probeResults | ConvertTo-Json -Compress | Write-Output
    $probePipe.WriteByte([byte][char]'S')
    $probePipe.Flush()
    $probeStopped = $probeReader.ReadLineAsync().WaitAsync([TimeSpan]::FromSeconds(10)).GetAwaiter().GetResult()
    if (-not $probeStopped -or $probeStopped.Length -gt 4096) { throw 'Missing cleanup report.' }
    Write-Output $probeStopped
    $probeCleanup = $probeStopped | ConvertFrom-Json
    if ($probeCleanup.phase -ne 'stopped' -or -not $probeCleanup.ownedFiltersRemoved) { throw 'Owned WFP filter removal was not confirmed.' }
    $probeAgain = $probeReader.ReadLineAsync().WaitAsync([TimeSpan]::FromSeconds(10)).GetAwaiter().GetResult()
    if (-not $probeAgain -or $probeAgain.Length -gt 4096) { throw 'Missing second-round report.' }
    Write-Output $probeAgain
    $probeAgainState = $probeAgain | ConvertFrom-Json
    if ($probeAgainState.phase -ne 'ready' -or -not $probeAgainState.ownConnectionAllowed -or $probeAgainState.port -lt 1024 -or $probeAgainState.port -gt 65535) { throw 'The second-round probe did not become ready.' }
    $probeResults += @((Test-BlockedConnection '127.0.0.1' $probeAgainState.port), (Test-BlockedConnection '::ffff:127.0.0.1' $probeAgainState.port))
    $probePipe.WriteByte([byte][char]'C')
    $probePipe.Flush()
    $null = $probeProcess.WaitForExitAsync().WaitAsync([TimeSpan]::FromSeconds(10)).GetAwaiter().GetResult()
    if ($probeProcess.ExitCode -ne 12) { throw "Expected deliberate helper exit 12; received $($probeProcess.ExitCode)" }
    # Confirm abandoned dynamic filters no longer block an unrelated replacement listener/client.
    $probeRecovered = $false
    $probeRecoveryDeadline = [DateTime]::UtcNow.AddSeconds(5)
    do {
        $probeReplacement = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, [int]$probeAgainState.port)
        $probeReplacement.Server.ExclusiveAddressUse = $true
        $probeReplacementClient = [Net.Sockets.TcpClient]::new()
        try {
            $probeReplacement.Start()
            $null = $probeReplacementClient.ConnectAsync([Net.IPAddress]::Loopback, [int]$probeAgainState.port).WaitAsync([TimeSpan]::FromSeconds(1)).GetAwaiter().GetResult()
            $probeRecovered = $true
        } catch { Start-Sleep -Milliseconds 50 }
        finally {
            $probeReplacementClient.Dispose()
            $probeReplacement.Stop()
        }
    } while (-not $probeRecovered -and [DateTime]::UtcNow -lt $probeRecoveryDeadline)
    Write-Output (@{ phase = 'forced-exit'; unrelatedReplacementAllowed = $probeRecovered } | ConvertTo-Json -Compress)
    $probeResults | ConvertTo-Json -Compress | Write-Output
    if (-not $probeRecovered) { throw 'Filter removal after deliberate helper termination was not proven.' }
    if (@($probeResults | Where-Object { -not $_.denied }).Count) { throw 'Unrelated-process denial was not proven for both address families.' }
    Write-Output 'PASS: own connections allowed, unrelated IPv4/mapped-IPv6 denied, normal and forced-exit filter cleanup verified.'
} finally {
    # Losing this pipe makes the bounded diagnostic close its listener and WFP session.
    $probePipe.Dispose()
    if ($probeProcess) { $probeProcess.Dispose() }
}
