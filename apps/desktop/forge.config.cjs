const { VitePlugin } = require('@electron-forge/plugin-vite');
const { MakerZIP } = require('@electron-forge/maker-zip');

module.exports = {
  packagerConfig: { asar: true, name: 'ModelLoom', executableName: 'ModelLoom' },
  makers: [new MakerZIP({}, ['win32', 'darwin', 'linux'])],
  plugins: [
    new VitePlugin({
      build: [{ entry: 'src/main/index.ts', config: 'vite.main.config.ts', target: 'main' }],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
    }),
  ],
};
