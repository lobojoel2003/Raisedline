import type { BrailleTranslator } from '../braille/translator.js';
import { uebGrade1 } from '../braille/translator.js';
import { DEFAULT_PAGE, DEFAULT_RULES, LINE_WEIGHTS } from '../config.js';
import { addKeyPage, createDocument, layoutKey, measureKey } from '../document.js';
import { parsePathData, toPathData, type Subpath } from '../geometry/pathdata.js';
import { circlePoints, polygonArea, ringArea } from '../geometry/polygon.js';
import { simplifyRDP, simplifyRing } from '../geometry/simplify.js';
import {
  apply,
  IDENTITY,
  matrixScale,
  multiply,
  parseTransform,
  translate,
  type Matrix,
} from '../geometry/transform.js';
import { boundsOf, polylineLength } from '../geometry/vec.js';
import { brailleSize, makeLabel } from '../layout/labels.js';
import { LabelPlacer } from '../layout/placement.js';
import { escapeXml } from '../render/svg.js';
import { LINE_STYLE_ORDER, SYMBOL_ORDER, TEXTURE_ORDER } from '../styles.js';
import type {
  BrailleSettings,
  BuildResult,
  KeyEntry,
  LabelElement,
  LineStyle,
  PageSpec,
  Point,
  TactileElement,
  TextureId,
} from '../types.js';
import { colorName, luminance, parseColor, toHex, type Rgba } from './color.js';
import { findFirst, localName, parseXml, textContent, type XmlNode } from './xml.js';

export interface SvgImportOptions {
  title?: string;
  page?: PageSpec;
  translator?: BrailleTranslator;
  braille?: Partial<BrailleSettings>;
  /** Simplification tolerance in mm: detail smaller than this is removed (default 0.4). */
  simplify?: number;
  /** Map distinct stroke colours to distinct line styles (default true). */
  strokeColorsToStyles?: boolean;
  /** Convert text elements into braille labels (default true). */
  labels?: boolean;
  /** Fills lighter than this luminance are treated as blank paper (default 0.9). */
  paperLuminance?: number;
}

interface Style {
  fill: string;
  stroke: string;
  strokeWidth: number;
  dash: string;
  fillOpacity: number;
  strokeOpacity: number;
  opacity: number;
  fontSize: number;
  textAnchor: string;
  visibility: string;
  color: string;
}

const INHERITED_DEFAULT: Style = {
  fill: '#000000',
  stroke: 'none',
  strokeWidth: 1,
  dash: 'none',
  fillOpacity: 1,
  strokeOpacity: 1,
  opacity: 1,
  fontSize: 16,
  textAnchor: 'start',
  visibility: 'visible',
  color: '#000000',
};

interface Shape {
  sourceId: string;
  name: string | null;
  subpaths: Subpath[];
  fill: Rgba | null;
  fillKey: string | null;
  stroke: Rgba | null;
  strokeKey: string | null;
  strokeWidth: number;
  dashed: boolean;
}

interface TextItem {
  sourceId: string;
  text: string;
  anchor: Point;
  fontSize: number;
  textAnchor: string;
  fill: string;
}

type CssRules = { selector: string; decls: Record<string, string> }[];

function parseCss(css: string): CssRules {
  const rules: CssRules = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    const decls = parseDecls(m[2]);
    for (const sel of m[1].split(',')) {
      const s = sel.trim();
      if (/^[.#]?[\w-]+$/.test(s) || /^[\w-]+\.[\w-]+$/.test(s)) rules.push({ selector: s, decls });
    }
  }
  return rules;
}

function parseDecls(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of s.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    out[part.slice(0, i).trim().toLowerCase()] = part
      .slice(i + 1)
      .replace(/!important/, '')
      .trim();
  }
  return out;
}

const num = (v: string | undefined, d = 0) => {
  const n = parseFloat(v ?? '');
  return Number.isFinite(n) ? n : d;
};

const SKIP = new Set([
  'defs',
  'clipPath',
  'mask',
  'marker',
  'pattern',
  'symbol',
  'linearGradient',
  'radialGradient',
  'filter',
  'metadata',
  'title',
  'desc',
  'style',
  'script',
  'foreignObject',
  'image',
  'sodipodi:namedview',
  'namedview',
]);

