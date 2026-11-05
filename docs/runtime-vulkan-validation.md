# Windows Vulkan development runtime

The source app supports the separately signed `llama-vulkan-development` package for llama.cpp **b11306**. Installed packages live in `%USERPROFILE%\.modelloom\runtimes`, alongside the existing CUDA packages. Settings → Runtime → GGUF selects an installed, verified GPU build for the next load or reload on that PC. Selecting a runtime does not replace an already loaded model's engine. CPU stays out of this picker.

The Settings picker and installed-runtime dialog share a display index built from verified metadata and matching installation directories. Listing does not hash payloads or grant execution authority. Directory changes refresh the index; selecting a build rechecks its metadata. Activation, memory estimation and loading retain the existing full file verification and sealing. A local inventory measurement returned all three installed builds in 131 ms on the first read and below 1 ms on subsequent reads.

The Vulkan package retains the existing b11306 RPC8 tensor-cache library and stock executables, adds the upstream b11306 Vulkan backend, and supplies separate Vulkan runtime and peer helpers. It does not replace the CUDA helpers or DLLs. GPU reservations still use stable physical UUIDs; the separate helper resolves those UUIDs to Vulkan's physical device indices before launching the child. A remote-only plan exposes no local Vulkan GPU. Implicit Vulkan layers are disabled only in the owned Vulkan processes, not in the user's global environment.

Mixed CUDA/Vulkan RPC is accepted only for the pinned coordinator/client and worker payload identities in `packages/core/src/runtime-package/development-vulkan.ts`. Matching build names alone do not authorize a connection. Existing signed-inventory verification, file seals, selected-GPU reservations, restricted worker execution, WFP policy, mTLS pairing, memory admission and owned-process shutdown remain required. This is not permission to mix arbitrary upstream packages or different RPC protocols.

## Measured on November 5, 2026

| Check             | Result                                                                                                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signed package    | Existing development trust root; inventory and all payload files verified before installation on both PCs                                                                     |
| Local Vulkan GPU  | RTX 4060 Ti selected by physical UUID; other local GPUs hidden from the owned Vulkan process                                                                                  |
| Memory planning   | Existing fixed-setting estimator completed through the Vulkan helper                                                                                                          |
| Single-PC Vulkan  | Bonsai-27B Q1_0, 64 repeating blocks plus output on RTX 4060 Ti; the app's placement verifier accepted the actual native log                                                  |
| Mixed two-PC run  | CUDA RTX 4060 Ti on the coordinator: blocks 0–30; Vulkan RTX 4070 SUPER on ptss: blocks 31–63 and output                                                                      |
| Transport         | ModelLoom's paired mTLS RPC relay and restricted native worker; temporary SSH forwarding reached the test management/TLS endpoints, not a publicly exposed stock RPC listener |
| Output comparison | Two deterministic prompts, 32 generated token IDs each; both single-PC Vulkan and mixed CUDA/Vulkan matched the existing single-GPU CUDA reference exactly                    |
| Lifecycle         | A live stream was cancelled, the slot recovered, another request completed and the owned engine and worker shut down cleanly                                                  |
| CUDA preservation | 132 baseline candidate/installed coordinator/worker files checked against their prior or signed hashes; unchanged                                                             |

The measured model SHA-256 is `71d6871836886267f39f1ac69b1b1dd8a783970708d7a189960112ed02978901`. Settings were context 7,680 per slot, four slots, Q8_0 K/V cache, flash attention on and speculative decoding off. The two reference prompts were “The capital of France is” and “Explain why the Moon has phases in one paragraph.”, temperature 0 and seed 7. These cases establish exact equality for those runs, not a general guarantee of token equality across all GPU backends and models.

This qualification covers the named Windows NVIDIA GPUs. AMD, Intel, macOS, speculative decoding on Vulkan, the reversed two-PC backend arrangement and packaged public-release acceptance have not been validated by these runs. Resource discovery currently uses the existing NVIDIA evidence path. Unsupported or unverified combinations must remain unavailable rather than being inferred from the GPU brand.

## Reproducibility and evidence

`packages/core/scripts/build-vulkan-hosts.mjs` builds only the two separate Vulkan helpers. It requires the pinned Vulkan-Headers v1.3.290 headers under the ignored Vulkan build directory and checks their core-header hash. `packages/core/scripts/prepare-vulkan-runtime.mjs` prepares a new candidate from the verified CUDA baseline and the hash-pinned upstream Vulkan archive/DLL. Signing is an explicit development publisher operation using the existing custody and verifier; it is not part of app startup. No signing keys are included in source or runtime packages.

Local ignored receipts are under `packages/core/out/vulkan-development`: `qualification-ptss-native-mtls.json`, `local-vulkan-placement.json`, `cuda-integrity.json`, native logs and test logs. The signed bootstrap is under `packages/core/out/activation/b11306-vulkan`. The current development inventory is `b11306-dev2-tensor-cache-v1`, SHA-256 `ed55b3f80525b04f47777d0d9af6ce08369cbbe617336020431ddb711dcee31e`.

The source application was updated on both PCs and reopened through `npm run electron dev`, with one interactive ModelLoom instance on each. Production package publication and production update-feed qualification remain separate work.
