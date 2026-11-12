import type { BrailleTranslator } from '../braille/translator.js';
import { uebGrade1 } from '../braille/translator.js';
import { DEFAULT_PAGE, LINE_WEIGHTS } from '../config.js';
import { createDocument, layoutKey, measureKey } from '../document.js';
import { polygonArea, ringArea } from '../geometry/polygon.js';
import { simplifyRDP, simplifyRing, smoothChaikin } from '../geometry/simplify.js';
import { polylineLength } from '../geometry/vec.js';
import { brailleSize, makeLabel } from '../layout/labels.js';
import { escapeXml } from '../render/svg.js';
import { TEXTURE_ORDER } from '../styles.js';
import type {
  BrailleSettings,
  BuildResult,
  KeyEntry,
  PageSpec,
  Point,
  TactileElement,
} from '../types.js';
import { colorName, toHex } from './color.js';

/** Raw RGBA pixels (e.g. from canvas `getImageData`, pngjs or jpeg-js). */
export interface RasterImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

export type TraceMode = 'auto' | 'lines' | 'outlines' | 'regions';

export interface TraceOptions {
  title?: string;
  page?: PageSpec;
  translator?: BrailleTranslator;
  braille?: Partial<BrailleSettings>;
  /**
   * `lines` follows the centre of drawn strokes, `outlines` traces the edges of dark shapes,
   * `regions` separates colour regions into textures, `auto` mixes lines and outlines.
   */
  mode?: TraceMode;
  /** 0–255 darkness threshold; default picks one automatically (Otsu). */
  threshold?: number;
  /** Trace light shapes on a dark background. */
  invert?: boolean;
  /** Blur radius in pixels before thresholding (default 1). */
  smoothing?: number;
  /** Remove detail smaller than this many mm (default 0.6). */
  simplify?: number;
  /** Number of colour regions for `regions` mode (default 4). */
  colors?: number;
  /** Largest working resolution in pixels (default 900). */
  maxSize?: number;
  /** Optional href (e.g. data URL) of the original image for the sighted view. */
  imageHref?: string;
}

// ---------------------------------------------------------------------------------------
// Raster helpers
// ---------------------------------------------------------------------------------------

export interface Gray {
  w: number;
  h: number;
  v: Float32Array;
}

function downscale(img: RasterImage, maxSize: number): RasterImage {
  const f = Math.max(img.width, img.height) / maxSize;
  if (f <= 1) return img;
  const w = Math.max(1, Math.round(img.width / f));
  const h = Math.max(1, Math.round(img.height / f));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * f);
    const y1 = Math.min(img.height, Math.max(y0 + 1, Math.floor((y + 1) * f)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * f);
      const x1 = Math.min(img.width, Math.max(x0 + 1, Math.floor((x + 1) * f)));
      let r = 0,
        g = 0,
        b = 0,
        a = 0,
        n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * img.width + xx) * 4;
          r += img.data[i];
          g += img.data[i + 1];
          b += img.data[i + 2];
          a += img.data[i + 3];
          n++;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = a / n;
    }
  }
  return { width: w, height: h, data: out };
}

function toGray(img: RasterImage): Gray {
  const v = new Float32Array(img.width * img.height);
  for (let i = 0; i < v.length; i++) {
    const a = img.data[i * 4 + 3] / 255;
    const l = 0.299 * img.data[i * 4] + 0.587 * img.data[i * 4 + 1] + 0.114 * img.data[i * 4 + 2];
    v[i] = l * a + 255 * (1 - a); // composite on white paper
  }
  return { w: img.width, h: img.height, v };
}

export function gaussianBlur(g: Gray, sigma: number): Gray {
  if (sigma <= 0) return g;
  const r = Math.ceil(sigma * 2.5);
  const k: number[] = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const e = Math.exp(-(i * i) / (2 * sigma * sigma));
    k.push(e);
    sum += e;
  }
  const kn = k.map((e) => e / sum);
  const tmp = new Float32Array(g.v.length);
  const out = new Float32Array(g.v.length);
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++)
        acc += g.v[y * g.w + Math.min(g.w - 1, Math.max(0, x + i))] * kn[i + r];
      tmp[y * g.w + x] = acc;
    }
  }
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++)
        acc += tmp[Math.min(g.h - 1, Math.max(0, y + i)) * g.w + x] * kn[i + r];
      out[y * g.w + x] = acc;
    }
  }
  return { w: g.w, h: g.h, v: out };
}

