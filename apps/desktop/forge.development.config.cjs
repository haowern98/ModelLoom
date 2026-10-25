const path = require('node:path');
const { VitePlugin } = require('@electron-forge/plugin-vite');
const ordinary = require('./forge.config.cjs');
const { prepareNetworkResource } = require('./scripts/network-resource.cjs');
module.exports = (stage) => {
  if (!stage || path.basename(stage) !== 'modelloom-development')
    throw new Error('Explicit development staging required');
  return {
    ...ordinary,
    outDir: path.join(__dirname, 'out/development'),
    packagerConfig: {
      ...ordinary.packagerConfig,
      name: 'ModelLoom Development',
      executableName: 'ModelLoom Development',
      extraResource: [stage],
    },
    hooks: { prePackage: prepareNetworkResource },
    plugins: [
      new VitePlugin({
        build: [
          { entry: 'src/main/index.ts', config: 'vite.main.development.config.ts', target: 'main' },
          { entry: 'src/preload/index.ts', config: 'vite.preload.config.ts', target: 'preload' },
        ],
        renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
      }),
    ],
  };
};
