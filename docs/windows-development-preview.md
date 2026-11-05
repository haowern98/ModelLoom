# Windows development preview

Use this guide to run the current CUDA development build and reproduce the standalone CPU and Vulkan checks.

## Start ModelLoom

From the source checkout on Windows x64, install the pinned dependencies with `pnpm install --frozen-lockfile`, then run `npm run electron dev`. See [development setup](development.md) for prerequisites and the persistent profile. The source app expects the verified runtime assets in the workspace bootstrap and keeps installed runtimes under `%USERPROFILE%\.modelloom\runtimes`.

In **Models**, use **Import GGUF** to register a model on disk. Then open **Cluster → Overview**, select the model, assign layers to the devices you intend to use, and choose **Load model**. After it reports **Loaded**, open **Chat** to generate. Use **Unload model** when switching runtimes or when you need to release the memory.

In the source app, **Settings → Runtime → GGUF** shows the build used for the next load. **Manage installed runtimes** lists verified builds. CUDA **b11306** is the baseline. The CUDA **b11307** build is a restricted Bonsai trial. Its tested two-PC split assigns layers 0–30 to the coordinator RTX 4060 Ti and 31–63 to the worker RTX 4070 SUPER, with the RTX 3060 unassigned. It uses Bonsai-27B Q1_0, context 7,680, four slots, Q8_0 K/V cache and speculative decoding off. The development package stages the b11306 CUDA baseline only.

For two-PC inference, enable **Allow connections** on the worker in **Cluster → Connections → Share this PC** and select the GPU to share. On the coordinator, add the worker from **Add device** using its reachable private address. Approve and verify the pairing, then add the worker to the cluster and assign its layers. Use compatible approved runtime packages. The separately signed b11306 Vulkan development package can now be selected in the source app; its measured CUDA/Vulkan pairing and current limitations are recorded in [Vulkan validation](runtime-vulkan-validation.md). See [development networking](development-network.md) for setup and reconnect behavior.

## Try CPU and Vulkan separately

Download the Windows x64 CPU and Vulkan archives from the [llama.cpp b11306 release](https://github.com/ggml-org/llama.cpp/releases/tag/b11306). Verify the archive digest and extract the builds into separate directories. Run these from the corresponding extracted directory in PowerShell with an existing Qwen3-0.6B Q8_0 GGUF.

```powershell
$model = 'E:\path\to\Qwen3-0.6B-Q8_0.gguf'
.\llama-completion.exe -m $model -c 512 -n 16 --temp 0 --seed 7 --no-conversation --fit off -p 'The capital of France is' -ngl 0 --device none
```

For Vulkan, list the devices and replace `Vulkan1` with the identifier for the intended GPU. The environment setting below applies to the test shell and is restored afterwards.

```powershell
.\llama-completion.exe --list-devices
$previousLayerFilter = $env:VK_LOADER_LAYERS_DISABLE
try {
  $env:VK_LOADER_LAYERS_DISABLE = '~implicit~'
  .\llama-completion.exe -m $model -c 512 -n 16 --temp 0 --seed 7 --no-conversation --fit off -p 'The capital of France is' -ngl 999 --device Vulkan1
} finally {
  $env:VK_LOADER_LAYERS_DISABLE = $previousLayerFilter
}
```

On November 5, 2026, both builds generated a response locally. Each upstream server also reached loopback HTTP readiness and returned 16 tokens from its completion endpoint. The test harness stopped each owned server process after the request. The Vulkan run used the RTX 4060 Ti with NVIDIA driver 617.14 and implicit layers disabled. With the normal environment, Vulkan failed to create the device on Intel Iris Xe and on the RTX 4060 Ti. The isolated retry does not identify the specific conflicting layer. CPU and Vulkan produced different continuations after the shared answer, so this smoke test does not establish output equivalence.

| Archive                               | SHA-256                                                            |
| ------------------------------------- | ------------------------------------------------------------------ |
| `llama-b11306-bin-win-cpu-x64.zip`    | `dc63fb6c55e1aae2e68c1a42d21d3d985a970edeb14858dbedbd8a5bd1e1d8e4` |
| `llama-b11306-bin-win-vulkan-x64.zip` | `ea52b47ded50e6a835b88a796d0343e577aada3e80e981eba37e7f3a0f6a6a8a` |

The CPU results above remain standalone experiments; CPU is not offered in the app. The subsequent [Vulkan development integration](runtime-vulkan-validation.md) adds a separately signed package, stable GPU UUID mapping, configuration-specific resource admission and measured mixed-backend RPC. The earlier standalone smoke test alone did not establish those properties.

## Packaging and release scope

Use `pnpm package:development` for the Windows x64 development build. The November 5 build completed and stages the approved CUDA coordinator and worker packages. It uses a separate development profile. The public release requires production runtime trust and signing under [D11](../specs/decisions/README.md), plus packaged acceptance for the platforms and backends advertised in the release.
