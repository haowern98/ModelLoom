# ModelLoom

![Windows x64](https://img.shields.io/badge/platform-Windows%20x64-blue)
![GGUF](https://img.shields.io/badge/models-GGUF-555)
![Windows development preview](https://img.shields.io/badge/status-development%20preview-orange)

ModelLoom runs GGUF language models on your own GPUs. Use one PC or assign model layers across a coordinator and an approved worker on a private network. Load the model from the cluster canvas, then use it in Chat or through the local API.

![Cluster Overview showing model layers assigned to Node 1 (coordinator) and Node 2 (worker)](docs/screenshots/cluster-overview.png)

## Start here

The current Windows x64 preview runs from source and requires verified runtime assets. Follow the [Windows preview setup](docs/getting-started/user-guide.md) before loading a model.

1. Import a GGUF file in **Models**.
2. In **Cluster → Overview**, choose the model and assign its layers to the GPUs you want to use.
3. Click **Load model**, wait for it to load, then open **Chat**.

The [User Guide](docs/getting-started/user-guide.md) covers pairing a second PC, choosing a runtime, and troubleshooting. The [Developer Guide](docs/getting-started/developer-guide.md) covers the repository, architecture, and checks.

## RPC input residency

When both peers support the residency bridge, ModelLoom can send a short reference for an eligible tensor write it has already sent. The worker reconstructs the original request byte for byte and passes it to the native runtime. This can reduce bytes sent between devices when writes repeat. The benefit depends on the workload, so throughput claims need a matched comparison with stock RPC.

## Performance experiment

Across three reported runs per setup, ModelLoom averaged **27.20 tok/s** in generation versus **25.82 tok/s** for stock llama.cpp RPC, an observed difference of **5.33%**. [Individual runs and comparison limits](docs/getting-started/developer-guide.md#performance-experiment)