/** Otsu's automatic threshold. */
export function otsuThreshold(g: Gray): number {
  const hist = new Array(256).fill(0);
  for (const v of g.v) hist[Math.max(0, Math.min(255, Math.round(v)))]++;
  const total = g.v.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

export type Mask = { w: number; h: number; m: Uint8Array };

function morph(mask: Mask, dilate: boolean): Mask {
  const { w, h, m } = mask;
  const out = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = dilate ? 0 : 1;
      for (let dy = -1; dy <= 1 && v === (dilate ? 0 : 1); dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          const p = xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : m[yy * w + xx];
          if (dilate && p) {
            v = 1;
            break;
          }
          if (!dilate && !p) {
            v = 0;
            break;
          }
        }
      }
      out[y * w + x] = v;
    }
  }
  return { w, h, m: out };
}

/** Connected components (8-connected). Returns labels and component pixel counts. */
function components(mask: Mask): { labels: Int32Array; sizes: number[] } {
  const { w, h, m } = mask;
  const labels = new Int32Array(m.length).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let i = 0; i < m.length; i++) {
    if (!m[i] || labels[i] >= 0) continue;
    const id = sizes.length;
    let count = 0;
    stack.push(i);
    labels[i] = id;
    while (stack.length) {
      const p = stack.pop()!;
      count++;
      const x = p % w;
      const y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const q = yy * w + xx;
          if (m[q] && labels[q] < 0) {
            labels[q] = id;
            stack.push(q);
          }
        }
      }
    }
    sizes.push(count);
  }
  return { labels, sizes };
}

/** Chamfer (3-4) distance to the nearest background pixel, in pixels. */
function distanceTransform(mask: Mask): Float32Array {
  const { w, h, m } = mask;
  const INF = 1e9;
  const d = new Float32Array(m.length);
  for (let i = 0; i < m.length; i++) d[i] = m[i] ? INF : 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(
        d[i],
        at(x - 1, y) + 3,
        at(x, y - 1) + 3,
        at(x - 1, y - 1) + 4,
        at(x + 1, y - 1) + 4,
      );
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(
        d[i],
        at(x + 1, y) + 3,
        at(x, y + 1) + 3,
        at(x + 1, y + 1) + 4,
        at(x - 1, y + 1) + 4,
      );
    }
  }
  for (let i = 0; i < d.length; i++) d[i] /= 3;
  return d;
}

/** Zhang–Suen thinning to a one-pixel skeleton. */
export function thin(mask: Mask): Mask {
  const { w, h } = mask;
  const m = mask.m.slice();
  const get = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : m[y * w + x]);
  let changed = true;
  const del: number[] = [];
  let guard = 0;
  while (changed && guard++ < 200) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      del.length = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!m[y * w + x]) continue;
          const p2 = get(x, y - 1),
            p3 = get(x + 1, y - 1),
            p4 = get(x + 1, y),
            p5 = get(x + 1, y + 1);
          const p6 = get(x, y + 1),
            p7 = get(x - 1, y + 1),
            p8 = get(x - 1, y),
            p9 = get(x - 1, y - 1);
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (b < 2 || b > 6) continue;
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
          let a = 0;
          for (let i = 0; i < 8; i++) if (!seq[i] && seq[i + 1]) a++;
          if (a !== 1) continue;
          if (
            pass === 0
              ? p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0
              : p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0
          )
            continue;
          del.push(y * w + x);
        }
      }
      if (del.length) changed = true;
      for (const i of del) m[i] = 0;
    }
  }
  removeStaircases({ w, h, m });
  return { w, h, m };
}

