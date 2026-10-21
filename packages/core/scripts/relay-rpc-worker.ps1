param([Parameter(Mandatory=$true)][string]$HelperImage)
$ErrorActionPreference = 'Stop'
$probeExe = [IO.Path]::GetFullPath($HelperImage)
if ([IO.Path]::GetFileName($probeExe) -cne 'ModelLoom-peer-host.exe') { throw 'Invalid peer helper' }
$gpuUuid = $env:MODELLOOM_PROBE_GPU_UUID
if ($gpuUuid -cnotmatch '^GPU-[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$') { throw 'Invalid selected GPU' }
# This runs in the ordinary core's token, before UAC. The caller retains native
# seals over these verifier-issued files and their ancestors throughout this
# operation. The elevated helper never edits filesystem permissions.
$runtimeDirectory = [IO.Path]::GetDirectoryName($probeExe)
$users = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-545')
foreach ($name in @('ggml-rpc-server.exe', 'ggml.dll', 'ggml-base.dll', 'ggml-cpu-x64.dll',
    'ggml-cuda.dll', 'ggml-rpc.dll', 'cublas64_12.dll', 'cublasLt64_12.dll', 'cudart64_12.dll',
    'libomp.dll', 'msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll')) {
    $file = Join-Path $runtimeDirectory $name
    $acl = [IO.File]::GetAccessControl($file, [Security.AccessControl.AccessControlSections]::Access)
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($users,
        [Security.AccessControl.FileSystemRights]::ReadAndExecute,
        [Security.AccessControl.AccessControlType]::Allow))
    [IO.File]::SetAccessControl($file, $acl)
}
# Write only the DACL; Set-Acl also attempts audit updates requiring SeSecurityPrivilege.
$acl = [IO.Directory]::GetAccessControl($runtimeDirectory, [Security.AccessControl.AccessControlSections]::Access)
$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($users,
    [Security.AccessControl.FileSystemRights]::ReadAndExecute,
    [Security.AccessControl.InheritanceFlags]::None, [Security.AccessControl.PropagationFlags]::None,
    [Security.AccessControl.AccessControlType]::Allow))
[IO.Directory]::SetAccessControl($runtimeDirectory, $acl)
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
    $mode = '--rpc-session-cuda'
    $helperArguments = @($nonce, "$PID", $mode, $gpuUuid)
    $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        $helper = Start-Process -FilePath $probeExe -ArgumentList $helperArguments -WindowStyle Hidden -PassThru
    } else {
        $helper = Start-Process -FilePath $probeExe -ArgumentList $helperArguments -Verb RunAs -WindowStyle Hidden -PassThru
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
    if ($report.phase -ne 'helper-ready') { throw "Sharing helper startup failed: $line" }
    $reader.Dispose()
    [Console]::Out.WriteLine($line)
    [Console]::Out.Flush()
    $inputCopy = [RelayProbeIdentity]::Pump([Console]::OpenStandardInput(), $pipe)
    $outputCopy = [RelayProbeIdentity]::Pump($pipe, [Console]::OpenStandardOutput())
    $null = [Threading.Tasks.Task]::WhenAny([Threading.Tasks.Task[]]@($inputCopy, $outputCopy)).GetAwaiter().GetResult()
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    throw
} finally {
    $pipe.Dispose()
    if ($helper) {
        if (-not $helper.WaitForExit(8000)) { throw 'Relay teardown unconfirmed' }
        if ($helper.ExitCode -ne 0) { throw "Relay helper failed: $($helper.ExitCode)" }
        $helper.Dispose()
    }
}
