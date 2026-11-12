// Bump the version everywhere and move "Unreleased" changelog entries under the new version.
// Usage: node scripts/bump-version.mjs <major|minor|patch|x.y.z>
// Then: git commit -am "chore(release): vX.Y.Z" && git tag vX.Y.Z && git push --follow-tags
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const file = (p) => new URL(p, root);
const arg = process.argv[2];
if (!arg) {
  console.error('Usage: node scripts/bump-version.mjs <major|minor|patch|x.y.z>');
  process.exit(2);
}

const current = JSON.parse(readFileSync(file('package.json'), 'utf8')).version;
const [maj, min, pat] = current.split(/[.-]/).map(Number);
const next =
  arg === 'major'
    ? `${maj + 1}.0.0`
    : arg === 'minor'
      ? `${maj}.${min + 1}.0`
      : arg === 'patch'
        ? `${maj}.${min}.${pat + 1}`
        : arg.replace(/^v/, '');
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(next)) {
  console.error(`"${next}" is not a semantic version`);
  process.exit(2);
}

for (const p of [
  'package.json',
  'packages/core/package.json',
  'packages/cli/package.json',
  'packages/web/package.json',
]) {
  const json = JSON.parse(readFileSync(file(p), 'utf8'));
  json.version = next;
  writeFileSync(file(p), JSON.stringify(json, null, 2) + '\n');
}

const versionTs = file('packages/core/src/version.ts');
writeFileSync(
  versionTs,
  readFileSync(versionTs, 'utf8').replace(
    /export const VERSION = '[^']+'/,
    `export const VERSION = '${next}'`,
  ),
);

const changelogPath = file('CHANGELOG.md');
let changelog = readFileSync(changelogPath, 'utf8');
const today = new Date().toISOString().slice(0, 10);
if (/^## \[Unreleased\]/m.test(changelog)) {
  changelog = changelog.replace(
    /^## \[Unreleased\]\s*\n/m,
    `## [Unreleased]\n\n## [${next}] - ${today}\n`,
  );
} else {
  changelog = changelog.replace(/^## /m, `## [${next}] - ${today}\n\n- \n\n## `);
}
changelog = changelog.replace(
  /^\[Unreleased\]: (.*)\/compare\/v[^.]+\.[^.]+\.[^.]+\.\.\.HEAD$/m,
  `[Unreleased]: $1/compare/v${next}...HEAD\n[${next}]: $1/compare/v${current}...v${next}`,
);
writeFileSync(changelogPath, changelog);

execSync('npm install --package-lock-only --ignore-scripts', { stdio: 'inherit', cwd: root });
console.log(`Bumped ${current} → ${next}`);
console.log(
  `Next: git commit -am "chore(release): v${next}" && git tag -a v${next} -m "v${next}" && git push --follow-tags`,
);
