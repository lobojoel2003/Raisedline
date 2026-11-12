import type { BrailleMetrics, BrailleSettings, PageSpec } from './types.js';

export const MM_PER_INCH = 25.4;
export const PT_PER_MM = 72 / MM_PER_INCH;

/** Common swell-paper, embosser and printer sheet sizes. */
export const PAGE_PRESETS: Record<string, Omit<PageSpec, 'margin'> & { label: string }> = {
  'letter-landscape': {
    name: 'letter-landscape',
    label: 'Letter, landscape (11 × 8.5 in)',
    width: 279.4,
    height: 215.9,
  },
  'letter-portrait': {
    name: 'letter-portrait',
    label: 'Letter, portrait (8.5 × 11 in)',
    width: 215.9,
    height: 279.4,
  },
  'a4-landscape': {
    name: 'a4-landscape',
    label: 'A4, landscape (297 × 210 mm)',
    width: 297,
    height: 210,
  },
  'a4-portrait': {
    name: 'a4-portrait',
    label: 'A4, portrait (210 × 297 mm)',
    width: 210,
    height: 297,
  },
  braille: { name: 'braille', label: 'Braille paper (11 × 11.5 in)', width: 279.4, height: 292.1 },
  'tabloid-landscape': {
    name: 'tabloid-landscape',
    label: 'Tabloid, landscape (17 × 11 in)',
    width: 431.8,
    height: 279.4,
  },
  'a3-landscape': {
    name: 'a3-landscape',
    label: 'A3, landscape (420 × 297 mm)',
    width: 420,
    height: 297,
  },
  'print-bed': {
    name: 'print-bed',
    label: '3D printer bed (200 × 200 mm)',
    width: 200,
    height: 200,
  },
};

export const DEFAULT_MARGIN = 12;

export function pagePreset(name: string, margin = DEFAULT_MARGIN): PageSpec {
  const preset = PAGE_PRESETS[name];
  if (!preset) {
    throw new Error(
      `Unknown page size "${name}". Use one of: ${Object.keys(PAGE_PRESETS).join(', ')}`,
    );
  }
  return { name: preset.name, width: preset.width, height: preset.height, margin };
}

export const DEFAULT_PAGE: PageSpec = pagePreset('letter-landscape');

/**
 * Standard braille cell geometry (close to NLS Specification 800 and Marburg Medium).
 * Dot spacing 2.5 mm, cell spacing 6.2 mm, line spacing 10 mm, dot diameter 1.5 mm.
 */
export const STANDARD_BRAILLE: BrailleMetrics = {
  dotSpacing: 2.5,
  cellSpacing: 6.2,
  lineSpacing: 10,
  dotDiameter: 1.5,
  dotHeight: 0.6,
};

export const DEFAULT_BRAILLE: BrailleSettings = {
  table: 'ueb-grade1',
  metrics: STANDARD_BRAILLE,
};

/**
 * Thresholds used by the touch check. The defaults follow widely used tactile-graphics
 * guidance (for example BANA's Guidelines and Standards for Tactile Graphics): about 3 mm
 * (1/8 in) of clear space between distinct features, point symbols of at least 6 mm (1/4 in),
 * and textured areas at least 12.7 mm (1/2 in) across. Every value can be overridden.
 */
export interface TouchRules {
  /** Clear space needed between two distinct lines, edge to edge (mm). */
  minLineGap: number;
  /** Clear space around braille labels (mm). */
  labelClearance: number;
  /** Smallest point symbol a finger can identify (mm). */
  minSymbolSize: number;
  /** Narrowest textured area whose pattern can still be identified (mm). */
  minAreaWidth: number;
  /** Thinnest line that raises reliably on swell paper (mm). */
  minLineWidth: number;
  /** Shortest dashed or dotted line whose pattern can be recognised (mm). */
  minPatternLength: number;
  /** Intersections sharper than this angle are hard to tell apart (degrees). */
  minCrossingAngle: number;
  /** Size of a fingertip for the crowding check (mm). */
  fingertip: number;
  /** Distinct features a single fingertip-sized spot may hold before it feels cluttered. */
  maxFeaturesPerFingertip: number;
  maxTextures: number;
  maxLineStyles: number;
  maxSymbolShapes: number;
}

export const DEFAULT_RULES: TouchRules = {
  minLineGap: 3,
  labelClearance: 3,
  minSymbolSize: 6,
  minAreaWidth: 12.7,
  minLineWidth: 0.5,
  minPatternLength: 12.7,
  minCrossingAngle: 25,
  fingertip: 15,
  maxFeaturesPerFingertip: 4,
  maxTextures: 5,
  maxLineStyles: 4,
  maxSymbolShapes: 5,
};

/** Standard stroke widths (mm). */
export const LINE_WEIGHTS = {
  thin: 0.6,
  medium: 1.0,
  thick: 1.6,
} as const;
