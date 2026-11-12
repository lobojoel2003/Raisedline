import { PT_PER_MM } from '../config.js';
import { labelBox } from '../layout/labels.js';
import { pagePrimitives } from '../render/primitives.js';
import { LINE_STYLES, SYMBOLS, TEXTURES } from '../styles.js';
import type { Primitive, TactileDocument } from '../types.js';
import { VERSION } from '../version.js';

export interface PdfOptions {
  /** Pages to include (default: all). */
  pages?: number[];
  /** Append a print-only transcriber page listing the key and labels (default false). */
  transcriberNotes?: boolean;
  /** Draw print text under each braille label (default false; never on swell paper). */
  interline?: boolean;
  /** Mirror horizontally, for machines that emboss from the back (default false). */
  mirror?: boolean;
  /** Fixed creation date (for reproducible builds). */
  date?: Date;
}

const KAPPA = 0.5522847498;

function num(v: number): string {
  const s = v.toFixed(3);
  return s.replace(/\.?0+$/, '') || '0';
}

/** Escape a string for a PDF literal using WinAnsi (non-Latin-1 replaced with '?'). */
function pdfString(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
    else if (c >= 32 && c < 127) out += ch;
    else if (c >= 160 && c <= 255) out += '\\' + c.toString(8).padStart(3, '0');
    else if (c === 0x2013 || c === 0x2014) out += '-';
    else if (c === 0x2018 || c === 0x2019) out += "'";
    else if (c === 0x201c || c === 0x201d) out += '"';
    else out += '?';
  }
  return `(${out})`;
}

/** PDF text string (UTF-16BE with BOM) for document metadata. */
function pdfTextString(s: string): string {
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++)
    hex += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}

function pdfDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `(D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z)`;
}

class ContentBuilder {
  private ops: string[] = [];
  constructor(
    private readonly pageHeightMm: number,
    private readonly pageWidthMm: number,
    private readonly mirror: boolean,
  ) {}
  private X(x: number) {
    return num((this.mirror ? this.pageWidthMm - x : x) * PT_PER_MM);
  }
  private Y(y: number) {
    return num((this.pageHeightMm - y) * PT_PER_MM);
  }
  raw(op: string) {
    this.ops.push(op);
  }
  primitive(p: Primitive) {
    if (p.type === 'stroke') {
      if (p.points.length < 2) return;
      let path = `${this.X(p.points[0].x)} ${this.Y(p.points[0].y)} m`;
      for (let i = 1; i < p.points.length; i++)
        path += ` ${this.X(p.points[i].x)} ${this.Y(p.points[i].y)} l`;
      if (p.closed) path += ' h';
      this.ops.push(`${num(p.width * PT_PER_MM)} w ${path} S`);
    } else if (p.type === 'fill') {
      let path = '';
      for (const ring of p.rings) {
        if (ring.length < 3) continue;
        path += `${this.X(ring[0].x)} ${this.Y(ring[0].y)} m`;
        for (let i = 1; i < ring.length; i++)
          path += ` ${this.X(ring[i].x)} ${this.Y(ring[i].y)} l`;
        path += ' h ';
      }
      if (path) this.ops.push(`${path}f*`);
    } else {
      this.circle(p.x, p.y, p.r);
    }
  }
  circle(cxMm: number, cyMm: number, rMm: number) {
    const cx = (this.mirror ? this.pageWidthMm - cxMm : cxMm) * PT_PER_MM;
    const cy = (this.pageHeightMm - cyMm) * PT_PER_MM;
    const r = rMm * PT_PER_MM;
    const k = r * KAPPA;
    this.ops.push(
      `${num(cx + r)} ${num(cy)} m ` +
        `${num(cx + r)} ${num(cy + k)} ${num(cx + k)} ${num(cy + r)} ${num(cx)} ${num(cy + r)} c ` +
        `${num(cx - k)} ${num(cy + r)} ${num(cx - r)} ${num(cy + k)} ${num(cx - r)} ${num(cy)} c ` +
        `${num(cx - r)} ${num(cy - k)} ${num(cx - k)} ${num(cy - r)} ${num(cx)} ${num(cy - r)} c ` +
        `${num(cx + k)} ${num(cy - r)} ${num(cx + r)} ${num(cy - k)} ${num(cx + r)} ${num(cy)} c f`,
    );
  }
  text(xMm: number, yMm: number, sizePt: number, s: string, bold = false) {
    this.ops.push(
      `BT /${bold ? 'F2' : 'F1'} ${num(sizePt)} Tf ${num(xMm * PT_PER_MM)} ${this.Y(yMm)} Td ${pdfString(s)} Tj ET`,
    );
  }
  toString() {
    return this.ops.join('\n');
  }
}