const AUTO_ID =
  /^(path|rect|circle|ellipse|line|polyline|polygon|g|text|tspan|use|layer|svg|shape|group|object|image)[-_]?\d*$/i;

class SvgWalker {
  shapes: Shape[] = [];
  texts: TextItem[] = [];
  private ids = new Map<string, XmlNode>();
  private counter = 0;
  constructor(
    private readonly root: XmlNode,
    private readonly css: CssRules,
    private readonly tolerance: number,
  ) {
    const index = (n: XmlNode) => {
      if (n.attrs.id) this.ids.set(n.attrs.id, n);
      n.children.forEach(index);
    };
    index(root);
  }

  private styleOf(node: XmlNode, parent: Style): { style: Style; display: boolean } {
    const props: Record<string, string> = {};
    for (const k of [
      'fill',
      'stroke',
      'stroke-width',
      'stroke-dasharray',
      'fill-opacity',
      'stroke-opacity',
      'opacity',
      'font-size',
      'text-anchor',
      'visibility',
      'display',
      'color',
    ]) {
      if (node.attrs[k] !== undefined) props[k] = node.attrs[k];
    }
    const classes = (node.attrs.class ?? '').split(/\s+/).filter(Boolean);
    const tag = localName(node.name);
    for (const r of this.css) {
      const s = r.selector;
      const match =
        s === tag ||
        (s.startsWith('.') && classes.includes(s.slice(1))) ||
        (s.startsWith('#') && node.attrs.id === s.slice(1)) ||
        (s.includes('.') &&
          !s.startsWith('.') &&
          s.split('.')[0] === tag &&
          classes.includes(s.split('.')[1]));
      if (match) Object.assign(props, r.decls);
    }
    if (node.attrs.style) Object.assign(props, parseDecls(node.attrs.style));
    const st: Style = { ...parent, opacity: parent.opacity };
    const inherit = (v: string | undefined) => v === undefined || v === 'inherit';
    if (!inherit(props.color)) st.color = props.color;
    if (!inherit(props.fill)) st.fill = props.fill === 'currentColor' ? st.color : props.fill;
    if (!inherit(props.stroke))
      st.stroke = props.stroke === 'currentColor' ? st.color : props.stroke;
    if (!inherit(props['stroke-width'])) st.strokeWidth = num(props['stroke-width'], 1);
    if (!inherit(props['stroke-dasharray'])) st.dash = props['stroke-dasharray'];
    if (!inherit(props['fill-opacity'])) st.fillOpacity = num(props['fill-opacity'], 1);
    if (!inherit(props['stroke-opacity'])) st.strokeOpacity = num(props['stroke-opacity'], 1);
    if (!inherit(props.opacity)) st.opacity = parent.opacity * num(props.opacity, 1);
    if (!inherit(props['font-size'])) st.fontSize = num(props['font-size'], parent.fontSize);
    if (!inherit(props['text-anchor'])) st.textAnchor = props['text-anchor'];
    if (!inherit(props.visibility)) st.visibility = props.visibility;
    return { style: st, display: props.display !== 'none' };
  }

  private nameOf(node: XmlNode): string | null {
    const t = node.children.find((c) => localName(c.name) === 'title');
    if (t) return textContent(t).trim() || null;
    const label =
      node.attrs['aria-label'] ?? node.attrs['inkscape:label'] ?? node.attrs['data-name'];
    if (label) return label;
    const id = node.attrs.id;
    if (id && !AUTO_ID.test(id) && id.length < 40) return id.replace(/[-_]+/g, ' ');
    return null;
  }

