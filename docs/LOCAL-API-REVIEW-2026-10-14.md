# Local API and packaged development review, 2026-10-14

What this change does: It connects the existing configuration and API pages to
protected local settings, a key-required loopback server and the shared Chat/API
queue. It also packages the approved Windows development runtime, using the
original server/helper names and an owner-bound private credential pipe.

**Authorized follow-up:** The user subsequently said PROCEED for all three
findings. The staging guard now runs before `try/finally`. Test-only runtime
enumeration validates every installed entry before deletion, preserves a normal
cache and rejects linked/unexpected entries. The live check preserves a primary
failure as the displayed cause if cleanup also fails. Live configuration help
now distinguishes saved generation defaults from load settings that require
Stop/Run and verified resources. Focused regressions failed before the helper fix
and pass afterwards. Full verification passed 129 desktop and 537 core tests,
all three staging tests, lint and typechecking. The development package rebuild
also passed. After memory was freed and a test launcher-PID mistake was corrected,
the latest live check passed real Chat generation, normal unload, reload and
owner death during loading. The results below distinguish these follow-ups from
the initial review. Broader packaged/security/release signoff remains open.

Reviewed checkout before local commits: `feat/local-api`, HEAD
`2ca5d791858b80d72a0737e286621ed827ba86df`, with the existing uncommitted work.
PR #6 is merged; its CI results do not cover this slice. This request authorizes
review, existing acceptance checks and documentation updates. The initial review
made no product/test edits; the later PROCEED authorized the three fixes above.
Nothing was staged, committed or published during the review/checks. The user
subsequently requested local commits; the source/test checkpoint is recorded
below. No push or hosted CI result is claimed.

## Local commit checkpoint

On October 14 the user requested commits after accepting the automated live
check. The feature and test groups are recorded in 68 focused local commits,
ending at `28d344d`, with at most two explicitly staged files per commit.
Documentation and build tooling follow in separate groups. Fresh pre-commit
verification passed 129 desktop tests sequentially, 537 core tests, full lint
and typechecking. An in-memory LF-normalized formatting check passed all 141
format-supported scoped files without rewriting unrelated CRLF files.
The earlier packaged live receipt retains its exact tested archive identity.
Local research, reference assets, plans and browser snapshots stay outside these
commits. No remote publication or signing is authorized by this checkpoint.

## Authorized fix verification

| Check                                             | Result                                                                                                                                                                                                                                                                            |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused runtime-path and live-configuration tests | Exit 0: eight tests passed, including three new filesystem cleanup regressions that reproduced failures before the fix.                                                                                                                                                           |
| Desktop sequential suite                          | Exit 0: 129 tests in 23 files passed with unchanged deadlines/assertions.                                                                                                                                                                                                         |
| Core suite                                        | Exit 0: 537 tests in 52 files passed.                                                                                                                                                                                                                                             |
| Staging tests with development preparation        | Exit 0: all three passed; ordinary host output restored afterwards.                                                                                                                                                                                                               |
| Full lint and typechecking                        | Exit 0.                                                                                                                                                                                                                                                                           |
| `pnpm package:development`                        | Exit 0 using existing signed inputs; no signing or metadata renewal. Ordinary host output restored afterwards.                                                                                                                                                                    |
| Rebuilt artifact audit                            | Exit 0: all 61 resources matched their manifest hashes, 1,192,467,104 bytes; all four original protected-profile hashes matched. Ordinary compiled development authority remained false.                                                                                          |
| Initial rebuilt-package attempts                  | First run failed during import with a generic runtime error. Separate packaged inspection/registration and normal-profile import diagnostics passed. The second unchanged live run imported Bonsai, then correctly rejected loading for insufficient available RAM or GPU memory. |
| Live rerun after freeing memory                   | Exit 0, one actual packaged test in 2.2 minutes: original server/helper names, real Chat completion, normal unload, reload, forced actual main-process exit during loading, every captured process gone and temporary runtime version removed.                                    |

Both live failures remained visible after cleanup. No resource, ownership or
assertion checks were weakened. Captured test app processes exited, and mining
was restarted after each check; SRBMiner was observed running afterwards.
The original import failure's cause remains unestablished.

The first run with sufficient memory generated a response and unloaded normally,
then exposed a test mistake: `app.process().pid` identified the Windows `cmd.exe`
launcher. Killing it left the Electron owner alive and its installed files locked.
An isolated diagnostic confirmed this. The test now reads `process.pid` in
Electron main, matching the existing lifecycle/private-stream checks. The
corrected run passed with unchanged product code, settings, deadlines and
ownership guards. Targeted test lint, formatting and desktop typechecking passed.
This is automated real Electron UI evidence, not manual Computer Use.

