# Windows preview user guide

This guide covers the Windows source-development preview. It describes the current development path, not a packaged public release.

## Start the preview

From a normal PowerShell or Windows Terminal session outside Codex, open the repository root, install the pinned workspace dependencies once, then use the supported interactive launcher:

```powershell
pnpm install --frozen-lockfile
npm run electron dev
```

Use `npm run electron dev` for later manual starts too. The source app keeps its development profile and checks its runtime/bootstrap assets before opening. If startup stops during preparation, follow [developer setup](developer-guide.md#onboard); do not launch llama.cpp yourself. The app's **Explore models** action is not a downloader.

## Import the approved model

1. Open **Models** and choose **Import GGUF**.
2. Select a standalone GGUF file and wait for **Indexing…** to finish.
3. Keep the file at that location. ModelLoom indexes the source; it does not copy or move it.

Import a standalone GGUF supported by your verified runtime. An indexed model still needs to pass runtime and resource checks before it can load.

## Load locally and chat

1. Open **Cluster → Overview** and choose the imported model in the model picker.
2. For a new allocation, choose **Auto place** or assign layer ranges manually. Auto place prepares a proposal; click the play button again to load. Saving a named configuration is optional.
3. Wait for the load action to finish and the status to report **Loaded**. Loading rechecks the model file, selected runtime, and available resources.
4. Open **Chat**, enter a prompt, and choose **Send**. Send is available when a model is loaded. Use Chat's Stop control to interrupt a response; use **Unload model** in Cluster when you want to release the model before changing runtimes or placements.

Use the validated settings for the model and devices in this preview. Unsupported load tuples, insufficient free memory, or an unverified runtime are rejected rather than silently changing the model or its quality.

## Choose a runtime

Open **Settings → Runtime**. The **GGUF** selector shows installed verified builds for the next load; **Active runtime** identifies the build used by a currently loaded model. A runtime selection does not replace the active build until the next load. The b11306 CUDA package is the development baseline; other packages shown in a checkout can have narrower validation scope. Use a compatible approved runtime on both PCs for a worker run.

## Share a worker GPU

Use two ModelLoom PCs on a reachable private LAN address or an already configured Tailscale network. In this guide, the **worker** shares a GPU and the **coordinator** assigns model layers to it.

1. On the worker, open **Cluster → Connections → Share this PC**. Select the GPU to share, choose the worker's reachable private address if more than one is listed, then turn on **Allow connections**. Approve the Windows permission prompt if ModelLoom requests it.
2. On the coordinator, open **Cluster → Connections → Add device**. Enter the worker's LAN or Tailscale IP address and choose **Connect**.
3. On the worker, open the incoming request under **Share this PC → Requests** and choose **Review**. The dialog shows a six-digit pairing code.
4. On the coordinator, find the pending invitation under **Add device → Invitations and shared PCs**, choose **Verify code**, and enter the worker's code. The code expires after five minutes.
5. Return to the worker's request and choose **Allow** once the code is verified. Approval grants this coordinator access to the selected shared GPU. You can later remove that access with **Revoke access**.
6. On the coordinator, return to **Cluster → Overview**, select the worker GPU in the allocation, and load the validated configuration. Both PCs need a compatible verified RPC runtime; use the same compatible build on both.

Pairing requires explicit verification and approval. A preview or sample connection shown in a demo is not a real peer.

## Troubleshooting

| What you see                                     | What to check                                                                                                                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **No models imported**                           | Finish library restoration, then import a supported standalone GGUF. Import does not download models.                                                                                            |
| The model is **unavailable** after restart       | The indexed source path may have moved or changed. Select the valid file again to refresh the entry.                                                                                             |
| Import says the file cannot be safely opened     | Choose a normal standalone copy, not a shortcut, hard link, reparse point, or a file held by another program.                                                                                    |
| Load rejects the model or settings               | Confirm it is the approved model and use a validated runtime, placement, and load profile. Do not lower precision or change context to bypass the gate.                                          |
| Load reports insufficient resources              | Close other GPU/memory workloads and retry. If the required reserve is still unavailable, the profile cannot load on the current resources.                                                      |
| Worker is unavailable or pairing fails           | Check the worker address, its sharing switch, the Windows Firewall prompt, and that both PCs run a compatible ModelLoom version. Reconnect and use a fresh code if the five-minute code expired. |
| `RPC_PACKAGE_REQUIRED` or `INCOMPATIBLE_RUNTIME` | Install/select an approved compatible peer runtime on both PCs, then reconnect and retry.                                                                                                        |
| Chat cannot send                                 | Open Cluster and confirm the model is **Loaded**. If loading failed, resolve the load error before retrying.                                                                                     |
| Runtime cleanup could not be confirmed           | Loading remains blocked until cleanup is safe. Quit and reopen ModelLoom before another allocation; do not terminate a runtime by process name.                                                  |

For startup and build checks, see the [Developer Guide](developer-guide.md).
