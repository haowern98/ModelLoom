const { VitePlugin } = require('@electron-forge/plugin-vite');
const { MakerZIP } = require('@electron-forge/maker-zip');
const childProcess = require('node:child_process');
const path = require('node:path');
const { prepareNetworkResource } = require('./scripts/network-resource.cjs');

module.exports = {
  packagerConfig: {
    asar: true,
    name: 'ModelLoom',
    executableName: 'ModelLoom',
    ...(process.platform === 'win32'
      ? { icon: path.join(__dirname, 'assets', 'modelloom.ico') }
      : {}),
  },
  makers: [new MakerZIP({}, ['win32', 'darwin', 'linux'])],
  hooks: {
    prePackage: (config, platform, arch) => {
      prepareNetworkResource(config, platform, arch);
      // Reset workspace policy for every ordinary/demo package, independently of earlier development runs.
      const coreRoot = path.resolve(__dirname, '../../packages/core');
      childProcess.execFileSync(
        process.execPath,
        [require.resolve('typescript/bin/tsc'), '-p', path.join(coreRoot, 'tsconfig.build.json')],
        { cwd: coreRoot, stdio: 'inherit', windowsHide: true },
      );
    },
    preStart: () => {
      if (process.env.MODELLOOM_DEV_LAUNCH !== 'electron-dev') {
        throw new Error('Start ModelLoom with npm run electron dev from the workspace root.');
      }
      if (process.platform !== 'win32' || process.env.MODELLOOM_DEMO === '1') return;
      const coreRoot = path.resolve(__dirname, '../../packages/core');
      // Ordinary host builds reset the development policy; restore it only for this launcher.
      childProcess.execFileSync(
        process.execPath,
        [require.resolve('typescript/bin/tsc'), '-p', path.join(coreRoot, 'tsconfig.build.json')],
        { cwd: coreRoot, stdio: 'inherit', windowsHide: true },
      );
      childProcess.execFileSync(
        process.execPath,
        [path.join(coreRoot, 'scripts/build-development.mjs')],
        { cwd: coreRoot, stdio: 'inherit', windowsHide: true },
      );
    },
  },
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'src/main/index.ts', config: 'vite.main.config.ts', target: 'main' },
        { entry: 'src/preload/index.ts', config: 'vite.preload.config.ts', target: 'preload' },
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
    }),
  ],
};
