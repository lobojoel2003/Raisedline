import type { Box, Point } from '../types.js';
import { boundsOf, dist, pointSegmentDistance } from './vec.js';

/** Signed area (positive when counter-clockwise in a y-up frame). */
export function signedArea(ring: Point[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j].x - ring[i].x) * (ring[j].y + ring[i].y);
  }
  return a / 2;
}

export function ringArea(ring: Point[]): number {
  return Math.abs(signedArea(ring));
}

/** Area of a polygon with holes. */
export function polygonArea(rings: Point[][]): number {
  if (rings.length === 0) return 0;
  let a = ringArea(rings[0]);
  for (let i = 1; i < rings.length; i++) a -= ringArea(rings[i]);
  return Math.max(0, a);
}

export function ringPerimeter(ring: Point[]): number {
  let p = 0;
  for (let i = 0; i < ring.length; i++) p += dist(ring[i], ring[(i + 1) % ring.length]);
  return p;
}

/** Even-odd point-in-polygon test across all rings (holes excluded). */
export function pointInPolygon(p: Point, rings: Point[][]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/** Distance from p to the nearest polygon edge. */
export function distanceToEdges(p: Point, rings: Point[][]): number {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      best = Math.min(best, pointSegmentDistance(p, ring[i], ring[(i + 1) % ring.length]));
    }
  }
  return best;
}

export function centroid(ring: Point[]): Point {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j].x * ring[i].y - ring[i].x * ring[j].y;
    a += f;
    cx += (ring[j].x + ring[i].x) * f;
    cy += (ring[j].y + ring[i].y) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const b = boundsOf(ring)!;
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/**
 * Approximate "pole of inaccessibility": the interior point farthest from any edge.
 * Uses an iterative grid refinement which is plenty for label placement.
 */
export function interiorPoint(rings: Point[][]): { point: Point; clearance: number } {
  const b = boundsOf(rings[0]);
  if (!b) return { point: { x: 0, y: 0 }, clearance: 0 };
  let best = { point: centroid(rings[0]), clearance: -Infinity };
  if (pointInPolygon(best.point, rings)) best.clearance = distanceToEdges(best.point, rings);
  let cx = b.x + b.w / 2;
  let cy = b.y + b.h / 2;
  let span = Math.max(b.w, b.h);
  for (let iter = 0; iter < 9; iter++) {
    const step = span / 10;
    for (let i = -5; i <= 5; i++) {
      for (let j = -5; j <= 5; j++) {
        const p = { x: cx + i * step, y: cy + j * step };
        if (!pointInPolygon(p, rings)) continue;
        const c = distanceToEdges(p, rings);
        if (c > best.clearance) best = { point: p, clearance: c };
      }
    }
    cx = best.point.x;
    cy = best.point.y;
    span /= 2.2;
  }
  return { point: best.point, clearance: Math.max(0, best.clearance) };
}

/**
 * Typical width of a shape: 2·area/perimeter. Equals the true width for long strips and the
 * radius for discs, which makes it a good proxy for "can a finger find the texture here".
 */
export function effectiveWidth(rings: Point[][]): number {
  if (rings.length === 0) return 0;
  const area = polygonArea(rings);
  let per = 0;
  for (const r of rings) per += ringPerimeter(r);
  return per === 0 ? 0 : (2 * area) / per;
}

/**
 * Clip an infinite line (through `origin` with direction `dir`) to the polygon interior.
 * Returns the inside intervals as segment pairs.
 */
export function clipLineToPolygon(origin: Point, dir: Point, rings: Point[][]): [Point, Point][] {
  const ts: number[] = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const e = { x: b.x - a.x, y: b.y - a.y };
      const denom = dir.x * e.y - dir.y * e.x;
      if (Math.abs(denom) < 1e-12) continue;
      const w = { x: a.x - origin.x, y: a.y - origin.y };
      const t = (w.x * e.y - w.y * e.x) / denom;
      const u = (w.x * dir.y - w.y * dir.x) / denom;
      // Half-open interval on the edge avoids double-counting shared vertices.
      if (u >= 0 && u < 1) ts.push(t);
    }
  }
  ts.sort((a, b) => a - b);
  const out: [Point, Point][] = [];
  for (let i = 0; i + 1 < ts.length; i += 2) {
    const t0 = ts[i];
    const t1 = ts[i + 1];
    if (t1 - t0 < 1e-6) continue;
    out.push([
      { x: origin.x + dir.x * t0, y: origin.y + dir.y * t0 },
      { x: origin.x + dir.x * t1, y: origin.y + dir.y * t1 },
    ]);
  }
  return out;
}

/** Remove the parts of segment ab that fall inside any of the boxes. */
export function subtractBoxesFromSegment(a: Point, b: Point, boxes: Box[]): [Point, Point][] {
  let intervals: [number, number][] = [[0, 1]];
  const d = { x: b.x - a.x, y: b.y - a.y };
  for (const box of boxes) {
    // Liang–Barsky clip of the segment against the box.
    let t0 = 0;
    let t1 = 1;
    const p = [-d.x, d.x, -d.y, d.y];
    const q = [a.x - box.x, box.x + box.w - a.x, a.y - box.y, box.y + box.h - a.y];
    let hit = true;
    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) {
        if (q[i] < 0) {
          hit = false;
          break;
        }
      } else {
        const r = q[i] / p[i];
        if (p[i] < 0) t0 = Math.max(t0, r);
        else t1 = Math.min(t1, r);
      }
    }
    if (!hit || t0 >= t1) continue;
    const next: [number, number][] = [];
    for (const [s, e] of intervals) {
      if (t1 <= s || t0 >= e) {
        next.push([s, e]);
        continue;
      }
      if (t0 > s) next.push([s, t0]);
      if (t1 < e) next.push([t1, e]);
    }
    intervals = next;
  }
  return intervals
    .filter(([s, e]) => e - s > 1e-6)
    .map(([s, e]) => [
      { x: a.x + d.x * s, y: a.y + d.y * s },
      { x: a.x + d.x * e, y: a.y + d.y * e },
    ]);
}

/** Regular polygon helper (used for circles and symbols). */
export function circlePoints(cx: number, cy: number, r: number, n = 48): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return out;
}

/** Ensure the outer ring is clockwise in screen space and holes are counter-clockwise. */
export function orientRings(rings: Point[][]): Point[][] {
  return rings.map((ring, i) => {
    const cw = signedArea(ring) > 0;
    const wantCw = i === 0;
    return cw === wantCw ? ring : [...ring].reverse();
  });
}
