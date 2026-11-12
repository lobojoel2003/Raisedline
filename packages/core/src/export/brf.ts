import { BLANK_CELL, BRAILLE_ASCII, cellBits, toBrailleAscii } from '../braille/cells.js';
import type { BrailleTranslator } from '../braille/translator.js';
import { uebGrade1 } from '../braille/translator.js';
import { pointInPolygon } from '../geometry/polygon.js';
import { boundsOf, dist } from '../geometry/vec.js';
import { wrapBraille } from '../layout/labels.js';
import { pagePrimitives } from '../render/primitives.js';
import { LINE_STYLES, SYMBOLS, TEXTURES } from '../styles.js';
import type { TactileDocument } from '../types.js';

export interface BrfOptions {
  /** Cells per braille line (default: as many as fit the page width). */
  cellsPerLine?: number;
  /** Lines per page (default: as many as fit the page height). */
  linesPerPage?: number;
  /** Add text pages with the title, description and key (default true). */
  includeKeyText?: boolean;
  translator?: BrailleTranslator;
}

/** A page of braille cells, each cell a 6-dot bit pattern. */
export class CellGrid {
  readonly cells: Uint8Array;
  constructor(
    readonly cols: number,
    readonly rows: number,
  ) {
    this.cells = new Uint8Array(cols * rows);
  }
  setDot(col: number, row: number, dot: number) {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return;
    this.cells[row * this.cols + col] |= 1 << (dot - 1);
  }
  setCell(col: number, row: number, bits: number) {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return;
    this.cells[row * this.cols + col] = bits & 0x3f;
  }
  toAscii(): string {
    const lines: string[] = [];
    for (let r = 0; r < this.rows; r++) {
      let line = '';
      for (let c = 0; c < this.cols; c++) line += BRAILLE_ASCII[this.cells[r * this.cols + c]];
      lines.push(line.replace(/ +$/, ''));
    }
    return lines.join('\r\n');
  }
  toUnicode(): string {
    const lines: string[] = [];
    for (let r = 0; r < this.rows; r++) {
      let line = '';
      for (let c = 0; c < this.cols; c++)
        line += String.fromCodePoint(0x2800 + this.cells[r * this.cols + c]);
      lines.push(line);
    }
    return lines.join('\n');
  }
}

/** Dot index (1–6) for column (0/1) and row (0–2) inside a cell. */
const DOT_AT = [
  [1, 2, 3],
  [4, 5, 6],
];

/**
 * Rasterise a page onto the braille cell grid used by every braille embosser. Lines are traced
 * dot by dot, areas are filled with their pattern, and braille labels are written as real
 * cells, so the result embosses on any machine that accepts BRF.
 */