/**
 * Remove "staircase" pixels: skeleton pixels whose neighbours stay connected without them.
 * This leaves a strictly 8-connected one-pixel skeleton, so every ordinary path pixel has
 * exactly two neighbours and lines trace as single strokes.
 */
function removeStaircases(mask: Mask): void {
  const { w, h, m } = mask;
  const ring: [number, number][] = [
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
  ];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      const set: number[] = [];
      for (let k = 0; k < 8; k++) {
        const xx = x + ring[k][0];
        const yy = y + ring[k][1];
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && m[yy * w + xx]) set.push(k);
      }
      if (set.length < 2) continue; // keep endpoints and isolated pixels
      // Union neighbours that touch each other (8-adjacency between ring positions).
      const parent = set.map((_, i) => i);
      const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
      for (let a = 0; a < set.length; a++) {
        for (let b = a + 1; b < set.length; b++) {
          const pa = ring[set[a]];
          const pb = ring[set[b]];
          if (Math.abs(pa[0] - pb[0]) <= 1 && Math.abs(pa[1] - pb[1]) <= 1)
            parent[find(a)] = find(b);
        }
      }
      const groups = new Set(set.map((_, i) => find(i))).size;
      if (groups === 1 && set.length <= 3) m[y * w + x] = 0;
    }
  }
}

const N8: [number, number][] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

/** Follow a skeleton into polylines (pixel coordinates). */
export function traceSkeleton(sk: Mask, pruneLength = 6): Point[][] {
  const { w, h, m } = sk;
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && m[y * w + x] === 1;
  const degree = (x: number, y: number) =>
    N8.reduce((n, [dx, dy]) => n + (on(x + dx, y + dy) ? 1 : 0), 0);
  const visitedEdge = new Set<string>();
  const ek = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  const lines: Point[][] = [];
  const isNode = (x: number, y: number) => degree(x, y) !== 2;
  const walk = (sx: number, sy: number, nx: number, ny: number): Point[] => {
    const pts: Point[] = [{ x: sx, y: sy }];
    let px = sx;
    let py = sy;
    let cx = nx;
    let cy = ny;
    visitedEdge.add(ek(py * w + px, cy * w + cx));
    for (let guard = 0; guard < w * h; guard++) {
      pts.push({ x: cx, y: cy });
      if ((cx === sx && cy === sy) || isNode(cx, cy)) break;
      let moved = false;
      for (const [dx, dy] of N8) {
        const qx = cx + dx;
        const qy = cy + dy;
        if (!on(qx, qy) || (qx === px && qy === py)) continue;
        const e = ek(cy * w + cx, qy * w + qx);
        if (visitedEdge.has(e)) continue;
        visitedEdge.add(e);
        px = cx;
        py = cy;
        cx = qx;
        cy = qy;
        moved = true;
        break;
      }
      if (!moved) break;
    }
    return pts;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!on(x, y) || !isNode(x, y)) continue;
      for (const [dx, dy] of N8) {
        const nx = x + dx;
        const ny = y + dy;
        if (!on(nx, ny) || visitedEdge.has(ek(y * w + x, ny * w + nx))) continue;
        lines.push(walk(x, y, nx, ny));
      }
    }
  }
  // Closed loops have no nodes: start anywhere unvisited.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!on(x, y)) continue;
      for (const [dx, dy] of N8) {
        const nx = x + dx;
        const ny = y + dy;
        if (!on(nx, ny) || visitedEdge.has(ek(y * w + x, ny * w + nx))) continue;
        lines.push(walk(x, y, nx, ny));
      }
    }
  }
  // Prune short spurs that end in an endpoint, then re-join fragments split at staircases.
  const pruned = lines.filter((pts) => {
    const len = polylineLength(pts);
    if (len >= pruneLength) return true;
    const a = pts[0];
    const b = pts[pts.length - 1];
    return !(degree(a.x, a.y) === 1 || degree(b.x, b.y) === 1) && len > 1.5;
  });
  return mergePolylines(pruned, 1.5);
}

