import { dashPieces, dotsAlong } from '../geometry/dash.js';
import {
  circlePoints,
  clipLineToPolygon,
  distanceToEdges,
  pointInPolygon,
  subtractBoxesFromSegment,
} from '../geometry/polygon.js';
import { boundsOf, boxesOverlap, dist, inflate, normalize, sub } from '../geometry/vec.js';
import { labelBox, labelDots } from '../layout/labels.js';
import { DASH_PATTERNS, DOTTED_SPACING, TEXTURE_PARAMS } from '../styles.js';
import type {
  AreaElement,
  BrailleMetrics,
  Box,
  LineElement,
  LineStyle,
  Point,
  Primitive,
  SymbolElement,
  TactileDocument,
  TactileElement,
  TactilePage,
  TextureId,
} from '../types.js';

/** Clear space knocked out of textures around braille labels (mm). */
export const LABEL_KNOCKOUT = 2;

export interface PrimitiveOptions {
  /** Remove texture under braille labels (default true). */
  knockout?: boolean;
}

/** Stroke a polyline with a tactile line style. */
export function styledLine(
  points: Point[],
  width: number,
  style: LineStyle,
  closed: boolean,
  ownerId: string,
): Primitive[] {
  if (points.length < 2) return [];
  if (style === 'solid') return [{ type: 'stroke', points, width, closed, ownerId }];
  if (style === 'dotted') {
    const r = Math.max(0.6, width * 0.7);
    return dotsAlong(points, DOTTED_SPACING, closed).map((p) => ({
      type: 'dot' as const,
      x: p.x,
      y: p.y,
      r,
      ownerId,
      braille: false,
    }));
  }
  const out: Primitive[] = [];
  for (const piece of dashPieces(points, DASH_PATTERNS[style], closed)) {
    if (piece.on) {
      out.push({ type: 'stroke', points: piece.points, width, closed: false, ownerId });
    } else if (style === 'dash-dot') {
      const mid = midpoint(piece.points);
      out.push({
        type: 'dot',
        x: mid.x,
        y: mid.y,
        r: Math.max(0.6, width * 0.65),
        ownerId,
        braille: false,
      });
    }
  }
  return out;
}

function midpoint(points: Point[]): Point {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const l = dist(points[i - 1], points[i]);
    if (acc + l >= total / 2) {
      const t = l === 0 ? 0 : (total / 2 - acc) / l;
      return {
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * t,
      };
    }
    acc += l;
  }
  return points[0];
}

function arrowHead(
  tip: Point,
  from: Point,
  width: number,
  ownerId: string,
): { prim: Primitive; base: Point } {
  const length = Math.max(4.5, width * 4);
  const dir = normalize(sub(tip, from));
  const base = { x: tip.x - dir.x * length, y: tip.y - dir.y * length };
  const half = length * 0.5;
  const n = { x: -dir.y * half, y: dir.x * half };
  return {
    prim: {
      type: 'fill',
      rings: [[tip, { x: base.x + n.x, y: base.y + n.y }, { x: base.x - n.x, y: base.y - n.y }]],
      ownerId,
    },
    base: { x: tip.x - dir.x * length * 0.7, y: tip.y - dir.y * length * 0.7 },
  };
}

function lineToPrimitives(el: LineElement): Primitive[] {
  const pts = el.points.slice();
  const extra: Primitive[] = [];
  if (pts.length >= 2 && !el.closed) {
    if (el.arrow === 'end' || el.arrow === 'both') {
      const h = arrowHead(pts[pts.length - 1], pts[pts.length - 2], el.width, el.id);
      extra.push(h.prim);
      pts[pts.length - 1] = h.base;
    }
    if (el.arrow === 'start' || el.arrow === 'both') {
      const h = arrowHead(pts[0], pts[1], el.width, el.id);
      extra.push(h.prim);
      pts[0] = h.base;
    }
  }
  return [...styledLine(pts, el.width, el.style, !!el.closed, el.id), ...extra];
}

