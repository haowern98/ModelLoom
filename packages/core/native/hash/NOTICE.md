# Hash source provenance

`sha256.c`, `sha256.h` and `rotate-bits/rotate-bits.h` are copied unchanged from llama.cpp commit `4f31296a907d73f3409f720429bcf31111615d77`, under `vendor/hash/`. SHA-256 is Igor Pavlov's public-domain implementation based on Wei Dai's Crypto++ work. Preserve the adjacent original `LICENSE`, original file notices and upstream `LLAMA-CPP-LICENSE`.

This code is shared by the cache maintenance binding and the pinned RPC patch. No new crypto dependency, credential format or key lifecycle is introduced.
