import { describe, expect, it } from 'vitest';
import {
  apply,
  arcPoints,
  boundsOf,
  clipLineToPolygon,
  dashPolyline,
  dotsAlong,
  interiorPoint,
  parsePathData,
  parseTransform,
  pointInPolygon,
  polygonArea,
  polylineLength,
  segmentAngle,
  segmentDistance,
  simplifyRDP,
  simplifyRing,
  subtractBoxesFromSegment,
  toPathData,
} from '@raisedline/core';

const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe('vector helpers', () => {
  it('measures segment distance and crossings', () => {
    const d = segmentDistance({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 2 }, { x: 10, y: 2 });
    expect(d.distance).toBeCloseTo(2);
    expect(d.intersects).toBe(false);
    const c = segmentDistance({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 });
    expect(c.intersects).toBe(true);
    expect(c.p).toEqual({ x: 5, y: 5 });
    expect(
      segmentAngle({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }),
    ).toBeCloseTo(90);
  });

  it('simplifies with Ramer–Douglas–Peucker', () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ x: i, y: Math.sin(i) * 0.05 }));
    expect(simplifyRDP(line, 0.2)).toHaveLength(2);
    expect(simplifyRing([...square, { x: 0, y: 5 }], 0.1)).toHaveLength(4);
  });

  it('handles polygons', () => {
    expect(polygonArea([square])).toBe(100);
    expect(
      polygonArea([
        square,
        [
          { x: 2, y: 2 },
          { x: 4, y: 2 },
          { x: 4, y: 4 },
          { x: 2, y: 4 },
        ],
      ]),
    ).toBe(96);
    expect(pointInPolygon({ x: 5, y: 5 }, [square])).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, [square])).toBe(false);
    const ip = interiorPoint([
      [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 12 },
        { x: 0, y: 12 },
      ],
    ]);
    expect(ip.clearance * 2).toBeGreaterThan(11.8);
    const clipped = clipLineToPolygon({ x: -5, y: 5 }, { x: 1, y: 0 }, [square]);
    expect(clipped).toHaveLength(1);
    expect(clipped[0][0].x).toBeCloseTo(0);
    expect(clipped[0][1].x).toBeCloseTo(10);
  });

  it('cuts segments around boxes', () => {
    const parts = subtractBoxesFromSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, [
      { x: 40, y: -1, w: 20, h: 2 },
    ]);
    expect(parts.map(([a, b]) => [a.x, b.x])).toEqual([
      [0, 40],
      [60, 100],
    ]);
  });

  it('dashes lines and spaces dots evenly', () => {
    const dashes = dashPolyline(
      [
        { x: 0, y: 0 },
        { x: 19, y: 0 },
      ],
      [6, 3.5],
    );
    expect(dashes).toHaveLength(2);
    expect(polylineLength(dashes[0])).toBeCloseTo(6);
    const dots = dotsAlong(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      2.5,
    );
    expect(dots).toHaveLength(5);
    expect(dots[4].x).toBeCloseTo(10);
  });
});

describe('SVG path data', () => {
  it('parses absolute and relative commands', () => {
    const [sp] = parsePathData('M10 10 h 20 v 20 H 10 z');
    expect(sp.closed).toBe(true);
    expect(sp.points).toEqual([
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 30, y: 30 },
      { x: 10, y: 30 },
    ]);
  });

  it('flattens curves and compact arc flags', () => {
    const [arc] = parsePathData('M0 0a10 10 0 0110 10');
    const end = arc.points[arc.points.length - 1];
    expect(end.x).toBeCloseTo(10);
    expect(end.y).toBeCloseTo(10);
    const b = boundsOf(arc.points)!;
    expect(b.w).toBeCloseTo(10, 0);
    const [curve] = parsePathData('M0 0 C 0 10 10 10 10 0 S 20 -10 20 0');
    expect(curve.points.length).toBeGreaterThan(8);
    const half = arcPoints({ x: 0, y: 0 }, 5, 5, 0, 0, 1, { x: 10, y: 0 }, 0.1);
    expect(Math.min(...half.map((p) => p.y))).toBeCloseTo(-5, 0);
  });

  it('keeps multiple subpaths and round-trips to path data', () => {
    const sps = parsePathData('M0 0 L1 1 M5 5 L6 6');
    expect(sps).toHaveLength(2);
    expect(toPathData(sps[0].points)).toBe('M0 0L1 1');
  });

  it('applies transforms', () => {
    const m = parseTransform('translate(10 5) scale(2) rotate(90)');
    const p = apply(m, { x: 1, y: 0 });
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(7);
  });
});
