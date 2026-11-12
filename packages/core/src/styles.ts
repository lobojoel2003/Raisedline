import type { LineStyle, SymbolShape, TextureId } from './types.js';

export interface TextureInfo {
  id: TextureId;
  label: string;
  /** How it feels, for keys and screen readers. */
  feel: string;
}

export const TEXTURES: Record<TextureId, TextureInfo> = {
  none: { id: 'none', label: 'Plain', feel: 'smooth, no texture' },
  diagonal: { id: 'diagonal', label: 'Diagonal lines', feel: 'fine slanted ridges' },
  dots: { id: 'dots', label: 'Fine dots', feel: 'fine even dots' },
  horizontal: { id: 'horizontal', label: 'Horizontal lines', feel: 'ridges running across' },
  grid: { id: 'grid', label: 'Grid', feel: 'small raised squares' },
  'coarse-dots': { id: 'coarse-dots', label: 'Coarse dots', feel: 'large widely spaced dots' },
  vertical: { id: 'vertical', label: 'Vertical lines', feel: 'ridges running up and down' },
  solid: { id: 'solid', label: 'Solid', feel: 'fully raised' },
};

/** Textures in the order they are handed out: neighbours in this list feel most different. */
export const TEXTURE_ORDER: TextureId[] = [
  'diagonal',
  'dots',
  'horizontal',
  'coarse-dots',
  'grid',
  'vertical',
  'solid',
];

export const LINE_STYLES: Record<LineStyle, { label: string; feel: string }> = {
  solid: { label: 'Solid line', feel: 'continuous line' },
  dashed: { label: 'Dashed line', feel: 'line with regular breaks' },
  dotted: { label: 'Dotted line', feel: 'row of dots' },
  'dash-dot': { label: 'Dash-dot line', feel: 'dashes separated by single dots' },
};

export const LINE_STYLE_ORDER: LineStyle[] = ['solid', 'dashed', 'dotted', 'dash-dot'];

export const SYMBOLS: Record<SymbolShape, { label: string; feel: string }> = {
  circle: { label: 'Filled circle', feel: 'solid round dot' },
  square: { label: 'Open square', feel: 'square outline' },
  triangle: { label: 'Filled triangle', feel: 'solid triangle' },
  diamond: { label: 'Open diamond', feel: 'diamond outline' },
  cross: { label: 'Cross', feel: 'x shape' },
  ring: { label: 'Open circle', feel: 'ring' },
};

export const SYMBOL_ORDER: SymbolShape[] = [
  'circle',
  'square',
  'triangle',
  'diamond',
  'cross',
  'ring',
];

/** Dash patterns (mm, alternating on/off). Gaps are wide enough to feel. */
export const DASH_PATTERNS: Record<LineStyle, number[]> = {
  solid: [],
  dashed: [6, 3.5],
  dotted: [],
  'dash-dot': [7, 6],
};

/** Centre spacing of the dots in a dotted line (mm). */
export const DOTTED_SPACING = 2.6;

/** Texture geometry parameters (mm). */
export const TEXTURE_PARAMS = {
  lineWidth: 0.5,
  diagonalSpacing: 3.5,
  straightSpacing: 3.2,
  gridSpacing: 4.2,
  fineDotSpacing: 3.0,
  fineDotRadius: 0.55,
  coarseDotSpacing: 6.0,
  coarseDotRadius: 1.0,
  /** Gap kept between a texture and its area outline. */
  inset: 1.2,
};

/** Sighted palette (colour-blind friendly, Okabe–Ito inspired). */
export const SIGHTED_PALETTE = [
  '#0072B2',
  '#E69F00',
  '#009E73',
  '#CC79A7',
  '#56B4E9',
  '#D55E00',
  '#F0E442',
  '#000000',
];
