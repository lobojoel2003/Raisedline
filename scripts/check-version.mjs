// Verify that every package, the core VERSION constant and the changelog agree on one version.
// Usage: node scripts/check-version.mjs [--tag v1.2.3]
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const manifests = [
  'package.json',
  'packages/core/package.json',
  'packages/cli/package.json',
  'packages/web/package.json',
];
const errors = [];
const versions = manifests.map((p) => [p, JSON.parse(read(p)).version]);
const version = versions[0][1];

if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version))
  errors.push(`"${version}" is not a semantic version`);
for (const [p, v] of versions)
  if (v !== version) errors.push(`${p} has version ${v}, expected ${version}`);

const constant = /export const VERSION = '([^']+)'/.exec(read('packages/core/src/version.ts'))?.[1];
if (constant !== version)
  errors.push(`packages/core/src/version.ts has VERSION ${constant}, expected ${version}`);

const changelog = read('CHANGELOG.md');
if (!new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm').test(changelog)) {
  errors.push(`CHANGELOG.md has no "## [${version}]" section`);
}

const tagArg = process.argv.indexOf('--tag');
const tag =
  tagArg > 0
    ? process.argv[tagArg + 1]
    : process.env.GITHUB_REF_TYPE === 'tag'
      ? process.env.GITHUB_REF_NAME
      : null;
if (tag && tag !== `v${version}`)
  errors.push(`tag ${tag} does not match package version v${version}`);

if (errors.length) {
  for (const e of errors) console.error(`✖ ${e}`);
  process.exit(1);
}
console.log(`✔ version ${version} is consistent${tag ? ` with tag ${tag}` : ''}`);
