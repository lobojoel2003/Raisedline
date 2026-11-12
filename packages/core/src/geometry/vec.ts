import type { Box, Point } from '../types.js';

export const pt = (x: number, y: number): Point => ({ x, y });
export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Point, s: number): Point => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;
export const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;
export const len = (a: Point): number => Math.hypot(a.x, a.y);
export const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
export const normalize = (a: Point): Point => {
  const l = len(a);
  return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
};
export const perp = (a: Point): Point => ({ x: -a.y, y: a.x });

export function round(n: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function polylineLength(points: Point[], closed = false): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
  if (closed && points.length > 2) total += dist(points[points.length - 1], points[0]);
  return total;
}

export function boundsOf(points: Iterable<Point>): Box | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function unionBox(a: Box | null, b: Box | null): Box | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

export function inflate(b: Box, d: number): Box {
  return { x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d };
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function boxContains(outer: Box, inner: Box, eps = 1e-6): boolean {
  return (
    inner.x >= outer.x - eps &&
    inner.y >= outer.y - eps &&
    inner.x + inner.w <= outer.x + outer.w + eps &&
    inner.y + inner.h <= outer.y + outer.h + eps
  );
}

export function boxCenter(b: Box): Point {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** Gap between two boxes (0 when they touch or overlap). */
export function boxGap(a: Box, b: Box): number {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
  return Math.hypot(dx, dy);
}

/** Closest point on segment ab to p, with its parameter t in [0,1]. */
export function closestOnSegment(p: Point, a: Point, b: Point): { point: Point; t: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 === 0) return { point: a, t: 0 };
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return { point: { x: a.x + ab.x * t, y: a.y + ab.y * t }, t };
}

export function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  return dist(p, closestOnSegment(p, a, b).point);
}

/** Intersection point of segments ab and cd, or null. */
export function segmentIntersection(a: Point, b: Point, c: Point, d: Point): Point | null {
  const r = sub(b, a);
  const s = sub(d, c);
  const denom = cross(r, s);
  if (Math.abs(denom) < 1e-12) return null;
  const qp = sub(c, a);
  const t = cross(qp, s) / denom;
  const u = cross(qp, r) / denom;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { x: a.x + r.x * t, y: a.y + r.y * t };
}

/** Minimum distance between segments ab and cd plus the closest points. */
export function segmentDistance(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
): { distance: number; p: Point; q: Point; intersects: boolean } {
  const hit = segmentIntersection(a, b, c, d);
  if (hit) return { distance: 0, p: hit, q: hit, intersects: true };
  const candidates = [
    { p: a, q: closestOnSegment(a, c, d).point },
    { p: b, q: closestOnSegment(b, c, d).point },
    { p: closestOnSegment(c, a, b).point, q: c },
    { p: closestOnSegment(d, a, b).point, q: d },
  ];
  let best = candidates[0];
  let bestD = dist(best.p, best.q);
  for (let i = 1; i < candidates.length; i++) {
    const dd = dist(candidates[i].p, candidates[i].q);
    if (dd < bestD) {
      bestD = dd;
      best = candidates[i];
    }
  }
  return { distance: bestD, p: best.p, q: best.q, intersects: false };
}

/** Smallest angle (0–90°) between the directions of two segments. */
export function segmentAngle(a: Point, b: Point, c: Point, d: Point): number {
  const u = normalize(sub(b, a));
  const v = normalize(sub(d, c));
  const cos = Math.min(1, Math.abs(dot(u, v)));
  return (Math.acos(cos) * 180) / Math.PI;
}

export function segmentBox(a: Point, b: Point): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

/** Does segment ab touch or cross box b? */
export function segmentIntersectsBox(a: Point, b: Point, box: Box): boolean {
  const inside = (p: Point) =>
    p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h;
  if (inside(a) || inside(b)) return true;
  const c1 = { x: box.x, y: box.y };
  const c2 = { x: box.x + box.w, y: box.y };
  const c3 = { x: box.x + box.w, y: box.y + box.h };
  const c4 = { x: box.x, y: box.y + box.h };
  return (
    !!segmentIntersection(a, b, c1, c2) ||
    !!segmentIntersection(a, b, c2, c3) ||
    !!segmentIntersection(a, b, c3, c4) ||
    !!segmentIntersection(a, b, c4, c1)
  );
}

/** Distance from a segment to a box (0 if they touch). */
export function segmentBoxDistance(a: Point, b: Point, box: Box): number {
  if (segmentIntersectsBox(a, b, box)) return 0;
  const c = [
    { x: box.x, y: box.y },
    { x: box.x + box.w, y: box.y },
    { x: box.x + box.w, y: box.y + box.h },
    { x: box.x, y: box.y + box.h },
  ];
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    best = Math.min(best, segmentDistance(a, b, c[i], c[(i + 1) % 4]).distance);
  }
  return best;
}
