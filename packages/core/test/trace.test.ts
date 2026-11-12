import { describe, expect, it } from 'vitest';
import { checkDocument, otsuThreshold, traceImage, type RasterImage } from '@raisedline/core';

function canvas(
  w: number,
  h: number,
  paint: (x: number, y: number) => [number, number, number],
): RasterImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [20, 20, 20];

describe('image tracing', () => {
  it('follows the centre of drawn strokes and fills solid shapes', () => {
    // A rectangle outline (5 px strokes) and a solid disc.
    const img = canvas(400, 300, (x, y) => {
      const inRect = x >= 40 && x <= 360 && y >= 40 && y <= 260;
      const inner = x >= 45 && x <= 355 && y >= 45 && y <= 255;
      if (inRect && !inner) return BLACK;
      if ((x - 200) ** 2 + (y - 150) ** 2 < 40 ** 2) return BLACK;
      return WHITE;
    });
    const { tactile } = traceImage(img, { title: 'Shapes' });
    const els = tactile.pages[0].elements;
    const lines = els.filter((e) => e.kind === 'line');
    const areas = els.filter((e) => e.kind === 'area');
    expect(lines).toHaveLength(1);
    expect((lines[0] as { closed?: boolean }).closed).toBe(true);
    expect(areas).toHaveLength(1);
    expect(checkDocument(tactile).counts.error).toBe(0);
  });

  it('separates colour regions into textures', () => {
    const img = canvas(300, 200, (x) =>
      x < 100 ? [220, 60, 60] : x < 200 ? [60, 90, 220] : [255, 255, 255],
    );
    const { tactile } = traceImage(img, { mode: 'regions', colors: 2 });
    const areas = tactile.pages[0].elements.filter((e) => e.kind === 'area' && e.role !== 'key');
    expect(areas.length).toBe(2);
    expect(new Set(areas.map((a) => (a as { texture: string }).texture)).size).toBe(2);
    expect(tactile.key).toHaveLength(2);
  });

  it('inverts light-on-dark drawings', () => {
    const img = canvas(200, 200, (x, y) =>
      Math.abs(x - 100) < 3 && y > 20 && y < 180 ? WHITE : BLACK,
    );
    const { tactile } = traceImage(img, { invert: true, mode: 'lines' });
    expect(tactile.pages[0].elements.filter((e) => e.kind === 'line')).toHaveLength(1);
  });

  it('chooses a threshold between ink and paper', () => {
    const g = { w: 2, h: 2, v: new Float32Array([10, 12, 240, 250]) };
    const t = otsuThreshold(g);
    expect(t).toBeGreaterThanOrEqual(12);
    expect(t).toBeLessThan(240);
  });

  it('rejects empty images', () => {
    expect(() => traceImage({ width: 0, height: 0, data: new Uint8Array() })).toThrow(/empty/);
  });
});
