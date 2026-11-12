/** CSS colour parsing and naming. */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NAMED: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  orange: '#ffa500',
  purple: '#800080',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  maroon: '#800000',
  olive: '#808000',
  lime: '#00ff00',
  aqua: '#00ffff',
  cyan: '#00ffff',
  teal: '#008080',
  navy: '#000080',
  fuchsia: '#ff00ff',
  magenta: '#ff00ff',
  brown: '#a52a2a',
  pink: '#ffc0cb',
  gold: '#ffd700',
  beige: '#f5f5dc',
  tan: '#d2b48c',
  khaki: '#f0e68c',
  coral: '#ff7f50',
  salmon: '#fa8072',
  crimson: '#dc143c',
  indigo: '#4b0082',
  violet: '#ee82ee',
  orchid: '#da70d6',
  plum: '#dda0dd',
  lavender: '#e6e6fa',
  turquoise: '#40e0d0',
  skyblue: '#87ceeb',
  steelblue: '#4682b4',
  royalblue: '#4169e1',
  darkblue: '#00008b',
  lightblue: '#add8e6',
  darkgreen: '#006400',
  lightgreen: '#90ee90',
  forestgreen: '#228b22',
  seagreen: '#2e8b57',
  darkred: '#8b0000',
  darkgray: '#a9a9a9',
  darkgrey: '#a9a9a9',
  lightgray: '#d3d3d3',
  lightgrey: '#d3d3d3',
  dimgray: '#696969',
  whitesmoke: '#f5f5f5',
  ivory: '#fffff0',
  linen: '#faf0e6',
  wheat: '#f5deb3',
  sienna: '#a0522d',
  chocolate: '#d2691e',
  tomato: '#ff6347',
  firebrick: '#b22222',
  darkorange: '#ff8c00',
  goldenrod: '#daa520',
  olivedrab: '#6b8e23',
  slategray: '#708090',
  midnightblue: '#191970',
  aliceblue: '#f0f8ff',
};

export function parseColor(value: string | undefined): Rgba | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (v === 'none' || v === 'transparent') return null;
  const named = NAMED[v];
  if (named) return parseColor(named);
  let m = /^#([0-9a-f]{3,8})$/.exec(v);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) {
      return {
        r: parseInt(h[0] + h[0], 16),
        g: parseInt(h[1] + h[1], 16),
        b: parseInt(h[2] + h[2], 16),
        a: h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1,
      };
    }
    if (h.length === 6 || h.length === 8) {
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
      };
    }
  }
  m = /^rgba?\(([^)]*)\)$/.exec(v);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    const ch = (s: string) => (s.endsWith('%') ? (parseFloat(s) * 255) / 100 : parseFloat(s));
    return {
      r: ch(parts[0] ?? '0'),
      g: ch(parts[1] ?? '0'),
      b: ch(parts[2] ?? '0'),
      a:
        parts[3] !== undefined
          ? parts[3].endsWith('%')
            ? parseFloat(parts[3]) / 100
            : parseFloat(parts[3])
          : 1,
    };
  }
  m = /^hsla?\(([^)]*)\)$/.exec(v);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    const h = (((parseFloat(parts[0] ?? '0') % 360) + 360) % 360) / 360;
    const s = parseFloat(parts[1] ?? '0') / 100;
    const l = parseFloat(parts[2] ?? '0') / 100;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue = (t: number) => {
      t = (t + 1) % 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return {
      r: hue(h + 1 / 3) * 255,
      g: hue(h) * 255,
      b: hue(h - 1 / 3) * 255,
      a: parts[3] ? parseFloat(parts[3]) : 1,
    };
  }
  return null;
}

export function toHex(c: Rgba): string {
  const h = (n: number) =>
    Math.round(Math.max(0, Math.min(255, n)))
      .toString(16)
      .padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** Relative luminance (0 = black, 1 = white). */
export function luminance(c: Rgba): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

const NAME_TABLE: [string, Rgba][] = [
  ['black', { r: 0, g: 0, b: 0, a: 1 }],
  ['dark grey', { r: 80, g: 80, b: 80, a: 1 }],
  ['grey', { r: 150, g: 150, b: 150, a: 1 }],
  ['light grey', { r: 210, g: 210, b: 210, a: 1 }],
  ['white', { r: 255, g: 255, b: 255, a: 1 }],
  ['red', { r: 210, g: 40, b: 40, a: 1 }],
  ['orange', { r: 240, g: 150, b: 30, a: 1 }],
  ['yellow', { r: 240, g: 220, b: 50, a: 1 }],
  ['green', { r: 50, g: 160, b: 70, a: 1 }],
  ['dark green', { r: 20, g: 90, b: 40, a: 1 }],
  ['teal', { r: 0, g: 140, b: 140, a: 1 }],
  ['light blue', { r: 130, g: 190, b: 235, a: 1 }],
  ['blue', { r: 30, g: 90, b: 200, a: 1 }],
  ['navy', { r: 20, g: 30, b: 100, a: 1 }],
  ['purple', { r: 130, g: 60, b: 170, a: 1 }],
  ['pink', { r: 235, g: 130, b: 180, a: 1 }],
  ['brown', { r: 130, g: 80, b: 40, a: 1 }],
  ['beige', { r: 225, g: 205, b: 160, a: 1 }],
];

/** Nearest everyday colour name (for keys and descriptions). */
export function colorName(c: Rgba): string {
  let best = NAME_TABLE[0][0];
  let bestD = Infinity;
  for (const [name, ref] of NAME_TABLE) {
    const d = (c.r - ref.r) ** 2 * 0.3 + (c.g - ref.g) ** 2 * 0.59 + (c.b - ref.b) ** 2 * 0.11;
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}
