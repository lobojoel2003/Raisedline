import type { BrailleTranslator } from './braille/translator.js';
import { uebGrade1 } from './braille/translator.js';
import { DEFAULT_BRAILLE, DEFAULT_PAGE, LINE_WEIGHTS } from './config.js';
import { brailleSize, cellsThatFit, makeLabel, wrapBraille } from './layout/labels.js';
import type {
  BrailleSettings,
  KeyEntry,
  PageSpec,
  SourceKind,
  TactileDocument,
  TactileElement,
} from './types.js';
import { VERSION } from './version.js';

export function createDocument(init: {
  title: string;
  source: SourceKind;
  page?: PageSpec;
  braille?: Partial<BrailleSettings>;
  description?: string;
}): TactileDocument {
  return {
    format: 'raisedline',
    version: 1,
    title: init.title,
    page: { ...(init.page ?? DEFAULT_PAGE) },
    braille: {
      table: init.braille?.table ?? DEFAULT_BRAILLE.table,
      metrics: { ...DEFAULT_BRAILLE.metrics, ...init.braille?.metrics },
    },
    pages: [{ id: 'graphic', title: 'Graphic', elements: [] }],
    key: [],
    description: init.description ?? '',
    source: init.source,
    generator: `Raisedline ${VERSION}`,
  };
}

/** Sequential id generator with readable prefixes. */
export class Ids {
  private n = new Map<string, number>();
  next(prefix: string): string {
    const v = (this.n.get(prefix) ?? 0) + 1;
    this.n.set(prefix, v);
    return `${prefix}-${v}`;
  }
}

const SWATCH_W = 18;
const SWATCH_H = 13;
/** Line samples are long enough to show their dash pattern on both sides of a symbol. */
const LINE_SWATCH_W = 30;

function layoutColumn(
  entries: KeyEntry[],
  origin: { x: number; y: number },
  width: number,
  translator: BrailleTranslator,
  doc: TactileDocument,
  idPrefix: string,
  startIndex: number,
): { elements: TactileElement[]; height: number; rows: number[] } {
  const m = doc.braille.metrics;
  const elements: TactileElement[] = [];
  let y = origin.y;
  const gap = 4;
  const rows: number[] = [];
  entries.forEach((entry, i) => {
    const id = `${idPrefix}-${startIndex + i + 1}`;
    const s = entry.swatch;
    const swatchW =
      s.kind === 'abbreviation'
        ? Math.max(SWATCH_W, brailleSize([translator.translate(s.code)], m).w)
        : s.kind === 'line'
          ? LINE_SWATCH_W
          : SWATCH_W;
    const labelX = origin.x + swatchW + 5;
    const label = makeLabel(
      {
        id: `${id}-text`,
        text: entry.text,
        at: { x: labelX, y },
        maxWidth: Math.max(m.cellSpacing * 4, width - (labelX - origin.x)),
        role: 'key',
        name: `Key: ${entry.text}`,
      },
      translator,
      m,
    );
    const lh = brailleSize(label.braille, m).h;
    const rowH = Math.max(SWATCH_H, lh);
    const cy = y + rowH / 2;
    label.at.y = cy - lh / 2;
    // Align the first braille line with the swatch centre when the label wraps.
    if (label.braille.length > 1) label.at.y = y;
    switch (s.kind) {
      case 'texture':
        elements.push({
          kind: 'area',
          id: `${id}-swatch`,
          role: 'key',
          name: `Key swatch: ${entry.text}`,
          rings: [
            [
              { x: origin.x, y: cy - SWATCH_H / 2 },
              { x: origin.x + SWATCH_W, y: cy - SWATCH_H / 2 },
              { x: origin.x + SWATCH_W, y: cy + SWATCH_H / 2 },
              { x: origin.x, y: cy + SWATCH_H / 2 },
            ],
          ],
          texture: s.texture,
          outline: { width: LINE_WEIGHTS.medium, style: 'solid' },
        });
        break;
      case 'line':
        elements.push({
          kind: 'line',
          id: `${id}-swatch`,
          role: 'key',
          name: `Key swatch: ${entry.text}`,
          points: [
            { x: origin.x + 1.5, y: cy },
            { x: origin.x + LINE_SWATCH_W - 1.5, y: cy },
          ],
          width: s.width,
          style: s.style,
        });
        if (s.symbol) {
          elements.push({
            kind: 'symbol',
            id: `${id}-symbol`,
            role: 'key',
            name: `Key symbol: ${entry.text}`,
            at: { x: origin.x + LINE_SWATCH_W / 2, y: cy },
            shape: s.symbol,
            size: 6.5,
            attachedTo: [`${id}-swatch`],
          });
        }
        break;
      case 'symbol':
        elements.push({
          kind: 'symbol',
          id: `${id}-swatch`,
          role: 'key',
          name: `Key swatch: ${entry.text}`,
          at: { x: origin.x + SWATCH_W / 2, y: cy },
          shape: s.shape,
          size: 7,
        });
        break;
      case 'abbreviation': {
        const code = makeLabel(
          {
            id: `${id}-code`,
            text: s.code,
            at: { x: origin.x, y: cy },
            valign: 'middle',
            role: 'key',
            name: `Key code: ${s.code}`,
          },
          translator,
          m,
        );
        if (label.braille.length > 1) code.at.y = label.at.y;
        elements.push(code);
        break;
      }
    }
    elements.push(label);
    rows.push(rowH);
    y += rowH + gap;
  });
  return { elements, height: Math.max(0, y - origin.y - gap), rows };
}