function swatchText(entry: TactileDocument['key'][number]): string {
  const s = entry.swatch;
  switch (s.kind) {
    case 'texture':
      return TEXTURES[s.texture].label;
    case 'line':
      return LINE_STYLES[s.style].label;
    case 'symbol':
      return SYMBOLS[s.shape].label;
    case 'abbreviation':
      return `Abbreviation "${s.code}"`;
  }
}

/** Wrap print text to a maximum character count. */
function wrapText(s: string, max: number): string[] {
  const words = s.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > max) {
      if (line) lines.push(line);
      line = w;
    } else line = (line + ' ' + w).trim();
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Export a tactile document as a vector PDF at true physical size, black on white, ready to
 * print onto swell (microcapsule) paper or to send to a graphics embosser driver.
 */
export function exportPdf(doc: TactileDocument, opts: PdfOptions = {}): Uint8Array<ArrayBuffer> {
  const pageIdx = opts.pages ?? doc.pages.map((_, i) => i);
  const W = doc.page.width;
  const H = doc.page.height;
  const contents: string[] = [];
  for (const i of pageIdx) {
    const c = new ContentBuilder(H, W, !!opts.mirror);
    c.raw('0 g 0 G 1 J 1 j');
    for (const p of pagePrimitives(doc, i)) c.primitive(p);
    if (opts.interline) {
      c.raw('0.45 0.29 0.07 rg');
      for (const el of doc.pages[i].elements) {
        if (el.kind !== 'label') continue;
        const b = labelBox(el, doc.braille.metrics);
        c.text(b.x, b.y + b.h + 3, 8, el.text);
      }
    }
    contents.push(c.toString());
  }
  if (opts.transcriberNotes) {
    const c = new ContentBuilder(H, W, false);
    let y = 20;
    c.text(15, y, 16, `${doc.title} - transcriber notes`, true);
    y += 9;
    c.text(
      15,
      y,
      9,
      `Generated by Raisedline ${VERSION}. Page size ${num(W)} x ${num(H)} mm. Braille: ${doc.braille.table}.`,
    );
    y += 10;
    if (doc.description) {
      c.text(15, y, 11, 'Description', true);
      y += 6;
      for (const line of wrapText(doc.description, 110)) {
        c.text(15, y, 9, line);
        y += 4.6;
      }
      y += 4;
    }
    if (doc.key.length) {
      c.text(15, y, 11, 'Key', true);
      y += 6;
      for (const k of doc.key) {
        c.text(15, y, 9, `${swatchText(k)}: ${k.text}`);
        y += 4.6;
        if (y > H - 15) break;
      }
      y += 4;
    }
    const labels = doc.pages.flatMap((p) => p.elements.filter((e) => e.kind === 'label'));
    if (labels.length && y < H - 25) {
      c.text(15, y, 11, 'Braille labels', true);
      y += 6;
      for (const l of labels) {
        if (y > H - 12) break;
        c.text(15, y, 9, l.text);
        y += 4.6;
      }
    }
    contents.push(c.toString());
  }

  // --- Assemble objects ------------------------------------------------------------------
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const catalogId = add('');
  const pagesId = add('');
  const font1 = add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  );
  const font2 = add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  );
  const pageIds: number[] = [];
  const mediaBox = `[0 0 ${num(W * PT_PER_MM)} ${num(H * PT_PER_MM)}]`;
  for (const content of contents) {
    const bytes = new TextEncoder().encode(content);
    const contentId = add(`<< /Length ${bytes.length} >>\nstream\n${content}\nendstream`);
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox ${mediaBox} /Contents ${contentId} 0 R /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> >> >>`,
      ),
    );
  }
  objects[pagesId - 1] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  objects[catalogId - 1] =
    `<< /Type /Catalog /Pages ${pagesId} 0 R /ViewerPreferences << /PrintScaling /None >> >>`;
  const date = pdfDate(opts.date ?? new Date());
  const infoId = add(
    `<< /Title ${pdfTextString(doc.title)} /Subject ${pdfTextString(doc.description.slice(0, 500))} /Creator (Raisedline ${VERSION}) /Producer (Raisedline ${VERSION}) /Keywords (tactile graphic; braille; swell paper) /CreationDate ${date} >>`,
  );

  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const write = (s: string) => {
    const b = enc.encode(s);
    chunks.push(b);
    offset += b.length;
  };
  write('%PDF-1.4\n%âãÏÓ\n');
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(offset);
    write(`${i + 1} 0 obj\n${body}\nendobj\n`);
  });
  const xref = offset;
  let table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) table += `${String(o).padStart(10, '0')} 00000 n \n`;
  write(table);
  write(
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  );
  const out = new Uint8Array(offset);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}
