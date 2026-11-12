import type { BrailleTranslator } from '../braille/translator.js';
import { uebGrade1 } from '../braille/translator.js';
import { DEFAULT_PAGE, DEFAULT_RULES, LINE_WEIGHTS } from '../config.js';
import { addKeyPage, createDocument, layoutKey, measureKey } from '../document.js';
import { toPathData } from '../geometry/pathdata.js';
import { interiorPoint, polygonArea } from '../geometry/polygon.js';
import { simplifyRDP, simplifyRing } from '../geometry/simplify.js';
import { boundsOf, dist, polylineLength } from '../geometry/vec.js';
import { brailleSize, makeLabel } from '../layout/labels.js';
import { LabelPlacer } from '../layout/placement.js';
import { escapeXml } from '../render/svg.js';
import { LINE_STYLE_ORDER, SIGHTED_PALETTE, SYMBOL_ORDER, TEXTURE_ORDER } from '../styles.js';
import type {
  BrailleSettings,
  BuildResult,
  KeyEntry,
  LabelElement,
  LineStyle,
  PageSpec,
  Point,
  SymbolShape,
  TactileElement,
  TextureId,
} from '../types.js';
import { abbreviationCodes } from './chart.js';

export interface MapOptions {
  title?: string;
  page?: PageSpec;
  translator?: BrailleTranslator;
  braille?: Partial<BrailleSettings>;
  /** Remove coastline/outline detail smaller than this (mm, default 0.6). */
  simplify?: number;
  /** Feature property holding the label text (default "name"). */
  labelProperty?: string;
  /** Feature property holding the category (default: first of category/type/kind/class). */
  categoryProperty?: string;
  /** Draw a north arrow (default: on for longitude/latitude data). */
  northArrow?: boolean;
  /** Treat planar (non-geographic) coordinates as y-down, like screen pixels. */
  yDown?: boolean;
}

type Geometry =
  | { type: 'Point'; coordinates: number[] }
  | { type: 'MultiPoint'; coordinates: number[][] }
  | { type: 'LineString'; coordinates: number[][] }
  | { type: 'MultiLineString'; coordinates: number[][][] }
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] }
  | { type: 'GeometryCollection'; geometries: Geometry[] };

interface Feature {
  type: 'Feature';
  geometry: Geometry | null;
  properties: Record<string, unknown> | null;
}

interface FlatFeature {
  index: number;
  kind: 'point' | 'line' | 'polygon';
  /** point: [[p]]; line: [path]; polygon: rings */
  coords: Point[][];
  props: Record<string, unknown>;
  name: string | null;
  category: string;
}

const TEXTURE_HINTS: [RegExp, TextureId][] = [
  [/water|lake|river|sea|ocean|pond|pool|reservoir|bay/i, 'horizontal'],
  [/park|grass|green|forest|wood|garden|field|meadow|lawn/i, 'coarse-dots'],
  [/building|hall|house|library|school|block/i, 'diagonal'],
  [/parking|car ?park|lot/i, 'grid'],
  [/sand|beach|desert/i, 'dots'],
];

const LINE_HINTS: [RegExp, LineStyle, number][] = [
  [/rail|train|tram/i, 'dash-dot', LINE_WEIGHTS.medium],
  [/path|foot|trail|walk|track|cycle/i, 'dashed', LINE_WEIGHTS.medium],
  [/river|stream|creek|canal/i, 'dotted', LINE_WEIGHTS.thick],
  [/border|boundary/i, 'dash-dot', LINE_WEIGHTS.medium],
  [/road|street|highway|avenue|drive|lane/i, 'solid', LINE_WEIGHTS.thick],
];

const SYMBOL_HINTS: [RegExp, SymbolShape][] = [
  [/entrance|door|gate/i, 'triangle'],
  [/stop|bus|station|transit/i, 'square'],
  [/info|help|desk/i, 'diamond'],
  [/toilet|restroom|wc/i, 'ring'],
];

function flatten(input: unknown): Feature[] {
  const g = input as { type?: string };
  if (!g || typeof g !== 'object') throw new Error('Not GeoJSON');
  if (g.type === 'FeatureCollection')
    return ((input as { features?: Feature[] }).features ?? []).filter(Boolean);
  if (g.type === 'Feature') return [input as Feature];
  if (typeof g.type === 'string')
    return [{ type: 'Feature', geometry: input as Geometry, properties: {} }];
  throw new Error('Not GeoJSON: expected a FeatureCollection, Feature or geometry');
}