Fresh post-run audit passed all 61 resource hashes and all four original profile
hashes. Only `runtime-cache` remains in that test's installed root, and its
verification floors remain present. SRBMiner was observed running again; no
test app/helper/server remained. The successful receipt and post-run audit are
under `review-fixes/live-ram-retry/correct-owner` as
`original-paths-loaded-owner-check.json` and `artifact-audit.json`. The parent
folder retains both run logs and `owner-kill-diagnostic.json`.

The rebuilt development archive SHA-256 is
`71a42493fb2c58742f4ec51dc004b923a8b39ed310896300634a3e51b3d99308`.
The archive contains both corrected live-help strings. Follow-up evidence is
retained under ignored
`packages/core/out/activation/b11306/evidence/packaged-development-20261014/review-fixes`:
`rebuilt-artifact.json`, `artifact-audit.json`, `import-diagnostic.json`,
`import-ui-diagnostic.json` and `live-resource-rejection.md`.
The full suite, staging and packaged commands are the same as those recorded
below, with `review-fixes` as the follow-up evidence directory. The focused
command selected `src/main/runtime-paths.test.ts` and
`src/renderer/app/LiveModelConfiguration.test.tsx` through desktop Vitest.

## Must fix: original review

1. **Full lint fails on test cleanup**
   ([stage-development.test.mjs](../apps/desktop/scripts/stage-development.test.mjs#L63)).
   - What this is: A path guard checks the temporary staging tree before removing it.
   - Problem: Its `throw` is inside `finally`, and `pnpm lint` fails with
     `no-unsafe-finally`. A cleanup exception can also replace the original failure.
   - Fix: Validate and retain the generated cleanup path before entering the
     guarded operation, preserving the containment check and every assertion.
   - If we skip it: The full quality check cannot pass for publication.

2. **The live package test rejects the current runtime-cache layout**
   ([runtime-paths.desktop.spec.ts](../apps/desktop/tests/runtime-paths.desktop.spec.ts#L20)).
   - What this is: The test counts installed versions and removes only its own
     disposable runtime copies after the run.
   - Problem: The engine now creates `installed/runtime-cache`, but the test
     expects exactly one entry at lines 92 and 121 and treats every entry as an
     install eligible for deletion. Cleanup throws `UNSAFE_TEST_RUNTIME_CLEANUP`
     on the cache and replaces any earlier failure. The actual run reproduced
     that cleanup exception; the retained tree contains the cache. No passing
     loaded-model receipt was written, so loading/generation cannot be claimed.
   - Fix: Count only validated runtime-version directories. Recognize and preserve
     the expected cache separately, keep containment/link guards, and report
     cleanup failure without hiding the primary failure. Then rerun the unchanged
     model/settings journey.
   - If we skip it: The latest real-model and loading-owner-death checks cannot
     produce trustworthy acceptance evidence.

## Should fix: original review

3. **Live configuration help still describes demo defaults**
   ([ModelConfigurationPage.tsx](../apps/desktop/src/renderer/features/models/ModelConfigurationPage.tsx#L162)).
   - What this is: Numeric-setting help is shared by the preview and live editor.
   - Problem: The helper always says values are samples and runtime support is
     unchecked, including live temperature/settings populated from core.
   - Fix: Select accurate live help when `live` is present; retain preview wording
     for explicit demo mode. Keep controls, values and layout unchanged.
   - If we skip it: Users get an incorrect explanation of saved live settings.

Initial verdict: fix 1 and 2 before publication; fix 3 with a focused UI-copy change.

## Initial review verification

Commands used the existing pinned Node 24.21.0/pnpm runtime. Results below are
from the initial review, not copied from the earlier package reports. The
authorized-fix results above supersede its lint and cleanup findings.

| Check                                              | Result                                                                                                                                                                                                         |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`                                        | Exit 1: desktop 123 passed, three existing Cluster/Joining cases timed out at 5 seconds; core did not run because the command stopped.                                                                         |
| Desktop `vitest run --no-file-parallelism`         | Exit 0: all 126 tests in 23 files passed with original assertions/deadlines. This does not establish the timeout cause.                                                                                        |
| Core `test`                                        | Exit 0: 537 tests in 52 files passed.                                                                                                                                                                          |
| Core `test:native`                                 | Exit 0: rebuilt native/host output; all 81 tests in 11 files passed. Uses synthetic native/runtime/storage/publisher fixtures, not the real publisher store or a loaded model.                                 |
| `pnpm typecheck`                                   | Exit 0 for desktop and core.                                                                                                                                                                                   |
| `pnpm lint`                                        | Exit 1: one `no-unsafe-finally` error, finding 1.                                                                                                                                                              |
| `pnpm format:check`                                | Exit 1: 106 CRLF files warned. All 202 tracked format-supported files passed an in-memory LF-normalized check; no source formatting change was made.                                                           |
| Core `check:native`                                | Exit 0: owned native formatting and clang-tidy checks passed.                                                                                                                                                  |
| Staging tests                                      | Initial ordinary-output run: one passed, two stopped at `DEVELOPMENT_BUILD_REQUIRED`. With the existing development build preparation, all three passed, exit 0. Ordinary host output was restored afterwards. |
| Five actual packaged checks, one worker            | Exit 0: private stream EOF, owner death before delivery, duplicate-instance exclusion, original server version, ordinary-package refusal of injected development authority. No model loaded.                   |
| Actual `runtime-paths.desktop.spec.ts`, one worker | Exit 1 after 56.1 seconds: finding 2 masked the earlier result. No loaded-model success or owner-death success is claimed.                                                                                     |
| Artifact audit                                     | Exit 0: all 61 resources matched manifest hashes, 1,192,467,104 bytes; all four original protected-profile hashes matched. Ordinary compiled development authority remained false.                             |

The development application archive SHA-256 is
`35a816b4befce4439f223c423d8e7969225548ec01848e63ff0463877aebe1ef`.
The ordinary archive is
`1e35988bd972f791ee527517832c53566cff20a3ee84bc495b02e40478d447b8`.
These identify the existing tested artifacts, not a new full package build.
Evidence is retained under ignored
`packages/core/out/activation/b11306/evidence/packaged-development-20261014/review-current`
and the failed Playwright result directory.

The verification commands were:

```text
# Workspace root, using the pinned Node/pnpm runtime
pnpm test
pnpm --filter @modelloom/desktop exec vitest run --no-file-parallelism
pnpm --filter @modelloom/core test
pnpm --filter @modelloom/core test:native
pnpm typecheck
pnpm lint
pnpm format:check
pnpm --filter @modelloom/core check:native

# apps/desktop, with development preparation and ordinary restoration
node ../../packages/core/scripts/build-development.mjs
node --test scripts/stage-development.test.mjs
node ../../node_modules/typescript/bin/tsc -p ../../packages/core/tsconfig.build.json

# Workspace root, packaged test flags set explicitly
pnpm --filter @modelloom/desktop exec playwright test --project=desktop tests/credential.desktop.spec.ts tests/instance.desktop.spec.ts tests/version.desktop.spec.ts tests/profiles.desktop.spec.ts --workers=1
pnpm --filter @modelloom/desktop exec playwright test --project=desktop tests/runtime-paths.desktop.spec.ts --workers=1
git -c core.safecrlf=false diff --check
```

Packaged commands used `MODELLOOM_PACKAGED_RUNTIME_TEST=1` and the review-current
evidence directory. The five-check run additionally set
`MODELLOOM_PACKAGE_PROFILE_TEST=ordinary`. The default existing development
artifact was used. Staging first ran once before development preparation; that
failed setup is retained in the results above. Documentation formatting and
relative-link checks were run after reconciliation.

## Evidence reconciliation and limits

- Read older package reports in chronological order through
  `CONTINUATION-REVIEW.md` and `ORIGINAL-PATHS-RESTORED.md`. Grouping is no longer
  a gate under the user's October 14 decision. Original filenames and verified
  ownership remain required; renamed launch copies remain removed.
- The former temporary credential-file gap was addressed by the private pipe.
  Native and actual packaged startup/owner-death checks pass. The latest loaded
  Chat/original-path/unload/loading-owner check also passes. This does not promote
  every earlier API/security journey to fresh acceptance.
- First-run page coverage and P06 rejection coverage were already reconciled in
  the continuation. Preserve the fresh-home/test-host qualification and retained
  verification-floor evidence; no extra GUI mutation sweep is required by P06.
- Earlier real Chat/API/defaults/restart/disconnect/utility-death checks predate
  the pipe change. Keep their scope rather than promoting them to fresh acceptance.
- An ordinary native fault remains unverified. The earlier injected breakpoint
  diagnostic and controlled process termination do not prove a spontaneous
  upstream fault. No assertion or resource guard was weakened to obtain a pass.
- Mining was stopped together with its captured Kryptex watchdog for the live
  check. Kryptex was restarted in `finally`; SRBMiner was observed running again.
  The test app/runtime processes exited. The disposable cache was retained
  after its cleanup guard rejected it; no manual deletion workaround was used.
- The review traced public parsing/authentication, caller revocation, shared
  admission/settings capture, protected storage/schema upgrades, management
  sender/frame checks, native credential delivery and packaged path/ownership
  boundaries. It is a focused source review, not independent full security
  signoff, cross-platform acceptance or inference-equivalence evidence.
- The agent tool cannot select Luna/max, so this review and verification stayed
  local. Historical delegated-review claims retain their original qualifications.

Not checked: ordinary native fault, Explorer launch, manual Computer Use/full
visual acceptance, other platforms and hosted CI for this local slice.
No signing, key rotation, publication or deployment occurred.
