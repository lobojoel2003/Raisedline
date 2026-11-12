import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  BRAILLE_ASCII,
  cellCount,
  cellDots,
  cells,
  createLookupTranslator,
  fromBrailleAscii,
  toBrailleAscii,
  translateUebGrade1,
  translateUebGrade1Detailed,
  uebGrade1,
  wrapBraille,
} from '@raisedline/core';

// Expected output captured from liblouis 3.29 (`unicode.dis,en-ueb-g1.ctb`).
const CASES: [string, string][] = [
  ['b', '⠃'],
  ['a b c', '⠁⠀⠃⠀⠉'],
  ['3a', '⠼⠉⠰⠁'],
  ['3k', '⠼⠉⠅'],
  ['3.5', '⠼⠉⠲⠑'],
  ['1,000', '⠼⠁⠂⠚⠚⠚'],
  ['Rainfall (mm)', '⠠⠗⠁⠊⠝⠋⠁⠇⠇⠀⠐⠣⠍⠍⠐⠜'],
  ['50%', '⠼⠑⠚⠨⠴'],
  ['$20', '⠈⠎⠼⠃⠚'],
  ['USA', '⠠⠠⠥⠎⠁'],
  ['CDs', '⠠⠠⠉⠙⠠⠄⠎'],
  ['McDonald', '⠠⠍⠉⠠⠙⠕⠝⠁⠇⠙'],
  ['café', '⠉⠁⠋⠘⠌⠑'],
  ['x-axis', '⠭⠤⠁⠭⠊⠎'],
  ['Hello, world!', '⠠⠓⠑⠇⠇⠕⠂⠀⠺⠕⠗⠇⠙⠖'],
  ['e.g.', '⠑⠲⠛⠲'],
  ['12:30', '⠼⠁⠃⠒⠼⠉⠚'],
  ['a/b', '⠁⠸⠌⠃'],
  ['Jan', '⠠⠚⠁⠝'],
  ['#1', '⠸⠹⠼⠁'],
  ["it's", '⠊⠞⠄⠎'],
  ['1st', '⠼⠁⠎⠞'],
  ['2024–2025', '⠼⠃⠚⠃⠙⠠⠤⠼⠃⠚⠃⠑'],
  ['"quoted"', '⠦⠟⠥⠕⠞⠑⠙⠴'],
  ['4 + 5 = 9', '⠼⠙⠀⠐⠖⠀⠼⠑⠀⠐⠶⠀⠼⠊'],
  ['10°C', '⠼⠁⠚⠘⠚⠠⠉'],
  ['R&D', '⠠⠗⠈⠯⠠⠙'],
  ['ABC DEF', '⠠⠠⠁⠃⠉⠀⠠⠠⠙⠑⠋'],
  ['A', '⠠⠁'],
  ['x2', '⠭⠼⠃'],
  ['−5', '⠐⠤⠼⠑'],
  ['-5', '⠤⠼⠑'],
  ['ΔT', '⠠⠠⠨⠙⠞'],
  ['THE BIG RED DOG', '⠠⠠⠠⠞⠓⠑⠀⠃⠊⠛⠀⠗⠑⠙⠀⠙⠕⠛⠠⠄'],
  ['THE BIG red', '⠠⠠⠞⠓⠑⠀⠠⠠⠃⠊⠛⠀⠗⠑⠙'],
  ['.5', '⠼⠲⠑'],
  ['1/2', '⠼⠁⠸⠌⠼⠃'],
  ['AM/PM', '⠠⠠⠁⠍⠸⠌⠠⠠⠏⠍'],
  ['km²', '⠅⠍⠰⠔⠼⠃'],
  ['3×4', '⠼⠉⠐⠦⠼⠙'],
  ['1.5e', '⠼⠁⠲⠑⠰⠑'],
  ['15:00h', '⠼⠁⠑⠒⠼⠚⠚⠰⠓'],
  ['3B', '⠼⠉⠠⠃'],
  ['½', '⠼⠁⠌⠃'],
  ['a;b', '⠁⠰⠆⠃'],
  ["DON'T", '⠠⠠⠙⠕⠝⠄⠠⠞'],
  ['X-RAY', '⠠⠭⠤⠠⠠⠗⠁⠽'],
  ['α β γ π', '⠨⠁⠀⠨⠃⠀⠨⠛⠀⠨⠏'],
  ['Ünïcödé', '⠠⠘⠒⠥⠝⠘⠒⠊⠉⠘⠒⠕⠙⠘⠌⠑'],
  ['5"', '⠼⠑⠠⠶'],
  ['"Hi," he said.', '⠦⠠⠓⠊⠂⠴⠀⠓⠑⠀⠎⠁⠊⠙⠲'],
  ['→', '⠰⠳⠕'],
  ['≤', '⠸⠈⠣'],
];

