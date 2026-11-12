import type { Point } from '../types.js';

export interface Subpath {
  points: Point[];
  closed: boolean;
}

const NUMBER_RE = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;

function tokenize(d: string): (string | number)[] {
  const tokens: (string | number)[] = [];
  let i = 0;
  let cmd = '';
  let arg = 0;
  while (i < d.length) {
    const ch = d[i];
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(ch)) {
      tokens.push(ch);
      cmd = ch;
      arg = 0;
      i++;
    } else if (/[\s,]/.test(ch)) {
      i++;
    } else if (
      (cmd === 'A' || cmd === 'a') &&
      (arg % 7 === 3 || arg % 7 === 4) &&
      /[01]/.test(ch)
    ) {
      // Arc flags are single characters and may be written without separators ("0 01 5 5").
      tokens.push(ch === '1' ? 1 : 0);
      arg++;
      i++;
    } else {
      NUMBER_RE.lastIndex = i;
      const m = NUMBER_RE.exec(d);
      if (!m) {
        i++;
        continue;
      }
      tokens.push(parseFloat(m[0]));
      arg++;
      i = NUMBER_RE.lastIndex;
    }
  }
  return tokens;
}

function cubicPoints(p0: Point, p1: Point, p2: Point, p3: Point, tol: number): Point[] {
  const chord =
    Math.hypot(p1.x - p0.x, p1.y - p0.y) +
    Math.hypot(p2.x - p1.x, p2.y - p1.y) +
    Math.hypot(p3.x - p2.x, p3.y - p2.y);
  const n = Math.max(2, Math.min(200, Math.ceil(Math.sqrt(chord / Math.max(tol, 1e-3)) * 1.5)));
  const out: Point[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const mt = 1 - t;
    out.push({
      x: mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
      y: mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y,
    });
  }
  return out;
}

function quadPoints(p0: Point, p1: Point, p2: Point, tol: number): Point[] {
  return cubicPoints(
    p0,
    { x: p0.x + (2 / 3) * (p1.x - p0.x), y: p0.y + (2 / 3) * (p1.y - p0.y) },
    { x: p2.x + (2 / 3) * (p1.x - p2.x), y: p2.y + (2 / 3) * (p1.y - p2.y) },
    p2,
    tol,
  );
}

/** SVG elliptical arc → polyline (endpoint to centre parameterisation, SVG spec F.6.5). */
export function arcPoints(
  p0: Point,
  rxIn: number,
  ryIn: number,
  phiDeg: number,
  largeArc: number,
  sweep: number,
  p1: Point,
  tol: number,
): Point[] {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0 || (p0.x === p1.x && p0.y === p1.y)) return [p1];
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (p0.x - p1.x) / 2;
  const dy = (p0.y - p1.y) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (largeArc === sweep) coef = -coef;
  const cx1 = (coef * rx * y1) / ry;
  const cy1 = (-coef * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (p0.x + p1.x) / 2;
  const cy = sin * cx1 + cos * cy1 + (p0.y + p1.y) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const theta1 = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let delta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  else if (sweep && delta < 0) delta += 2 * Math.PI;
  const arcLen = Math.abs(delta) * Math.max(rx, ry);
  const n = Math.max(2, Math.min(360, Math.ceil(Math.sqrt(arcLen / Math.max(tol, 1e-3)) * 2)));
  const out: Point[] = [];
  for (let i = 1; i <= n; i++) {
    const t = theta1 + (delta * i) / n;
    const ex = rx * Math.cos(t);
    const ey = ry * Math.sin(t);
    out.push({ x: cos * ex - sin * ey + cx, y: sin * ex + cos * ey + cy });
  }
  out[out.length - 1] = p1;
  return out;
}

/**
 * Parse SVG path data into flattened subpaths. `tolerance` is the curve flattening tolerance in
 * the path's own units.
 */
