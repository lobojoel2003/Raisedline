import type { Point } from '../types.js';
import { dist, pointSegmentDistance } from './vec.js';

/** Drop consecutive points closer than `eps`. */
export function dedupe(points: Point[], eps = 1e-6): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    if (out.length === 0 || dist(out[out.length - 1], p) > eps) out.push(p);
  }
  return out;
}

/** Ramer–Douglas–Peucker simplification. */
export function simplifyRDP(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2 || tolerance <= 0) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = pointSegmentDistance(points[i], points[s], points[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > tolerance) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Simplify a closed ring, keeping it closed and non-degenerate. */
export function simplifyRing(ring: Point[], tolerance: number): Point[] {
  if (ring.length < 4) return ring.slice();
  // Split at the vertex farthest from the first one for a stable result.
  let far = 0;
  let farD = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = dist(ring[0], ring[i]);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const a = simplifyRDP(ring.slice(0, far + 1), tolerance);
  const b = simplifyRDP([...ring.slice(far), ring[0]], tolerance);
  const out = [...a.slice(0, -1), ...b.slice(0, -1)];
  return out.length >= 3 ? out : ring.slice();
}

/** Chaikin corner cutting, used to smooth traced lines. */
export function smoothChaikin(points: Point[], iterations = 1, closed = false): Point[] {
  let pts = points;
  for (let k = 0; k < iterations; k++) {
    if (pts.length < 3) return pts;
    const out: Point[] = [];
    const n = pts.length;
    if (!closed) out.push(pts[0]);
    const limit = closed ? n : n - 1;
    for (let i = 0; i < limit; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    if (!closed) out.push(pts[n - 1]);
    pts = out;
  }
  return pts;
}

/** Resample a polyline into points spaced `step` apart along its length. */
export function resample(points: Point[], step: number, closed = false): Point[] {
  const pts = closed && points.length > 2 ? [...points, points[0]] : points;
  if (pts.length === 0) return [];
  const out: Point[] = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const segLen = dist(a, b);
    if (segLen === 0) continue;
    let t = step - carry;
    while (t <= segLen + 1e-9) {
      out.push({ x: a.x + ((b.x - a.x) * t) / segLen, y: a.y + ((b.y - a.y) * t) / segLen });
      t += step;
    }
    carry = segLen - (t - step);
  }
  if (closed && out.length > 1 && dist(out[out.length - 1], out[0]) < step * 0.5) out.pop();
  return out;
}
