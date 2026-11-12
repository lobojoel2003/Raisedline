// Build metadata shared by the CLI bundle (esbuild) and the web app (Vite).
//
// Build number: BUILD_NUMBER, else GITHUB_RUN_NUMBER, else the git commit count.
// Channel: "release" for tag builds, "ci" for other CI builds, "dev" locally.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function git(cmd) {
  try {
    return execSync(`git ${cmd}`, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

export function getVersion() {
  return JSON.parse(readFileSync(new URL('../packages/core/package.json', import.meta.url), 'utf8'))
    .version;
}

export function getBuildInfo() {
  const env = process.env;
  const build = env.BUILD_NUMBER || env.GITHUB_RUN_NUMBER || git('rev-list --count HEAD') || '0';
  const commit = (env.GITHUB_SHA || git('rev-parse HEAD') || 'unknown').slice(0, 7);
  const epoch = env.SOURCE_DATE_EPOCH ? Number(env.SOURCE_DATE_EPOCH) * 1000 : Date.now();
  const isTag = env.GITHUB_REF_TYPE === 'tag' || (env.GITHUB_REF ?? '').startsWith('refs/tags/');
  const channel = env.RAISEDLINE_CHANNEL || (isTag ? 'release' : env.CI ? 'ci' : 'dev');
  return { build: String(build), commit, date: new Date(epoch).toISOString(), channel };
}

/** `define` map for bundlers. */
export function buildDefine() {
  return { __RAISEDLINE_BUILD__: JSON.stringify(getBuildInfo()) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const info = { version: getVersion(), ...getBuildInfo() };
  console.log(JSON.stringify(info, null, 2));
}
