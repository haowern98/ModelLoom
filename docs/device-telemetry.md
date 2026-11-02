# Device-card telemetry

The GPU telemetry implementation populates the existing device cards.
It does not activate an inference backend, make an observed GPU eligible for
placement, or change GPU sharing authorization. Real AMD and Mac hardware
validation is explicitly deferred by the user.

## Measurements

| Reading         | Source and meaning                                                                                                                                                                                                                                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CPU             | Busy time divided by elapsed aggregate logical-CPU time between Node OS samples. The initial sample is unknown.                                                                                                                                                                                                                   |
| RAM             | OS total minus free bytes. This is not a promise of matching every OS's treatment of cached/reclaimable memory.                                                                                                                                                                                                                   |
| AMD on Windows  | DXGI enumerates adapters and their LUIDs. WDDM CIM performance counters are joined by LUID. Per-process percentages are summed for each engine; utilization is the busiest engine, capped at 100%. Dedicated memory usage is reported against DXGI's dedicated capacity.                                                          |
| AMD on Linux    | Physical PCI identity and the amdgpu driver's `gpu_busy_percent`, `mem_info_vram_total` and `mem_info_vram_used` sysfs readings.                                                                                                                                                                                                  |
| Mac GPUs        | IORegistry accelerator identity and driver `PerformanceStatistics`. Use `Device Utilization %` or `GPU Activity(%)` when available. Apple/Intel integrated GPU allocations use `In use system memory` and are labelled unified memory. AMD dedicated allocations use reported VRAM bytes. Missing total capacity is not invented. |
| Disk on Windows | Formatted physical-disk `_Total` read/write byte rates.                                                                                                                                                                                                                                                                           |
| Disk on macOS   | Deltas of each unique IOBlockStorageDriver's cumulative read/write byte counts over monotonic elapsed time.                                                                                                                                                                                                                       |
| Disk on Linux   | `/proc/diskstats` sector deltas for physical whole disks, excluding partitions and virtual stacked block devices. Kernel disk-stat sectors are 512 bytes.                                                                                                                                                                         |

NVIDIA on Windows also uses a separate fixed `nvidia-smi` display query for
UUID, utilization, used memory, total memory and free memory. Preserve the reported
free bytes, rather than deriving free memory from total minus used. NVIDIA
inventory discovery and runtime admission retain their existing path.

GPU observations are matched by adapter identity, not by model name or enumeration
order. A missing assignment identity must never match a missing execution identity
on a virtual or unsupported adapter.

## Refresh and failure handling

Runtime snapshots request a coalesced observation after two seconds. Expensive
Windows hardware discovery retains its ten-second cache, invalidated by a native
device-change notification. Each fixed OS query has bounded output and a deadline;
sampling never overlaps inside the controller. Observations that cannot be read
are omitted, while a measured zero remains valid. Cards hide samples older than
15 seconds on the next two-second display tick. Implausibly future-dated samples
are also hidden.

CPU baselines reset when CPU topology changes. Disk baselines reset on discovery
failure, hotplug, counter regression or nonpositive elapsed time. GPU and disk
providers fail independently. Failed child cleanup propagates instead of being
disguised as an unavailable counter. Collection uses no elevation, vendor-setting
changes, model launch or GPU workload.

## Connected devices

Optional display readings travel with the existing authenticated hardware view.
Inventory readers opt in to the extended format. Older readers receive the old
closed schema; newer readers fall back when an older worker rejects negotiation.
Validation enforces finite percentages, nonnegative byte values, allowed memory
kinds, existing GPU limits and the existing frame-size bound. Unshared GPUs stay
excluded. Local AMD/Mac discovery does not broaden the existing NVIDIA execution
identity, worker eligibility or sharing rules. Full AMD/Metal worker inference is
outside this telemetry change.

## Evidence and limits

Automated tests cover provider parsing and failures, identical adapter names,
counter resets/hotplug, local inventory integration, peer schema/compatibility,
card labels and stale readings. Windows script parsing and DXGI binding
compilation require no GPU query. TLS integration tests exercise local synthetic
hardware reports, not remote GPU workloads. Browser fixtures exercise the real
card component with synthetic readings.

Actual driver counter availability, accuracy, collection cost, supported Mac
models and behavior during inference still require the deferred hardware checks.

The NVIDIA matching fix was checked with native read-only readings from this
Windows host's RTX 3060 Laptop GPU and RTX 4060 Ti, while StarDesk and Intel
adapters remained in the inventory. The real card component rendered each GPU's
own readings in a browser fixture. This confirms collection and display wiring;
it is not a GPU-load accuracy test or a native inference test.

Provider references: [Microsoft DXGI adapter identity and capacity](https://learn.microsoft.com/en-us/windows/win32/api/dxgi/ns-dxgi-dxgi_adapter_desc1),
[amdgpu memory counters](https://docs.kernel.org/gpu/amdgpu/driver-misc.html),
[amdgpu activity](https://docs.kernel.org/gpu/amdgpu/thermal.html),
[Apple disk counter definitions](https://github.com/apple-oss-distributions/IOStorageFamily/blob/main/IOBlockStorageDriver.h),
and [Stats' direct use of accelerator statistics](https://github.com/exelban/stats/blob/master/Modules/GPU/reader.swift).
