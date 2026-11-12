import type { Box } from '../types.js';

/** Uniform-grid spatial hash for boxes. Items are returned at most once per query. */
export class SpatialGrid<T> {
  private cells = new Map<number, number[]>();
  private items: { box: Box; value: T }[] = [];

  constructor(private readonly cellSize: number) {}

  private key(ix: number, iy: number): number {
    return (ix + 32768) * 65536 + (iy + 32768);
  }

  insert(box: Box, value: T): void {
    const idx = this.items.length;
    this.items.push({ box, value });
    const x0 = Math.floor(box.x / this.cellSize);
    const y0 = Math.floor(box.y / this.cellSize);
    const x1 = Math.floor((box.x + box.w) / this.cellSize);
    const y1 = Math.floor((box.y + box.h) / this.cellSize);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const k = this.key(ix, iy);
        let list = this.cells.get(k);
        if (!list) {
          list = [];
          this.cells.set(k, list);
        }
        list.push(idx);
      }
    }
  }

  query(box: Box): T[] {
    const seen = new Set<number>();
    const out: T[] = [];
    const x0 = Math.floor(box.x / this.cellSize);
    const y0 = Math.floor(box.y / this.cellSize);
    const x1 = Math.floor((box.x + box.w) / this.cellSize);
    const y1 = Math.floor((box.y + box.h) / this.cellSize);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const list = this.cells.get(this.key(ix, iy));
        if (!list) continue;
        for (const idx of list) {
          if (seen.has(idx)) continue;
          seen.add(idx);
          const it = this.items[idx];
          const b = it.box;
          if (
            b.x <= box.x + box.w &&
            box.x <= b.x + b.w &&
            b.y <= box.y + box.h &&
            box.y <= b.y + b.h
          ) {
            out.push(it.value);
          }
        }
      }
    }
    return out;
  }

  get size(): number {
    return this.items.length;
  }

  all(): T[] {
    return this.items.map((i) => i.value);
  }
}
