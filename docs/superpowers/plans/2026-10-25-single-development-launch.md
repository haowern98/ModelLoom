# One development launcher

The user approved implementation on 2026-10-25. The only interactive development
launch command is `npm run electron dev` from the workspace root. Keep pnpm for
dependency management and build/test commands. Preserve the source development
profile and Tailscale enrollment; do not migrate it to packaged profiles.

1. Add a small Node launcher which accepts only `dev`, resolves this checkout's
   Forge CLI and runs it from `apps/desktop`. Remove the old `dev`/desktop `start`
   aliases. Reject direct development Forge/Electron starts with guidance to use
   the canonical command. The launcher marker is a workflow guard, not authority.
2. Apply Electron's single-instance lock to source development as well as packaged
   builds. A second launch restores/shows/focuses the existing window.
3. Cover command validation, child ownership/exit, legacy alias removal and instance
   behavior. Keep packaging and isolated CI artifact tests separate.
4. Update current development/agent instructions. Verify the exact npm command,
   one window/main process and unchanged profile. No dependency installation,
   profile deletion, runtime/GPU experiment, PTSS deployment or publication.

## Evidence

- Four Node launcher tests and nine desktop instance/path tests passed. Targeted
  ESLint, desktop typecheck and formatting passed.
- Ran the exact `npm run electron dev` twice. The second invocation exited 0;
  the original visible ModelLoom main PID 37256 and helper PID 6900 remained.
  The helper still uses the existing Roaming/ModelLoom enrollment directory.
- The previous debug session failed graceful Quit and retained its profile. Only
  its verified main PID and the incomplete new test launch were stopped after
  checking their descendants contained no active native model runtime.
- Disabled the two obsolete local packaged executables under `apps/desktop/out`
  by renaming them with `.disabled`. No profile or enrollment was deleted.
- Windows Computer Use could not initialize (kernel assets path missing), so
  window/process observations verify launch and instance retention; no new UI
  or Tailscale connection-status assertion is inferred from those observations.
- Pre-existing staged index unchanged. PTSS deployment unchanged. No commits,
  pushes, native model launches or inference tests.