function explode(
  f: Feature,
  index: number,
  labelProp: string,
  catProp: string | undefined,
): FlatFeature[] {
  const props = f.properties ?? {};
  const nameRaw = props[labelProp] ?? props.label ?? props.title ?? props.NAME;
  const name =
    typeof nameRaw === 'string' && nameRaw.trim()
      ? nameRaw.trim()
      : typeof nameRaw === 'number'
        ? String(nameRaw)
        : null;
  const catKey =
    catProp ??
    ['category', 'type', 'kind', 'class', 'landuse', 'amenity', 'highway', 'building'].find(
      (k) => props[k] !== undefined,
    );
  const category =
    catKey && props[catKey] !== undefined && props[catKey] !== null ? String(props[catKey]) : '';
  const out: FlatFeature[] = [];
  const P = (c: number[]): Point => ({ x: Number(c[0]), y: Number(c[1]) });
  const visit = (geom: Geometry | null) => {
    if (!geom) return;
    switch (geom.type) {
      case 'Point':
        out.push({ index, kind: 'point', coords: [[P(geom.coordinates)]], props, name, category });
        break;
      case 'MultiPoint':
        for (const c of geom.coordinates)
          out.push({ index, kind: 'point', coords: [[P(c)]], props, name, category });
        break;
      case 'LineString':
        out.push({ index, kind: 'line', coords: [geom.coordinates.map(P)], props, name, category });
        break;
      case 'MultiLineString':
        for (const l of geom.coordinates)
          out.push({ index, kind: 'line', coords: [l.map(P)], props, name, category });
        break;
      case 'Polygon':
        out.push({
          index,
          kind: 'polygon',
          coords: geom.coordinates.map((r) => r.map(P)),
          props,
          name,
          category,
        });
        break;
      case 'MultiPolygon':
        for (const poly of geom.coordinates)
          out.push({
            index,
            kind: 'polygon',
            coords: poly.map((r) => r.map(P)),
            props,
            name,
            category,
          });
        break;
      case 'GeometryCollection':
        geom.geometries.forEach(visit);
        break;
    }
  };
  visit(f.geometry);
  return out;
}

