# ModelLoom

![Windows x64](https://img.shields.io/badge/platform-Windows%20x64-blue)
![GGUF](https://img.shields.io/badge/models-GGUF-555)
![Windows development preview](https://img.shields.io/badge/status-development%20preview-orange)

ModelLoom runs GGUF language models on your own GPUs. Assign model layers on one PC or split them across a coordinator and an approved worker on a private network. Once the model is loaded, use it in Chat or through the local API.

- [User Guide](docs/getting-started/user-guide.md) · Launch the preview, load a model, and connect a worker.
- [Developer Guide](docs/getting-started/developer-guide.md) · Set up the checkout, understand the architecture, and run checks.

![Cluster Overview showing model layers assigned to Node 1 (coordinator) and Node 2 (worker)](docs/screenshots/cluster-overview.png)

## Quick start

The Windows x64 development preview runs from source and requires verified runtime assets. Follow the [User Guide](docs/getting-started/user-guide.md) to start the app.

1. Import a GGUF file in **Models**.
2. In **Cluster → Overview**, select the model and assign its layers to the GPUs you want to use.
3. Click **Load model**. Once the model is loaded, open **Chat**.

## Residency Bridge

When both peers support the Residency Bridge, ModelLoom can send a short reference for an eligible tensor write it has already sent. The worker reconstructs the original request byte for byte before passing it to the runtime. This reduces network traffic when eligible writes repeat.

In three reported runs per setup, ModelLoom averaged **27.20 tok/s** in generation and stock llama.cpp RPC averaged **25.82 tok/s**. The setups used different KV cache precision, so the comparison cannot isolate the bridge’s effect. See the [runs and test settings](docs/getting-started/developer-guide.md#performance-experiment).