/** Join polylines whose ends meet where exactly two ends touch. */
export function mergePolylines(lines: Point[][], tol: number): Point[][] {
  let work = lines.map((l) => l.slice());
  let changed = true;
  let guard = 0;
  const near = (a: Point, b: Point) => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;
  while (changed && guard++ < 50) {
    changed = false;
    const ends: { line: number; start: boolean; p: Point }[] = [];
    work.forEach((l, i) => {
      if (l.length < 2) return;
      const closed = near(l[0], l[l.length - 1]) && l.length > 3;
      if (closed) return;
      ends.push({ line: i, start: true, p: l[0] }, { line: i, start: false, p: l[l.length - 1] });
    });
    const grid = new Map<string, number[]>();
    const cell = (p: Point) => `${Math.round(p.x / (tol * 2))},${Math.round(p.y / (tol * 2))}`;
    ends.forEach((e, i) => {
      for (const dx of [-1, 0, 1]) {
        for (const dy of [-1, 0, 1]) {
          const k = `${Math.round(e.p.x / (tol * 2)) + dx},${Math.round(e.p.y / (tol * 2)) + dy}`;
          const list = grid.get(k) ?? [];
          list.push(i);
          grid.set(k, list);
        }
      }
    });
    const used = new Set<number>();
    for (let i = 0; i < ends.length; i++) {
      const e = ends[i];
      if (used.has(e.line)) continue;
      const cands = (grid.get(cell(e.p)) ?? []).filter((j) => j !== i && near(ends[j].p, e.p));
      const others = cands.filter((j) => ends[j].line !== e.line);
      if (cands.length !== 1 || others.length !== 1) continue;
      const o = ends[others[0]];
      if (used.has(o.line)) continue;
      const a = e.start ? work[e.line].slice().reverse() : work[e.line];
      const b = o.start ? work[o.line] : work[o.line].slice().reverse();
      work[e.line] = [...a, ...b.slice(1)];
      work[o.line] = [];
      used.add(e.line);
      used.add(o.line);
      changed = true;
    }
    work = work.filter((l) => l.length >= 2);
  }
  return work;
}

/** Marching-squares outlines of a mask (pixel coordinates, closed rings). */
export function traceContours(mask: Mask): Point[][] {
  const { w, h, m } = mask;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : m[y * w + x]);
  // Edge ids: horizontal edge h(x,y) joins pixel centres (x,y)-(x+1,y); vertical v(x,y) joins (x,y)-(x,y+1).
  const adj = new Map<number, number[]>();
  const W = w + 2;
  const hid = (x: number, y: number) => ((y + 1) * W + (x + 1)) * 2;
  const vid = (x: number, y: number) => ((y + 1) * W + (x + 1)) * 2 + 1;
  const posOf = (id: number): Point => {
    const vert = id & 1;
    const cellIdx = id >> 1;
    const x = (cellIdx % W) - 1;
    const y = Math.floor(cellIdx / W) - 1;
    return vert ? { x: x + 0.5, y: y + 1 } : { x: x + 1, y: y + 0.5 };
  };
  const link = (a: number, b: number) => {
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
  };
  for (let y = -1; y < h; y++) {
    for (let x = -1; x < w; x++) {
      const c = (at(x, y) << 3) | (at(x + 1, y) << 2) | (at(x + 1, y + 1) << 1) | at(x, y + 1);
      if (c === 0 || c === 15) continue;
      const T = hid(x, y);
      const B = hid(x, y + 1);
      const L = vid(x, y);
      const R = vid(x + 1, y);
      switch (c) {
        case 1:
        case 14:
          link(L, B);
          break;
        case 2:
        case 13:
          link(B, R);
          break;
        case 3:
        case 12:
          link(L, R);
          break;
        case 4:
        case 11:
          link(T, R);
          break;
        case 6:
        case 9:
          link(T, B);
          break;
        case 7:
        case 8:
          link(L, T);
          break;
        case 5:
          link(L, T);
          link(B, R);
          break;
        case 10:
          link(T, R);
          link(L, B);
          break;
      }
    }
  }
  const rings: Point[][] = [];
  const seen = new Set<number>();
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const ring: Point[] = [];
    let prev = -1;
    let cur = start;
    for (let guard = 0; guard < 1e7; guard++) {
      seen.add(cur);
      ring.push(posOf(cur));
      const nb = adj.get(cur)!;
      const nxt = nb[0] !== prev ? nb[0] : nb[1];
      if (nxt === undefined || nxt === start) break;
      if (seen.has(nxt)) break;
      prev = cur;
      cur = nxt;
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}

