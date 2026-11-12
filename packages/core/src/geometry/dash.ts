import type { Point } from '../types.js';
import { dist } from './vec.js';

/**
 * Split a polyline into dashes following `pattern` (alternating on/off lengths, starting "on").
 * Returns the "on" pieces.
 */
export function dashPolyline(points: Point[], pattern: number[], closed = false): Point[][] {
  const pts = closed && points.length > 2 ? [...points, points[0]] : points;
  if (pattern.length === 0 || pts.length < 2) return [pts];
  const pieces: Point[][] = [];
  let idx = 0;
  let remaining = pattern[0];
  let on = true;
  let current: Point[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1];
    const b = pts[i];
    let segLen = dist(a, b);
    while (segLen > 1e-9) {
      if (remaining >= segLen) {
        remaining -= segLen;
        if (on) current.push(b);
        segLen = 0;
      } else {
        const t = remaining / segLen;
        const m = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        if (on) {
          current.push(m);
          if (current.length > 1) pieces.push(current);
        }
        current = [m];
        on = !on;
        idx = (idx + 1) % pattern.length;
        remaining = pattern[idx];
        segLen -= dist(a, m);
        a = m;
      }
    }
  }
  if (on && current.length > 1) pieces.push(current);
  return pieces;
}

/** Points spaced `spacing` apart along a polyline (for dotted lines). Always includes the ends. */
export function dotsAlong(points: Point[], spacing: number, closed = false): Point[] {
  const pts = closed && points.length > 2 ? [...points, points[0]] : points;
  if (pts.length === 0) return [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
  if (total === 0) return [pts[0]];
  const count = Math.max(1, Math.round(total / spacing));
  const step = total / count;
  const out: Point[] = [];
  let target = 0;
  let acc = 0;
  for (let i = 1; i < pts.length && out.length <= count; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const l = dist(a, b);
    while (target <= acc + l + 1e-9 && out.length <= count) {
      const t = l === 0 ? 0 : (target - acc) / l;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      target += step;
    }
    acc += l;
  }
  if (closed && out.length > 1 && dist(out[0], out[out.length - 1]) < step / 2) out.pop();
  return out;
}

/** Like `dashPolyline` but returns both "on" and "off" pieces in order. */
export function dashPieces(
  points: Point[],
  pattern: number[],
  closed = false,
): { on: boolean; points: Point[] }[] {
  const pts = closed && points.length > 2 ? [...points, points[0]] : points;
  if (pattern.length === 0 || pts.length < 2) return [{ on: true, points: pts }];
  const pieces: { on: boolean; points: Point[] }[] = [];
  let idx = 0;
  let remaining = pattern[0];
  let on = true;
  let current: Point[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1];
    const b = pts[i];
    let segLen = dist(a, b);
    while (segLen > 1e-9) {
      if (remaining >= segLen) {
        remaining -= segLen;
        current.push(b);
        segLen = 0;
      } else {
        const t = remaining / segLen;
        const m = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        current.push(m);
        if (current.length > 1) pieces.push({ on, points: current });
        current = [m];
        on = !on;
        idx = (idx + 1) % pattern.length;
        remaining = pattern[idx];
        segLen -= dist(a, m);
        a = m;
      }
    }
  }
  if (current.length > 1) pieces.push({ on, points: current });
  return pieces;
}
