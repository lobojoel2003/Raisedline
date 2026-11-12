import { SpatialGrid } from '../geometry/grid.js';
import { distanceToEdges, pointInPolygon } from '../geometry/polygon.js';
import { boxContains, boxGap, inflate, segmentBox, segmentBoxDistance } from '../geometry/vec.js';
import type { BrailleMetrics, Box, LabelElement, Point, TactileElement } from '../types.js';
import { brailleSize, labelBox } from './labels.js';

type Obstacle = { kind: 'seg'; a: Point; b: Point; w: number } | { kind: 'box'; box: Box };

export type PlacementSide =
  | 'right'
  | 'left'
  | 'above'
  | 'below'
  | 'above-right'
  | 'below-right'
  | 'above-left'
  | 'below-left';

export const DEFAULT_SIDES: PlacementSide[] = [
  'right',
  'left',
  'above',
  'below',
  'above-right',
  'below-right',
  'above-left',
  'below-left',
];

/** Greedy collision-aware label placement. */
export class LabelPlacer {
  private grid = new SpatialGrid<Obstacle>(12);

  constructor(
    private readonly bounds: Box,
    private readonly clearance: number,
    private readonly metrics: BrailleMetrics,
  ) {}

  addSegment(a: Point, b: Point, w: number): void {
    this.grid.insert(inflate(segmentBox(a, b), w / 2), { kind: 'seg', a, b, w });
  }

  addPolyline(points: Point[], w: number, closed = false): void {
    for (let i = 1; i < points.length; i++) this.addSegment(points[i - 1], points[i], w);
    if (closed && points.length > 2) this.addSegment(points[points.length - 1], points[0], w);
  }

  addBox(box: Box): void {
    this.grid.insert(box, { kind: 'box', box });
  }

  /** Register an element's geometry as an obstacle. Area textures are not obstacles. */
  addElement(el: TactileElement): void {
    switch (el.kind) {
      case 'line':
        this.addPolyline(el.points, el.width, !!el.closed);
        break;
      case 'area':
        if (el.outline) for (const r of el.rings) this.addPolyline(r, el.outline.width, true);
        break;
      case 'symbol':
        this.addBox({ x: el.at.x - el.size / 2, y: el.at.y - el.size / 2, w: el.size, h: el.size });
        break;
      case 'label':
        this.addBox(labelBox(el, this.metrics));
        break;
    }
  }

  /** True if a label box has the required clear space and stays inside the bounds. */
  isFree(box: Box): boolean {
    if (!boxContains(this.bounds, box)) return false;
    const c = this.clearance;
    for (const o of this.grid.query(inflate(box, c + 2))) {
      if (o.kind === 'seg') {
        if (segmentBoxDistance(o.a, o.b, box) - o.w / 2 < c) return false;
      } else if (boxGap(o.box, box) < c) return false;
    }
    return true;
  }

  /** Box for a label whose top-left is at (x, y). */
  private boxAt(label: LabelElement, x: number, y: number): Box {
    const s = brailleSize(label.braille, this.metrics);
    return { x, y, w: s.w, h: s.h };
  }

  /**
   * Try to put a label beside an anchor (a point symbol, or a point on a line). `gap` is the
   * distance from the anchor to the nearest edge of the label.
   */
  placeNear(
    label: LabelElement,
    anchor: Point,
    gap: number,
    sides: PlacementSide[] = DEFAULT_SIDES,
    reach = [1, 1.8, 2.8],
  ): LabelElement | null {
    const s = brailleSize(label.braille, this.metrics);
    for (const k of reach) {
      const g = gap * k + (k > 1 ? 2 : 0);
      for (const side of sides) {
        const xs: number[] = [];
        let y: number;
        if (side.startsWith('above')) y = anchor.y - g - s.h;
        else if (side.startsWith('below')) y = anchor.y + g;
        else y = anchor.y - s.h / 2;
        if (side === 'right') xs.push(anchor.x + g);
        else if (side === 'left') xs.push(anchor.x - g - s.w);
        else if (side.endsWith('right')) xs.push(anchor.x + g * 0.7);
        else if (side.endsWith('left')) xs.push(anchor.x - g * 0.7 - s.w);
        else xs.push(anchor.x - s.w / 2, anchor.x - s.w + 4, anchor.x - 4);
        const ys =
          side === 'right' || side === 'left' ? [y, y - s.h / 2 - 2, y + s.h / 2 + 2] : [y];
        for (const yy of ys) {
          for (const x of xs) {
            if (this.isFree(this.boxAt(label, x, yy))) return { ...label, at: { x, y: yy } };
          }
        }
      }
    }
    return null;
  }

  /** Try to place a label fully inside a polygon, as close to `prefer` as possible. */
  placeInside(label: LabelElement, rings: Point[][], prefer: Point): LabelElement | null {
    const s = brailleSize(label.braille, this.metrics);
    const step = 2.5;
    const candidates: Point[] = [];
    for (let r = 0; r <= 60; r += step) {
      const n = r === 0 ? 1 : Math.ceil((2 * Math.PI * r) / step);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        candidates.push({ x: prefer.x + r * Math.cos(a), y: prefer.y + r * Math.sin(a) });
      }
    }
    for (const c of candidates) {
      const box = { x: c.x - s.w / 2, y: c.y - s.h / 2, w: s.w, h: s.h };
      const corners = [
        { x: box.x, y: box.y },
        { x: box.x + box.w, y: box.y },
        { x: box.x, y: box.y + box.h },
        { x: box.x + box.w, y: box.y + box.h },
      ];
      if (!corners.every((p) => pointInPolygon(p, rings))) continue;
      if (!corners.every((p) => distanceToEdges(p, rings) >= this.clearance)) continue;
      if (!this.isFree(box)) continue;
      return { ...label, at: { x: box.x, y: box.y } };
    }
    return null;
  }

  /** Reserve a placed label's space. */
  commit(label: LabelElement): void {
    this.addBox(labelBox(label, this.metrics));
  }
}