function prettyCategory(c: string): string {
  if (!c) return 'Other';
  const s = c.replace(/[_-]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Build a tactile map from GeoJSON (geographic or planar coordinates). */
export function buildMap(geojson: string | unknown, opts: MapOptions = {}): BuildResult {
  const data = typeof geojson === 'string' ? JSON.parse(geojson) : geojson;
  const translator = opts.translator ?? uebGrade1;
  const page = opts.page ?? DEFAULT_PAGE;
  const notes: string[] = [];
  const labelProp = opts.labelProperty ?? 'name';
  const feats = flatten(data).flatMap((f, i) => explode(f, i, labelProp, opts.categoryProperty));
  if (!feats.length) throw new Error('The GeoJSON contains no features');
  const title =
    opts.title ??
    (typeof (data as { name?: unknown }).name === 'string'
      ? (data as { name: string }).name
      : 'Tactile map');

  // Projection.
  const raw = feats.flatMap((f) => f.coords.flat());
  const rb = boundsOf(raw)!;
  const geographic =
    raw.every((p) => Math.abs(p.x) <= 180 && Math.abs(p.y) <= 90) &&
    (rb.w > 0 || rb.h > 0) &&
    rb.w < 360;
  const lat0 = ((rb.y + rb.y + rb.h) / 2) * (Math.PI / 180);
  const project = (p: Point): Point =>
    geographic
      ? { x: p.x * Math.cos(lat0), y: -p.y }
      : opts.yDown
        ? { x: p.x, y: p.y }
        : { x: p.x, y: -p.y };
  for (const f of feats) f.coords = f.coords.map((r) => r.map(project));

  const doc = createDocument({
    title,
    source: 'map',
    page,
    braille: { table: translator.id, ...opts.braille },
  });
  const m = doc.braille.metrics;
  const titleLabel = makeLabel(
    {
      id: 'title',
      text: title,
      at: { x: page.margin, y: page.margin },
      maxWidth: page.width - 2 * page.margin - 20,
      role: 'title',
      sourceId: 'title',
    },
    translator,
    m,
  );
  const top = page.margin + brailleSize(titleLabel.braille, m).h + 6;

  // Categories → textures, line styles and symbols.
  const polyCats = new Map<string, number>();
  const lineCats = new Map<string, number>();
  const pointCats = new Map<string, number>();
  for (const f of feats) {
    if (f.kind === 'polygon')
      polyCats.set(f.category, (polyCats.get(f.category) ?? 0) + Math.abs(polygonArea(f.coords)));
    else if (f.kind === 'line')
      lineCats.set(f.category, (lineCats.get(f.category) ?? 0) + polylineLength(f.coords[0]));
    else pointCats.set(f.category, (pointCats.get(f.category) ?? 0) + 1);
  }
  const textureFor = new Map<string, TextureId>();
  const usedTex = new Set<TextureId>();
  const polyOrder = [...polyCats.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  for (const c of polyOrder) {
    const hint = TEXTURE_HINTS.find(([re]) => re.test(c))?.[1];
    if (hint && !usedTex.has(hint)) {
      textureFor.set(c, hint);
      usedTex.add(hint);
    }
  }
  for (const c of polyOrder) {
    if (textureFor.has(c)) continue;
    const t = TEXTURE_ORDER.find((x) => !usedTex.has(x)) ?? 'solid';
    textureFor.set(c, t);
    usedTex.add(t);
  }
  const lineFor = new Map<string, { style: LineStyle; width: number }>();
  const usedStyles = new Set<LineStyle>();
  const lineOrder = [...lineCats.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  for (const c of lineOrder) {
    const hint = LINE_HINTS.find(([re]) => re.test(c));
    if (hint && !usedStyles.has(hint[1])) {
      lineFor.set(c, { style: hint[1], width: hint[2] });
      usedStyles.add(hint[1]);
    }
  }
  for (const c of lineOrder) {
    if (lineFor.has(c)) continue;
    const st = LINE_STYLE_ORDER.find((x) => !usedStyles.has(x)) ?? 'solid';
    usedStyles.add(st);
    lineFor.set(c, { style: st, width: LINE_WEIGHTS.medium });
  }
  const symbolFor = new Map<string, SymbolShape>();
  const usedShapes = new Set<SymbolShape>();
  const pointOrder = [...pointCats.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  for (const c of pointOrder) {
    const hint = SYMBOL_HINTS.find(([re]) => re.test(c))?.[1];
    if (hint && !usedShapes.has(hint)) {
      symbolFor.set(c, hint);
      usedShapes.add(hint);
    }
  }
  for (const c of pointOrder) {
    if (symbolFor.has(c)) continue;
    const sh = SYMBOL_ORDER.find((x) => !usedShapes.has(x)) ?? 'circle';
    usedShapes.add(sh);
    symbolFor.set(c, sh);
  }

  const key: KeyEntry[] = [];
  for (const c of polyOrder)
    key.push({ swatch: { kind: 'texture', texture: textureFor.get(c)! }, text: prettyCategory(c) });
  for (const c of lineOrder)
    key.push({
      swatch: { kind: 'line', style: lineFor.get(c)!.style, width: lineFor.get(c)!.width },
      text: prettyCategory(c),
    });
  for (const c of pointOrder)
    key.push({ swatch: { kind: 'symbol', shape: symbolFor.get(c)! }, text: prettyCategory(c) });
  // A single unnamed category needs no key.
  if (key.length === 1 && !polyOrder[0] && !lineOrder[0] && !pointOrder[0]) key.length = 0;

  const contentW = page.width - 2 * page.margin;
  const showNorth = opts.northArrow ?? geographic;
  // The north arrow gets its own strip on the right so it never touches the map.
  const avail = {
    x: page.margin + 2,
    y: top + 2,
    w: contentW - 4 - (showNorth ? 18 : 0),
    h: page.height - page.margin - top - 4,
  };
  // Maps need every millimetre: a key with more than a few entries goes on its own page.
  const keyEstimate = key.length ? measureKey(key, contentW, translator, doc) + 30 : 0;
  const keyOnPage = key.length > 0 && key.length <= 4 && keyEstimate < avail.h * 0.35;
  const fitH = keyOnPage ? avail.h - keyEstimate : avail.h;

  // Fit.
  const pb = boundsOf(feats.flatMap((f) => f.coords.flat()))!;
  const scale = Math.min(avail.w / Math.max(pb.w, 1e-9), fitH / Math.max(pb.h, 1e-9));
  const ox = avail.x + (avail.w - pb.w * scale) / 2;
  const oy = avail.y + (fitH - pb.h * scale) / 2;
  const T = (p: Point): Point => ({ x: ox + (p.x - pb.x) * scale, y: oy + (p.y - pb.y) * scale });
  const tol = opts.simplify ?? 0.6;

  const elements: TactileElement[] = [titleLabel];
  const sighted: string[] = [];
  const colorOf = new Map<string, string>();
  const catColor = (c: string, base: number) => {
    if (!colorOf.has(c)) {
      const hint = /water|lake|river|sea|ocean|pond/i.test(c)
        ? '#9cc9f0'
        : /park|grass|green|forest|garden/i.test(c)
          ? '#b9e3b0'
          : SIGHTED_PALETTE[(colorOf.size + base) % SIGHTED_PALETTE.length] + '99';
      colorOf.set(c, hint);
    }
    return colorOf.get(c)!;
  };
  let dropped = 0;
  const named: { f: FlatFeature; el: TactileElement; sid: string }[] = [];
  // Paint order: areas, then lines, then points.
  const ordered = [
    ...feats
      .filter((f) => f.kind === 'polygon')
      .sort((a, b) => polygonArea(b.coords) - polygonArea(a.coords)),
    ...feats.filter((f) => f.kind === 'line'),
    ...feats.filter((f) => f.kind === 'point'),
  ];
  ordered.forEach((f, i) => {
    const sid = `feature-${f.index}`;
    const name = f.name ?? prettyCategory(f.category);
    if (f.kind === 'polygon') {
      const rings = f.coords
        .map((r) => simplifyRing(dedupeClosed(r.map(T)), tol))
        .filter((r) => r.length >= 3);
      if (!rings.length || polygonArea(rings) < 6) {
        dropped++;
        return;
      }
      const el: TactileElement = {
        kind: 'area',
        id: `area-${i}`,
        role: 'feature',
        sourceId: sid,
        name,
        rings,
        texture: textureFor.get(f.category) ?? 'diagonal',
        outline: { width: LINE_WEIGHTS.medium, style: 'solid' },
      };
      elements.push(el);
      sighted.push(
        `<path data-rl-id="${sid}" d="${rings.map((r) => toPathData(r, true)).join('')}" fill="${catColor(f.category, 0)}" fill-rule="evenodd" stroke="#4a4a4a" stroke-width="0.35"/>`,
      );
      if (f.name) named.push({ f, el, sid });
    } else if (f.kind === 'line') {
      const pts = simplifyRDP(f.coords[0].map(T), tol);
      if (polylineLength(pts) < 3) {
        dropped++;
        return;
      }
      const st = lineFor.get(f.category) ?? {
        style: 'solid' as LineStyle,
        width: LINE_WEIGHTS.medium,
      };
      const el: TactileElement = {
        kind: 'line',
        id: `line-${i}`,
        role: 'feature',
        sourceId: sid,
        name,
        points: pts,
        width: st.width,
        style: st.style,
      };
      elements.push(el);
      const dash =
        st.style === 'dashed'
          ? ' stroke-dasharray="2.5 1.5"'
          : st.style === 'dotted'
            ? ' stroke-dasharray="0.6 1.2"'
            : st.style === 'dash-dot'
              ? ' stroke-dasharray="3 1.2 0.6 1.2"'
              : '';
      sighted.push(
        `<path data-rl-id="${sid}" d="${toPathData(pts)}" fill="none" stroke="${/river|stream|canal/i.test(f.category) ? '#3b82c4' : '#555'}" stroke-width="${(st.width * 0.7).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"${dash}/>`,
      );
      if (f.name) named.push({ f, el, sid });
    } else {
      const p = T(f.coords[0][0]);
      const el: TactileElement = {
        kind: 'symbol',
        id: `point-${i}`,
        role: 'feature',
        sourceId: sid,
        name,
        at: p,
        shape: symbolFor.get(f.category) ?? 'circle',
        size: 7,
      };
      elements.push(el);
      sighted.push(
        `<circle data-rl-id="${sid}" cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="1.8" fill="#c0392b" stroke="#fff" stroke-width="0.4"/>`,
      );
      if (f.name) named.push({ f, el, sid });
    }
  });
  if (dropped) notes.push(`${dropped} features too small to feel at this scale were left out.`);

  // North arrow (top-right corner, in its own strip).
  if (showNorth) {
    const nx = page.width - page.margin - 6;
    const ny = top + 2;
    elements.push({
      kind: 'line',
      id: 'north-arrow',
      role: 'compass',
      name: 'North arrow',
      points: [
        { x: nx, y: ny + 22 },
        { x: nx, y: ny + 2 },
      ],
      width: LINE_WEIGHTS.thick,
      style: 'solid',
      arrow: 'end',
    });
    const n = makeLabel(
      {
        id: 'north-label',
        text: 'N',
        at: { x: nx, y: ny + 26 },
        align: 'middle',
        role: 'compass',
        name: 'North',
      },
      translator,
      m,
    );
    elements.push(n);
  }

  // Labels: smallest features first, so they get the best spots.
  const placer = new LabelPlacer(
    {
      x: page.margin,
      y: page.margin,
      w: page.width - 2 * page.margin,
      h: page.height - 2 * page.margin,
    },
    DEFAULT_RULES.labelClearance,
    m,
  );
  for (const el of elements) placer.addElement(el);
  const abbreviations: KeyEntry[] = [];
  const codes = abbreviationCodes(named.map((n) => n.f.name!));
  const sizeOf = (n: (typeof named)[number]) =>
    n.f.kind === 'point'
      ? 0
      : n.f.kind === 'line'
        ? 1e6
        : polygonArea((n.el as { rings: Point[][] }).rings);
  const order = named
    .map((n, i) => ({ n, code: codes[i] }))
    .sort((a, b) => sizeOf(a.n) - sizeOf(b.n));
  for (const { n, code } of order) {
    const text = n.f.name!;
    const mk = (t: string) =>
      makeLabel(
        {
          id: `label-${n.el.id}`,
          text: t,
          at: { x: 0, y: 0 },
          maxWidth: 70,
          sourceId: n.sid,
          name: text,
        },
        translator,
        m,
      );
    let placed: LabelElement | null;
    let usedCode = false;
    const anchorOf = (): { at: Point; radius: number } =>
      n.el.kind === 'symbol'
        ? { at: n.el.at, radius: n.el.size / 2 }
        : n.el.kind === 'area'
          ? { at: interiorPoint(n.el.rings).point, radius: 0 }
          : {
              at: pointAlong((n.el as { points: Point[] }).points, 0.5),
              radius: (n.el as { width: number }).width / 2,
            };
    const tryPlace = (label: LabelElement, reach: number[]): LabelElement | null => {
      if (n.el.kind === 'symbol')
        return placer.placeNear(label, n.el.at, n.el.size / 2 + 2.5, undefined, reach);
      if (n.el.kind === 'area') {
        if (reach[0] > 1) return null;
        const ip = interiorPoint(n.el.rings);
        return placer.placeInside(label, n.el.rings, ip.point);
      }
      if (n.el.kind === 'line') {
        const pts = n.el.points;
        const gap = n.el.width / 2 + 3.2;
        for (const t of [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9]) {
          const hit = placer.placeNear(label, pointAlong(pts, t), gap, undefined, reach);
          if (hit) return hit;
        }
      }
      return null;
    };
    // 1) full name close by, 2) key code close by, 3) full name further out with a lead line.
    placed = tryPlace(mk(text), [1]);
    if (!placed) {
      placed = tryPlace(mk(code), [1, 1.5]);
      usedCode = !!placed;
    }
    if (!placed) {
      const { at, radius } = anchorOf();
      const far =
        placer.placeNear(mk(text), at, Math.max(radius, 3) + 12, undefined, [1, 1.6]) ??
        placer.placeNear(mk(code), at, Math.max(radius, 3) + 10, undefined, [1, 1.6]);
      if (far) {
        usedCode = far.text === code;
        const lb = { ...far.at, ...brailleSize(far.braille, m) };
        const centre = { x: lb.x + lb.w / 2, y: lb.y + lb.h / 2 };
        // Leave the box at the side facing the feature.
        const dx = at.x - centre.x;
        const dy = at.y - centre.y;
        const tBox = Math.min(Math.abs(lb.w / 2 / (dx || 1e-9)), Math.abs(lb.h / 2 / (dy || 1e-9)));
        const d = Math.hypot(dx, dy) || 1;
        const start = {
          x: centre.x + dx * tBox + (dx / d) * 1.8,
          y: centre.y + dy * tBox + (dy / d) * 1.8,
        };
        const end = { x: at.x - (dx / d) * (radius + 0.4), y: at.y - (dy / d) * (radius + 0.4) };
        const leaderId = `leader-${n.el.id}`;
        elements.push({
          kind: 'line',
          id: leaderId,
          role: 'leader',
          name: `Lead line to ${text}`,
          points: [start, end],
          width: 0.6,
          style: 'solid',
          attachedTo: [n.el.id],
        });
        placer.addSegment(start, end, 0.6);
        placed = { ...far, attachedTo: [leaderId] };
      }
    }
    if (!placed) {
      notes.push(`No clear space for "${text}"; its label may overlap other features.`);
      const label = mk(code);
      const { at } = anchorOf();
      placed = { ...label, at: { x: at.x + 4, y: at.y - 3 } };
      usedCode = true;
    }
    if (usedCode) abbreviations.push({ swatch: { kind: 'abbreviation', code }, text });
    placer.commit(placed);
    elements.push(placed);
    const lb = { ...placed.at, ...brailleSize(placed.braille, m) };
    sighted.push(
      `<text data-rl-id="${n.sid}-label" x="${lb.x.toFixed(2)}" y="${(lb.y + lb.h * 0.75).toFixed(2)}" font-size="3.4" font-family="system-ui, sans-serif" fill="#1d1d1f" paint-order="stroke" stroke="#fff" stroke-width="0.8">${escapeXml(text)}</text>`,
    );
  }
  key.push(...abbreviations);
  doc.key = key;
  doc.pages[0].elements = elements;
  if (key.length) {
    const kh = measureKey(key, contentW, translator, doc);
    const used = boundsOf(feats.flatMap((f) => f.coords.flat()).map(T));
    const keyTop = Math.max((used ? used.y + used.h : top) + 8, page.height - page.margin - kh);
    if (keyOnPage && key.length <= 4 && keyTop + kh <= page.height - page.margin + 0.01) {
      elements.push(
        ...layoutKey(key, { x: page.margin, y: keyTop }, contentW, translator, doc).elements,
      );
    } else {
      addKeyPage(doc, translator);
      notes.push('The key is on its own page.');
    }
  }
  const names = named.map((n) => n.f.name).filter(Boolean);
  doc.description =
    `Map "${title}" with ${feats.filter((f) => f.kind === 'polygon').length} areas, ${feats.filter((f) => f.kind === 'line').length} routes and ${feats.filter((f) => f.kind === 'point').length} places.` +
    (key.length
      ? ` Categories: ${[...polyOrder, ...lineOrder, ...pointOrder].map(prettyCategory).join(', ')}.`
      : '') +
    (names.length ? ` Named features: ${names.slice(0, 30).join(', ')}.` : '') +
    (showNorth ? ' North is at the top.' : '');
  const sightedSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}mm" height="${page.height}mm" viewBox="0 0 ${page.width} ${page.height}" role="img" aria-label="${escapeXml(title)}">` +
    `<rect width="${page.width}" height="${page.height}" fill="#fbfaf7"/>` +
    `<text data-rl-id="title" x="${page.margin}" y="${page.margin + 6}" font-size="6" font-weight="600" font-family="system-ui, sans-serif" fill="#1d1d1f">${escapeXml(title)}</text>` +
    sighted.join('') +
    (showNorth
      ? `<g data-rl-id="north-arrow"><path d="M${page.width - page.margin - 6} ${top + 22}V${top + 6}" stroke="#333" stroke-width="0.6"/><path d="M${page.width - page.margin - 6} ${top + 4}l-2 4h4z" fill="#333"/><text x="${page.width - page.margin - 6}" y="${top + 29}" font-size="3.6" text-anchor="middle" font-family="system-ui, sans-serif">N</text></g>`
      : '') +
    '</svg>';
  return { sighted: sightedSvg, tactile: doc, notes };
}

function dedupeClosed(r: Point[]): Point[] {
  const out = r.filter((p, i) => i === 0 || dist(p, r[i - 1]) > 1e-6);
  if (out.length > 1 && dist(out[0], out[out.length - 1]) < 1e-6) out.pop();
  return out;
}

function pointAlong(pts: Point[], t: number): Point {
  const total = polylineLength(pts);
  let target = total * t;
  for (let i = 1; i < pts.length; i++) {
    const l = dist(pts[i - 1], pts[i]);
    if (target <= l) {
      const k = l === 0 ? 0 : target / l;
      return {
        x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k,
        y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * k,
      };
    }
    target -= l;
  }
  return pts[pts.length - 1];
}
