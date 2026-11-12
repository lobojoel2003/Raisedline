import { describe, expect, it } from 'vitest';
import {
  buildChart,
  buildMap,
  chartFromCsv,
  embossDots,
  exportBrf,
  exportGcode,
  exportPdf,
  exportStl,
  parseDocument,
  parseXml,
  rasterizeToCells,
  renderTactileSvg,
  retranslate,
  serializeDocument,
  stlTriangleCount,
  createTranslator,
  type TactileDocument,
} from '@raisedline/core';
import { example } from './helpers';

const chart = () =>
  buildChart(chartFromCsv(example('rainfall.csv'), { type: 'bar', title: 'Rain' })).tactile;
const map = () => buildMap(example('riverside-campus.geojson')).tactile;

function pdfText(bytes: Uint8Array) {
  return new TextDecoder('latin1').decode(bytes);
}

describe('PDF export', () => {
  it('writes a valid PDF at true size with a correct xref table', () => {
    const doc = map();
    const bytes = exportPdf(doc, { date: new Date(Date.UTC(2026, 0, 1)) });
    const text = pdfText(bytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/MediaBox [0 0 792 612]');
    expect(text).toContain('/Count 2');
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const entries = text
      .slice(startxref)
      .split('\n')
      .slice(3)
      .filter((l) => / n $/.test(l));
    for (const e of entries) {
      const off = Number(e.slice(0, 10));
      expect(text.slice(off)).toMatch(/^\d+ 0 obj/);
    }
  });

  it('is reproducible and supports proofs', () => {
    const doc = chart();
    const date = new Date(Date.UTC(2026, 0, 1));
    expect(exportPdf(doc, { date })).toEqual(exportPdf(doc, { date }));
    const proof = pdfText(exportPdf(doc, { date, interline: true, transcriberNotes: true }));
    expect(proof).toContain('/Count 2');
    expect(proof).toContain('(Jan) Tj');
    expect(proof).toContain('transcriber notes');
  });
});

describe('STL export', () => {
  it('writes a watertight-sized binary STL with the page footprint', () => {
    const doc = chart();
    const stl = exportStl(doc);
    const n = stlTriangleCount(stl);
    expect(stl.byteLength).toBe(84 + 50 * n);
    expect(n).toBeGreaterThan(1000);
    const view = new DataView(stl.buffer);
    let maxX = 0;
    let maxY = 0;
    let maxZ = 0;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) {
        const o = 84 + i * 50 + 12 + k * 12;
        maxX = Math.max(maxX, view.getFloat32(o, true));
        maxY = Math.max(maxY, view.getFloat32(o + 4, true));
        maxZ = Math.max(maxZ, view.getFloat32(o + 8, true));
      }
    }
    expect(maxX).toBeCloseTo(doc.page.width, 1);
    expect(maxY).toBeCloseTo(doc.page.height, 1);
    expect(maxZ).toBeCloseTo(2.6, 1);
  });

  it('scales and drops the base plate on request', () => {
    const doc = chart();
    expect(stlTriangleCount(exportStl(doc, { baseThickness: 0 }))).toBeLessThan(
      stlTriangleCount(exportStl(doc)),
    );
  });
});

describe('BRF export', () => {
  it('draws the graphic with braille cells and appends the key as text', () => {
    const doc = map();
    const brf = exportBrf(doc);
    const pages = brf.split('\f');
    expect(pages.length).toBeGreaterThanOrEqual(3);
    const grid = rasterizeToCells(doc, 0);
    for (const line of pages[0].split('\r\n')) expect(line.length).toBeLessThanOrEqual(grid.cols);
    expect(pages[0].split('\r\n').length).toBeLessThanOrEqual(grid.rows + 1);
    expect(brf).toContain(',RIVERSIDE ,CAMPUS');
    expect(brf).toMatch(/KEY3/);
  });
});

describe('G-code export', () => {
  it('emits BrailleRAP-style G-code without duplicate dots', () => {
    const doc = chart();
    const g = exportGcode(doc);
    const lines = g.split('\r\n');
    expect(lines.slice(2, 7)).toEqual([
      'G28 X;',
      'G28 Y;',
      'M204 T1500;',
      'G1 F6000;',
      'G1 X0.00 Y0.00;',
    ]);
    expect(lines).toContain('M84;');
    const moves = lines.filter((l) => /^G1 X[\d.]+ Y[\d.]+;$/.test(l)).slice(1, -1);
    const strikes = lines.filter((l) => l === 'M3 S1;');
    expect(strikes.length).toBe(moves.length);
    const dots = embossDots(doc);
    expect(dots.length).toBe(strikes.length);
    for (let i = 1; i < dots.length; i++)
      expect(dots[i].y).toBeGreaterThanOrEqual(dots[i - 1].y - 0.05);
  });

  it('mirrors on request', () => {
    const doc = chart();
    const a = exportGcode(doc).match(/G1 X([\d.]+) Y[\d.]+;\r\nM3 S1/)![1];
    const b = exportGcode(doc, { mirror: true }).match(/G1 X([\d.]+) Y[\d.]+;\r\nM3 S1/)![1];
    expect(Number(a)).not.toBe(Number(b));
  });
});

describe('SVG and project files', () => {
  it('renders well-formed SVG at physical size', () => {
    const doc = chart();
    const svg = renderTactileSvg(doc, 0, { interactive: false });
    expect(svg).toMatch(/^<svg[^>]+width="279.4mm" height="215.9mm"/);
    expect(parseXml(svg).children[0].name).toBe('svg');
    expect(svg).not.toContain('data-rl-id');
    expect(renderTactileSvg(doc, 0, { raised: true, interline: true })).toContain('rl-raised');
  });

  it('round-trips documents and re-translates labels', () => {
    const doc = chart();
    const copy = parseDocument(serializeDocument(doc));
    expect(copy).toEqual(doc);
    expect(() => parseDocument('{"format":"x"}')).toThrow(/Raisedline/);
    const upper = createTranslator('test', 'Test', () => '⠿⠿');
    const re: TactileDocument = retranslate(doc, upper);
    expect(re.braille.table).toBe('test');
    expect(re.pages[0].elements.find((e) => e.kind === 'label')!).toMatchObject({
      braille: ['⠿⠿'],
    });
  });
});
