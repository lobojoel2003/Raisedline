import { describe, expect, it } from 'vitest';
import {
  abbreviationCodes,
  buildChart,
  buildMap,
  chartFromCsv,
  checkDocument,
  describeChart,
  formatNumber,
  importSvg,
  niceScale,
  pagePreset,
  parseCsv,
  type TactileDocument,
} from '@raisedline/core';
import { example } from './helpers';

const labels = (doc: TactileDocument) =>
  doc.pages.flatMap((p) => p.elements.filter((e) => e.kind === 'label').map((e) => e.text));
const assertClean = (doc: TactileDocument) => {
  const r = checkDocument(doc);
  expect(r.counts.error, r.issues.map((i) => i.message).join('\n')).toBe(0);
  expect(r.counts.warning, r.issues.map((i) => i.message).join('\n')).toBe(0);
  expect(r.score).toBeGreaterThanOrEqual(95);
};

describe('scales and CSV', () => {
  it('picks nice ticks', () => {
    expect(niceScale(0, 78, 6)).toMatchObject({ min: 0, max: 80, step: 20 });
    expect(niceScale(3, 3).ticks.length).toBeGreaterThan(1);
    expect(niceScale(-12, 33, 6).ticks).toContain(0);
    expect(formatNumber(2.5, 0.5)).toBe('2.5');
    expect(formatNumber(20, 5)).toBe('20');
  });

  it('parses quoted, semicolon and tab separated CSV', () => {
    expect(parseCsv('a,b\n"x, y",2\n"say ""hi""",3\n')).toEqual([
      ['a', 'b'],
      ['x, y', '2'],
      ['say "hi"', '3'],
    ]);
    expect(parseCsv('a;b\r\nx;1')).toEqual([
      ['a', 'b'],
      ['x', '1'],
    ]);
    expect(parseCsv('a\tb\nx\t1')[1]).toEqual(['x', '1']);
  });

  it('builds specs from CSV', () => {
    const spec = chartFromCsv(example('rainfall.csv'), { type: 'bar', title: 'Rain' });
    expect(spec.categories).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May']);
    expect(spec.series.map((s) => s.name)).toEqual(['2024', '2025']);
    expect(spec.xLabel).toBe('Month');
    expect(() => chartFromCsv('only one row', { type: 'bar', title: 'x' })).toThrow(/header row/);
    expect(() => chartFromCsv('a,b\nx,y', { type: 'bar', title: 'x' })).toThrow(/numeric/);
  });

  it('makes unique key codes', () => {
    expect(abbreviationCodes(['Mill River', 'Main Gate', 'Main Walk', 'Bus Stop'])).toEqual([
      'm',
      'ma',
      'mai',
      'b',
    ]);
  });
});

describe('charts', () => {
  it.each([
    ['bar', 'rainfall.csv'],
    ['line', 'plant-growth.csv'],
    ['scatter', 'height-armspan.csv'],
    ['pie', 'school-travel.csv'],
  ] as const)('%s chart from %s is touch-ready', (type, file) => {
    const { tactile, sighted } = buildChart(
      chartFromCsv(example(file), { type, title: 'Example' }),
    );
    assertClean(tactile);
    expect(sighted).toMatch(/^<svg/);
    expect(tactile.description.length).toBeGreaterThan(20);
    expect(tactile.pages[0].elements.some((e) => e.role === 'title')).toBe(true);
  });

  it('links tactile elements to the sighted rendering', () => {
    const { tactile, sighted } = buildChart(
      chartFromCsv(example('rainfall.csv'), { type: 'bar', title: 'Rain' }),
    );
    const bar = tactile.pages[0].elements.find((e) => e.id === 'bar-0-0')!;
    expect(bar.sourceId).toBe('bar-0-0');
    expect(sighted).toContain('data-rl-id="bar-0-0"');
  });

  it('uses a key for multiple series and abbreviations for long categories', () => {
    const csv =
      'Region,Sales\nNorthern Highlands,4\nSouthern Lowlands,5\nEastern Seaboard,6\nWestern Plateau,7\nCentral Valley,8\nIsland Territories,3\nCoastal Wetlands,2';
    const { tactile, notes } = buildChart(chartFromCsv(csv, { type: 'bar', title: 'Sales' }));
    expect(tactile.key.some((k) => k.swatch.kind === 'abbreviation')).toBe(true);
    expect(notes.join(' ')).toMatch(/abbreviations/);
    expect(labels(tactile)).toContain('n');
  });

  it('folds small pie slices into Other', () => {
    const csv =
      'k,v\n' +
      'abcdefgh'
        .split('')
        .map((c, i) => `${c},${10 - i}`)
        .join('\n');
    const { tactile, notes } = buildChart(chartFromCsv(csv, { type: 'pie', title: 'Pie' }));
    expect(tactile.key).toHaveLength(6);
    expect(tactile.key[5].text).toMatch(/^Other/);
    expect(notes.join(' ')).toMatch(/Other/);
  });

  it('describes charts in plain language', () => {
    const d = describeChart(chartFromCsv(example('rainfall.csv'), { type: 'bar', title: 'Rain' }));
    expect(d).toContain('Bar chart titled "Rain"');
    expect(d).toContain('Highest is Jan (78)');
  });

  it('validates input', () => {
    expect(() => buildChart({ type: 'bar', title: 'x', series: [] })).toThrow(/series/);
    expect(() =>
      buildChart({ type: 'scatter', title: 'x', series: [{ name: 's', values: [1] }] }),
    ).toThrow(/x values/);
  });

  it('fits other page sizes', () => {
    const { tactile } = buildChart({
      ...chartFromCsv(example('rainfall.csv'), { type: 'bar', title: 'Rain' }),
      page: pagePreset('a4-portrait'),
    });
    expect(tactile.page.width).toBe(210);
    expect(checkDocument(tactile).counts.error).toBe(0);
  });
});