/**
 * Lay out key entries as tactile elements: swatch on the left, braille meaning on the right.
 * With `maxHeight`, entries flow into up to four columns.
 */
export function layoutKey(
  entries: KeyEntry[],
  origin: { x: number; y: number },
  width: number,
  translator: BrailleTranslator,
  doc: TactileDocument,
  idPrefix = 'key',
  maxHeight = Infinity,
): { elements: TactileElement[]; height: number; columns: number } {
  const colGap = 10;
  let fallback: { elements: TactileElement[]; height: number; columns: number } | null = null;
  for (let cols = 1; cols <= 4; cols++) {
    const colW = (width - (cols - 1) * colGap) / cols;
    if (colW < 60 && cols > 1) break;
    // Measure row heights at this width, then split greedily into columns.
    const rows = layoutColumn(entries, { x: 0, y: 0 }, colW, translator, doc, idPrefix, 0).rows;
    const groups: number[][] = [[]];
    let h = 0;
    rows.forEach((rh, i) => {
      const add = (groups[groups.length - 1].length ? 4 : 0) + rh;
      if (h + add > maxHeight && groups[groups.length - 1].length) {
        groups.push([]);
        h = 0;
      }
      h += (groups[groups.length - 1].length ? 4 : 0) + rh;
      groups[groups.length - 1].push(i);
    });
    const elements: TactileElement[] = [];
    let height = 0;
    groups.forEach((g, c) => {
      if (!g.length) return;
      const col = layoutColumn(
        g.map((i) => entries[i]),
        { x: origin.x + c * (colW + colGap), y: origin.y },
        colW,
        translator,
        doc,
        idPrefix,
        g[0],
      );
      elements.push(...col.elements);
      height = Math.max(height, col.height);
    });
    const result = { elements, height, columns: groups.length };
    if (groups.length <= cols) return result;
    fallback = result;
  }
  return fallback ?? { elements: [], height: 0, columns: 0 };
}

/** Height a key would need at the given width. */
export function measureKey(
  entries: KeyEntry[],
  width: number,
  translator: BrailleTranslator,
  doc: TactileDocument,
): number {
  return layoutKey(entries, { x: 0, y: 0 }, width, translator, doc).height;
}

/**
 * Put the key on its own page (with a braille heading), used when it does not fit beside the
 * graphic.
 */
export function addKeyPage(doc: TactileDocument, translator: BrailleTranslator = uebGrade1): void {
  if (doc.key.length === 0) return;
  const m = doc.braille.metrics;
  const { margin, width } = doc.page;
  const heading = makeLabel(
    {
      id: 'keypage-title',
      text: `Key: ${doc.title}`,
      at: { x: margin, y: margin },
      maxWidth: width - 2 * margin,
      role: 'title',
    },
    translator,
    m,
  );
  const top = margin + brailleSize(heading.braille, m).h + 8;
  const key = layoutKey(
    doc.key,
    { x: margin, y: top },
    width - 2 * margin,
    translator,
    doc,
    'keypage',
    doc.page.height - margin - top,
  );
  doc.pages.push({ id: 'key', title: 'Key', elements: [heading, ...key.elements] });
}

/** Serialise a document to pretty JSON. */
export function serializeDocument(doc: TactileDocument): string {
  return JSON.stringify(doc, null, 2);
}

/** Parse and minimally validate a Raisedline document. */
export function parseDocument(json: string | unknown): TactileDocument {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (!data || typeof data !== 'object') throw new Error('Not a Raisedline document');
  const d = data as Partial<TactileDocument>;
  if (d.format !== 'raisedline')
    throw new Error('Not a Raisedline document (missing "format": "raisedline")');
  if (d.version !== 1) throw new Error(`Unsupported document version ${String(d.version)}`);
  if (!d.page || typeof d.page.width !== 'number' || typeof d.page.height !== 'number') {
    throw new Error('Document page size is missing');
  }
  if (!Array.isArray(d.pages) || d.pages.length === 0) throw new Error('Document has no pages');
  for (const p of d.pages) {
    if (!Array.isArray(p.elements)) throw new Error(`Page "${p.id}" has no elements array`);
    for (const e of p.elements) {
      if (!e || typeof e !== 'object' || !('kind' in e) || !('id' in e))
        throw new Error('Invalid element');
      if (!['line', 'area', 'symbol', 'label'].includes(e.kind))
        throw new Error(`Unknown element kind "${e.kind}"`);
    }
  }
  return {
    ...d,
    braille: {
      table: d.braille?.table ?? DEFAULT_BRAILLE.table,
      metrics: { ...DEFAULT_BRAILLE.metrics, ...d.braille?.metrics },
    },
    key: d.key ?? [],
    description: d.description ?? '',
    title: d.title ?? 'Untitled',
    source: d.source ?? 'manual',
    generator: d.generator ?? `Raisedline ${VERSION}`,
  } as TactileDocument;
}

/** Re-translate every label with another braille table (layout is kept, widths may change). */
export function retranslate(doc: TactileDocument, translator: BrailleTranslator): TactileDocument {
  const m = doc.braille.metrics;
  return {
    ...doc,
    braille: { ...doc.braille, table: translator.id },
    pages: doc.pages.map((p) => ({
      ...p,
      elements: p.elements.map((e) => {
        if (e.kind !== 'label') return e;
        const width = brailleSize(e.braille, m).w;
        const b = translator.translate(e.text);
        const maxCells = e.braille.length > 1 ? cellsThatFit(width, m) : Infinity;
        return { ...e, braille: Number.isFinite(maxCells) ? wrapBraille(b, maxCells) : [b] };
      }),
    })),
  };
}
