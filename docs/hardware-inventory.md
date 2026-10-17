# Local device inventory

The Devices page displays observed facts, with no fixed Windows edition, build,
CPU/GPU specifications or memory values. Device roles still come from application
configuration. Browser-only demo PCs remain explicitly sample data; they are not
hardware discoveries. Remote inventory still requires the approved worker integration.

Windows' main-process collector reads these fields without a model, elevation,
NVIDIA installation or a native ModelLoom ownership binding:

| Reading                               | Source                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------ |
| OS edition and build                  | Win32_OperatingSystem Caption and BuildNumber                                        |
| Feature version and build revision    | Windows CurrentVersion DisplayVersion and UBR                                        |
| CPU model and logical threads         | Node OS CPU records                                                                  |
| Physical cores                        | Win32_Processor NumberOfCores                                                        |
| Machine architecture                  | Node os.machine(), rather than the renderer's process architecture                   |
| Installed RAM                         | Sum of Win32_PhysicalMemory Capacity                                                 |
| Usable and available RAM              | Node os.totalmem() and os.freemem()                                                  |
| GPU/virtual adapter names and drivers | Win32_VideoController                                                                |
| GPU enabled/working status            | Win32_VideoController ConfigManagerErrorCode                                         |
| PCI vendor identity                   | Win32_VideoController PNPDeviceID, or validated NVIDIA PCI telemetry                 |
| Dedicated GPU capacity                | The adapter driver's 64-bit qwMemorySize when present, or validated NVIDIA telemetry |
| Available dedicated GPU memory        | Validated NVIDIA telemetry when provided                                             |
| Verified runtime backends             | Existing verifier-accepted installed package inventory, including its actual version |

The Windows provider internally enumerates Intel, AMD, NVIDIA and virtual display
adapters; both GPU views use the supported-device filter described below.
An optional NVIDIA query supplements a uniquely matching adapter; identical-name
adapters do not borrow one another's available memory. Missing WMI or NVIDIA
results do not erase successful readings from the other provider. Shared system
memory is not dedicated VRAM. WMI's 32-bit AdapterRAM is deliberately excluded.
An absent measurement renders as Unavailable. Before the runtime's existing
verification/install path supplies inventory, the backend row says Not verified
yet. Hardware presence does not establish inference compatibility or runtime support.

Both commands have fixed executable paths and fixed queries chosen by main,
hidden windows, no shell expansion, bounded output and retained-child cleanup.
The renderer cannot submit executable paths, queries or new privileged actions.
The PowerShell deadline is eight seconds and the optional NVIDIA deadline is two
seconds; the shared cleanup helper bounds termination waits. Device snapshots are
rechecked after ten seconds and concurrent requests share one in-flight probe.
On Windows, WM_DEVICECHANGE/DBT_DEVNODES_CHANGED notifications bypass that cache
and start discovery immediately. A notification during discovery discards the
older result and schedules a fresh scan without overlapping native queries.
The renderer's existing 500 ms snapshot loop supplies the completed result to
both views. This is automatic event-triggered refresh, not a zero-latency claim:
native discovery and the existing query/cleanup deadlines still apply. Periodic
scans remain a fallback when firmware or drivers do not emit a notification.
The displayed observation time makes an older retained result identifiable.
Quit closes admission and shuts the engine down first, then waits for any pending
hardware query before main exits. Failed diagnostic-child cleanup is propagated
through the collector and controller; it cannot be disguised as an unavailable
reading or a successful Quit.

On other OSes, the existing OS identity, machine architecture, CPU and available
system-memory readings remain available through Node. Equivalent detailed native
GPU and installed-memory providers on macOS/Linux are not established by this
Windows change.

## GPU display scope, 2026-10-15