export function parsePathData(d: string, tolerance = 0.25): Subpath[] {
  const tokens = tokenize(d);
  const subpaths: Subpath[] = [];
  let current = null as Subpath | null;
  let pos: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  let lastCtrl: Point | null = null;
  let lastCmd = '';
  let i = 0;
  let cmd = '';

  const num = (): number => {
    const t = tokens[i];
    if (typeof t !== 'number') throw new Error('Malformed path data');
    i++;
    return t;
  };
  const begin = (p: Point) => {
    if (current && current.points.length > 1) subpaths.push(current);
    current = { points: [p], closed: false };
    start = p;
  };
  const lineTo = (p: Point) => {
    if (!current) begin(pos);
    current!.points.push(p);
  };

  try {
    while (i < tokens.length) {
      const t = tokens[i];
      if (typeof t === 'string') {
        cmd = t;
        i++;
        if (cmd === 'Z' || cmd === 'z') {
          if (current) {
            current.closed = true;
            subpaths.push(current);
            current = null;
          }
          pos = start;
          lastCtrl = null;
          lastCmd = cmd;
          continue;
        }
      } else if (!cmd) {
        throw new Error('Path data must start with a command');
      }
      const rel = cmd === cmd.toLowerCase();
      const ox = rel ? pos.x : 0;
      const oy = rel ? pos.y : 0;
      switch (cmd.toUpperCase()) {
        case 'M': {
          const p = { x: num() + ox, y: num() + oy };
          begin(p);
          pos = p;
          // Subsequent pairs are implicit line-tos.
          cmd = rel ? 'l' : 'L';
          lastCtrl = null;
          break;
        }
        case 'L': {
          const p = { x: num() + ox, y: num() + oy };
          lineTo(p);
          pos = p;
          lastCtrl = null;
          break;
        }
        case 'H': {
          const p = { x: num() + ox, y: pos.y };
          lineTo(p);
          pos = p;
          lastCtrl = null;
          break;
        }
        case 'V': {
          const p = { x: pos.x, y: num() + oy };
          lineTo(p);
          pos = p;
          lastCtrl = null;
          break;
        }
        case 'C': {
          const c1 = { x: num() + ox, y: num() + oy };
          const c2 = { x: num() + ox, y: num() + oy };
          const p = { x: num() + ox, y: num() + oy };
          for (const q of cubicPoints(pos, c1, c2, p, tolerance)) lineTo(q);
          lastCtrl = c2;
          pos = p;
          break;
        }
        case 'S': {
          const c1: Point =
            lastCtrl && /[CcSs]/.test(lastCmd)
              ? { x: 2 * pos.x - lastCtrl.x, y: 2 * pos.y - lastCtrl.y }
              : pos;
          const c2 = { x: num() + ox, y: num() + oy };
          const p = { x: num() + ox, y: num() + oy };
          for (const q of cubicPoints(pos, c1, c2, p, tolerance)) lineTo(q);
          lastCtrl = c2;
          pos = p;
          break;
        }
        case 'Q': {
          const c = { x: num() + ox, y: num() + oy };
          const p = { x: num() + ox, y: num() + oy };
          for (const q of quadPoints(pos, c, p, tolerance)) lineTo(q);
          lastCtrl = c;
          pos = p;
          break;
        }
        case 'T': {
          const c: Point =
            lastCtrl && /[QqTt]/.test(lastCmd)
              ? { x: 2 * pos.x - lastCtrl.x, y: 2 * pos.y - lastCtrl.y }
              : pos;
          const p = { x: num() + ox, y: num() + oy };
          for (const q of quadPoints(pos, c, p, tolerance)) lineTo(q);
          lastCtrl = c;
          pos = p;
          break;
        }
        case 'A': {
          const rx = num();
          const ry = num();
          const rot = num();
          const large = num();
          const sweep = num();
          const p = { x: num() + ox, y: num() + oy };
          for (const q of arcPoints(pos, rx, ry, rot, large, sweep, p, tolerance)) lineTo(q);
          lastCtrl = null;
          pos = p;
          break;
        }
        default:
          i++;
      }
      lastCmd = cmd;
    }
  } catch {
    // Keep whatever parsed cleanly; browsers do the same with malformed path data.
  }
  const last = current as Subpath | null;
  if (last && last.points.length > 1) subpaths.push(last);
  return subpaths;
}

/** Serialise a polyline to compact SVG path data. */
export function toPathData(points: Point[], closed = false, digits = 2): string {
  if (points.length === 0) return '';
  const f = (n: number) => {
    const s = n.toFixed(digits);
    return s.includes('.') ? s.replace(/\.?0+$/, '') || '0' : s;
  };
  let d = `M${f(points[0].x)} ${f(points[0].y)}`;
  for (let i = 1; i < points.length; i++) d += `L${f(points[i].x)} ${f(points[i].y)}`;
  if (closed) d += 'Z';
  return d;
}
