import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { URL } from 'node:url';
import { format, resolveConfig } from 'prettier';

const require = createRequire(import.meta.url);
const source = path.dirname(require.resolve('@openai/apps-sdk-ui/css'));
const files = ['variables-primitive.css', 'variables-semantic.css', 'variables-components.css'];
const tokens = (await Promise.all(files.map((file) => readFile(path.join(source, file), 'utf8'))))
  .join('\n')
  .replaceAll(':root', ':scope')
  .replaceAll('@theme static', ':scope')
  // A scoped descendant selector does not match the scope root itself.
  .replace(
    /^([ \t]*):where\(\[data-theme="dark"\]\)\s*\{/gmu,
    '$1:scope:where([data-theme="dark"]), :where([data-theme="dark"]) {',
  )
  .replace(/^.*--(?:font-weight|radius)-\*: initial;\r?\n/gmu, '')
  // Keep the SDK's 16px reference scale without changing the app's 14px root.
  .replace(/(-?(?:\d*\.)?\d+)rem\b/gu, (_, value) => `${Number(value) * 16}px`);

const target = new URL('../src/renderer/features/cluster/cluster-sdk-tokens.css', import.meta.url);
await writeFile(
  target,
  await format(
    `/* Generated from OpenAI Apps SDK UI 0.2.2. MIT; see OPENAI-UI-LICENSE.txt.\n * Regenerate: node apps/desktop/scripts/generate-cluster-sdk-tokens.mjs\n */\n@scope ([data-cluster-sdk]) {\n${tokens}\n}\n`,
    { ...(await resolveConfig(target)), parser: 'css' },
  ),
);
