import path from 'node:path';

export interface RuntimePathInputs {
  packaged: boolean;
  development: boolean;
  resources: string;
  workspaceCore: string;
  localData: string;
  home: string;
}

/** Resolves trusted main-owned paths; ordinary packaged builds have no runtime location. */
export function runtimePaths(input: RuntimePathInputs): {
  core: string;
  bootstrap: string;
  state: string;
  profile: string;
  chromium?: string;
} | null {
  if (input.packaged && !input.development) return null;
  const join = (...parts: string[]) => path.win32.join(...parts);
  if (!input.packaged) {
    const bootstrap = join(input.workspaceCore, 'out/activation/b11306');
    return {
      core: input.workspaceCore,
      bootstrap,
      state: bootstrap,
      profile: join(input.home, '.modelloom'),
    };
  }
  if (!path.win32.isAbsolute(input.localData)) throw new Error('INVALID_APPLICATION_DATA');
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
