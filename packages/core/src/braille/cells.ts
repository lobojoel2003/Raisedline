/**
 * Braille cell helpers. Cells are represented as Unicode braille patterns (U+2800–U+28FF);
 * bit 0 = dot 1 … bit 5 = dot 6, which matches the North American Braille ASCII ordering.
 */

export const BRAILLE_BASE = 0x2800;
export const BLANK_CELL = '⠀';

/** North American Braille ASCII, indexed by 6-dot bit pattern. */
export const BRAILLE_ASCII = ' A1B\'K2L@CIF/MSP"E3H9O6R^DJG>NTQ,*5<-U8V.%[$+X!&;:4\\0Z7(_?W]#Y)=';

const ASCII_TO_BITS = new Map<string, number>();
for (let i = 0; i < BRAILLE_ASCII.length; i++) ASCII_TO_BITS.set(BRAILLE_ASCII[i], i);

export function isBrailleChar(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return c >= BRAILLE_BASE && c <= 0x28ff;
}

/** Bits for dots, e.g. `cellFromDots(1, 3, 4)`. */
export function cellFromDots(...dots: number[]): string {
  let bits = 0;
  for (const d of dots) bits |= 1 << (d - 1);
  return String.fromCodePoint(BRAILLE_BASE + bits);
}

/** Build a braille string from a dot description such as "6-1-14" (dash separated cells). */
export function cells(spec: string): string {
  return spec
    .split('-')
    .map((c) => (c === '0' ? BLANK_CELL : cellFromDots(...[...c].map(Number))))
    .join('');
}

export function cellBits(ch: string): number {
  return ((ch.codePointAt(0) ?? BRAILLE_BASE) - BRAILLE_BASE) & 0xff;
}

/** Raised dot numbers (1–8) of a cell. */
export function cellDots(ch: string): number[] {
  const bits = cellBits(ch);
  const out: number[] = [];
  for (let d = 0; d < 8; d++) if (bits & (1 << d)) out.push(d + 1);
  return out;
}

/** Unicode braille → Braille ASCII (BRF). 8-dot cells lose dots 7 and 8. */
export function toBrailleAscii(braille: string): string {
  let out = '';
  for (const ch of braille) {
    if (isBrailleChar(ch)) out += BRAILLE_ASCII[cellBits(ch) & 0x3f];
    else if (ch === ' ' || ch === '\n') out += ch;
  }
  return out;
}

/** Braille ASCII (BRF) → Unicode braille. */
export function fromBrailleAscii(ascii: string): string {
  let out = '';
  for (const raw of ascii) {
    if (raw === '\n' || raw === '\r') {
      out += raw;
      continue;
    }
    const bits = ASCII_TO_BITS.get(raw.toUpperCase());
    out += bits === undefined ? BLANK_CELL : String.fromCodePoint(BRAILLE_BASE + bits);
  }
  return out;
}

/** Number of braille cells in a string (ignores non-braille characters). */
export function cellCount(braille: string): number {
  let n = 0;
  for (const ch of braille) if (isBrailleChar(ch)) n++;
  return n;
}
