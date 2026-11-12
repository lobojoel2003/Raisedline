import { BLANK_CELL, fromBrailleAscii, isBrailleChar } from './cells.js';
import { translateUebGrade1 } from './ueb.js';

/** Converts print text to Unicode braille. Implementations must be synchronous. */
export interface BrailleTranslator {
  /** Table id, e.g. `ueb-grade1` or `liblouis:en-ueb-g2.ctb`. */
  id: string;
  label: string;
  translate(text: string): string;
}

export const uebGrade1: BrailleTranslator = {
  id: 'ueb-grade1',
  label: 'Unified English Braille, Grade 1 (built in)',
  translate: (text) => translateText(text, translateUebGrade1),
};

/**
 * Labels may be typed directly in braille: either Unicode braille, or Braille ASCII wrapped
 * in `{brf:...}`. Both bypass translation so transcribers keep full control.
 */
function translateText(text: string, fn: (t: string) => string): string {
  const trimmed = text.trim();
  const brf = /^\{brf:(.*)\}$/s.exec(trimmed);
  if (brf) return fromBrailleAscii(brf[1]).replace(/ /g, BLANK_CELL);
  if (trimmed.length > 0 && [...trimmed].every((c) => isBrailleChar(c) || c === ' ')) {
    return trimmed.replace(/ /g, BLANK_CELL);
  }
  return fn(trimmed);
}

/** Wrap any table-based translate function (e.g. a liblouis binding) as a translator. */
export function createTranslator(
  id: string,
  label: string,
  fn: (text: string) => string,
): BrailleTranslator {
  const cache = new Map<string, string>();
  return {
    id,
    label,
    translate(text: string) {
      let hit = cache.get(text);
      if (hit === undefined) {
        hit = translateText(text, fn);
        cache.set(text, hit);
      }
      return hit;
    },
  };
}

/**
 * A translator backed by a lookup table, falling back to Grade 1. Useful in the browser where
 * translations are fetched asynchronously ahead of layout.
 */
export function createLookupTranslator(
  id: string,
  label: string,
  table: Map<string, string>,
  fallback: BrailleTranslator = uebGrade1,
): BrailleTranslator {
  return {
    id,
    label,
    translate: (text) => table.get(text.trim()) ?? fallback.translate(text),
  };
}
