$ErrorActionPreference = 'Stop'
try {
  Add-Type @'
using System;
using System.IO;
using System.Text;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class ModelLoomProfilePath {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  private static extern SafeFileHandle CreateFile(string path, uint access, uint share,
    IntPtr security, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  private static extern uint GetFinalPathNameByHandle(SafeFileHandle handle,
    StringBuilder buffer, uint size, uint flags);

  // Query metadata only. Node realpath does not expose this Windows package redirection.
  public static void Check(string path) {
    try { File.GetAttributes(path); }
    catch (FileNotFoundException) { return; }
    catch (DirectoryNotFoundException) { return; }
    using (var handle = CreateFile(path, 0x80, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero)) {
      if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
      var buffer = new StringBuilder(32768);
      uint length = GetFinalPathNameByHandle(handle, buffer, 32768, 0);
      if (length == 0 || length >= 32768) throw new InvalidOperationException("Profile path unavailable");
      string actual = buffer.ToString();
      if (actual.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase)) actual = @"\\" + actual.Substring(8);
      else if (actual.StartsWith(@"\\?\", StringComparison.Ordinal)) actual = actual.Substring(4);
      if (!String.Equals(Path.GetFullPath(path).TrimEnd('\\'), actual.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
        throw new InvalidOperationException("Profile path redirected");
    }
  }
}
'@
  if (-not [IO.Path]::IsPathRooted($env:APPDATA)) { throw 'Profile location unavailable' }
  $profileRoot = Join-Path $env:APPDATA 'ModelLoom'
  foreach ($relative in @('', 'Local State', 'embedded-tailscale', 'embedded-tailscale\enrollment.bin')) {
    $target = if ($relative) { Join-Path $profileRoot $relative } else { $profileRoot }
    [ModelLoomProfilePath]::Check($target)
  }
  exit 0
} catch {
  # Report no paths or credential contents to the launcher.
  exit 2
}
