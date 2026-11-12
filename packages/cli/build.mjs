// Bundle the CLI (and @raisedline/core) into a single ESM file, and copy the web app next to it.
import { build } from 'esbuild';
import { chmodSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildDefine, getVersion } from '../../scripts/build-info.mjs';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
rmSync(here('./dist'), { recursive: true, force: true });
mkdirSync(here('./dist'), { recursive: true });

await build({
  entryPoints: [here('./src/main.ts')],
  outfile: here('./dist/raisedline.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  minify: false,
  sourcemap: false,
  legalComments: 'inline',
  alias: { '@raisedline/core': here('../core/src/index.ts') },
  define: buildDefine(),
  banner: {
    js: [
      '#!/usr/bin/env node',
      `// raisedline ${getVersion()} — https://github.com/lobojoel2003/Raisedline — GPL-3.0-or-later`,
      "import { createRequire as __rlCreateRequire } from 'node:module';",
      'const require = __rlCreateRequire(import.meta.url);',
    ].join('\n'),
  },
  logLevel: 'warning',
});
chmodSync(here('./dist/raisedline.mjs'), 0o755);

const web = here('../web/dist');
if (existsSync(web))
  cpSync(web, here('./dist/web'), { recursive: true, filter: (src) => !src.endsWith('.map') });
else
  console.warn(
    'note: packages/web/dist not found; "raisedline serve" needs the web app built first.',
  );
console.log('built packages/cli/dist/raisedline.mjs');
