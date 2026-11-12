// Collect release artifacts into ./release (run after `npm run build` and `npm run build:single`).
//
//   raisedline-<v>.mjs                 standalone CLI (single file, Node ≥ 20)
//   raisedline-<v>.tgz                 npm package of the CLI (includes the web app for `serve`)
//   raisedline-core-<v>.tgz            npm package of the core library
//   raisedline-web-<v>.zip             static web app (host anywhere)
//   raisedline-<v>-offline.html        the whole web app in one HTML file
//   raisedline-examples-<v>.zip        example outputs (PDF, SVG, STL, BRF, G-code, reports)
//   build-info.json, SHA256SUMS.txt, RELEASE_NOTES.md
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBuildInfo, getVersion } from './build-info.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'release');
const version = getVersion();
const info = { version, ...getBuildInfo() };
const need = (p, hint) => {
  if (!existsSync(join(root, p))) {
    console.error(`✖ ${p} is missing — run ${hint} first`);
    process.exit(1);
  }
};
need('packages/cli/dist/raisedline.mjs', '"npm run build"');
need('packages/cli/dist/web/index.html', '"npm run build"');
need('packages/core/dist/index.js', '"npm run build"');
need('packages/web/dist-single/index.html', '"npm run build:single"');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const run = (cmd, args, cwd = root) =>
  execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] }).toString();

// 1. Standalone CLI and offline app.
copyFileSync(
  join(root, 'packages/cli/dist/raisedline.mjs'),
  join(out, `raisedline-${version}.mjs`),
);
copyFileSync(
  join(root, 'packages/web/dist-single/index.html'),
  join(out, `raisedline-${version}-offline.html`),
);

// 2. npm packages.
for (const [dir, name] of [
  ['packages/cli', `raisedline-${version}.tgz`],
  ['packages/core', `raisedline-core-${version}.tgz`],
]) {
  const file = run('npm', ['pack', '--silent', '--pack-destination', out], join(root, dir))
    .trim()
    .split('\n')
    .pop();
  const produced = join(out, file);
  if (basename(produced) !== name) {
    copyFileSync(produced, join(out, name));
    rmSync(produced);
  }
}

// 3. Static web app.
run(
  'zip',
  ['-qr', join(out, `raisedline-web-${version}.zip`), '.'],
  join(root, 'packages/web/dist'),
);

// 4. Example outputs, produced by the CLI exactly as users would.
const exDir = join(out, `examples-${version}`);
mkdirSync(exDir, { recursive: true });
const cli = join(root, 'packages/cli/dist/raisedline.mjs');
const examples = [
  ['chart', 'rainfall.csv', ['--type', 'bar', '--title', 'Monthly rainfall (mm)']],
  [
    'chart',
    'plant-growth.csv',
    ['--type', 'line', '--title', 'Plant growth', '--y-label', 'Height (cm)'],
  ],
  ['chart', 'height-armspan.csv', ['--type', 'scatter', '--title', 'Height and arm span']],
  ['chart', 'school-travel.csv', ['--type', 'pie', '--title', 'How students get to school']],
  ['svg', 'water-cycle.svg', []],
  ['map', 'riverside-campus.geojson', []],
  ['trace', 'plant-cell.png', ['--title', 'Plant cell']],
];
for (const [cmd, file, extra] of examples) {
  const base = join(exDir, file.replace(/\.[^.]+$/, ''));
  execFileSync(
    process.execPath,
    [
      cli,
      cmd,
      join(root, 'examples', file),
      ...extra,
      '-f',
      'pdf,svg,stl,brf,gcode,json,report',
      '-o',
      base,
      '--quiet',
    ],
    {
      stdio: 'inherit',
    },
  );
}
run('zip', ['-qr', join(out, `raisedline-examples-${version}.zip`), '.'], exDir);
rmSync(exDir, { recursive: true, force: true });

// 5. Metadata, notes and checksums.
writeFileSync(join(out, 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
const section = new RegExp(
  `^## \\[${version.replace(/\./g, '\\.')}\\][^\\n]*\\n([\\s\\S]*?)(?=^## \\[|^\\[[^\\]]+\\]: )`,
  'm',
).exec(changelog);
const notes = [
  section ? section[1].trim() : `Release ${version}.`,
  '',
  '### Downloads',
  '',
  `- **Web app, no install:** \`raisedline-${version}-offline.html\` — open it in any modern browser, even without internet.`,
  `- **Command line:** \`raisedline-${version}.mjs\` — run \`node raisedline-${version}.mjs --help\` (Node.js 20 or newer).`,
  `- **npm package:** \`npm install -g ./raisedline-${version}.tgz\`, then \`raisedline serve\` for the app with liblouis Grade 2 braille.`,
  `- **Self-hosting:** \`raisedline-web-${version}.zip\` is the static site.`,
  `- **Samples:** \`raisedline-examples-${version}.zip\` holds PDF, STL, BRF and G-code made from the bundled examples.`,
  '',
  `Build ${info.build} · commit \`${info.commit}\` · ${info.date.slice(0, 10)}`,
].join('\n');
writeFileSync(join(out, 'RELEASE_NOTES.md'), notes + '\n');

const sums = readdirSync(out)
  .filter(
    (f) => statSync(join(out, f)).isFile() && f !== 'SHA256SUMS.txt' && f !== 'RELEASE_NOTES.md',
  )
  .sort()
  .map(
    (f) =>
      `${createHash('sha256')
        .update(readFileSync(join(out, f)))
        .digest('hex')}  ${f}`,
  );
writeFileSync(join(out, 'SHA256SUMS.txt'), sums.join('\n') + '\n');

for (const f of readdirSync(out).sort()) {
  console.log(`${(statSync(join(out, f)).size / 1024).toFixed(0).padStart(7)} KB  ${f}`);
}
console.log(`✔ release ${version} (build ${info.build}) packaged in ./release`);
