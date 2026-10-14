# Model configuration and the local API

The initial Windows development connection uses the existing model configuration and API pages. [ADR-0006](../specs/decisions/0006-model-configuration-and-local-api.md) was accepted on 2026-10-13. It does not close production, platform, distributed-networking or independent security review gates.

## Using the connection

Start the current checkout with `pnpm dev` using Node 24.21.0 or newer within major version 24. Wait for Forge to report that Electron launched. The development launcher rebuilds the shared core; an older packaged executable does not represent this checkout. No API server starts automatically.

The separately approved Windows development artifact is built with `pnpm package:development`. Its executable is `apps/desktop/out/development/ModelLoom Development-win32-x64/ModelLoom Development.exe`. It stages the verified runtime and bundled core dependencies, while the approved model remains external. Copy the whole package directory when relocating it. The command requires the existing native build and unexpired signed bootstrap inputs; it does not sign or renew them.

This artifact uses `%USERPROFILE%\.modelloom-packaged-development` for protected history, settings and the API key, and `%LOCALAPPDATA%\ModelLoom-Development` for Chromium and runtime state. It does not migrate the ordinary development profile. The engine and API start only through explicit actions. Local packaged checks exercised the approved model, real Chat, JSON/SSE and usage, stream-disconnect isolation, key replacement, retained settings/history/key, controlled native termination/recovery and Quit with queued work. Ordinary packaging after development still disabled runtime authority.

The test launcher inherited Codex's Windows Store package context. Windows redirected the logical local-data location into that package's `LocalCache\Local` folder, causing an exact process-image mismatch. Addressing the same existing state through its physical path in the test launch environment allowed the unchanged native ownership check to pass. No fallback or weaker image check was added. This is a test-host accommodation, not proof of launch from Explorer or release readiness.

Full signoff remains open. The earlier forced-main exit left a temporary credential
directory; the later implementation replaces that file with an owner-bound private
pipe. Native and actual packaged startup tests verify delivery, EOF and pipe
disappearance on owner death. The latest loaded-model check passed real Chat,
normal unload, reload and owner death during loading with the pipe and restored
original filenames. Earlier API/security journeys retain their dated scope.
The user accepts `llama-server.exe` outside the GUI process group, so grouping is
no longer a gate and renamed launch copies have been removed. An ordinary native
fault remains unverified. First-run page checks and P06 rejection coverage were
completed with the test-host qualifications recorded in the continuation reports.
Clipboard passed on continuation; the earlier failure's cause remains unknown.
Exact local results are under ignored
`packages/core/out/activation/b11306/evidence/packaged-development-20261014`.

The October 14 review's staging-lint, runtime-cache cleanup and live-help findings
are fixed. Fresh follow-up checks passed 129 desktop tests sequentially, 537 core
tests, all three staging checks, lint, typechecking and the development package
rebuild. The rebuilt artifact's 61 resource hashes and four original protected
profile hashes matched. Earlier review results include 81 native tests, native
static checks and five packaged startup/authority checks; those were not rerun
as part of this fix. The first live attempts exposed import/resource failures;
after freeing memory, real Chat and normal unload passed. The forced-close check
then revealed that Playwright's launcher PID belonged to `cmd.exe`. Selecting
Electron main's own PID corrected the test, and the complete packaged check
passed generation, unload, reload and loading-owner exit in 2.2 minutes. Only the
test's runtime version was removed; cache and verification floors were retained.
The follow-up artifact/profile audit, targeted lint/format and desktop
typechecking passed. Mining was restarted and SRBMiner observed running. This is
automated Electron UI evidence, not manual Computer Use. See
[the current review](LOCAL-API-REVIEW-2026-10-14.md) for commands and exact limits.

Following the user's RAM-reduction request, packaged four-slot admission is
6,500 MiB (6.35 GiB), down from 7.35 GiB. The model and all context, cache,
concurrency and sampling settings are unchanged. A fresh four-slot memory and
cache validation passed with a 5.76 GiB resident peak and clean shutdown.

Loaded utility termination also passed captured engine/helper exit, port closure,
temporary credential cleanup and usable GUI checks. Quit previously demanded an
acknowledgement from the dead core; it now joins the existing owner confirmation
for `CORE_EXITED`. Unconfirmed cleanup and other broker failures still reject.
The final real Chat/API journey verified exact server identity across disconnect
and exited normally after utility failure. Its last runtime-cache root was an
isolated short path on E: to avoid another large C: installation; the original
C: verification state and protected profile were retained. A deeper E: test path
reached Windows' path-length boundary and was rejected without launching an engine.

Import the approved Bonsai GGUF through Models. Configure opens its existing editor. Save commits defaults to separate protected configuration storage. Its identity is the verified GGUF digest, so importing the same content retains settings and its first recorded import time. A failed Save retains the draft and previous committed revision.

The development importer requires a standalone GGUF file that can be safely locked. Native ownership checks reject hard-linked files, reparse points and unsafe filesystem ancestry without starting an engine. A rejected file now explains that a standalone copy is needed. The approved byte-identical Bonsai copy is `packages/core/out/activation/b11306/models/Bonsai-27B-Q1_0.gguf`; the earlier audit file has two hard links. Import remains session-only, so reopen this file after restarting the app. An empty connected library shows "No models imported"; "No runtime connected" is reserved for unavailable integration.