// ---------------------------------------------------------------------------------------
// Colour quantisation for regions mode
// ---------------------------------------------------------------------------------------

function kmeans(img: RasterImage, k: number): { centers: number[][]; assign: Uint8Array } {
  const n = img.width * img.height;
  const px = (i: number) => {
    const a = img.data[i * 4 + 3] / 255;
    return [
      img.data[i * 4] * a + 255 * (1 - a),
      img.data[i * 4 + 1] * a + 255 * (1 - a),
      img.data[i * 4 + 2] * a + 255 * (1 - a),
    ];
  };
  // Deterministic k-means++-style seeding on a sample.
  const sample: number[][] = [];
  const stride = Math.max(1, Math.floor(n / 4000));
  for (let i = 0; i < n; i += stride) sample.push(px(i));
  const centers: number[][] = [sample[0]];
  while (centers.length < k) {
    let best = sample[0];
    let bestD = -1;
    for (const s of sample) {
      const d = Math.min(
        ...centers.map((c) => (c[0] - s[0]) ** 2 + (c[1] - s[1]) ** 2 + (c[2] - s[2]) ** 2),
      );
      if (d > bestD) {
        bestD = d;
        best = s;
      }
    }
    centers.push(best.slice());
  }
  const assign = new Uint8Array(n);
  for (let iter = 0; iter < 12; iter++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      const p = px(i);
      let bi = 0;
      let bd = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d =
          (centers[c][0] - p[0]) ** 2 + (centers[c][1] - p[1]) ** 2 + (centers[c][2] - p[2]) ** 2;
        if (d < bd) {
          bd = d;
          bi = c;
        }
      }
      assign[i] = bi;
      sums[bi][0] += p[0];
      sums[bi][1] += p[1];
      sums[bi][2] += p[2];
      sums[bi][3]++;
    }
    for (let c = 0; c < centers.length; c++) {
      if (sums[c][3])
        centers[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]];
    }
  }
  return { centers, assign };
}

// ---------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------

