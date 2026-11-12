import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createTranslator, uebGrade1, type BrailleTranslator } from '@raisedline/core';

/** Bridge to the system liblouis (`lou_translate`) for contracted braille and other languages. */

let available: boolean | null = null;

export function liblouisAvailable(): boolean {
  if (available === null) {
    try {
      const r = spawnSync('lou_translate', ['--version'], { encoding: 'utf8', timeout: 5000 });
      available = r.status === 0 || /liblouis/i.test(`${r.stdout}${r.stderr}`);
    } catch {
      available = false;
    }
  }
  return available;
}

export function liblouisVersion(): string | null {
  if (!liblouisAvailable()) return null;
  const r = spawnSync('lou_translate', ['--version'], { encoding: 'utf8', timeout: 5000 });
  return /(\d+\.\d+\.\d+)/.exec(`${r.stdout}${r.stderr}`)?.[1] ?? 'unknown';
}

const TABLE_DIRS = [
  '/usr/share/liblouis/tables',
  '/usr/local/share/liblouis/tables',
  '/opt/homebrew/share/liblouis/tables',
];

/** Installed liblouis tables (best effort). */
export function liblouisTables(): string[] {
  for (const dir of TABLE_DIRS) {
    if (!existsSync(dir)) continue;
    return readdirSync(dir)
      .filter((f) => /\.(ctb|utb)$/.test(f))
      .sort();
  }
  return [];
}

/** Translate one string with liblouis. Throws with a helpful message on failure. */
export function liblouisTranslate(table: string, text: string): string {
  if (!/^[\w.,-]+$/.test(table)) throw new Error(`Invalid liblouis table name "${table}"`);
  const r = spawnSync('lou_translate', ['--forward', `unicode.dis,${table}`], {
    input: text.replace(/\r?\n/g, ' ') + '\n',
    encoding: 'utf8',
    timeout: 10000,
  });
  if (r.error) throw new Error(`Could not run lou_translate: ${r.error.message}`);
  if (r.status !== 0)
    throw new Error(
      `liblouis failed for table "${table}": ${r.stderr.trim() || `exit ${r.status}`}`,
    );
  return r.stdout.replace(/\r?\n$/, '').replace(/ /g, '⠀');
}

/** Resolve a `--braille` value to a translator. */
export function resolveTranslator(id: string | undefined): BrailleTranslator {
  if (!id || id === 'ueb-grade1' || id === 'grade1') return uebGrade1;
  const table = id.startsWith('liblouis:')
    ? id.slice('liblouis:'.length)
    : id === 'grade2'
      ? 'en-ueb-g2.ctb'
      : id;
  if (!liblouisAvailable()) {
    throw new Error(
      `Braille table "${table}" needs liblouis, but "lou_translate" was not found.\n` +
        'Install it (Debian/Ubuntu: sudo apt install liblouis-bin, macOS: brew install liblouis) ' +
        'or use the built-in UEB Grade 1 translator (--braille ueb-grade1).',
    );
  }
  liblouisTranslate(table, 'test');
  return createTranslator(`liblouis:${table}`, `liblouis ${table}`, (text) =>
    liblouisTranslate(table, text),
  );
}
