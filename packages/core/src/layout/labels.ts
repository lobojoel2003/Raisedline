import { BLANK_CELL, cellCount } from '../braille/cells.js';
import type { BrailleTranslator } from '../braille/translator.js';
import type { BrailleMetrics, Box, LabelElement, Point } from '../types.js';

/** Greedy word wrap of a braille string to `maxCells` per line. */
export function wrapBraille(braille: string, maxCells: number): string[] {
  const max = Math.max(1, Math.floor(maxCells));
  const words = braille.split(BLANK_CELL).filter((w) => w.length > 0);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    let w = word;
    // Hard-split words that are longer than a whole line.
    while (cellCount(w) > max) {
      if (line) {
        lines.push(line);
        line = '';
      }
      const chars = [...w];
      lines.push(chars.slice(0, max).join(''));
      w = chars.slice(max).join('');
    }
    if (!w) continue;
    const candidate = line ? line + BLANK_CELL + w : w;
    if (cellCount(candidate) <= max) line = candidate;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/** Width/height of a block of braille lines. */
export function brailleSize(lines: string[], m: BrailleMetrics): { w: number; h: number } {
  const n = Math.max(1, ...lines.map((l) => cellCount(l)));
  return {
    w: (n - 1) * m.cellSpacing + m.dotSpacing + m.dotDiameter,
    h: (lines.length - 1) * m.lineSpacing + 2 * m.dotSpacing + m.dotDiameter,
  };
}

/** Max cells that fit in `width` mm. */
export function cellsThatFit(width: number, m: BrailleMetrics): number {
  return Math.max(1, Math.floor((width - m.dotSpacing - m.dotDiameter) / m.cellSpacing) + 1);
}

export function labelBox(label: LabelElement, m: BrailleMetrics): Box {
  const s = brailleSize(label.braille, m);
  return { x: label.at.x, y: label.at.y, w: s.w, h: s.h };
}

export type HAlign = 'start' | 'middle' | 'end';
export type VAlign = 'top' | 'middle' | 'bottom';

export interface LabelOptions {
  id: string;
  text: string;
  /** Anchor point; how it is interpreted depends on align/valign. */
  at: Point;
  align?: HAlign;
  valign?: VAlign;
  maxWidth?: number;
  role?: LabelElement['role'];
  sourceId?: string;
  name?: string;
}

/** Translate and lay out a braille label. */
export function makeLabel(
  opts: LabelOptions,
  translator: BrailleTranslator,
  m: BrailleMetrics,
): LabelElement {
  const braille = translator.translate(opts.text);
  const lines = opts.maxWidth ? wrapBraille(braille, cellsThatFit(opts.maxWidth, m)) : [braille];
  const size = brailleSize(lines, m);
  let x = opts.at.x;
  let y = opts.at.y;
  if (opts.align === 'middle') x -= size.w / 2;
  else if (opts.align === 'end') x -= size.w;
  if (opts.valign === 'middle') y -= size.h / 2;
  else if (opts.valign === 'bottom') y -= size.h;
  return {
    kind: 'label',
    id: opts.id,
    role: opts.role ?? 'label',
    sourceId: opts.sourceId,
    name: opts.name ?? opts.text,
    at: { x, y },
    text: opts.text,
    braille: lines,
  };
}

/** Move a label so its box has the given top-left corner. */
export function moveLabel(label: LabelElement, x: number, y: number): LabelElement {
  return { ...label, at: { x, y } };
}

/** Centres of every raised dot in a label. */
export function labelDots(label: LabelElement, m: BrailleMetrics): Point[] {
  const out: Point[] = [];
  const r = m.dotDiameter / 2;
  // Dot positions inside a cell: dots 1-3 in the left column, 4-6 right, 7-8 bottom row.
  const offsets: [number, number][] = [
    [0, 0],
    [0, 1],
    [0, 2],
    [1, 0],
    [1, 1],
    [1, 2],
    [0, 3],
    [1, 3],
  ];
  label.braille.forEach((line, li) => {
    let ci = 0;
    for (const ch of line) {
      const code = (ch.codePointAt(0) ?? 0) - 0x2800;
      if (code < 0 || code > 0xff) continue;
      for (let d = 0; d < 8; d++) {
        if (!(code & (1 << d))) continue;
        const [cx, cy] = offsets[d];
        out.push({
          x: label.at.x + r + ci * m.cellSpacing + cx * m.dotSpacing,
          y: label.at.y + r + li * m.lineSpacing + cy * m.dotSpacing,
        });
      }
      ci++;
    }
  });
  return out;
}
