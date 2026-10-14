# ADR-0006: Model configuration and the local API

**Date:** 2026-10-13

**Status:** Accepted by the user on 2026-10-13 for the Windows development slice, explicitly including protected configuration storage, Windows-protected API keys, sender-validated management operations and a key-required loopback API using shared generation. Implementation is authorized on `feat/local-api`. This is not independent security review or production acceptance; D04/D07 remain open overall.

## Behaviour and evidence

Follow Bionic 1.1.7+7's separation of load and operation settings. Its inspected OpenAI Chat Completions handler obtains the loaded model's base prediction configuration and combines it with the request override stack. Its user-default provider stores separate `data.load` and `data.operation` settings per indexed model. This is shipped-code evidence, not a completed live saved-default experiment. The observed editor also shows separate performance, generation and advanced groups.

ModelLoom captures defaults when a request is admitted. Explicit supported API fields replace only that request's defaults. Save never changes an active or queued request. Load settings take effect through explicit Stop/Load with fresh resource preflight. No automatic reload or model substitution is permitted.

Disabled generation checkboxes preserve their manual values while disabling the filter: Top P resolves to 1, Min P to 0, repeat penalty to 1, presence penalty to 0, and Seed to the pinned sampler's random sentinel `4294967295`. Initial records preserve the actual profile's behaviour through corresponding enabled states. Disabled response length still resolves to the finite approved output budget. This corrects the earlier specification's inheritance wording according to the Bionic trace.

The pure contract bounds temperature to 0-2, probabilities to 0-1, Top K to integer 0-2147483647, repeat penalty to 0-100, presence penalty to -2 to 2, and seed to unsigned 32-bit integer. Stops are at most four non-empty UTF-8 strings of at most 256 bytes each. Output tokens must be a positive integer within the trusted profile ceiling. These are explicit ModelLoom bounds, not a claim that Bionic rejects every other value.

The existing four-slot Bonsai profile retains its 7,680 tokens per slot and 512-token output ceiling. A higher requested output budget fails explicitly. Other load tuples remain unavailable until their resource evidence is approved. Template-dependent thinking changes stay unavailable until the selected template is verified. Advanced reasoning budgets, overflow, templates, RoPE and raw arguments remain stored preferences rather than executable options.

## Accepted storage and identity boundary

- Use the verified GGUF SHA-256 as the stable configuration identity. Main derives it from import inspection; renderer-provided paths and preview IDs have no authority. Reimporting the same bytes finds the same defaults.
- Keep configuration in a separate, utility-owned SQLite database under the trusted application root, with schema version 1 and compare-and-swap revisions. Reuse the retained Windows identity/DACL mechanism only after extending its closed purpose selector to a fixed configuration directory and fixed database/journal names. No arbitrary path parameter or plaintext fallback is introduced. Bound records to 64 KiB, the database to 4 MiB and its rollback journal to 8 MiB.
- Validate known schema and integrity before use; reject unknown schemas. Serialize saves in transactions, retaining the prior record on failure. Do not automatically migrate, repair or delete user data.
- Retain the first verified import timestamp in a separate bounded identity table in the same configuration database. Public model IDs derive from the verified digest and never from a private path or native alias.
- Add nullable captured generation settings to history through an exact schema-4 to schema-5 migration, preserving earlier fields. Legacy attempts keep unknown settings unknown; Retry requires an explicit new send if exact settings cannot be recovered.

## Accepted local API and credential boundary

- Use built-in `node:http`, bound exclusively to `127.0.0.1`, with explicit Start and no app-launch autostart. Require a separate 256-bit random bearer key. Deny Origin headers and Host authorities outside the exact listener allowlist. Do not expose native routes or network serving.
- Protect the recoverable key using Windows DPAPI under the current user and store only its protected bytes in the separate managed database. Native protection failure blocks key operations and Start. No signing or runtime credential is reused.
- Keep key generation, verification and rotation in core. Use Node's standard constant-time comparison on fixed-size credential digests. A successful atomic replacement revokes old caller authority and cancels its work; a failed save retains the existing generation.
- Main validates the exact window and main frame before every management operation. Data-only configuration operations carry model ID, expected revision and a closed validated record. No caller can supply capabilities, paths, URLs, slots, native arguments or ownership handles.
- Key status is always masked. Explicit Reveal delivers a transient value masked on blur/navigation or after 30 seconds; Copy uses main's clipboard operation and returns no secret. Public HTTP cannot invoke management operations.
- Bound HTTP headers to 16 KiB, body to 256 KiB, connections to 32, headers to 5 seconds, request body to 15 seconds and unsent response data to 64 KiB. Cancel a stalled reader through ordinary caller-owned settlement. Stop closes public sockets and cancels API work without treating socket closure as native completion.
- Chat and stateless API work share one admission queue. API identities do not fabricate conversation or attempt IDs and never write Chat history. A cancellation confirmation failure closes admission and reports the wider runtime recovery requirement; it must not silently free a slot or hide interruption of unrelated work.

## Review and validation

The user explicitly accepted this design before continuation. Implementation and
dated results are in [the local API development guide](../../docs/LOCAL-API-DEVELOPMENT.md)
and [the October 14 review](../../docs/LOCAL-API-REVIEW-2026-10-14.md). Core/renderer,
retained storage, DPAPI and pinned SDK fixtures establish their specific contracts.
Later packaged real-model Chat/API checks and private-pipe startup/owner-death
checks retain their stated scope; older successful model runs do not establish
loaded-model acceptance after a credential transport change. First-run UI coverage
uses the recorded test-home qualification. Native computer-use availability has
varied; successful observation does not establish reliable input. Inference
equivalence, independent full security review and production/platform acceptance
remain outstanding.

References: [API specification](../API-SPEC.md), [security requirements](../SECURITY-SPEC.md), [implementation plan](../../plans/LOCAL-API-AND-MODEL-CONFIGURATION-IMPLEMENTATION.md), [LM Studio defaults](https://lmstudio.ai/docs/app/advanced/per-model), and [pinned native protocol](https://github.com/ggml-org/llama.cpp/blob/4f31296a907d73f3409f720429bcf31111615d77/tools/server/README.md).