export function rasterizeToCells(
  doc: TactileDocument,
  pageIndex = 0,
  opts: BrfOptions = {},
): CellGrid {
  const m = doc.braille.metrics;
  const cw = m.cellSpacing;
  const lh = m.lineSpacing;
  const ds = m.dotSpacing;
  const cols = opts.cellsPerLine ?? Math.floor(doc.page.width / cw);
  const rows = opts.linesPerPage ?? Math.floor(doc.page.height / lh);
  const grid = new CellGrid(cols, rows);

  const snapX = (x: number): [number, number] => {
    const c = Math.floor(x / cw);
    const local = x - c * cw;
    // Candidates: this cell's two columns and the next cell's first column.
    const options: [number, number, number][] = [
      [c, 0, Math.abs(local)],
      [c, 1, Math.abs(local - ds)],
      [c + 1, 0, Math.abs(local - cw)],
    ];
    options.sort((a, b) => a[2] - b[2]);
    return [options[0][0], options[0][1]];
  };
  const snapY = (y: number): [number, number] => {
    const r = Math.floor(y / lh);
    const local = y - r * lh;
    const options: [number, number, number][] = [
      [r, 0, Math.abs(local)],
      [r, 1, Math.abs(local - ds)],
      [r, 2, Math.abs(local - 2 * ds)],
      [r + 1, 0, Math.abs(local - lh)],
    ];
    options.sort((a, b) => a[2] - b[2]);
    return [options[0][0], options[0][1]];
  };
  const mark = (x: number, y: number) => {
    const [c, dc] = snapX(x);
    const [r, dr] = snapY(y);
    grid.setDot(c, r, DOT_AT[dc][dr]);
  };

  const prims = pagePrimitives(doc, pageIndex);
  for (const p of prims) {
    if (p.type === 'dot') {
      if (!p.braille) mark(p.x, p.y);
    } else if (p.type === 'stroke') {
      const pts = p.closed ? [...p.points, p.points[0]] : p.points;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const steps = Math.max(1, Math.ceil(dist(a, b) / (ds / 2)));
        for (let k = 0; k <= steps; k++)
          mark(a.x + ((b.x - a.x) * k) / steps, a.y + ((b.y - a.y) * k) / steps);
      }
    } else {
      const b = boundsOf(p.rings.flat());
      if (!b) continue;
      for (let r = Math.floor(b.y / lh); r <= Math.ceil((b.y + b.h) / lh); r++) {
        for (let dr = 0; dr < 3; dr++) {
          const y = r * lh + dr * ds;
          for (let c = Math.floor(b.x / cw); c <= Math.ceil((b.x + b.w) / cw); c++) {
            for (let dc = 0; dc < 2; dc++) {
              const x = c * cw + dc * ds;
              if (pointInPolygon({ x, y }, p.rings)) grid.setDot(c, r, DOT_AT[dc][dr]);
            }
          }
        }
      }
    }
  }

  // Braille labels as real cells, with one blank cell either side for separation.
  for (const el of doc.pages[pageIndex].elements) {
    if (el.kind !== 'label') continue;
    const col = Math.round(el.at.x / cw);
    const row0 = Math.round(el.at.y / lh);
    el.braille.forEach((line, li) => {
      const row = row0 + li;
      const chars = [...line];
      grid.setCell(col - 1, row, 0);
      chars.forEach((ch, i) => grid.setCell(col + i, row, cellBits(ch)));
      grid.setCell(col + chars.length, row, 0);
    });
  }
  return grid;
}

function swatchName(entry: TactileDocument['key'][number]): string {
  const s = entry.swatch;
  if (s.kind === 'texture') return TEXTURES[s.texture].label.toLowerCase();
  if (s.kind === 'line') return LINE_STYLES[s.style].label.toLowerCase();
  if (s.kind === 'symbol') return SYMBOLS[s.shape].label.toLowerCase();
  return s.code;
}

/** Plain braille text pages: title, description and key. */
export function keyTextBraille(
  doc: TactileDocument,
  translator: BrailleTranslator,
  cols: number,
  rows: number,
): string[] {
  const lines: string[] = [];
  const add = (text: string, indent = 0) => {
    const b = translator.translate(text);
    const wrapped = wrapBraille(b, cols - indent);
    wrapped.forEach((l, i) => lines.push(BLANK_CELL.repeat(i === 0 ? indent : indent + 2) + l));
  };
  add(doc.title);
  lines.push('');
  if (doc.key.length) {
    add('Key:');
    for (const k of doc.key) add(`${swatchName(k)}: ${k.text}`, 2);
    lines.push('');
  }
  if (doc.description) add(doc.description);
  const pages: string[] = [];
  for (let i = 0; i < lines.length; i += rows) {
    pages.push(
      lines
        .slice(i, i + rows)
        .map((l) => toBrailleAscii(l.replace(new RegExp(BLANK_CELL, 'g'), ' ')).replace(/ +$/, ''))
        .join('\r\n'),
    );
  }
  return pages;
}

/**
 * Export as Braille Ready Format (BRF): graphics drawn with braille cells, followed by the key
 * as braille text. Pages are separated by form feeds.
 */
export function exportBrf(doc: TactileDocument, opts: BrfOptions = {}): string {
  const pages = doc.pages.map((_, i) => rasterizeToCells(doc, i, opts));
  const out = pages.map((g) => g.toAscii());
  if (opts.includeKeyText ?? true) {
    const cols = opts.cellsPerLine ?? pages[0]?.cols ?? 40;
    const rows = opts.linesPerPage ?? pages[0]?.rows ?? 25;
    out.push(...keyTextBraille(doc, opts.translator ?? uebGrade1, cols, rows));
  }
  return out.join('\r\n\f') + '\r\n';
}
