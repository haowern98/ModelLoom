param([switch]$Cuda, [switch]$Session)
$ErrorActionPreference = 'Stop'
$probeExe = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../out/network-guard-probe/network-guard-probe.exe'))
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
public static class RelayProbeIdentity {
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool GetNamedPipeClientProcessId(IntPtr pipe, out uint pid);
    public static Task Pump(Stream input, Stream output) {
        var done = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var copy = new Thread(() => {
            try { input.CopyTo(output, 262144); done.SetResult(true); }
            catch (Exception e) { done.SetException(e); }
        });
        copy.IsBackground = true;
        copy.Start();
        return done.Task;
    }
}
'@
$nonce = [Guid]::NewGuid().ToString('N')
$security = [IO.Pipes.PipeSecurity]::new()
$security.SetAccessRuleProtection($true, $false)
$security.AddAccessRule([IO.Pipes.PipeAccessRule]::new([Security.Principal.WindowsIdentity]::GetCurrent().User,
    [IO.Pipes.PipeAccessRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow))
$pipe = [IO.Pipes.NamedPipeServerStream]::new("ModelLoom-guard-probe-$nonce", [IO.Pipes.PipeDirection]::InOut, 1,
    [IO.Pipes.PipeTransmissionMode]::Byte, [IO.Pipes.PipeOptions]::Asynchronous, 262144, 262144, $security)
$helper = $null
try {
    $mode = if ($Session) { if ($Cuda) { '--rpc-session-cuda' } else { '--rpc-session-cpu' } } else { if ($Cuda) { '--rpc-relay-cuda' } else { '--rpc-relay-cpu' } }
    $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        $helper = Start-Process -FilePath $probeExe -ArgumentList @($nonce, "$PID", $mode) -WindowStyle Hidden -PassThru
    } else {
        $helper = Start-Process -FilePath $probeExe -ArgumentList @($nonce, "$PID", $mode) -Verb RunAs -WindowStyle Hidden -PassThru
    }
    $null = $helper.Handle
    $connected = $pipe.WaitForConnectionAsync()
    if (-not $connected.Wait(15000)) { throw 'Relay connection timeout' }
    [uint32]$clientPid = 0
    if (-not [RelayProbeIdentity]::GetNamedPipeClientProcessId($pipe.SafePipeHandle.DangerousGetHandle(), [ref]$clientPid) -or $clientPid -ne $helper.Id) { throw 'Unexpected relay reporter' }
    $reader = [IO.StreamReader]::new($pipe, [Text.Encoding]::UTF8, $false, 4096, $true)
    $ready = $reader.ReadLineAsync()
    if (-not $ready.Wait(15000)) { throw 'Relay readiness timeout' }
    $line = $ready.Result
    if (-not $line -or $line.Length -gt 4096) { throw 'Invalid relay readiness' }
    $report = $line | ConvertFrom-Json
    if ($Session) {
        if ($report.phase -ne 'helper-ready') { throw "Sharing helper startup failed: $line" }
    } elseif ($report.phase -ne 'relay-ready' -or -not $report.workerRestricted) { throw "Restricted relay startup failed: $line" }
    $reader.Dispose()
    [Console]::Out.WriteLine($line)
    [Console]::Out.Flush()
    $inputCopy = [RelayProbeIdentity]::Pump([Console]::OpenStandardInput(), $pipe)
    $outputCopy = [RelayProbeIdentity]::Pump($pipe, [Console]::OpenStandardOutput())
    $null = [Threading.Tasks.Task]::WhenAny([Threading.Tasks.Task[]]@($inputCopy, $outputCopy)).GetAwaiter().GetResult()
} finally {
    $pipe.Dispose()
    if ($helper) {
        if (-not $helper.WaitForExit(8000)) { throw 'Relay teardown unconfirmed' }
        if ($helper.ExitCode -ne 0) { throw "Relay helper failed: $($helper.ExitCode)" }
        $helper.Dispose()
    }
}
