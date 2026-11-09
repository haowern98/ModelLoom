<p align="center">
  <img src="docs/assets/modelloom-logo.png" alt="ModelLoom indigo woven-knot logo" width="56" height="56">
</p>

<h1 align="center">ModelLoom</h1>

<p align="center"><strong>Local and distributed LLM inference with llama.cpp</strong></p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Windows%20x64-blue" alt="Windows x64">
  <img src="https://img.shields.io/badge/models-GGUF-555" alt="GGUF models">
  <img src="https://img.shields.io/badge/backend-CUDA-76b900" alt="CUDA backend">
  <img src="https://img.shields.io/badge/backend-Vulkan-a41e22" alt="Vulkan backend">
  <img src="https://img.shields.io/badge/status-Windows%20preview-orange" alt="Windows preview">
  <a href="https://github.com/haowern98/ModelLoom/actions/workflows/checks.yml"><img src="https://github.com/haowern98/ModelLoom/actions/workflows/checks.yml/badge.svg?branch=main" alt="ModelLoom checks on main"></a>
</p>

<p align="center">
  <a href="docs/getting-started/user-guide.md">User Guide</a> /
  <a href="docs/getting-started/developer-guide.md">Developer Guide</a>
</p>

## Quick start

ModelLoom is a Windows desktop app for running GGUF models on one GPU, splitting layers across multiple GPUs in one PC, or sharing the workload between two PCs over a private network.

[**Download for Windows x64**](https://github.com/haowern98/ModelLoom/releases/tag/v0.1.1)

Run `ModelLoom-Setup-x64.exe`, then choose CUDA or Vulkan on first launch. ModelLoom downloads and verifies the selected llama.cpp runtime. The [User Guide](docs/getting-started/user-guide.md#install-modelloom) covers the checksum and Windows publisher warning.

1. Import a GGUF file in **Models**.
2. In **Cluster → Overview**, select the model and assign its layers to the GPUs you want to use.
3. Click **Load model**. Once the model is loaded, open **Chat**.

## Why ModelLoom?

ModelLoom is built for splitting a GGUF model across GPUs you already own. Assign exact layer ranges in the desktop app, run them across a coordinator and an approved worker over a private network, and see the placement on the cluster canvas. The Residency Bridge reduces coordinator-to-worker traffic when eligible tensor writes repeat.

## Cluster overview

<p align="center">
  <img src="docs/screenshots/cluster-overview.png" alt="Cluster overview showing GGUF model layers split between Node 1, the coordinator, and Node 2, the worker">
</p>

## Features

- **Visual GPU layer assignment** — Set layer ranges directly on device cards in the Cluster view.
- **Built-in Chat** — Send prompts to a loaded model from the desktop app.
- **Local OpenAI-compatible API** — Send chat completion requests from scripts and other applications.

## Residency Bridge

When both peers support the Residency Bridge, ModelLoom can send a short reference for an eligible tensor write it has already sent. The worker reconstructs the original request byte for byte before passing it to the runtime. This reduces network traffic when eligible writes repeat.

In three reported runs per setup, ModelLoom averaged **27.20 tok/s** in generation and stock llama.cpp RPC averaged **25.82 tok/s**. The setups used different KV cache precision, so the comparison cannot isolate the bridge’s effect. See the [runs and test settings](docs/getting-started/developer-guide.md#performance-experiment).
