import earcut from 'earcut';
import { circlePoints } from '../geometry/polygon.js';
import { dist } from '../geometry/vec.js';
import { pagePrimitives } from '../render/primitives.js';
import type { Point, Primitive, TactileDocument } from '../types.js';
import { VERSION } from '../version.js';

export interface StlOptions {
  page?: number;
  /** Base plate thickness (mm). 0 disables the plate. */
  baseThickness?: number;
  /** Height of lines, outlines and symbols above the plate (mm). */
  lineHeight?: number;
  /** Height of area textures (mm); lower than lines so outlines stand out. */
  textureHeight?: number;
  /** Height of braille dots (mm); defaults to the document's braille metrics. */
  brailleHeight?: number;
  /** Cut the top-right corner of the plate so the reader can orient the page (mm, 0 = off). */
  cornerCut?: number;
  /** Uniform scale factor applied to the whole plate (e.g. to fit a printer bed). */
  scale?: number;
  /** Facets used for round dots and joints. */
  segments?: number;
}

type V3 = [number, number, number];

class MeshWriter {
  tris: number[] = [];
  count = 0;

  tri(a: V3, b: V3, c: V3) {
    this.tris.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.count++;
  }

  /** Closed prism from a polygon (outer ring CCW in y-up space, holes CW). */
  prism(rings: Point[][], z0: number, z1: number) {
    const fixed = rings
      .map((r) => dedupeRing(r))
      .filter((r) => r.length >= 3)
      .map((r, i) => {
        const ccw = shoelace(r) > 0;
        return (i === 0) === ccw ? r : [...r].reverse();
      });
    if (fixed.length === 0) return;
    const flat: number[] = [];
    const holes: number[] = [];
    fixed.forEach((r, i) => {
      if (i > 0) holes.push(flat.length / 2);
      for (const p of r) flat.push(p.x, p.y);
    });
    const idx = earcut(flat, holes.length ? holes : undefined, 2);
    const pt = (i: number, z: number): V3 => [flat[2 * i], flat[2 * i + 1], z];
    for (let k = 0; k < idx.length; k += 3) {
      const a = idx[k];
      let b = idx[k + 1];
      let c = idx[k + 2];
      const area =
        (flat[2 * b] - flat[2 * a]) * (flat[2 * c + 1] - flat[2 * a + 1]) -
        (flat[2 * c] - flat[2 * a]) * (flat[2 * b + 1] - flat[2 * a + 1]);
      if (area < 0) [b, c] = [c, b];
      this.tri(pt(a, z1), pt(b, z1), pt(c, z1));
      this.tri(pt(a, z0), pt(c, z0), pt(b, z0));
    }
    for (const r of fixed) {
      for (let i = 0; i < r.length; i++) {
        const a = r[i];
        const b = r[(i + 1) % r.length];
        this.tri([a.x, a.y, z0], [b.x, b.y, z0], [b.x, b.y, z1]);
        this.tri([a.x, a.y, z0], [b.x, b.y, z1], [a.x, a.y, z1]);
      }
    }
  }

  /** Rounded dot: a short cylinder topped with a spherical-cap profile. */
  dome(cx: number, cy: number, r: number, z0: number, h: number, n: number) {
    const profile: [number, number][] = [
      [r, z0],
      [r, z0 + h * 0.25],
      [r * 0.82, z0 + h * 0.68],
      [r * 0.45, z0 + h * 0.93],
    ];
    const ring = (rr: number) =>
      Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2;
        return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)] as const;
      });
    const rings = profile.map(([rr, z]) => ring(rr).map(([x, y]) => [x, y, z] as V3));
    for (let i = 1; i < n - 1; i++) this.tri(rings[0][0], rings[0][i + 1], rings[0][i]);
    for (let k = 0; k + 1 < rings.length; k++) {
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        this.tri(rings[k][i], rings[k][j], rings[k + 1][j]);
        this.tri(rings[k][i], rings[k + 1][j], rings[k + 1][i]);
      }
    }
    const top = rings[rings.length - 1];
    const apex: V3 = [cx, cy, z0 + h];
    for (let i = 0; i < n; i++) this.tri(top[i], top[(i + 1) % n], apex);
  }

  toBinary(header: string): Uint8Array<ArrayBuffer> {
    const buf = new ArrayBuffer(84 + this.count * 50);
    const view = new DataView(buf);
    const enc = new TextEncoder().encode(header.slice(0, 80));
    new Uint8Array(buf, 0, 80).set(enc);
    view.setUint32(80, this.count, true);
    let off = 84;
    const t = this.tris;
    for (let i = 0; i < this.count; i++) {
      const o = i * 9;
      const ux = t[o + 3] - t[o];
      const uy = t[o + 4] - t[o + 1];
      const uz = t[o + 5] - t[o + 2];
      const vx = t[o + 6] - t[o];
      const vy = t[o + 7] - t[o + 1];
      const vz = t[o + 8] - t[o + 2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      view.setFloat32(off, nx, true);
      view.setFloat32(off + 4, ny, true);
      view.setFloat32(off + 8, nz, true);
      for (let k = 0; k < 9; k++) view.setFloat32(off + 12 + k * 4, t[o + k], true);
      view.setUint16(off + 48, 0, true);
      off += 50;
    }
    return new Uint8Array(buf);
  }
}