function hatch(
  rings: Point[][],
  angleDeg: number,
  spacing: number,
  width: number,
  knockouts: Box[],
  ownerId: string,
): Primitive[] {
  const b = boundsOf(rings.flat());
  if (!b) return [];
  const a = (angleDeg * Math.PI) / 180;
  const dir = { x: Math.cos(a), y: Math.sin(a) };
  const nrm = { x: -dir.y, y: dir.x };
  const corners = [
    { x: b.x, y: b.y },
    { x: b.x + b.w, y: b.y },
    { x: b.x, y: b.y + b.h },
    { x: b.x + b.w, y: b.y + b.h },
  ];
  const proj = corners.map((c) => c.x * nrm.x + c.y * nrm.y);
  const lo = Math.min(...proj);
  const hi = Math.max(...proj);
  const out: Primitive[] = [];
  const inset = TEXTURE_PARAMS.inset;
  // Align the pattern to a global lattice so neighbouring areas line up.
  const start = Math.ceil(lo / spacing) * spacing;
  for (let o = start; o <= hi; o += spacing) {
    const origin = { x: nrm.x * o, y: nrm.y * o };
    for (const [p, q] of clipLineToPolygon(origin, dir, rings)) {
      const l = dist(p, q);
      if (l <= 2 * inset + 1) continue;
      const u = { x: (q.x - p.x) / l, y: (q.y - p.y) / l };
      const p2 = { x: p.x + u.x * inset, y: p.y + u.y * inset };
      const q2 = { x: q.x - u.x * inset, y: q.y - u.y * inset };
      for (const [s, e] of subtractBoxesFromSegment(p2, q2, knockouts)) {
        if (dist(s, e) < 1.5) continue;
        out.push({ type: 'stroke', points: [s, e], width, closed: false, ownerId, texture: true });
      }
    }
  }
  return out;
}

function dotFill(
  rings: Point[][],
  spacing: number,
  r: number,
  knockouts: Box[],
  ownerId: string,
): Primitive[] {
  const b = boundsOf(rings.flat());
  if (!b) return [];
  const out: Primitive[] = [];
  const rowH = spacing * 0.866;
  const y0 = Math.ceil(b.y / rowH) * rowH;
  for (let y = y0, row = Math.round(y0 / rowH); y <= b.y + b.h; y += rowH, row++) {
    const offset = row % 2 === 0 ? 0 : spacing / 2;
    const x0 = Math.ceil((b.x - offset) / spacing) * spacing + offset;
    for (let x = x0; x <= b.x + b.w; x += spacing) {
      const p = { x, y };
      if (!pointInPolygon(p, rings)) continue;
      if (distanceToEdges(p, rings) < r + TEXTURE_PARAMS.inset) continue;
      if (knockouts.some((k) => p.x >= k.x && p.x <= k.x + k.w && p.y >= k.y && p.y <= k.y + k.h))
        continue;
      out.push({ type: 'dot', x, y, r, ownerId, braille: false, texture: true });
    }
  }
  return out;
}

export function texturePrimitives(
  rings: Point[][],
  texture: TextureId,
  ownerId: string,
  knockouts: Box[] = [],
): Primitive[] {
  const P = TEXTURE_PARAMS;
  switch (texture) {
    case 'none':
      return [];
    case 'solid':
      return [{ type: 'fill', rings, ownerId, texture: true }];
    case 'diagonal':
      return hatch(rings, -45, P.diagonalSpacing, P.lineWidth, knockouts, ownerId);
    case 'horizontal':
      return hatch(rings, 0, P.straightSpacing, P.lineWidth, knockouts, ownerId);
    case 'vertical':
      return hatch(rings, 90, P.straightSpacing, P.lineWidth, knockouts, ownerId);
    case 'grid':
      return [
        ...hatch(rings, 0, P.gridSpacing, P.lineWidth, knockouts, ownerId),
        ...hatch(rings, 90, P.gridSpacing, P.lineWidth, knockouts, ownerId),
      ];
    case 'dots':
      return dotFill(rings, P.fineDotSpacing, P.fineDotRadius, knockouts, ownerId);
    case 'coarse-dots':
      return dotFill(rings, P.coarseDotSpacing, P.coarseDotRadius, knockouts, ownerId);
  }
}

function areaToPrimitives(el: AreaElement, knockouts: Box[]): Primitive[] {
  const b = boundsOf(el.rings.flat());
  const local = b ? knockouts.filter((k) => boxesOverlap(k, b)) : [];
  const out = texturePrimitives(el.rings, el.texture, el.id, local);
  if (el.outline) {
    for (const ring of el.rings) {
      out.push(...styledLine(ring, el.outline.width, el.outline.style, true, el.id));
    }
  }
  return out;
}

