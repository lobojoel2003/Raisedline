/** Tiny argument parser: positionals, `--flag`, `--key value`, `--key=value`, `-o value`. */

export interface ParsedArgs {
  positionals: string[];
  options: Record<string, string | boolean>;
}

const SHORT: Record<string, string> = {
  o: 'out',
  f: 'format',
  t: 'type',
  h: 'help',
  v: 'version',
  p: 'port',
  q: 'quiet',
};

/** Options that never take a value. */
const BOOLEAN = new Set([
  'help',
  'version',
  'quiet',
  'json',
  'strict',
  'interline',
  'invert',
  'gridlines',
  'no-gridlines',
  'grade2',
  'brf',
  'open',
  'mirror',
  'no-key',
  'transcriber-notes',
  'y-down',
  'no-north',
  'list-tables',
  'no-labels',
]);

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const options: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
      if (eq > 0) options[name] = a.slice(eq + 1);
      else if (BOOLEAN.has(name)) options[name] = true;
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) options[name] = argv[++i];
      else options[name] = true;
    } else if (a.startsWith('-') && a.length > 1 && !/^-\d/.test(a)) {
      const name = SHORT[a.slice(1)] ?? a.slice(1);
      if (BOOLEAN.has(name)) options[name] = true;
      else if (i + 1 < argv.length) options[name] = argv[++i];
      else options[name] = true;
    } else positionals.push(a);
  }
  return { positionals, options };
}

export function str(opts: ParsedArgs['options'], name: string): string | undefined {
  const v = opts[name];
  return typeof v === 'string' ? v : undefined;
}

export function num(opts: ParsedArgs['options'], name: string): number | undefined {
  const v = str(opts, name);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new UsageError(`--${name} expects a number, got "${v}"`);
  return n;
}

export class UsageError extends Error {}