describe('UEB Grade 1 translator', () => {
  it.each(CASES)('%s', (text, expected) => {
    expect(translateUebGrade1(text)).toBe(expected);
  });

  it('collapses whitespace and trims', () => {
    expect(translateUebGrade1('  a   b  ')).toBe('⠁⠀⠃');
  });

  it('reports unknown characters with a full cell', () => {
    const r = translateUebGrade1Detailed('a☃b');
    expect(r.unknown).toEqual(['☃']);
    expect(r.braille).toBe('⠁⠿⠃');
  });

  it('passes through Unicode braille and {brf:} overrides', () => {
    expect(uebGrade1.translate('⠠⠓⠊')).toBe('⠠⠓⠊');
    expect(uebGrade1.translate('{brf:,HI}')).toBe('⠠⠓⠊');
  });
});

describe('braille cells', () => {
  it('maps Braille ASCII both ways', () => {
    expect(BRAILLE_ASCII).toHaveLength(64);
    expect(toBrailleAscii('⠠⠓⠑⠇⠇⠕⠀⠼⠁⠃⠉')).toBe(',HELLO #ABC');
    expect(fromBrailleAscii(',hello #abc')).toBe('⠠⠓⠑⠇⠇⠕⠀⠼⠁⠃⠉');
    for (let i = 0; i < 64; i++) {
      const ch = String.fromCodePoint(0x2800 + i);
      expect(fromBrailleAscii(toBrailleAscii(ch))).toBe(ch);
    }
  });

  it('builds cells from dot numbers', () => {
    expect(cells('6-1-14')).toBe('⠠⠁⠉');
    expect(cellDots('⠿')).toEqual([1, 2, 3, 4, 5, 6]);
    expect(cellCount('⠁⠀⠃ x')).toBe(3);
  });

  it('wraps at word boundaries and hard-splits long words', () => {
    expect(wrapBraille('⠁⠃⠀⠉⠙⠀⠑⠋', 5)).toEqual(['⠁⠃⠀⠉⠙', '⠑⠋']);
    expect(wrapBraille('⠁⠃⠉⠙⠑⠋⠛', 3)).toEqual(['⠁⠃⠉', '⠙⠑⠋', '⠛']);
  });

  it('lookup translator falls back to Grade 1', () => {
    const t = createLookupTranslator('test', 'Test', new Map([['hello', '⠓⠑⠇⠇⠕-g2']]));
    expect(t.translate('hello')).toBe('⠓⠑⠇⠇⠕-g2');
    expect(t.translate('Hi')).toBe('⠠⠓⠊');
  });
});

const hasLiblouis = spawnSync('lou_translate', ['--version']).status === 0;

describe.skipIf(!hasLiblouis)('agreement with liblouis en-ueb-g1', () => {
  const corpus = [
    'Monthly rainfall (mm)',
    'Average high temperature',
    'Height and arm span',
    'How students get to school',
    'Riverside Campus',
    'Mill River',
    'Bus Stop',
    'The water cycle',
    'Week 1',
    'Population 2024: 1,250,000',
    'Science Hall, room 3B',
    'Up 12.5% from 2020',
    'NORTH LOT',
    'pH 7.4',
  ];
  it.each(corpus)('%s', (text) => {
    const r = spawnSync('lou_translate', ['--forward', 'unicode.dis,en-ueb-g1.ctb'], {
      input: text,
      encoding: 'utf8',
    });
    expect(translateUebGrade1(text)).toBe(r.stdout.trim().replace(/ /g, '⠀'));
  });
});