/** Outline geometry of a symbol (used by renderers and the touch check). */
export function symbolPrimitives(el: SymbolElement): Primitive[] {
  const { x, y } = el.at;
  const s = el.size;
  const h = s / 2;
  const w = Math.max(0.8, s * 0.13);
  switch (el.shape) {
    case 'circle':
      return [{ type: 'fill', rings: [circlePoints(x, y, h, 32)], ownerId: el.id }];
    case 'ring':
      return [
        {
          type: 'stroke',
          points: circlePoints(x, y, h - w / 2, 32),
          width: w,
          closed: true,
          ownerId: el.id,
        },
      ];
    case 'square': {
      const k = h - w / 2;
      return [
        {
          type: 'stroke',
          points: [
            { x: x - k, y: y - k },
            { x: x + k, y: y - k },
            { x: x + k, y: y + k },
            { x: x - k, y: y + k },
          ],
          width: w,
          closed: true,
          ownerId: el.id,
        },
      ];
    }
    case 'diamond': {
      const k = h - w / 2;
      return [
        {
          type: 'stroke',
          points: [
            { x, y: y - k },
            { x: x + k, y },
            { x, y: y + k },
            { x: x - k, y },
          ],
          width: w,
          closed: true,
          ownerId: el.id,
        },
      ];
    }
    case 'triangle': {
      const r = h * 1.1;
      const pts = [0, 1, 2].map((i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
        return { x: x + r * Math.cos(a), y: y + r * 0.95 * Math.sin(a) + r * 0.15 };
      });
      return [{ type: 'fill', rings: [pts], ownerId: el.id }];
    }
    case 'cross': {
      const k = h * 0.8;
      return [
        {
          type: 'stroke',
          points: [
            { x: x - k, y: y - k },
            { x: x + k, y: y + k },
          ],
          width: w * 1.2,
          closed: false,
          ownerId: el.id,
        },
        {
          type: 'stroke',
          points: [
            { x: x + k, y: y - k },
            { x: x - k, y: y + k },
          ],
          width: w * 1.2,
          closed: false,
          ownerId: el.id,
        },
      ];
    }
  }
}

/** Primitives for a single element. */
export function elementPrimitives(
  el: TactileElement,
  metrics: BrailleMetrics,
  knockouts: Box[] = [],
): Primitive[] {
  switch (el.kind) {
    case 'line':
      return lineToPrimitives(el);
    case 'area':
      return areaToPrimitives(el, knockouts);
    case 'symbol':
      return symbolPrimitives(el);
    case 'label':
      return labelDots(el, metrics).map((p) => ({
        type: 'dot' as const,
        x: p.x,
        y: p.y,
        r: metrics.dotDiameter / 2,
        ownerId: el.id,
        braille: true,
      }));
  }
}

/** Knock-out boxes for every label on the page. */
export function labelKnockouts(page: TactilePage, metrics: BrailleMetrics): Box[] {
  return page.elements
    .filter((e) => e.kind === 'label')
    .map((e) => inflate(labelBox(e, metrics), LABEL_KNOCKOUT));
}

/** Flatten a page into exporter-friendly primitives (paint order = element order). */
export function pagePrimitives(
  doc: TactileDocument,
  pageIndex = 0,
  opts: PrimitiveOptions = {},
): Primitive[] {
  const page = doc.pages[pageIndex];
  if (!page) return [];
  const m = doc.braille.metrics;
  const knockouts = opts.knockout === false ? [] : labelKnockouts(page, m);
  const out: Primitive[] = [];
  for (const el of page.elements) out.push(...elementPrimitives(el, m, knockouts));
  return out;
}

/** Group primitives by owning element (keeps element order). */
export function groupByOwner(prims: Primitive[]): Map<string, Primitive[]> {
  const map = new Map<string, Primitive[]>();
  for (const p of prims) {
    let list = map.get(p.ownerId);
    if (!list) {
      list = [];
      map.set(p.ownerId, list);
    }
    list.push(p);
  }
  return map;
}

export function primitiveBounds(p: Primitive): Box {
  if (p.type === 'dot') return { x: p.x - p.r, y: p.y - p.r, w: 2 * p.r, h: 2 * p.r };
  if (p.type === 'stroke') return inflate(boundsOf(p.points)!, p.width / 2);
  return boundsOf(p.rings.flat())!;
}