  private geometry(node: XmlNode): Subpath[] {
    const tag = localName(node.name);
    const a = node.attrs;
    switch (tag) {
      case 'path':
        return parsePathData(a.d ?? '', this.tolerance);
      case 'rect': {
        const x = num(a.x);
        const y = num(a.y);
        const w = num(a.width);
        const h = num(a.height);
        if (w <= 0 || h <= 0) return [];
        const rx = Math.min(w / 2, num(a.rx, num(a.ry)));
        const ry = Math.min(h / 2, num(a.ry, rx));
        if (rx > 0 && ry > 0) {
          const d = `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
          return parsePathData(d, this.tolerance);
        }
        return [
          {
            points: [
              { x, y },
              { x: x + w, y },
              { x: x + w, y: y + h },
              { x, y: y + h },
            ],
            closed: true,
          },
        ];
      }
      case 'circle':
      case 'ellipse': {
        const cx = num(a.cx);
        const cy = num(a.cy);
        const rx = tag === 'circle' ? num(a.r) : num(a.rx);
        const ry = tag === 'circle' ? num(a.r) : num(a.ry, rx);
        if (rx <= 0 || ry <= 0) return [];
        const n = Math.max(
          16,
          Math.min(96, Math.ceil(Math.sqrt(Math.max(rx, ry) / this.tolerance) * 8)),
        );
        return [
          {
            points: circlePoints(0, 0, 1, n).map((p) => ({ x: cx + p.x * rx, y: cy + p.y * ry })),
            closed: true,
          },
        ];
      }
      case 'line':
        return [
          {
            points: [
              { x: num(a.x1), y: num(a.y1) },
              { x: num(a.x2), y: num(a.y2) },
            ],
            closed: false,
          },
        ];
      case 'polyline':
      case 'polygon': {
        const nums =
          (a.points ?? '').match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
        const pts: Point[] = [];
        for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
        return pts.length >= 2 ? [{ points: pts, closed: tag === 'polygon' }] : [];
      }
    }
    return [];
  }

  walk(
    node: XmlNode,
    m: Matrix,
    parent: Style,
    depth = 0,
    inheritedName: string | null = null,
  ): void {
    if (depth > 64) return;
    const tag = localName(node.name);
    if (SKIP.has(tag) || SKIP.has(node.name)) return;
    const { style, display } = this.styleOf(node, parent);
    if (!display) return;
    const local = multiply(m, parseTransform(node.attrs.transform));
    const name = this.nameOf(node) ?? inheritedName;
    if (tag === 'g' || tag === 'a' || tag === 'switch' || tag === '#document') {
      for (const c of node.children)
        this.walk(c, local, style, depth + 1, tag === 'g' ? name : inheritedName);
      return;
    }
    if (tag === 'svg') {
      const inner =
        depth === 0 ? local : multiply(local, translate(num(node.attrs.x), num(node.attrs.y)));
      for (const c of node.children) this.walk(c, inner, style, depth + 1, inheritedName);
      return;
    }
    if (tag === 'use') {
      const href = node.attrs.href ?? node.attrs['xlink:href'] ?? '';
      const target = href.startsWith('#') ? this.ids.get(href.slice(1)) : undefined;
      if (!target) return;
      const mm = multiply(local, translate(num(node.attrs.x), num(node.attrs.y)));
      if (localName(target.name) === 'symbol') {
        for (const c of target.children) this.walk(c, mm, style, depth + 1, name);
      } else this.walk(target, mm, style, depth + 1, name);
      return;
    }
    if (tag === 'text') {
      this.text(node, local, style);
      return;
    }
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return;
    const geo = this.geometry(node);
    if (!geo.length) return;
    const transformed = geo.map((sp) => ({
      closed: sp.closed,
      points: sp.points.map((p) => apply(local, p)),
    }));
    const fillC = parseColor(style.fill);
    const strokeC = parseColor(style.stroke);
    const fillOk = fillC && fillC.a * style.fillOpacity * style.opacity > 0.08;
    const strokeOk =
      strokeC && strokeC.a * style.strokeOpacity * style.opacity > 0.08 && style.strokeWidth > 0;
    const gradient = /^url\(#([^)]+)\)/.exec(style.fill ?? '');
    const fill = fillOk ? fillC : gradient ? { r: 150, g: 150, b: 150, a: 1 } : null;
    this.shapes.push({
      sourceId: `svg-${++this.counter}`,
      name,
      subpaths: transformed,
      fill,
      fillKey: gradient ? `gradient:${gradient[1]}` : fill ? toHex(fill) : null,
      stroke: strokeOk ? strokeC : null,
      strokeKey: strokeOk && strokeC ? `${toHex(strokeC)}` : null,
      strokeWidth: style.strokeWidth * matrixScale(local),
      dashed: !!style.dash && style.dash !== 'none' && style.dash !== '0',
    });
  }

  private text(node: XmlNode, m: Matrix, style: Style) {
    const content = textContent(node).replace(/\s+/g, ' ').trim();
    if (!content) return;
    // Use the first positioned tspan when the text element itself has no position.
    let x = node.attrs.x;
    let y = node.attrs.y;
    let anchor = style.textAnchor;
    let fontSize = style.fontSize;
    const firstSpan = node.children.find((c) => localName(c.name) === 'tspan');
    if (firstSpan) {
      const st = this.styleOf(firstSpan, style).style;
      if (x === undefined) x = firstSpan.attrs.x;
      if (y === undefined) y = firstSpan.attrs.y;
      anchor = st.textAnchor;
      fontSize = st.fontSize;
    }
    const p = apply(m, { x: num(x?.split(/[\s,]+/)[0]), y: num(y?.split(/[\s,]+/)[0]) });
    this.texts.push({
      sourceId: `svg-${++this.counter}`,
      text: content,
      anchor: p,
      fontSize: fontSize * matrixScale(m),
      textAnchor: anchor,
      fill: style.fill,
    });
  }
}

function strokeWeight(w: number): number {
  if (w >= 2.2) return LINE_WEIGHTS.thick;
  if (w >= 1.1) return 1.3;
  return LINE_WEIGHTS.medium;
}

/** Import an SVG diagram and redesign it as a tactile graphic. */
export function importSvg(svgText: string, opts: SvgImportOptions = {}): BuildResult {
  const translator = opts.translator ?? uebGrade1;
  const page = opts.page ?? DEFAULT_PAGE;
  const tol = opts.simplify ?? 0.4;
  const notes: string[] = [];
  const doc0 = parseXml(svgText);
  const svg = findFirst(doc0, 'svg');
  if (!svg) throw new Error('This file does not contain an <svg> element');
  const css = parseCss(
    (function collect(n: XmlNode): string {
      return (
        (localName(n.name) === 'style' ? textContent(n) : '') + n.children.map(collect).join('\n')
      );
    })(svg),
  );

  // Root coordinate system.
  const vb = (svg.attrs.viewBox ?? svg.attrs.viewbox ?? '').split(/[\s,]+/).map(Number);
  let rootM: Matrix = IDENTITY;
  if (vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0)
    rootM = translate(-vb[0], -vb[1]);
  // Curve flattening tolerance in user units: generous (scaled later).
  const walker = new SvgWalker(svg, css, 0.15);
  walker.walk(svg, rootM, INHERITED_DEFAULT);
  const titleNode = svg.children.find((c) => localName(c.name) === 'title');
  const title =
    opts.title ?? (titleNode ? textContent(titleNode).trim() : '') ?? 'Imported diagram';
  const docTitle = title || 'Imported diagram';

  // Fit the drawing onto the page below the title.
  const all = walker.shapes.flatMap((s) => s.subpaths.flatMap((sp) => sp.points));
  const allWithText = [...all, ...walker.texts.map((t) => t.anchor)];
  const b = boundsOf(allWithText);
  if (!b) throw new Error('The SVG contains no drawable shapes');
  const doc = createDocument({
    title: docTitle,
    source: 'svg',
    page,
    braille: { table: translator.id, ...opts.braille },
  });
  const m = doc.braille.metrics;
  const titleLabel = makeLabel(
    {
      id: 'title',
      text: docTitle,
      at: { x: page.margin, y: page.margin },
      maxWidth: page.width - 2 * page.margin,
      role: 'title',
      sourceId: 'title',
    },
    translator,
    m,
  );
  const top = page.margin + brailleSize(titleLabel.braille, m).h + 6;
  const avail = {
    x: page.margin + 2,
    y: top + 2,
    w: page.width - 2 * page.margin - 4,
    h: page.height - page.margin - top - 4,
  };

  // Background detection: a filled shape covering most of the drawing is paper.
  const drawingArea = Math.max(1e-9, b.w * b.h);
  const paperLum = opts.paperLuminance ?? 0.9;

  // Small filled marks (arrowheads, markers) do not define texture categories.
  const prelimScale = Math.min(avail.w / Math.max(b.w, 1e-9), avail.h / Math.max(b.h, 1e-9));
  const isMark = (s: Shape) => {
    if (!s.fill || s.stroke) return false;
    const sb = boundsOf(s.subpaths.flatMap((sp) => sp.points));
    return !!sb && Math.max(sb.w, sb.h) * prelimScale < 16;
  };
  // Reserve room for a key; measured after classification, so do a first pass.
  const fillGroups = new Map<string, { area: number; color: Rgba; names: Map<string, number> }>();
  const strokeGroups = new Map<
    string,
    { length: number; color: Rgba; dashed: boolean; names: Map<string, number> }
  >();
  for (const s of walker.shapes) {
    if (s.fill && s.fillKey) {
      const area = s.subpaths
        .filter((sp) => sp.closed || sp.points.length > 2)
        .reduce((a, sp) => a + ringArea(sp.points), 0);
      if (area / drawingArea > 0.85 && luminance(s.fill) > 0.6) {
        s.fill = null; // background
        continue;
      }
      if (luminance(s.fill) > paperLum && !s.fillKey.startsWith('gradient')) {
        s.fill = null;
        continue;
      }
      if (isMark(s)) continue;
      const g = fillGroups.get(s.fillKey) ?? { area: 0, color: s.fill, names: new Map() };
      g.area += area;
      if (s.name) g.names.set(s.name, (g.names.get(s.name) ?? 0) + 1);
      fillGroups.set(s.fillKey, g);
    }
    if (s.stroke && s.strokeKey) {
      const key = `${s.strokeKey}${s.dashed ? ':dashed' : ''}`;
      const g = strokeGroups.get(key) ?? {
        length: 0,
        color: s.stroke,
        dashed: s.dashed,
        names: new Map(),
      };
      g.length += s.subpaths.reduce((a, sp) => a + polylineLength(sp.points, sp.closed), 0);
      if (s.name) g.names.set(s.name, (g.names.get(s.name) ?? 0) + 1);
      strokeGroups.set(key, g);
    }
  }
  const fillOrder = [...fillGroups.entries()].sort((a, b2) => b2[1].area - a[1].area);
  const textureFor = new Map<string, TextureId>();
  fillOrder.forEach(([k], i) =>
    textureFor.set(k, i < TEXTURE_ORDER.length ? TEXTURE_ORDER[i] : 'solid'),
  );
  if (fillOrder.length > TEXTURE_ORDER.length)
    notes.push(
      `${fillOrder.length} fill colours found; only ${TEXTURE_ORDER.length} textures are available, so some share a texture.`,
    );
  const strokeOrder = [...strokeGroups.entries()].sort((a, b2) => b2[1].length - a[1].length);
  const styleFor = new Map<string, LineStyle>();
  const useStyles = opts.strokeColorsToStyles ?? true;
  let styleIdx = 0;
  for (const [k, g] of strokeOrder) {
    if (g.dashed) styleFor.set(k, 'dashed');
    else if (useStyles && styleIdx < LINE_STYLE_ORDER.length)
      styleFor.set(k, LINE_STYLE_ORDER[styleIdx++]);
    else styleFor.set(k, 'solid');
  }
  const groupName = (names: Map<string, number>, color: Rgba, what: string) => {
    const top = [...names.entries()].sort((a, b2) => b2[1] - a[1]).map(([n]) => n);
    if (!top.length) return `${colorName(color)} ${what} in the original`;
    return top.length <= 3 ? top.join(', ') : `${top.slice(0, 3).join(', ')} and others`;
  };
  const key: KeyEntry[] = [];
  if (fillOrder.length > 1) {
    for (const [k, g] of fillOrder.slice(0, TEXTURE_ORDER.length)) {
      key.push({
        swatch: { kind: 'texture', texture: textureFor.get(k)! },
        text: groupName(g.names, g.color, 'areas'),
      });
    }
  }
  const usedStyles = new Set(styleFor.values());
  if (usedStyles.size > 1) {
    const seen = new Set<LineStyle>();
    for (const [k, g] of strokeOrder) {
      const st = styleFor.get(k)!;
      if (seen.has(st)) continue;
      seen.add(st);
      key.push({
        swatch: { kind: 'line', style: st, width: LINE_WEIGHTS.medium },
        text: groupName(g.names, g.color, 'lines'),
      });
    }
  }
  const contentW = page.width - 2 * page.margin;
  let keyH = key.length ? measureKey(key, contentW, translator, doc) : 0;
  const keyOnPage = key.length > 0 && keyH < avail.h * 0.25;
  if (keyOnPage) avail.h -= keyH + 8;
  else keyH = 0;

  const scale = Math.min(avail.w / Math.max(b.w, 1e-9), avail.h / Math.max(b.h, 1e-9));
  const ox = avail.x + (avail.w - b.w * scale) / 2;
  const oy = avail.y + (avail.h - b.h * scale) / 2;
  const P = (p: Point): Point => ({ x: ox + (p.x - b.x) * scale, y: oy + (p.y - b.y) * scale });

  const elements: TactileElement[] = [titleLabel];
  const sighted: string[] = [];
  let dropped = 0;
  let glyphLike = 0;
  const smallFills: Shape[] = [];
  for (const s of walker.shapes) {
    const sb = boundsOf(s.subpaths.flatMap((sp) => sp.points));
    if (s.fill && sb && Math.max(sb.w, sb.h) * scale < DEFAULT_RULES.minSymbolSize && !s.stroke) {
      smallFills.push(s);
      glyphLike++;
    }
  }
  const dropGlyphs = glyphLike > 60;
  if (dropGlyphs)
    notes.push(
      `${glyphLike} tiny filled shapes look like text converted to outlines and were removed. Add labels in the editor instead.`,
    );
  const symbolFor = new Map<string, number>();

  walker.shapes.forEach((s) => {
    const pathsMm = s.subpaths.map((sp) => ({ closed: sp.closed, points: sp.points.map(P) }));
    const sb = boundsOf(pathsMm.flatMap((sp) => sp.points));
    if (!sb) return;
    // Sighted version keeps the original colours.
    const d = pathsMm.map((sp) => toPathData(sp.points, sp.closed)).join('');
    sighted.push(
      `<path data-rl-id="${s.sourceId}" d="${d}" fill="${s.fill ? toHex(s.fill) : 'none'}" stroke="${s.stroke ? toHex(s.stroke) : 'none'}" stroke-width="${(s.strokeWidth * scale).toFixed(2)}" stroke-linejoin="round" stroke-linecap="round"${s.dashed ? ' stroke-dasharray="3 2"' : ''}/>`,
    );
    const isSmall = Math.max(sb.w, sb.h) < DEFAULT_RULES.minSymbolSize;
    if (s.fill && s.fillKey && isSmall && !s.stroke) {
      if (dropGlyphs) return;
      const ring = pathsMm[0].points;
      const area = ringArea(ring);
      const roundish =
        area / Math.max(1e-9, sb.w * sb.h) > 0.65 &&
        Math.abs(sb.w - sb.h) < 0.3 * Math.max(sb.w, sb.h);
      if (roundish) {
        const idx = symbolFor.get(s.fillKey) ?? symbolFor.size;
        symbolFor.set(s.fillKey, idx);
        elements.push({
          kind: 'symbol',
          id: `sym-${s.sourceId}`,
          role: 'feature',
          sourceId: s.sourceId,
          name: s.name ?? `${colorName(s.fill)} marker`,
          at: { x: sb.x + sb.w / 2, y: sb.y + sb.h / 2 },
          shape: SYMBOL_ORDER[idx % SYMBOL_ORDER.length],
          size: DEFAULT_RULES.minSymbolSize,
        });
      } else {
        // Arrowheads and small solid marks keep their shape.
        elements.push({
          kind: 'area',
          id: `mark-${s.sourceId}`,
          role: 'feature',
          sourceId: s.sourceId,
          name: s.name ?? 'Small mark',
          rings: pathsMm.filter((sp) => sp.points.length >= 3).map((sp) => sp.points),
          texture: 'solid',
          outline: null,
        });
      }
      return;
    }
    // Arrowheads: small filled triangles keep their shape as solid marks.
    if (s.fill && s.fillKey && !s.stroke && Math.max(sb.w, sb.h) < 16 && pathsMm.length === 1) {
      const simple = simplifyRing(pathsMm[0].points, 0.3);
      if (simple.length <= 4) {
        elements.push({
          kind: 'area',
          id: `mark-${s.sourceId}`,
          role: 'feature',
          sourceId: s.sourceId,
          name: s.name ?? 'Arrowhead',
          rings: [simple],
          texture: 'solid',
          outline: null,
        });
        return;
      }
    }
    const closed = pathsMm.filter((sp) => sp.closed || (sp.points.length > 3 && s.fill));
    if (s.fill && s.fillKey && closed.length) {
      const rings = closed.map((sp) => simplifyRing(sp.points, tol)).filter((r) => r.length >= 3);
      if (polygonArea(rings) < 4) {
        dropped++;
        return;
      }
      const strokeStyle = s.strokeKey
        ? (styleFor.get(`${s.strokeKey}${s.dashed ? ':dashed' : ''}`) ?? 'solid')
        : 'solid';
      elements.push({
        kind: 'area',
        id: `area-${s.sourceId}`,
        role: 'feature',
        sourceId: s.sourceId,
        name: s.name ?? `${colorName(s.fill)} area`,
        rings,
        texture: textureFor.get(s.fillKey) ?? 'diagonal',
        outline: {
          width: s.stroke ? strokeWeight(s.strokeWidth * scale) : LINE_WEIGHTS.medium,
          style: strokeStyle,
        },
      });
      // Open subpaths of a filled shape still need their stroke.
      if (!s.stroke) return;
      pathsMm
        .filter((sp) => !closed.includes(sp))
        .forEach((sp, i) => pushLine(sp, `${s.sourceId}-${i}`));
      return;
    }
    if (s.stroke) {
      pathsMm.forEach((sp, i) => pushLine(sp, `${s.sourceId}${pathsMm.length > 1 ? `-${i}` : ''}`));
    }
    function pushLine(sp: { closed: boolean; points: Point[] }, id: string) {
      const pts = sp.closed ? simplifyRing(sp.points, tol) : simplifyRDP(sp.points, tol);
      if (polylineLength(pts, sp.closed) < 2.5) {
        dropped++;
        return;
      }
      elements.push({
        kind: 'line',
        id: `line-${id}`,
        role: 'feature',
        sourceId: s.sourceId,
        name: s.name ?? `${colorName(s.stroke!)} line`,
        points: pts,
        closed: sp.closed,
        width: strokeWeight(s.strokeWidth * scale),
        style: styleFor.get(`${s.strokeKey}${s.dashed ? ':dashed' : ''}`) ?? 'solid',
      });
    }
  });
  if (dropped) notes.push(`${dropped} features smaller than a fingertip can feel were removed.`);

  // Labels from text, placed clear of the graphics.
  if (opts.labels ?? true) {
    const placer = new LabelPlacer(
      {
        x: page.margin,
        y: page.margin,
        w: page.width - 2 * page.margin,
        h: page.height - 2 * page.margin - (keyOnPage ? keyH + 6 : 0),
      },
      DEFAULT_RULES.labelClearance,
      m,
    );
    for (const el of elements) placer.addElement(el);
    const abbreviations: KeyEntry[] = [];
    let codeN = 0;
    for (const t of walker.texts) {
      const a = P(t.anchor);
      const fs = t.fontSize * scale;
      sighted.push(
        `<text data-rl-id="${t.sourceId}" x="${a.x.toFixed(2)}" y="${a.y.toFixed(2)}" font-size="${Math.max(2, fs).toFixed(2)}" text-anchor="${escapeXml(t.textAnchor)}" fill="${escapeXml(parseColor(t.fill) ? toHex(parseColor(t.fill)!) : '#000')}" font-family="system-ui, sans-serif">${escapeXml(t.text)}</text>`,
      );
      const align = t.textAnchor === 'middle' ? 'middle' : t.textAnchor === 'end' ? 'end' : 'start';
      const centre = {
        x: align === 'start' ? a.x : align === 'end' ? a.x : a.x,
        y: a.y - fs * 0.35,
      };
      let label: LabelElement = makeLabel(
        {
          id: `label-${t.sourceId}`,
          text: t.text,
          at: centre,
          align,
          valign: 'middle',
          sourceId: t.sourceId,
          maxWidth: Math.min(90, page.width / 3),
        },
        translator,
        m,
      );
      const box = { ...label.at, ...brailleSize(label.braille, m) };
      let placed: LabelElement | null = placer.isFree({ x: box.x, y: box.y, w: box.w, h: box.h })
        ? label
        : null;
      if (!placed) placed = placer.placeNear(label, centre, 3);
      if (!placed) {
        // Fall back to a short key code.
        const code =
          String.fromCharCode(97 + (codeN % 26)) +
          (codeN >= 26 ? String(Math.floor(codeN / 26)) : '');
        const short = makeLabel(
          {
            id: label.id,
            text: code,
            at: centre,
            align,
            valign: 'middle',
            sourceId: t.sourceId,
            name: t.text,
          },
          translator,
          m,
        );
        placed =
          placer.placeNear(short, centre, 2.5, ['right', 'left', 'above', 'below']) ??
          (placer.isFree({ ...short.at, ...brailleSize(short.braille, m) }) ? short : null);
        if (placed) {
          codeN++;
          abbreviations.push({ swatch: { kind: 'abbreviation', code }, text: t.text });
        }
      }
      if (!placed) {
        placed = label; // keep it where the author put it; the touch check will flag it
        notes.push(`Could not find clear space for the label "${t.text}".`);
      }
      label = placed;
      placer.commit(label);
      elements.push(label);
    }
    key.push(...abbreviations);
  }

  doc.pages[0].elements = elements;
  doc.key = key;
  if (key.length) {
    keyH = measureKey(key, contentW, translator, doc);
    const used = boundsOf(
      elements.flatMap((e) =>
        e.kind === 'label'
          ? [e.at, { x: e.at.x, y: e.at.y + brailleSize(e.braille, m).h }]
          : e.kind === 'symbol'
            ? [e.at]
            : e.kind === 'line'
              ? e.points
              : e.rings.flat(),
      ),
    );
    const keyTop = (used ? used.y + used.h : top) + 8;
    if (keyTop + keyH <= page.height - page.margin) {
      doc.pages[0].elements.push(
        ...layoutKey(key, { x: page.margin, y: keyTop }, contentW, translator, doc).elements,
      );
    } else {
      addKeyPage(doc, translator);
      notes.push('The key is on its own page.');
    }
  }
  const counts = { lines: 0, areas: 0, symbols: 0, labels: 0 };
  for (const e of elements) {
    if (e.role === 'title' || e.role === 'key') continue;
    if (e.kind === 'line') counts.lines++;
    else if (e.kind === 'area') counts.areas++;
    else if (e.kind === 'symbol') counts.symbols++;
    else counts.labels++;
  }
  const labelTexts = walker.texts.map((t) => t.text).slice(0, 25);
  doc.description =
    `Diagram "${docTitle}" with ${counts.areas} textured areas, ${counts.lines} lines, ${counts.symbols} point symbols and ${counts.labels} labels.` +
    (labelTexts.length ? ` Labels: ${labelTexts.join(', ')}.` : '');
  const sightedSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}mm" height="${page.height}mm" viewBox="0 0 ${page.width} ${page.height}" role="img" aria-label="${escapeXml(docTitle)}">` +
    `<rect width="${page.width}" height="${page.height}" fill="#fff"/>` +
    `<text data-rl-id="title" x="${page.margin}" y="${page.margin + 6}" font-size="6" font-weight="600" font-family="system-ui, sans-serif" fill="#1d1d1f">${escapeXml(docTitle)}</text>` +
    sighted.join('') +
    '</svg>';
  return { sighted: sightedSvg, tactile: doc, notes };
}
