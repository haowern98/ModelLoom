import path from 'node:path';

export interface RuntimePathInputs {
  packaged: boolean;
  development: boolean;
  release?: boolean;
  resources: string;
  workspaceCore: string;
  pairedBuild?: boolean;
  localData: string;
  home: string;
}

/** Resolves trusted main-owned paths for explicit development and release builds. */
export function runtimePaths(input: RuntimePathInputs): {
  core: string;
  bootstrap: string;
  state: string;
  profile: string;
  runtimes?: string;
  chromium?: string;
} | null {
  if (input.packaged && !input.development && !input.release) return null;
  const join = (...parts: string[]) => path.win32.join(...parts);
  if (!input.packaged) {
    const bootstrap = join(
      input.workspaceCore,
      'out/activation',
      input.pairedBuild ? 'b11307' : 'b11306',
    );
    const profile = join(input.home, '.modelloom');
    return {
      core: input.workspaceCore,
      bootstrap,
      state: bootstrap,
      profile,
      runtimes: join(profile, 'runtimes'),
    };
  }
  if (!path.win32.isAbsolute(input.localData)) throw new Error('INVALID_APPLICATION_DATA');
  if (input.release) {
    const profile = join(input.home, '.modelloom');
    const assets = join(input.resources, 'modelloom-release');
    return {
      core: join(assets, 'core'),
      bootstrap: join(assets, 'bootstrap'),
      state: join(profile, 'release'),
      profile,
      runtimes: join(profile, 'runtimes'),
    };
  }
  const assets = join(input.resources, 'modelloom-development');
  const data = join(input.localData, 'ModelLoom-Development');
  return {
    core: join(assets, 'core'),
    bootstrap: join(assets, 'bootstrap'),
    state: join(data, 'runtime'),
    profile: join(input.home, '.modelloom-packaged-development'),
    chromium: join(data, 'chromium'),
  };
}
