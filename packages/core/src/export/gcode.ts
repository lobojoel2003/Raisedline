import { SpatialGrid } from '../geometry/grid.js';
import { pointInPolygon } from '../geometry/polygon.js';
import { dotsAlong } from '../geometry/dash.js';
import { boundsOf, dist } from '../geometry/vec.js';
import { pagePrimitives } from '../render/primitives.js';
import type { Point, TactileDocument } from '../types.js';
import { VERSION } from '../version.js';

export interface GcodeOptions {
  page?: number;
  /** Spacing of dots along lines (mm). BrailleRAP's own default is 2.4. */
  step?: number;
  /** Vector dots closer than this to an existing dot are skipped (mm). */
  minDotDistance?: number;
  /** Feed rate (mm/min). */
  feed?: number;
  /** Acceleration (mm/s²). */
  acceleration?: number;
  /** Shift applied to every dot (mm), e.g. to centre on the machine's usable area. */
  offsetX?: number;
  offsetY?: number;
  /** Mirror left-right, for machines that emboss from the back of the sheet. */
  mirror?: boolean;
  /** Distance to feed past the page at the end to eject it (mm). */
  eject?: number;
}

export interface EmbossDot extends Point {
  braille: boolean;
}

/** Every dot an XY embosser must strike for a page, de-duplicated and in print order. */
export function embossDots(doc: TactileDocument, opts: GcodeOptions = {}): EmbossDot[] {
  const step = opts.step ?? 2.4;
  const minD = opts.minDotDistance ?? 1.4;
  const prims = pagePrimitives(doc, opts.page ?? 0);
  const braille: EmbossDot[] = [];
  const vector: EmbossDot[] = [];
  for (const p of prims) {
    if (p.type === 'dot')
      (p.braille ? braille : vector).push({ x: p.x, y: p.y, braille: p.braille });
    else if (p.type === 'stroke') {
      for (const d of dotsAlong(p.points, step, p.closed)) vector.push({ ...d, braille: false });
    } else {
      for (const ring of p.rings)
        for (const d of dotsAlong(ring, step, true)) vector.push({ ...d, braille: false });
      const b = boundsOf(p.rings.flat());
      if (!b) continue;
      const rowH = step * 0.866;
      for (let y = b.y + rowH / 2, row = 0; y < b.y + b.h; y += rowH, row++) {
        for (let x = b.x + (row % 2 ? step / 2 : 0); x < b.x + b.w; x += step) {
          if (pointInPolygon({ x, y }, p.rings)) vector.push({ x, y, braille: false });
        }
      }
    }
  }
  // Braille always wins; vector dots must keep clear of it and of each other.
  const grid = new SpatialGrid<EmbossDot>(Math.max(minD, 1));
  const kept: EmbossDot[] = [];
  for (const d of braille) {
    grid.insert({ x: d.x, y: d.y, w: 0, h: 0 }, d);
    kept.push(d);
  }
  for (const d of vector) {
    const near = grid.query({ x: d.x - minD, y: d.y - minD, w: 2 * minD, h: 2 * minD });
    if (near.some((o) => dist(o, d) < minD)) continue;
    grid.insert({ x: d.x, y: d.y, w: 0, h: 0 }, d);
    kept.push(d);
  }
  // Paper feeds along Y: emboss row by row, alternating direction to minimise travel.
  const rows = new Map<number, EmbossDot[]>();
  for (const d of kept) {
    const key = Math.round(d.y * 20) / 20;
    let list = rows.get(key);
    if (!list) {
      list = [];
      rows.set(key, list);
    }
    list.push(d);
  }
  const ordered: EmbossDot[] = [];
  [...rows.keys()]
    .sort((a, b) => a - b)
    .forEach((key, i) => {
      const list = rows.get(key)!.sort((a, b) => a.x - b.x);
      ordered.push(...(i % 2 ? list.reverse() : list));
    });
  return ordered;
}

/**
 * Export G-code for BrailleRAP-style open-source XY embossers. The dialect matches what
 * DesktopBrailleRAP emits: home X/Y, `G1` moves in mm, and `M3 S1` / `M3 S0` to strike a dot.
 */
export function exportGcode(doc: TactileDocument, opts: GcodeOptions = {}): string {
  const dots = embossDots(doc, opts);
  const feed = opts.feed ?? 6000;
  const accel = opts.acceleration ?? 1500;
  const ox = opts.offsetX ?? 0;
  const oy = opts.offsetY ?? 0;
  const W = doc.page.width;
  const f = (v: number) => v.toFixed(2);
  const lines: string[] = [
    `; Raisedline ${VERSION} - ${doc.title.replace(/[\r\n;]/g, ' ')}`,
    `; page ${f(doc.page.width)} x ${f(doc.page.height)} mm, ${dots.length} dots (${dots.filter((d) => d.braille).length} braille)`,
    'G28 X;',
    'G28 Y;',
    `M204 T${accel};`,
    `G1 F${feed};`,
    'G1 X0.00 Y0.00;',
  ];
  for (const d of dots) {
    const x = (opts.mirror ? W - d.x : d.x) + ox;
    const y = d.y + oy;
    lines.push(`G1 X${f(x)} Y${f(y)};`, 'M3 S1;', 'M3 S0;');
  }
  lines.push(
    `G1 F${Math.min(feed, 6000)};`,
    `G1 X0.00 Y${f(doc.page.height + (opts.eject ?? 20) + oy)};`,
    'M84;',
  );
  return lines.join('\r\n') + '\r\n';
}
