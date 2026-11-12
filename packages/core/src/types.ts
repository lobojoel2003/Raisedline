/**
 * Raisedline document model.
 *
 * All coordinates are in millimetres with the origin at the top-left corner of the page and
 * the y axis pointing down (the same convention as SVG). Exporters convert to their own units.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Physical page description, in millimetres. */
export interface PageSpec {
  /** Preset id such as `letter-landscape`, or `custom`. */
  name: string;
  width: number;
  height: number;
  /** Clear border kept free of tactile features. */
  margin: number;
}

/** How a raised line feels along its length. */
export type LineStyle = 'solid' | 'dashed' | 'dotted' | 'dash-dot';

/** Area fill patterns that stay distinguishable by touch. */
export type TextureId =
  'none' | 'diagonal' | 'dots' | 'horizontal' | 'grid' | 'coarse-dots' | 'vertical' | 'solid';

/** Point symbol shapes. */
export type SymbolShape = 'circle' | 'square' | 'triangle' | 'diamond' | 'cross' | 'ring';

export type ElementRole =
  | 'axis'
  | 'tick'
  | 'grid'
  | 'data'
  | 'outline'
  | 'feature'
  | 'title'
  | 'label'
  | 'leader'
  | 'key'
  | 'compass'
  | 'decoration';

interface BaseElement {
  /** Unique within the document. */
  id: string;
  role: ElementRole;
  /** Id of the matching element in the sighted rendering (for linked highlighting). */
  sourceId?: string;
  /** Human-readable name used in check reports and descriptions. */
  name?: string;
  /** Ids of elements this one is meant to touch (e.g. a data marker sitting on its line). */
  attachedTo?: string[];
  /** Elements sharing a group (e.g. all tick marks of one axis) count as one feature. */
  group?: string;
}

export interface LineElement extends BaseElement {
  kind: 'line';
  points: Point[];
  closed?: boolean;
  /** Stroke width in mm. */
  width: number;
  style: LineStyle;
  /** Draw a filled arrowhead at one or both ends. */
  arrow?: 'start' | 'end' | 'both';
}

export interface AreaElement extends BaseElement {
  kind: 'area';
  /** First ring is the outer boundary, later rings are holes. */
  rings: Point[][];
  texture: TextureId;
  /** Outline drawn around the area, or null for none. */
  outline: { width: number; style: LineStyle } | null;
}

export interface SymbolElement extends BaseElement {
  kind: 'symbol';
  at: Point;
  shape: SymbolShape;
  /** Overall size (diameter / side) in mm. */
  size: number;
}

export interface LabelElement extends BaseElement {
  kind: 'label';
  /** Top-left corner of the first braille cell. */
  at: Point;
  /** Print text (shown to sighted transcribers as an interline). */
  text: string;
  /** Unicode braille, one string per braille line. */
  braille: string[];
}

export type TactileElement = LineElement | AreaElement | SymbolElement | LabelElement;

/** Swatch shown next to a key entry. */
export type KeySwatch =
  | { kind: 'texture'; texture: TextureId }
  | { kind: 'line'; style: LineStyle; width: number; symbol?: SymbolShape }
  | { kind: 'symbol'; shape: SymbolShape }
  | { kind: 'abbreviation'; code: string };

export interface KeyEntry {
  swatch: KeySwatch;
  /** Print text of the meaning. */
  text: string;
}

export interface TactilePage {
  id: string;
  title: string;
  elements: TactileElement[];
}

export type SourceKind = 'chart' | 'svg' | 'image' | 'map' | 'manual';

export interface TactileDocument {
  format: 'raisedline';
  version: 1;
  title: string;
  page: PageSpec;
  braille: BrailleSettings;
  /** First page is the graphic. A separate key page may follow. */
  pages: TactilePage[];
  key: KeyEntry[];
  /** Plain-language description of the graphic (alt text). */
  description: string;
  source: SourceKind;
  generator: string;
}

/** Physical braille cell dimensions in mm. */
export interface BrailleMetrics {
  /** Distance between dot centres inside a cell. */
  dotSpacing: number;
  /** Distance between corresponding dots of adjacent cells. */
  cellSpacing: number;
  /** Distance between corresponding dots of adjacent braille lines. */
  lineSpacing: number;
  /** Dot base diameter. */
  dotDiameter: number;
  /** Dot height for 3D output. */
  dotHeight: number;
}

export interface BrailleSettings {
  /** Translator id, e.g. `ueb-grade1` or `liblouis:en-ueb-g2.ctb`. */
  table: string;
  metrics: BrailleMetrics;
}

/** Renderable, exporter-friendly geometry produced from a document page. */
export type Primitive =
  | {
      type: 'stroke';
      points: Point[];
      width: number;
      closed: boolean;
      ownerId: string;
      /** Part of an area texture (rendered lower in 3D output). */
      texture?: boolean;
    }
  | { type: 'fill'; rings: Point[][]; ownerId: string; texture?: boolean }
  | {
      type: 'dot';
      x: number;
      y: number;
      r: number;
      ownerId: string;
      braille: boolean;
      texture?: boolean;
    };

/** Output of every source builder: a sighted rendering plus the tactile document. */
export interface BuildResult {
  /** Standalone SVG (in mm units) showing the sighted version, with `data-rl-id` hooks. */
  sighted: string;
  tactile: TactileDocument;
  /** Non-fatal notes produced while building (e.g. features dropped by simplification). */
  notes: string[];
}
