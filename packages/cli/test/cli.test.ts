import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseArgs } from '../src/args';
import { planOutputs } from '../src/io';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const examples = join(root, 'examples');
let dir: string;
let bin: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'raisedline-cli-'));
  bin = join(dir, 'raisedline.mjs');
  await build({
    entryPoints: [join(root, 'packages/cli/src/main.ts')],
    outfile: bin,
    bundle: true,
    platform: 'node',
    format: 'esm',
    alias: { '@raisedline/core': join(root, 'packages/core/src/index.ts') },
    define: {
      __RAISEDLINE_BUILD__: JSON.stringify({
        build: '42',
        commit: 'abc1234',
        date: '2026-01-01T00:00:00.000Z',
        channel: 'ci',
      }),
    },
    banner: {
      js: "import { createRequire as __c } from 'node:module'; const require = __c(import.meta.url);",
    },
    logLevel: 'error',
  });
}, 60000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(...args: string[]) {
  const r = spawnSync(process.execPath, [bin, ...args], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 60000,
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

describe('argument parsing', () => {
  it('handles flags, values and short options', () => {
    const a = parseArgs([
      'chart',
      'data.csv',
      '-t',
      'line',
      '--title=Hi there',
      '--interline',
      '-o',
      'out.pdf',
    ]);
    expect(a.positionals).toEqual(['chart', 'data.csv']);
    expect(a.options).toMatchObject({
      type: 'line',
      title: 'Hi there',
      interline: true,
      out: 'out.pdf',
    });
  });

  it('plans output files', () => {
    expect(planOutputs('data/rain.csv', undefined, undefined)[0].path).toMatch(
      /rain-tactile\.pdf$/,
    );
    expect(planOutputs('rain.csv', 'x/out.stl', undefined)).toMatchObject([{ format: 'stl' }]);
    expect(planOutputs('rain.csv', 'x/out', 'pdf,brf').map((o) => o.format)).toEqual([
      'pdf',
      'brf',
    ]);
    expect(() => planOutputs('rain.csv', undefined, 'docx')).toThrow(/Unknown format/);
  });
});

describe('raisedline CLI', () => {
  it('prints version and build number', () => {
    const r = run('--version');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^raisedline 1\.0\.0\+build\.42\.abc1234 \(ci, built 2026-01-01\)/);
    const j = JSON.parse(run('--version', '--json').out);
    expect(j).toMatchObject({ version: '1.0.0', build: '42', commit: 'abc1234', channel: 'ci' });
  });

  it('prints help', () => {
    expect(run('--help').out).toContain('Commands');
    expect(run('chart', '--help').out).toContain('--type');
  });

  it('builds a chart in every format', () => {
    const r = run(
      'chart',
      join(examples, 'rainfall.csv'),
      '--title',
      'Rain',
      '-f',
      'pdf,svg,stl,brf,gcode,json,report',
      '-o',
      join(dir, 'rain'),
    );
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain('Touch score 100/100');
    for (const ext of [
      '.pdf',
      '.svg',
      '.stl',
      '.brf',
      '.gcode',
      '.raisedline.json',
      '.report.json',
    ]) {
      expect(existsSync(join(dir, `rain${ext}`)), ext).toBe(true);
    }
    expect(readFileSync(join(dir, 'rain.pdf')).subarray(0, 8).toString()).toBe('%PDF-1.4');
  });

  it('exports and re-checks a saved project', () => {
    run(
      'map',
      join(examples, 'riverside-campus.geojson'),
      '-o',
      join(dir, 'campus.raisedline.json'),
    );
    const exp = run(
      'export',
      join(dir, 'campus.raisedline.json'),
      '-f',
      'brf',
      '-o',
      join(dir, 'campus'),
    );
    expect(exp.code, exp.err).toBe(0);
    expect(readFileSync(join(dir, 'campus.brf'), 'utf8')).toContain(',RIVERSIDE ,CAMPUS');
    const check = run('check', join(dir, 'campus.raisedline.json'), '--json');
    expect(check.code).toBe(0);
    expect(JSON.parse(check.out).verdict).toBe('ready');
  });

  it('converts SVG diagrams and traces images', () => {
    expect(run('svg', join(examples, 'water-cycle.svg'), '-o', join(dir, 'water.pdf')).code).toBe(
      0,
    );
    const t = run('trace', join(examples, 'plant-cell.png'), '-o', join(dir, 'cell.svg'), '--json');
    expect(t.code, t.err).toBe(0);
    expect(JSON.parse(t.out).report.counts.error).toBe(0);
  });

  it('fails the check (exit 1) when a graphic has errors', () => {
    const r = run('check', join(examples, 'temperatures.csv'), '--type', 'line');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/Symbol/);
  });

  it('translates braille', () => {
    expect(run('braille', 'Hello', 'World').out.trim()).toBe('⠠⠓⠑⠇⠇⠕ ⠠⠺⠕⠗⠇⠙');
    expect(run('braille', 'Hello', '--brf').out.trim()).toBe(',HELLO');
  });

  it('reports usage errors with exit code 2', () => {
    expect(run('chart').code).toBe(2);
    expect(run('frobnicate').code).toBe(2);
    const missing = run('chart', 'nope.csv');
    expect(missing.code).toBe(1);
    expect(missing.err).toMatch(/File not found/);
  });

  it('accepts JSON chart specs', () => {
    const spec = join(dir, 'spec.json');
    writeFileSync(
      spec,
      JSON.stringify({
        type: 'pie',
        title: 'Pets',
        categories: ['Cat', 'Dog'],
        series: [{ name: 'n', values: [3, 5] }],
      }),
    );
    const r = run('chart', spec, '-o', join(dir, 'pets.svg'));
    expect(r.code, r.err).toBe(0);
  });

  it.skipIf(spawnSync('lou_translate', ['--version']).status !== 0)(
    'uses liblouis for Grade 2',
    () => {
      expect(run('braille', 'Hello World', '--grade2').out.trim()).toBe('⠠⠓⠑⠇⠇⠕ ⠠⠸⠺');
    },
  );
});
