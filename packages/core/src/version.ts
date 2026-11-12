/**
 * Version and build metadata.
 *
 * `VERSION` is kept in sync with package.json by `scripts/bump-version.mjs` (checked in CI).
 * Bundlers (Vite for the web app, esbuild for the CLI) replace `__RAISEDLINE_BUILD__` with
 * the CI build number, commit and date; unbundled use reports a development build.
 */

export const VERSION = '1.0.0';

export interface BuildInfo {
  version: string;
  /** Monotonic build number (CI run number, or git commit count locally). */
  build: string;
  /** Short git commit hash. */
  commit: string;
  /** ISO build date. */
  date: string;
  /** `release`, `ci` or `dev`. */
  channel: string;
}

declare const __RAISEDLINE_BUILD__: Omit<BuildInfo, 'version'> | undefined;

export const BUILD_INFO: BuildInfo = {
  version: VERSION,
  ...(typeof __RAISEDLINE_BUILD__ !== 'undefined'
    ? __RAISEDLINE_BUILD__
    : { build: '0', commit: 'unknown', date: '', channel: 'dev' }),
};

/** e.g. `1.0.0+build.42.3f2a1bc`. */
export function versionString(info: BuildInfo = BUILD_INFO): string {
  return `${info.version}+build.${info.build}${info.commit && info.commit !== 'unknown' ? `.${info.commit}` : ''}`;
}