function shoelace(r: Point[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i];
    const q = r[(i + 1) % r.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function dedupeRing(r: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of r) if (!out.length || dist(out[out.length - 1], p) > 1e-4) out.push(p);
  while (out.length > 1 && dist(out[0], out[out.length - 1]) < 1e-4) out.pop();
  return out;
}

function segmentBox(a: Point, b: Point, w: number): Point[] {
  const l = dist(a, b) || 1;
  const nx = (-(b.y - a.y) / l) * (w / 2);
  const ny = ((b.x - a.x) / l) * (w / 2);
  return [
    { x: a.x + nx, y: a.y + ny },
    { x: a.x - nx, y: a.y - ny },
    { x: b.x - nx, y: b.y - ny },
    { x: b.x + nx, y: b.y + ny },
  ];
}

/**
 * Export a page as a binary STL relief: a base plate with raised lines, textures, symbols and
 * domed braille dots, ready for slicing. Units are millimetres.
 */
export function exportStl(doc: TactileDocument, opts: StlOptions = {}): Uint8Array<ArrayBuffer> {
  const page = opts.page ?? 0;
  const base = opts.baseThickness ?? 1.6;
  const lineH = opts.lineHeight ?? 1.0;
  const texH = opts.textureHeight ?? 0.55;
  const brailleH = opts.brailleHeight ?? doc.braille.metrics.dotHeight;
  const cut = opts.cornerCut ?? 8;
  const s = opts.scale ?? 1;
  const n = Math.max(6, opts.segments ?? 10);
  const W = doc.page.width;
  const H = doc.page.height;
  const z0 = base > 0 ? base - 0.05 : 0;
  const zTop = base > 0 ? base : 0;
  // Page coordinates (y down) → STL coordinates (y up), scaled.
  const P = (p: Point): Point => ({ x: p.x * s, y: (H - p.y) * s });
  const mesh = new MeshWriter();

  if (base > 0) {
    const c = Math.min(cut, W / 4, H / 4) * s;
    const plate: Point[] = [
      { x: 0, y: 0 },
      { x: W * s, y: 0 },
      { x: W * s, y: H * s - c },
      { x: W * s - c, y: H * s },
      { x: 0, y: H * s },
    ];
    mesh.prism([plate], 0, base);
  }

  const heightOf = (p: Primitive) => (p.texture ? texH : lineH);
  for (const p of pagePrimitives(doc, page)) {
    const h = heightOf(p);
    if (p.type === 'dot') {
      const c = P({ x: p.x, y: p.y });
      if (p.braille) mesh.dome(c.x, c.y, p.r * s, z0, brailleH + (zTop - z0), n);
      else
        mesh.dome(
          c.x,
          c.y,
          p.r * s,
          z0,
          Math.max(h * 0.8, p.r * 0.9 * s) + (zTop - z0),
          Math.max(6, n - 2),
        );
    } else if (p.type === 'fill') {
      mesh.prism(
        p.rings.map((r) => r.map(P)),
        z0,
        zTop + h,
      );
    } else {
      const pts = p.closed ? [...p.points, p.points[0]] : p.points;
      const w = p.width * s;
      const sp = pts.map(P);
      for (let i = 1; i < sp.length; i++) {
        if (dist(sp[i - 1], sp[i]) < 1e-4) continue;
        mesh.prism([segmentBox(sp[i - 1], sp[i], w)], z0, zTop + h);
      }
      // Round joints and caps keep corners solid and feel smooth under the finger.
      const joints = p.closed ? sp.slice(0, -1) : sp;
      const jn = w < 0.8 ? 6 : 8;
      for (const j of joints) mesh.prism([circlePoints(j.x, j.y, w / 2, jn)], z0, zTop + h);
    }
  }
  return mesh.toBinary(
    `Raisedline ${VERSION} tactile relief: ${doc.title}`.replace(/[^\x20-\x7e]/g, '?'),
  );
}

/** Triangle count of a binary STL. */
export function stlTriangleCount(stl: Uint8Array): number {
  return new DataView(stl.buffer, stl.byteOffset, stl.byteLength).getUint32(80, true);
}