The approved GPU scope for both canvas and Devices is AMD/NVIDIA physical GPUs.
CPU remains visible. Filter the observed
inventory by PCI vendor identity (`1002` for AMD, `10de` for NVIDIA), derived from
the PCI PNP device ID. Root/software display adapters, Intel GPUs and unknown
identities have no displayed GPU entry. Never infer eligibility from an
adapter name, its position, or whether dedicated-memory telemetry is available.
Validated NVIDIA telemetry can identify NVIDIA GPUs when the Windows inventory
provider is unavailable. Number cards after filtering, with a plain GPU label for
a single card. Windows status code zero means working; nonzero codes (including
22, disabled) exclude an adapter from both views. Missing status remains unknown;
an idle or power-saving GPU is not automatically disabled. NVIDIA memory readings
cannot override a Windows disabled/error status.

This display rule does not prove runtime compatibility, add an AMD runtime, or
change model admission. Actual runtime resource checks remain authoritative.

Identity references: [Microsoft PCI device IDs](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/identifiers-for-pci-devices),
[AMD identification guide](https://www.amd.com/en/resources/support-articles/faqs/GPU-55.html),
and [NVIDIA PCI vendor identity](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/22.9.1/openshift/install-nfd.html).

Initial canvas-only validation: 30 focused desktop tests passed across the Windows provider, local
snapshot, App, live inventory integration and Devices inventory. Desktop type
checking, scoped ESLint and renderer production build passed. A live read-only
query on this laptop identified RTX 4060 Ti (`10de`) as included, Iris Xe (`8086`)
as excluded, and StarDesk (no PCI vendor identity) as excluded. AMD and missing
identity cases have fixture coverage; no other physical laptop or native-window
visual check was performed for this filter. Restart the desktop app to load the
updated main-process collector.

Native notification and status contracts:
[WM_DEVICECHANGE](https://learn.microsoft.com/en-us/windows/win32/devio/wm-devicechange)
and [Win32_VideoController](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-videocontroller).

Follow-up validation: 51 focused tests passed in seven files covering the native
notification adapter, scan invalidation/coalescing, Windows status decoding,
local observations, both renderer views, and enable/disable/re-enable updates.
Desktop type checking, scoped ESLint, main compile and renderer production build
passed. Live collection reported all three current adapters working, while the
shared view rule included only RTX 4060 Ti. No actual GPU was disabled, and no
native-window timing or driver-specific notification delivery was measured.

## Evidence, 2026-10-15

- Live read-only collection on the current laptop returned Windows 11 Home
  Single Language, 25H2, build 26200.7171, 24 GiB installed RAM, 14 physical CPU
  cores and 20 logical threads. It enumerated the NVIDIA RTX 4060 Ti, Intel Iris
  Xe and StarDesk virtual display adapter with their actual driver versions.
  NVIDIA total/free dedicated-memory readings succeeded. The other two adapters
  did not supply supported dedicated-memory measurements and remain unavailable.
- Parser/provider tests cover Intel/AMD/NVIDIA identities, multi-adapter safety,
  capacity above 4 GiB, malformed/oversized reports, missing NVIDIA tooling,
  denied WMI and independent provider failures. The bridge-to-Devices test also
  carries an ARM64 observation through the actual App renderer.
- Tests verify refresh without model activation and that backend names/version
  originate from accepted installation inventory. No engine or inference workload
  was started for this task; runtime admission/security rules are unchanged.
- Other physical Windows laptops and Windows ARM machines were not tested.
  These fixtures do not establish universal hardware or release acceptance.
- Browser visual review was blocked by the computer-use environment failing to
  start. The captured hardware JSON and passing renderer integration checks are
  separate evidence from native-window visual verification.

Ignored local evidence: apps/desktop/out/hardware-audit/local-device.json and
desktop-tests.json. Validation details are also recorded in design-qa.md.

Reference contracts: [Node OS APIs](https://nodejs.org/api/os.html),
[Windows OS inventory](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-operatingsystem),
[Windows video-controller inventory](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-videocontroller),
and [GPU process-budget semantics](https://learn.microsoft.com/en-us/windows/win32/api/dxgi1_4/nf-dxgi1_4-idxgiadapter3-queryvideomemoryinfo).
