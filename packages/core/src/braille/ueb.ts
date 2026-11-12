import { BLANK_CELL, cells, isBrailleChar } from './cells.js';

/**
 * Built-in Unified English Braille (UEB) Grade 1 (uncontracted) translator.
 *
 * Covers what tactile-graphic labels need: letters, capitals (letter, word and passage
 * indicators), numbers with the numeric and grade 1 indicators, punctuation, common symbols,
 * accented letters and Greek letters. Its output is checked against liblouis' `en-ueb-g1.ctb`
 * in the test suite. For contracted (Grade 2) braille, use a liblouis-backed translator.
 */

const LETTERS: Record<string, string> = {
  a: '1',
  b: '12',
  c: '14',
  d: '145',
  e: '15',
  f: '124',
  g: '1245',
  h: '125',
  i: '24',
  j: '245',
  k: '13',
  l: '123',
  m: '134',
  n: '1345',
  o: '135',
  p: '1234',
  q: '12345',
  r: '1235',
  s: '234',
  t: '2345',
  u: '136',
  v: '1236',
  w: '2456',
  x: '1346',
  y: '13456',
  z: '1356',
};

const GREEK: Record<string, string> = {
  α: 'a',
  β: 'b',
  γ: 'g',
  δ: 'd',
  ε: 'e',
  ζ: 'z',
  η: '156',
  θ: '1456',
  ι: 'i',
  κ: 'k',
  λ: 'l',
  μ: 'm',
  ν: 'n',
  ξ: 'x',
  ο: 'o',
  π: 'p',
  ρ: 'r',
  σ: 's',
  ς: 's',
  τ: 't',
  υ: 'u',
  φ: 'f',
  χ: '12346',
  ψ: 'y',
  ω: 'w',
};

const DIACRITICS: Record<string, string> = {
  '́': '45-34', // acute
  '̀': '45-16', // grave
  '̂': '45-146', // circumflex
  '̈': '45-25', // diaeresis
  '̃': '45-12456', // tilde
  '̧': '45-12346', // cedilla
  '̊': '45-1246', // ring
  '̌': '45-346', // caron
};

const SYMBOLS: Record<string, string> = {
  ',': '2',
  '.': '256',
  ';': '23',
  ':': '25',
  '!': '235',
  '?': '236',
  "'": '3',
  '’': '3',
  '-': '36',
  '‐': '36',
  '‑': '36',
  '–': '6-36',
  '—': '6-36',
  '(': '5-126',
  ')': '5-345',
  '[': '46-126',
  ']': '46-345',
  '{': '456-126',
  '}': '456-345',
  '/': '456-34',
  '\\': '456-16',
  '|': '456-1256',
  '%': '46-356',
  $: '4-234',
  '£': '4-123',
  '€': '4-15',
  '¢': '4-14',
  '¥': '4-13456',
  '&': '4-12346',
  '@': '4-1',
  '*': '5-35',
  '#': '456-1456',
  '~': '4-35',
  _: '46-36',
  '<': '4-126',
  '>': '4-345',
  '+': '5-235',
  '=': '5-2356',
  '×': '5-236',
  '÷': '5-34',
  '−': '5-36',
  '±': '456-235',
  '°': '45-245',
  '§': '45-234',
  '¶': '45-1234',
  '©': '45-14',
  '®': '45-1235',
  '™': '45-2345',
  '•': '456-256',
  '…': '256-256-256',
  '→': '56-1256-135',
  '←': '56-1256-246',
  '↑': '56-1256-346',
  '↓': '56-1256-16',
  '≤': '456-4-126',
  '≥': '456-4-345',
  '≠': '5-2356-4-156',
  '“': '236',
  '”': '356',
  '‘': '6-236',
};

const SUPERSCRIPTS: Record<string, string> = {
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
};

const FRACTIONS: Record<string, [string, string]> = {
  '½': ['1', '2'],
  '¼': ['1', '4'],
  '¾': ['3', '4'],
  '⅓': ['1', '3'],
  '⅔': ['2', '3'],
  '⅛': ['1', '8'],
};

const DIGIT_DOTS = ['245', '1', '12', '14', '145', '15', '124', '1245', '125', '24'];

const NUMERIC = cells('3456');
const CAPITAL = cells('6');
const CAPS_WORD = cells('6-6');
const CAPS_PASSAGE = cells('6-6-6');
const CAPS_TERMINATOR = cells('6-3');
const GRADE1 = cells('56');
const GREEK_PREFIX = cells('46');

const isDigit = (c: string | undefined) => !!c && c >= '0' && c <= '9';

interface Glyph {
  base: string; // lowercase base letter (latin) or '' for greek
  braille: string; // braille for the letter itself, incl. diacritic / greek prefix
  upper: boolean;
}

function letterGlyph(ch: string): Glyph | null {
  const decomposed = ch.normalize('NFD');
  const base = decomposed[0];
  const lower = base.toLowerCase();
  const upper = base !== lower;
  if (LETTERS[lower]) {
    let prefix = '';
    for (const mark of decomposed.slice(1)) {
      const dia = DIACRITICS[mark];
      if (dia) prefix += cells(dia);
    }
    return { base: lower, braille: prefix + cells(LETTERS[lower]), upper };
  }
  const g = GREEK[lower];
  if (g) {
    const dots = LETTERS[g] ?? g;
    return { base: '', braille: GREEK_PREFIX + cells(dots), upper };
  }
  return null;
}