/** Trace a raster image (scan, photo of a diagram, screenshot) into a tactile graphic. */
export function traceImage(image: RasterImage, opts: TraceOptions = {}): BuildResult {
  if (!image.width || !image.height || image.data.length < image.width * image.height * 4) {
    throw new Error('Image data is empty or not RGBA');
  }
  const translator = opts.translator ?? uebGrade1;
  const page = opts.page ?? DEFAULT_PAGE;
  const mode = opts.mode ?? 'auto';
  const notes: string[] = [];
  const title = opts.title ?? 'Traced image';
  const doc = createDocument({
    title,
    source: 'image',
    page,
    braille: { table: translator.id, ...opts.braille },
  });
  const m = doc.braille.metrics;
  const titleLabel = makeLabel(
    {
      id: 'title',
      text: title,
      at: { x: page.margin, y: page.margin },
      maxWidth: page.width - 2 * page.margin,
      role: 'title',
      sourceId: 'title',
    },
    translator,
    m,
  );
  const top = page.margin + brailleSize(titleLabel.braille, m).h + 6;
  const img = downscale(image, opts.maxSize ?? 900);
  const avail = {
    x: page.margin + 2,
    y: top + 2,
    w: page.width - 2 * page.margin - 4,
    h: page.height - page.margin - top - 4,
  };
  const key: KeyEntry[] = [];
  const keyReserve =
    mode === 'regions' ? Math.min(avail.h * 0.25, 18 * Math.min(6, opts.colors ?? 4)) : 0;
  const fitH = avail.h - keyReserve;
  const scale = Math.min(avail.w / img.width, fitH / img.height);
  const ox = avail.x + (avail.w - img.width * scale) / 2;
  const oy = avail.y + (fitH - img.height * scale) / 2;
  const P = (p: Point): Point => ({ x: ox + p.x * scale, y: oy + p.y * scale });
  const tol = opts.simplify ?? 0.6;
  const elements: TactileElement[] = [titleLabel];
  let lineCount = 0;
  let areaCount = 0;

  const addLine = (pxPts: Point[], closed: boolean) => {
    let pts = pxPts.map(P);
    pts = closed ? simplifyRing(pts, tol) : simplifyRDP(pts, tol);
    pts = smoothChaikin(pts, 1, closed);
    if (polylineLength(pts, closed) < 3) return;
    elements.push({
      kind: 'line',
      id: `trace-line-${++lineCount}`,
      role: 'feature',
      name: `Traced line ${lineCount}`,
      points: pts,
      closed,
      width: LINE_WEIGHTS.medium,
      style: 'solid',
    });
  };

  if (mode === 'regions') {
    const k = Math.max(2, Math.min(7, opts.colors ?? 4));
    const { centers, assign } = kmeans(img, k + 1);
    // The lightest cluster is paper.
    const lum = centers.map((c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]);
    const paper = lum.indexOf(Math.max(...lum));
    const order = centers
      .map((_, i) => i)
      .filter((i) => i !== paper)
      .map((i) => ({ i, count: assign.reduce((n, a) => n + (a === i ? 1 : 0), 0) }))
      .sort((a, b) => b.count - a.count);
    order.forEach(({ i }, rank) => {
      let mask: Mask = { w: img.width, h: img.height, m: new Uint8Array(assign.length) };
      for (let p = 0; p < assign.length; p++) mask.m[p] = assign[p] === i ? 1 : 0;
      mask = morph(morph(mask, false), true); // open: drop specks
      const texture = TEXTURE_ORDER[rank % TEXTURE_ORDER.length];
      const color = { r: centers[i][0], g: centers[i][1], b: centers[i][2], a: 1 };
      const rings = traceContours(mask)
        .map((r) => simplifyRing(r.map(P), tol))
        .filter((r) => r.length >= 3 && ringArea(r) > 20);
      if (!rings.length) return;
      // Group rings into polygons: largest rings are outers, contained rings become holes.
      rings.sort((a, b) => ringArea(b) - ringArea(a));
      const polys: Point[][][] = [];
      for (const r of rings) {
        const host = polys.find((poly) => contains(poly[0], r[0]));
        if (host && host.length === 1) host.push(r);
        else if (!host) polys.push([r]);
        else host.push(r);
      }
      for (const poly of polys) {
        if (polygonArea(poly) < 30) continue;
        elements.push({
          kind: 'area',
          id: `region-${++areaCount}`,
          role: 'feature',
          name: `${colorName(color)} region`,
          rings: poly,
          texture,
          outline: { width: LINE_WEIGHTS.medium, style: 'solid' },
        });
      }
      key.push({
        swatch: { kind: 'texture', texture },
        text: `${colorName(color)} (${toHex(color)}) in the original`,
      });
    });
  } else {
    let g = toGray(img);
    g = gaussianBlur(g, opts.smoothing ?? 1);
    const t = opts.threshold ?? otsuThreshold(g);
    let mask: Mask = { w: g.w, h: g.h, m: new Uint8Array(g.v.length) };
    for (let i = 0; i < g.v.length; i++)
      mask.m[i] = (opts.invert ? g.v[i] > t : g.v[i] < t) ? 1 : 0;
    mask = morph(morph(mask, true), false); // close small gaps
    const comp = components(mask);
    const minPx = Math.max(6, (1.5 / scale) ** 2); // ignore specks under ~1.5 mm
    const dt = distanceTransform(mask);
    const thickness = new Float32Array(comp.sizes.length);
    for (let i = 0; i < dt.length; i++) {
      const l = comp.labels[i];
      if (l >= 0 && dt[i] > thickness[l]) thickness[l] = dt[i];
    }
    const solidPx = 2.2 / scale; // strokes thicker than ~4.4 mm become filled shapes
    const lineMask: Mask = { w: mask.w, h: mask.h, m: new Uint8Array(mask.m.length) };
    const fillMask: Mask = { w: mask.w, h: mask.h, m: new Uint8Array(mask.m.length) };
    let removed = 0;
    for (let i = 0; i < mask.m.length; i++) {
      const l = comp.labels[i];
      if (l < 0) continue;
      if (comp.sizes[l] < minPx) {
        if (mask.m[i]) removed++;
        continue;
      }
      const solid = mode === 'outlines' || (mode === 'auto' && thickness[l] > solidPx);
      (solid ? fillMask : lineMask).m[i] = 1;
    }
    if (removed) notes.push('Specks too small to feel were removed.');
    if (fillMask.m.some((v) => v)) {
      const rings = traceContours(fillMask)
        .map((r) => simplifyRing(r.map(P), tol))
        .filter((r) => r.length >= 3 && ringArea(r) > 12);
      rings.sort((a, b) => ringArea(b) - ringArea(a));
      const polys: Point[][][] = [];
      for (const r of rings) {
        const host = polys.find((poly) => contains(poly[0], r[0]));
        if (host) host.push(r);
        else polys.push([r]);
      }
      for (const poly of polys) {
        elements.push({
          kind: 'area',
          id: `shape-${++areaCount}`,
          role: 'feature',
          name: `Traced shape ${areaCount}`,
          rings: poly,
          texture: mode === 'outlines' ? 'none' : 'solid',
          outline: { width: LINE_WEIGHTS.medium, style: 'solid' },
        });
      }
    }
    if (lineMask.m.some((v) => v)) {
      const sk = thin(lineMask);
      for (const pts of traceSkeleton(sk, Math.max(4, 2 / scale))) {
        const closed =
          pts.length > 3 &&
          pts[0].x === pts[pts.length - 1].x &&
          pts[0].y === pts[pts.length - 1].y;
        addLine(closed ? pts.slice(0, -1) : pts, closed);
      }
    }
  }
  if (elements.length === 1)
    notes.push('Nothing was traced: try another mode, threshold or the invert option.');

  if (key.length) {
    const kh = measureKey(key, page.width - 2 * page.margin, translator, doc);
    const kTop = page.height - page.margin - kh;
    elements.push(
      ...layoutKey(key, { x: page.margin, y: kTop }, page.width - 2 * page.margin, translator, doc)
        .elements,
    );
  }
  doc.pages[0].elements = elements;
  doc.key = key;
  doc.description = `Traced from a ${image.width} × ${image.height} pixel image (${mode} mode): ${lineCount} line${lineCount === 1 ? '' : 's'} and ${areaCount} shape${areaCount === 1 ? '' : 's'}.`;
  const href = opts.imageHref;
  const sighted =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}mm" height="${page.height}mm" viewBox="0 0 ${page.width} ${page.height}" role="img" aria-label="${escapeXml(title)}">` +
    `<rect width="${page.width}" height="${page.height}" fill="#fff"/>` +
    `<text data-rl-id="title" x="${page.margin}" y="${page.margin + 6}" font-size="6" font-weight="600" font-family="system-ui, sans-serif" fill="#1d1d1f">${escapeXml(title)}</text>` +
    (href
      ? `<image href="${escapeXml(href)}" x="${ox.toFixed(2)}" y="${oy.toFixed(2)}" width="${(img.width * scale).toFixed(2)}" height="${(img.height * scale).toFixed(2)}" preserveAspectRatio="none"/>`
      : `<rect x="${ox.toFixed(2)}" y="${oy.toFixed(2)}" width="${(img.width * scale).toFixed(2)}" height="${(img.height * scale).toFixed(2)}" fill="#f2f2f2" stroke="#ccc"/>`) +
    '</svg>';
  return { sighted, tactile: doc, notes };
}

function contains(ring: Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}