describe('SVG import', () => {
  it('redesigns the water cycle diagram', () => {
    const { tactile, sighted, notes } = importSvg(example('water-cycle.svg'));
    assertClean(tactile);
    expect(tactile.title).toBe('The water cycle');
    const textures = new Set(
      tactile.pages[0].elements
        .filter((e) => e.kind === 'area' && e.role !== 'key')
        .map((e) => (e as { texture: string }).texture),
    );
    expect(textures.size).toBeGreaterThanOrEqual(4);
    expect(labels(tactile)).toEqual(expect.arrayContaining(['Sun', 'Mountain', 'Sea']));
    expect(tactile.key.map((k) => k.text)).toEqual(
      expect.arrayContaining(['Mountain', 'Sea', 'Cloud', 'Sun']),
    );
    expect(sighted).toContain('#4a90d9');
    expect(Array.isArray(notes)).toBe(true);
  });

  it('handles transforms, <use>, CSS classes and backgrounds', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 200 100">
      <style>.thick{stroke:#333;stroke-width:4;fill:none}</style>
      <defs><rect id="box" width="40" height="40" fill="#e69f00"/></defs>
      <rect width="200" height="100" fill="#fff"/>
      <g transform="translate(10 10)"><use xlink:href="#box"/><use href="#box" x="100"/></g>
      <path class="thick" d="M10 80 L190 80"/>
      <text x="100" y="20" text-anchor="middle">Top</text>
    </svg>`;
    const { tactile } = importSvg(svg, { title: 'Boxes' });
    const els = tactile.pages[0].elements;
    expect(els.filter((e) => e.kind === 'area' && e.role !== 'key')).toHaveLength(2);
    expect(els.filter((e) => e.kind === 'line' && e.role !== 'key')).toHaveLength(1);
    expect(labels(tactile)).toContain('Top');
  });

  it('rejects files without an <svg> element', () => {
    expect(() => importSvg('<html></html>')).toThrow(/svg/i);
  });
});

describe('maps', () => {
  it('builds the campus map with codes, key page and no problems', () => {
    const { tactile } = buildMap(example('riverside-campus.geojson'));
    assertClean(tactile);
    expect(tactile.title).toBe('Riverside Campus');
    expect(tactile.pages.map((p) => p.id)).toEqual(['graphic', 'key']);
    expect(tactile.key.map((k) => k.text)).toEqual(
      expect.arrayContaining(['Water', 'Building', 'Road', 'Path', 'Entrance']),
    );
    expect(labels(tactile)).toContain('Gym');
  });

  it('projects longitude/latitude and adds a north arrow', () => {
    const geo = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'Island', category: 'land' },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-1, 50],
                [1, 50],
                [1, 51],
                [-1, 51],
                [-1, 50],
              ],
            ],
          },
        },
        {
          type: 'Feature',
          properties: { name: 'Port' },
          geometry: { type: 'Point', coordinates: [0, 50.2] },
        },
      ],
    };
    const { tactile } = buildMap(geo, { title: 'Island' });
    expect(tactile.pages[0].elements.some((e) => e.id === 'north-arrow')).toBe(true);
    expect(tactile.description).toMatch(/North is at the top/);
    const area = tactile.pages[0].elements.find((e) => e.kind === 'area')!;
    const xs = (area as { rings: { x: number; y: number }[][] }).rings[0].map((p) => p.x);
    const ys = (area as { rings: { x: number; y: number }[][] }).rings[0].map((p) => p.y);
    // 2° of longitude at 50.5°N is about 1.27 × 1° of latitude.
    expect((Math.max(...xs) - Math.min(...xs)) / (Math.max(...ys) - Math.min(...ys))).toBeCloseTo(
      1.27,
      1,
    );
  });

  it('rejects empty input', () => {
    expect(() => buildMap({ type: 'FeatureCollection', features: [] })).toThrow(/no features/);
    expect(() => buildMap('42')).toThrow(/GeoJSON/);
  });
});