export interface TranslationResult {
  braille: string;
  /** Characters the translator did not know (rendered as a full cell ⠿). */
  unknown: string[];
}

function isCapsWord(word: string): boolean {
  let letters = 0;
  for (const ch of word) {
    const g = letterGlyph(ch);
    if (!g) continue;
    letters++;
    if (!g.upper) return false;
  }
  return letters > 0;
}

function translateWord(word: string, inPassage: boolean, unknown: string[]): string {
  const chars = [...word];
  let out = '';
  let numeric = false;
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    // Already braille: pass through untouched (manual override).
    if (isBrailleChar(ch)) {
      out += ch;
      numeric = false;
      i++;
      continue;
    }
    if (isDigit(ch)) {
      if (!numeric) out += NUMERIC;
      out += cells(DIGIT_DOTS[Number(ch)]);
      numeric = true;
      i++;
      continue;
    }
    if ((ch === '.' || ch === ',') && isDigit(chars[i + 1])) {
      if (!numeric) out += NUMERIC;
      out += cells(ch === '.' ? '256' : '2');
      numeric = true;
      i++;
      continue;
    }
    if (SUPERSCRIPTS[ch]) {
      out += cells('56-35') + NUMERIC;
      while (i < chars.length && SUPERSCRIPTS[chars[i]]) {
        out += cells(DIGIT_DOTS[Number(SUPERSCRIPTS[chars[i]])]);
        i++;
      }
      numeric = false;
      continue;
    }
    if (FRACTIONS[ch]) {
      const [n, d] = FRACTIONS[ch];
      out += NUMERIC + cells(DIGIT_DOTS[Number(n)]) + cells('34') + cells(DIGIT_DOTS[Number(d)]);
      numeric = false;
      i++;
      continue;
    }
    const glyph = letterGlyph(ch);
    if (glyph) {
      // Collect the run of consecutive letters for capitalisation decisions.
      const run: Glyph[] = [];
      let j = i;
      while (j < chars.length) {
        const g = letterGlyph(chars[j]);
        if (!g) break;
        run.push(g);
        j++;
      }
      if (numeric && !run[0].upper && run[0].base && 'abcdefghij'.includes(run[0].base)) {
        out += GRADE1;
      }
      numeric = false;
      if (inPassage) {
        out += run.map((g) => g.braille).join('');
      } else {
        let k = 0;
        let upperLead = 0;
        while (upperLead < run.length && run[upperLead].upper) upperLead++;
        if (upperLead >= 2) {
          out +=
            CAPS_WORD +
            run
              .slice(0, upperLead)
              .map((g) => g.braille)
              .join('');
          k = upperLead;
          if (k < run.length) out += CAPS_TERMINATOR;
        }
        for (; k < run.length; k++) {
          out += (run[k].upper ? CAPITAL : '') + run[k].braille;
        }
      }
      i = j;
      continue;
    }
    numeric = false;
    if (ch === '"') {
      const prev = chars[i - 1];
      if (i === 0 || (!prev.match(/[\p{L}\p{N}]/u) && !SYMBOLS[prev])) out += cells('236');
      else if (isDigit(prev)) out += cells('6-2356');
      else out += cells('356');
      i++;
      continue;
    }
    if (ch === '’' && i === chars.length - 1 && i > 0) {
      // Closing single quote at the end of a word.
      const hasOpen = chars.includes('‘');
      out += hasOpen ? cells('6-356') : cells('3');
      i++;
      continue;
    }
    const sym = SYMBOLS[ch];
    if (sym) {
      const next = chars[i + 1];
      if ((ch === ';' || ch === '?') && next && letterGlyph(next)) out += GRADE1;
      out += cells(sym);
      i++;
      continue;
    }
    unknown.push(ch);
    out += cells('123456');
    i++;
  }
  return out;
}

/** Translate print text to UEB Grade 1, returning Unicode braille. */
export function translateUebGrade1Detailed(text: string): TranslationResult {
  const unknown: string[] = [];
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const parts: string[] = [];
  let w = 0;
  while (w < words.length) {
    // Capitals passage: three or more consecutive all-capital words.
    let run = 0;
    while (w + run < words.length && isCapsWord(words[w + run])) run++;
    if (run >= 3) {
      for (let k = 0; k < run; k++) {
        let b = translateWord(words[w + k], true, unknown);
        if (k === 0) b = CAPS_PASSAGE + b;
        if (k === run - 1) b += CAPS_TERMINATOR;
        parts.push(b);
      }
      w += run;
      continue;
    }
    parts.push(translateWord(words[w], false, unknown));
    w++;
  }
  return { braille: parts.join(BLANK_CELL), unknown };
}

export function translateUebGrade1(text: string): string {
  return translateUebGrade1Detailed(text).braille;
}
