# ADR-0001: Product and UI baseline

**Date:** 2026-09-30  
**Status:** Accepted historical product baseline; process-name/hosting direction partially superseded by [ADR-0002](0002-lm-studio-runtime-direction.md); no implementation authorization  
**References:** [PRODUCT-SPEC.md](../PRODUCT-SPEC.md), [UI-SPEC.md](../UI-SPEC.md)

## Context

The existing PRD defines an Electron desktop app for pooling personal computers and running existing dense GGUF models. The user supplied five generated ModelLoom screens, clarified darker foreground content panels and rounded corners, and accepted the proposed model/queue/cache/placement defaults. They requested specifications and guides before coding.

## Decisions already agreed

- One installation per device; Windows/Linux NVIDIA CUDA and Apple Silicon macOS Metal support, plus Linux headless workers.
- LAN, Tailscale, and an existing user-operated Headscale server are connection options. Networking components are embedded or supplied/managed by ModelLoom; no separate user installation is required for normal setup. Built-in Headscale server hosting is outside the release.
- Models, Cluster, Chat, API, and Settings are the five main screens. The preserved ModelLoom screenshots are the visual source of truth. The additional ChatGPT image clarifies foreground panel layering and rounding.
- One active model is shared by Chat and API. Requests have a bounded queue with visible busy states and cancellation.
- Approved workers may automatically receive/cache required model data with visible storage locations, limits, and cleanup.
- API exposure beyond localhost is explicit and requires an API key. Worker approval does not authorize API access.
- Placement changes are pending until an explicit restart with an interruption warning.
- Runtime updates are independent of app releases, verified before activation, checked across the cluster, and reversible with a retained working version. The initial baseline required branded names without raw llama.cpp executables; **that naming rule is historical and superseded by ADR-0002**, which allows grouped llama-server. The no-visible-console-window requirement remains.
- Preserve weights and sampling behavior and match the quality of the single-GPU reference. Speculative methods requiring draft models are prohibited.
- Use dedicated `specs/`, `docs/`, and `plans/` directories. Product requirements have one authoritative home at `specs/PRODUCT-SPEC.md`.

## Consequences

Feature work must preserve these requirements. Measurements and model/device data must come from actual state; screenshot examples are not fixed values or capability promises. Cross-platform release requires real platform, mixed-device, headless, and network-path acceptance evidence.

The accepted defaults do not settle a catalogue/provider, localhost key policy, attachments/feedback scope, or extra navigation destinations. They also do not choose a networking library, storage format, signing design, transport, numeric queue limit, or UI framework. The later native-host direction is recorded in ADR-0002 and precise hosting remains gated on the D01 LM Studio audit. Open choices are listed in the [decision register](README.md).

## Authorization and evidence

This record summarizes supplied requirements; it is not a claim of feasibility or completed validation. Only documentation and reference preservation have been authorized in the current request. Coding, scaffolding, product dependency installation, builds, GPU workloads, and implementation remain gated on **PROCEED** and resolution of applicable decisions.