Generation captures settings once before token accounting and queue admission. An API override applies to its request only. Later Saves cannot rewrite running or queued requests. Retry retains the original captured settings; older attempts with unknown settings require a new send. A disabled filter keeps its editor value but uses its neutral native value; disabled Seed requests randomness. A disabled output-length control still uses the finite profile budget.

The current resource profile remains four slots, 7,680 context tokens per slot and a maximum 512 output tokens, including thinking counted by the runtime. Other performance tuples require reviewed resource evidence and explicit Stop/Load. Thinking changes, reasoning budgets, overflow modes, custom templates, RoPE and raw arguments are unavailable as live options. Stored advanced preferences do not execute native arguments or hidden prompt instructions.

Open API, explicitly Generate key, then Start server. The default address is `http://127.0.0.1:8000/v1`; the page distinguishes the configured address from a listening address. A port conflict fails without changing ports. Copy endpoint becomes available after binding. The server can start without a model; model listing then returns an empty array.

Both routes require the separate bearer key. Reveal lasts at most 30 seconds and is masked on blur, hidden-page state or navigation. Copy writes through main and returns no secret to the renderer. Regenerate commits the replacement, revokes old callers and cancels their work. Failure to protect or save a replacement retains the old key. Stop retains the key but revokes the listener's existing callers. Windows DPAPI and retained configuration paths are required; there is no plaintext fallback.

## Supported requests

The routes are `GET /v1/models` and `POST /v1/chat/completions`. Use the exact opaque model ID returned by listing or populated in the examples. Requests never load or switch models, fetch URLs, read Chat history or proxy private native routes.

The initial completion contract accepts string content in system/user/assistant messages, a final nonempty user message, one choice, optional streaming/usage and plain text output. Supported request overrides are temperature, Top K, Top P, Min P, repeat penalty, presence penalty, seed, output length and stop strings. Unknown options, content arrays, tools, draft models, slot IDs and native arguments fail explicitly.

An explicit first system message replaces the saved system default. Otherwise the default is included once. Token counting and generation receive the same final messages and captured settings. This is the accepted ModelLoom rule; exact Bionic system-default replacement has not been demonstrated by the reference investigation.

Answers and `reasoning_content` remain separate. JSON replies include actual native usage. Streams have stable public IDs, an optional final usage record and `[DONE]` only after successful captured settlement. A thinking-only output-limit result may have empty answer content and `finish_reason: "length"`. Native aliases and credentials never become public IDs or output fields.

Chat and API share four active requests and eight waiting requests. Public Stop and disconnect cancel only captured API handles. Socket closure does not free native capacity. Unconfirmed cancellation closes shared admission and reports that recovery can interrupt Chat work. Full Quit retains the existing owned-runtime teardown policy.

The listener binds only `127.0.0.1`. It denies Origin headers and accepts only exact `127.0.0.1:<port>` or `localhost:<port>` Host values. Network serving and browser clients are unavailable. Bounds are 256 KiB body, 16 KiB headers, 32 connections, five-second headers, 15-second body receipt and 64 KiB unsent response data. A stalled writer has a five-second drain deadline. A listener-wide token bucket allows a burst of 120 HTTP requests and refills at two per second; generation still uses the separate finite shared queue.

Requests counts authenticated completions admitted to the shared queue. Response time averages the last 100 normal completions, including queue time. The viewer retains at most 500 safe service events within 256 KiB. Copy/Clear affect that viewer only; keys, headers, prompts, reasoning and answers are excluded.

## Validation and client versions

Protocol fixtures passed with Node 24.21.0, JavaScript `openai` 7.32.0 and Python `openai` 3.29.0. They cover listing, JSON, SSE and final usage, plus unsupported-field errors; JavaScript additionally covers queue and in-stream errors. These use real loopback HTTP, DPAPI and the SDK parsers with synthetic output. They are not real-model inference equivalence or broad OpenAI API compatibility evidence. The JavaScript fetch example is for Node, since browser Origin requests are denied.

The optional fixture is `packages/core/scripts/check-local-api-clients.mjs`. Build core hosts first, install the pinned JavaScript SDK under ignored `packages/core/out/api-clients/javascript`, and install the Python SDK in the isolated `packages/core/out/api-clients/python` environment. Run it with the pinned Node executable. It creates no user key or saved model conversation, makes no external inference request and stops its ephemeral listener on exit.

Configuration/store, queue, stream, management and React tests establish their specific contracts. A native integration check exercises the retained Windows configuration store, DPAPI recovery, shared generation, API Stop isolation and restart without autostart using a synthetic transport. The packaged checks above add actual Windows model and desktop evidence for their stated scenarios. Electron Playwright controlled the packaged application after the native computer helper became unavailable; it substituted the approved file selection in main for repeated imports. Platform coverage, external Task Manager inspection, inference equivalence and independent security review remain separate evidence.

References: [API contract](../specs/API-SPEC.md), [Bionic investigation](research/BIONIC-CONFIGURATION-CHECKS-2026-10-13.md), [Windows DPAPI](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata), [official JavaScript SDK](https://developers.openai.com/api/reference/typescript), [official Python SDK](https://developers.openai.com/api/reference/python).
