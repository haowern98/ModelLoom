# ModelLoom versus stock llama.cpp RPC

The table records the generation throughput readings reported by the operator. Each mean gives equal weight to the three runs in its column.

| Run      | ModelLoom (tok/s) | Stock llama.cpp RPC (tok/s) |
| -------- | ----------------: | --------------------------: |
| 1        |             27.02 |                       25.91 |
| 2        |             27.63 |                       26.01 |
| 3        |             26.95 |                       25.55 |
| **Mean** |         **27.20** |                   **25.82** |

The difference is **1.38 tok/s**, or **5.33%** relative to the stock mean. The percentage uses the unrounded means.

The operator confirmed they reused the earlier test setup. The stock run used **Qwen3.8-27B IQ4_XS** with **CUDA b11306**, **MTP enabled**, and a **50/50 layer split** with ptss first and HAOWERNSLAPPY last. The stock startup log confirms **30,720 tokens in one slot** and MTP initialization. The earlier setup used **BF16 K/V** in stock llama.cpp and **Q8_0 K/V** in ModelLoom.

The six readings come from the operator. The stock startup log establishes launch settings, while per-run logs would establish the exact prompt, sampling, and timing for each reading. The KV precision difference limits attribution of the throughput difference to the residency bridge.

The separate Bonsai experiment measured the residency codec with the app in both arms and recorded RPC byte counts. [Bonsai residency measurements](APP-RESIDENCY-BENCHMARK-2026-10-27.md)
