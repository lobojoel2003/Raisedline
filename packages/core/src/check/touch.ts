import { DEFAULT_RULES, type TouchRules } from '../config.js';
import { SpatialGrid } from '../geometry/grid.js';
import { interiorPoint, polygonArea } from '../geometry/polygon.js';
import {
  boundsOf,
  boxContains,
  boxesOverlap,
  boxGap,
  dist,
  inflate,
  polylineLength,
  segmentAngle,
  segmentBox,
  segmentBoxDistance,
  segmentDistance,
  unionBox,
} from '../geometry/vec.js';
import { labelBox } from '../layout/labels.js';
import { pagePrimitives, primitiveBounds } from '../render/primitives.js';
import type {
  Box,
  LabelElement,
  Point,
  TactileDocument,
  TactileElement,
  TactilePage,
} from '../types.js';

export type Severity = 'error' | 'warning' | 'info';

export type RuleId =
  | 'line-gap'
  | 'self-gap'
  | 'shallow-crossing'
  | 'label-overlap'
  | 'label-crowding'
  | 'label-collision'
  | 'symbol-size'
  | 'symbol-crowding'
  | 'area-too-small'
  | 'pattern-too-short'
  | 'line-too-thin'
  | 'outside-page'
  | 'in-margin'
  | 'crowded'
  | 'too-many-textures'
  | 'too-many-line-styles'
  | 'too-many-symbols'
  | 'missing-title'
  | 'missing-key';

export interface TouchIssue {
  id: string;
  rule: RuleId;
  severity: Severity;
  page: number;
  message: string;
  /** What to do about it. */
  hint: string;
  /** Region of the page the issue covers (mm). */
  box: Box;
  elementIds: string[];
  /** Measured value (e.g. gap in mm) when it applies. */
  measured?: number;
}

export interface TouchReport {
  /** 0–100; 90+ is ready to print. */
  score: number;
  verdict: 'ready' | 'review' | 'rework';
  issues: TouchIssue[];
  counts: Record<Severity, number>;
  stats: {
    elements: number;
    labels: number;
    textures: number;
    lineStyles: number;
    symbolShapes: number;
    /** Share of the usable page area carrying raised features (0–1). */
    coverage: number;
  };
  rules: TouchRules;
}

interface Seg {
  a: Point;
  b: Point;
  width: number;
  ownerId: string;
  /** Path index of the owning polyline (to detect self-proximity). */
  path: number;
  /** Arc length at `a` along its path. */
  s: number;
  closed: boolean;
  pathLength: number;
}

const RULE_TEXT: Record<RuleId, { hint: string }> = {
  'line-gap': { hint: 'Move the lines apart, merge them, or drop the less important one.' },
  'self-gap': {
    hint: 'Smooth or simplify the line so its turns are wider than a fingertip can resolve.',
  },
  'shallow-crossing': {
    hint: 'Make lines cross closer to a right angle, or separate them before they meet.',
  },
  'label-overlap': { hint: 'Move one label, shorten it, or replace it with a key abbreviation.' },
  'label-crowding': { hint: 'Leave at least the label clearance between braille labels.' },
  'label-collision': {
    hint: 'Move the label off the line, or leave clear space around the braille.',
  },
  'symbol-size': { hint: 'Enlarge the symbol so a fingertip can identify its shape.' },
  'symbol-crowding': { hint: 'Give the symbol clear space so its outline can be traced.' },
  'area-too-small': {
    hint: 'Enlarge the area, use a solid fill, or replace it with a point symbol.',
  },
  'pattern-too-short': {
    hint: 'Use a solid line here; the dash pattern needs more length to be recognised.',
  },
  'line-too-thin': { hint: 'Increase the stroke width so it raises reliably.' },
  'outside-page': { hint: 'Move or shrink the content so it fits on the page.' },
  'in-margin': {
    hint: 'Keep raised features out of the page margin so paper handling does not crush them.',
  },
  crowded: { hint: 'Spread the features out, simplify, or split the graphic across pages.' },
  'too-many-textures': {
    hint: 'Combine categories; readers struggle to tell more than about five textures apart.',
  },
  'too-many-line-styles': { hint: 'Use fewer line styles; combine series or split the graphic.' },
  'too-many-symbols': { hint: 'Use fewer symbol shapes; combine categories or split the graphic.' },
  'missing-title': { hint: 'Add a braille title so the reader knows what they are exploring.' },
  'missing-key': { hint: 'Add a key that explains each texture, line style and symbol.' },
};

function pageSegments(doc: TactileDocument, page: TactilePage): Seg[] {
  const segs: Seg[] = [];
  let path = 0;
  const addPath = (points: Point[], closed: boolean, width: number, ownerId: string) => {
    const pts = closed && points.length > 2 ? [...points, points[0]] : points;
    const total = polylineLength(pts);
    let s = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const l = dist(a, b);
      if (l < 1e-6) continue;
      segs.push({ a, b, width, ownerId, path, s, closed, pathLength: total });
      s += l;
    }
    path++;
  };
  for (const el of page.elements) {
    if (el.kind === 'line') addPath(el.points, !!el.closed, el.width, el.id);
    else if (el.kind === 'area' && el.outline) {
      for (const ring of el.rings) addPath(ring, true, el.outline.width, el.id);
    }
  }
  void doc;
  return segs;
}

function symbolBox(el: TactileElement & { kind: 'symbol' }): Box {
  return { x: el.at.x - el.size / 2, y: el.at.y - el.size / 2, w: el.size, h: el.size };
}

function attached(a: TactileElement | undefined, b: TactileElement | undefined): boolean {
  if (!a || !b) return false;
  return !!(a.attachedTo?.includes(b.id) || b.attachedTo?.includes(a.id));
}

/** Merge nearby hits for the same pair into one issue each. */
function clusterHits(
  hits: { key: string; p: Point; value: number; ids: string[] }[],
  radius: number,
): { ids: string[]; box: Box; value: number }[] {
  const byKey = new Map<string, { p: Point; value: number; ids: string[] }[]>();
  for (const h of hits) {
    let list = byKey.get(h.key);
    if (!list) {
      list = [];
      byKey.set(h.key, list);
    }
    list.push(h);
  }
  const out: { ids: string[]; box: Box; value: number }[] = [];
  for (const list of byKey.values()) {
    const used = new Uint8Array(list.length);
    for (let i = 0; i < list.length; i++) {
      if (used[i]) continue;
      used[i] = 1;
      const group = [list[i]];
      for (let g = 0; g < group.length; g++) {
        for (let j = 0; j < list.length; j++) {
          if (used[j]) continue;
          if (dist(group[g].p, list[j].p) <= radius) {
            used[j] = 1;
            group.push(list[j]);
          }
        }
      }
      const box = inflate(boundsOf(group.map((h) => h.p))!, 2);
      out.push({ ids: list[i].ids, box, value: Math.min(...group.map((h) => h.value)) });
    }
  }
  return out;
}

function checkPage(
  doc: TactileDocument,
  pageIndex: number,
  rules: TouchRules,
  push: (i: Omit<TouchIssue, 'id' | 'page' | 'hint'> & { hint?: string }) => void,
) {
  const page = doc.pages[pageIndex];
  const m = doc.braille.metrics;
  const byId = new Map(page.elements.map((e) => [e.id, e] as const));
  const nameOf = (id: string) => byId.get(id)?.name ?? id;
  const segs = pageSegments(doc, page);
  const maxWidth = Math.max(1, ...segs.map((s) => s.width));
  const reach = rules.minLineGap + maxWidth;
  const grid = new SpatialGrid<number>(Math.max(4, reach * 1.5));
  segs.forEach((s, i) => grid.insert(segmentBox(s.a, s.b), i));

  // --- Line proximity, folds and shallow crossings -------------------------------------
  const gapHits: { key: string; p: Point; value: number; ids: string[] }[] = [];
  // Where two features touch or cross, their neighbouring segments are naturally close:
  // remember those contact points and ignore proximity right next to them.
  const contacts = new Map<string, Point[]>();
  const selfHits: { key: string; p: Point; value: number; ids: string[] }[] = [];
  const angleHits: { key: string; p: Point; value: number; ids: string[] }[] = [];
  segs.forEach((s, i) => {
    const near = grid.query(inflate(segmentBox(s.a, s.b), reach));
    for (const j of near) {
      if (j <= i) continue;
      const t = segs[j];
      const sameOwner = s.ownerId === t.ownerId;
      if (sameOwner && s.path !== t.path) continue; // e.g. outline vs hole of the same area
      const d = segmentDistance(s.a, s.b, t.a, t.b);
      const gap = d.distance - (s.width + t.width) / 2;
      const mid = { x: (d.p.x + d.q.x) / 2, y: (d.p.y + d.q.y) / 2 };
      if (sameOwner) {
        // Distance along the path between the two closest points.
        const along = t.s + dist(t.a, d.q) - (s.s + dist(s.a, d.p));
        let pathGap = Math.abs(along);
        if (s.closed) pathGap = Math.min(pathGap, s.pathLength - pathGap);
        if (pathGap < Math.max(3 * rules.minLineGap, rules.fingertip)) continue;
        if (d.intersects || gap <= 0) continue;
        if (gap < rules.minLineGap - 0.05) {
          selfHits.push({ key: s.ownerId, p: mid, value: Math.max(0, gap), ids: [s.ownerId] });
        }
        continue;
      }
      const ea = byId.get(s.ownerId);
      const eb = byId.get(t.ownerId);
      if (attached(ea, eb)) continue;
      const key = s.ownerId < t.ownerId ? `${s.ownerId}|${t.ownerId}` : `${t.ownerId}|${s.ownerId}`;
      const ids = [s.ownerId, t.ownerId];
      if (d.intersects || gap <= 0) {
        let list = contacts.get(key);
        if (!list) {
          list = [];
          contacts.set(key, list);
        }
        list.push(mid);
        if (!d.intersects) continue; // touching end-to-end: treated as one joined line
        const ls = dist(s.a, s.b);
        const lt = dist(t.a, t.b);
        if (ls < 4 || lt < 4) continue;
        // Ignore T-junctions where a line ends on another.
        const endHit = [s.a, s.b, t.a, t.b].some((p) => dist(p, d.p) < 0.5);
        if (endHit) continue;
        const angle = segmentAngle(s.a, s.b, t.a, t.b);
        if (angle < rules.minCrossingAngle) angleHits.push({ key, p: d.p, value: angle, ids });
        continue;
      }
      if (gap < rules.minLineGap - 0.05) gapHits.push({ key, p: mid, value: gap, ids });
    }
  });
  const contactRadius = rules.minLineGap + maxWidth + 1;
  const realGaps = gapHits.filter(
    (h) => !(contacts.get(h.key) ?? []).some((c) => dist(c, h.p) <= contactRadius),
  );
  for (const c of clusterHits(realGaps, 30)) {
    push({
      rule: 'line-gap',
      severity: c.value < rules.minLineGap / 2 ? 'error' : 'warning',
      message: `"${nameOf(c.ids[0])}" and "${nameOf(c.ids[1])}" are only ${c.value.toFixed(1)} mm apart; fingers need ${rules.minLineGap} mm to feel two lines.`,
      box: c.box,
      elementIds: c.ids,
      measured: c.value,
    });
  }
  for (const c of clusterHits(selfHits, 30)) {
    push({
      rule: 'self-gap',
      severity: 'warning',
      message: `"${nameOf(c.ids[0])}" doubles back on itself with only ${c.value.toFixed(1)} mm between the turns.`,
      box: c.box,
      elementIds: c.ids,
      measured: c.value,
    });
  }
  for (const c of clusterHits(angleHits, 20)) {
    push({
      rule: 'shallow-crossing',
      severity: 'warning',
      message: `"${nameOf(c.ids[0])}" and "${nameOf(c.ids[1])}" cross at ${c.value.toFixed(0)}°, too shallow to tell which line is which.`,
      box: c.box,
      elementIds: c.ids,
      measured: c.value,
    });
  }

  // --- Labels ---------------------------------------------------------------------------
  const labels = page.elements.filter((e): e is LabelElement => e.kind === 'label');
  const boxes = labels.map((l) => labelBox(l, m));
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const g = boxGap(boxes[i], boxes[j]);
      if (boxesOverlap(boxes[i], boxes[j])) {
        push({
          rule: 'label-overlap',
          severity: 'error',
          message: `Braille labels "${labels[i].text}" and "${labels[j].text}" overlap.`,
          box: unionBox(boxes[i], boxes[j])!,
          elementIds: [labels[i].id, labels[j].id],
        });
      } else if (g < rules.labelClearance) {
        // Labels on the same braille line read as one when closer than a blank cell.
        const sameRow = Math.abs(boxes[i].y - boxes[j].y) < 0.5;
        const need = sameRow
          ? m.cellSpacing - m.dotSpacing - m.dotDiameter + m.cellSpacing
          : rules.labelClearance;
        if (g < need - 1e-6) {
          push({
            rule: 'label-crowding',
            severity: 'warning',
            message: `Braille labels "${labels[i].text}" and "${labels[j].text}" are ${g.toFixed(1)} mm apart and may read as one.`,
            box: unionBox(boxes[i], boxes[j])!,
            elementIds: [labels[i].id, labels[j].id],
            measured: g,
          });
        }
      }
    }
  }
  const symbols = page.elements.filter((e) => e.kind === 'symbol');
  labels.forEach((label, i) => {
    const box = boxes[i];
    const zone = inflate(box, rules.labelClearance + maxWidth);
    let worst = Infinity;
    let worstId = '';
    for (const j of grid.query(zone)) {
      const s = segs[j];
      if (attached(label, byId.get(s.ownerId))) continue;
      const d = segmentBoxDistance(s.a, s.b, box) - s.width / 2;
      if (d < worst) {
        worst = d;
        worstId = s.ownerId;
      }
    }
    for (const sym of symbols) {
      if (attached(label, sym)) continue;
      const d = boxGap(box, symbolBox(sym as TactileElement & { kind: 'symbol' }));
      if (d < worst) {
        worst = d;
        worstId = sym.id;
      }
    }
    if (worst <= 0) {
      push({
        rule: 'label-collision',
        severity: 'error',
        message: `Braille label "${label.text}" sits on "${nameOf(worstId)}", so neither can be read.`,
        box: inflate(box, 1),
        elementIds: [label.id, worstId],
      });
    } else if (worst < rules.labelClearance - 0.05) {
      push({
        rule: 'label-collision',
        severity: 'warning',
        message: `Braille label "${label.text}" is ${worst.toFixed(1)} mm from "${nameOf(worstId)}"; leave ${rules.labelClearance} mm of clear space.`,
        box: inflate(box, 1),
        elementIds: [label.id, worstId],
        measured: worst,
      });
    }
  });

  // --- Symbols --------------------------------------------------------------------------
  for (const el of symbols) {
    const s = el as TactileElement & { kind: 'symbol' };
    const box = symbolBox(s);
    if (s.size < rules.minSymbolSize) {
      push({
        rule: 'symbol-size',
        severity: 'warning',
        message: `Symbol "${nameOf(s.id)}" is ${s.size.toFixed(1)} mm across; ${rules.minSymbolSize} mm is the smallest a finger can identify.`,
        box: inflate(box, 1),
        elementIds: [s.id],
        measured: s.size,
      });
    }
    for (const j of grid.query(inflate(box, rules.minLineGap + maxWidth))) {
      const seg = segs[j];
      if (attached(s, byId.get(seg.ownerId))) continue;
      const d = segmentBoxDistance(seg.a, seg.b, box) - seg.width / 2;
      if (d < rules.minLineGap - 0.05) {
        push({
          rule: 'symbol-crowding',
          severity: d <= 0 ? 'error' : 'warning',
          message:
            d <= 0
              ? `Symbol "${nameOf(s.id)}" overlaps "${nameOf(seg.ownerId)}".`
              : `Symbol "${nameOf(s.id)}" is ${d.toFixed(1)} mm from "${nameOf(seg.ownerId)}".`,
          box: inflate(box, 1),
          elementIds: [s.id, seg.ownerId],
          measured: Math.max(0, d),
        });
        break;
      }
    }
  }
  for (let i = 0; i < symbols.length; i++) {
    for (let j = i + 1; j < symbols.length; j++) {
      const a = symbolBox(symbols[i] as TactileElement & { kind: 'symbol' });
      const b = symbolBox(symbols[j] as TactileElement & { kind: 'symbol' });
      const g = boxGap(a, b);
      if (g < rules.minLineGap - 0.05) {
        push({
          rule: 'symbol-crowding',
          severity: boxesOverlap(a, b) ? 'error' : 'warning',
          message: boxesOverlap(a, b)
            ? `Symbols "${nameOf(symbols[i].id)}" and "${nameOf(symbols[j].id)}" overlap.`
            : `Symbols "${nameOf(symbols[i].id)}" and "${nameOf(symbols[j].id)}" are ${g.toFixed(1)} mm apart.`,
          box: unionBox(a, b)!,
          elementIds: [symbols[i].id, symbols[j].id],
          measured: g,
        });
      }
    }
  }

  // --- Areas, line widths and patterns --------------------------------------------------
  for (const el of page.elements) {
    if (el.kind === 'area' && el.texture !== 'none' && el.texture !== 'solid') {
      // Diameter of the largest circle that fits inside: how much texture a finger can explore.
      const w = 2 * interiorPoint(el.rings).clearance;
      if (w < rules.minAreaWidth) {
        const b = boundsOf(el.rings[0])!;
        push({
          rule: 'area-too-small',
          severity: w < rules.minAreaWidth / 3 ? 'error' : 'warning',
          message: `"${nameOf(el.id)}" is about ${w.toFixed(1)} mm wide; its texture needs ${rules.minAreaWidth} mm to be recognised.`,
          box: inflate(b, 1),
          elementIds: [el.id],
          measured: w,
        });
      }
    }
    if (el.kind === 'line' || (el.kind === 'area' && el.outline)) {
      const width = el.kind === 'line' ? el.width : el.outline!.width;
      const style = el.kind === 'line' ? el.style : el.outline!.style;
      const pts = el.kind === 'line' ? el.points : el.rings[0];
      const b = boundsOf(pts);
      if (!b) continue;
      if (width < rules.minLineWidth && el.role !== 'grid') {
        push({
          rule: 'line-too-thin',
          severity: 'warning',
          message: `"${nameOf(el.id)}" is ${width.toFixed(2)} mm wide; ${rules.minLineWidth} mm is the thinnest line that raises reliably.`,
          box: inflate(b, 1),
          elementIds: [el.id],
          measured: width,
        });
      }
      const length =
        el.kind === 'line' ? polylineLength(el.points, !!el.closed) : polylineLength(pts, true);
      if (style !== 'solid' && length < rules.minPatternLength) {
        push({
          rule: 'pattern-too-short',
          severity: 'warning',
          message: `"${nameOf(el.id)}" is ${length.toFixed(0)} mm long; a ${style} pattern needs ${rules.minPatternLength} mm to be recognised.`,
          box: inflate(b, 2),
          elementIds: [el.id],
          measured: length,
        });
      }
    }
  }

  // --- Page bounds ----------------------------------------------------------------------
  const { width: W, height: H, margin } = doc.page;
  const pageBox = { x: 0, y: 0, w: W, h: H };
  const inner = { x: margin, y: margin, w: W - 2 * margin, h: H - 2 * margin };
  const prims = pagePrimitives(doc, pageIndex);
  const perOwner = new Map<string, Box>();
  for (const p of prims)
    perOwner.set(p.ownerId, unionBox(perOwner.get(p.ownerId) ?? null, primitiveBounds(p))!);
  for (const [id, b] of perOwner) {
    if (!boxContains(pageBox, b)) {
      push({
        rule: 'outside-page',
        severity: 'error',
        message: `"${nameOf(id)}" runs off the page.`,
        box: b,
        elementIds: [id],
      });
    } else if (!boxContains(inner, b, 0.5)) {
      push({
        rule: 'in-margin',
        severity: 'info',
        message: `"${nameOf(id)}" reaches into the ${margin} mm page margin.`,
        box: b,
        elementIds: [id],
      });
    }
  }

  // --- Crowding: distinct features under one fingertip ----------------------------------
  const ft = rules.fingertip;
  const crowdGrid = new SpatialGrid<string>(ft);
  // Use segments/dots individually so long lines only count where they actually pass.
  for (const p of prims) {
    const e = byId.get(p.ownerId);
    if (!e || e.role === 'key') continue;
    crowdGrid.insert(primitiveBounds(p), e.group ?? p.ownerId);
  }
  const crowdHits: { key: string; p: Point; value: number; ids: string[] }[] = [];
  for (let y = margin; y < H - margin; y += ft / 2) {
    for (let x = margin; x < W - margin; x += ft / 2) {
      const win = { x, y, w: ft, h: ft };
      const ids = [...new Set(crowdGrid.query(win))];
      if (ids.length > rules.maxFeaturesPerFingertip) {
        crowdHits.push({
          key: 'crowd',
          p: { x: x + ft / 2, y: y + ft / 2 },
          value: ids.length,
          ids,
        });
      }
    }
  }
  for (const c of clusterHits(crowdHits, ft)) {
    const maxCount = Math.max(
      ...crowdHits
        .filter((h) => boxContains(inflate(c.box, 0.1), { x: h.p.x, y: h.p.y, w: 0, h: 0 }))
        .map((h) => h.value),
    );
    const groups = new Set(
      crowdHits
        .filter((h) => boxContains(inflate(c.box, 0.1), { x: h.p.x, y: h.p.y, w: 0, h: 0 }))
        .flatMap((h) => h.ids),
    );
    const ids = page.elements.filter((e) => groups.has(e.group ?? e.id)).map((e) => e.id);
    push({
      rule: 'crowded',
      severity: 'info',
      message: `Up to ${maxCount} different features fall under one fingertip here.`,
      box: inflate(c.box, ft / 2 - 2),
      elementIds: ids,
      measured: maxCount,
    });
  }
}

/** Run every touch-readability rule over a document. */
export function checkDocument(
  doc: TactileDocument,
  overrides: Partial<TouchRules> = {},
): TouchReport {
  const rules = { ...DEFAULT_RULES, ...overrides };
  const issues: TouchIssue[] = [];
  let counter = 0;
  const pushFor =
    (page: number) => (i: Omit<TouchIssue, 'id' | 'page' | 'hint'> & { hint?: string }) => {
      issues.push({ ...i, hint: i.hint ?? RULE_TEXT[i.rule].hint, id: `issue-${++counter}`, page });
    };
  doc.pages.forEach((_, i) => checkPage(doc, i, rules, pushFor(i)));

  // --- Document-level rules -------------------------------------------------------------
  const graphic = doc.pages[0];
  const textures = new Set<string>();
  const lineStyles = new Set<string>();
  const shapes = new Set<string>();
  for (const el of graphic?.elements ?? []) {
    if (el.role === 'key') continue;
    if (el.kind === 'area' && el.texture !== 'none') textures.add(el.texture);
    if (el.kind === 'line' && el.role === 'data') lineStyles.add(el.style);
    if (el.kind === 'symbol') shapes.add(el.shape);
  }
  const whole = { x: 0, y: 0, w: doc.page.width, h: doc.page.height };
  const docIssue = pushFor(0);
  if (textures.size > rules.maxTextures) {
    docIssue({
      rule: 'too-many-textures',
      severity: 'warning',
      message: `${textures.size} different textures are used; more than ${rules.maxTextures} are hard to tell apart.`,
      box: whole,
      elementIds: [],
      measured: textures.size,
    });
  }
  if (lineStyles.size > rules.maxLineStyles) {
    docIssue({
      rule: 'too-many-line-styles',
      severity: 'warning',
      message: `${lineStyles.size} line styles are used; more than ${rules.maxLineStyles} are hard to tell apart.`,
      box: whole,
      elementIds: [],
      measured: lineStyles.size,
    });
  }
  if (shapes.size > rules.maxSymbolShapes) {
    docIssue({
      rule: 'too-many-symbols',
      severity: 'warning',
      message: `${shapes.size} symbol shapes are used; more than ${rules.maxSymbolShapes} are hard to tell apart.`,
      box: whole,
      elementIds: [],
      measured: shapes.size,
    });
  }
  const hasTitle = doc.pages.some((p) => p.elements.some((e) => e.role === 'title'));
  if (!hasTitle) {
    docIssue({
      rule: 'missing-title',
      severity: 'info',
      message: 'The graphic has no braille title.',
      box: { x: 0, y: 0, w: doc.page.width, h: 20 },
      elementIds: [],
    });
  }
  if (
    textures.size + shapes.size + (lineStyles.size > 1 ? lineStyles.size : 0) > 1 &&
    doc.key.length === 0
  ) {
    docIssue({
      rule: 'missing-key',
      severity: 'info',
      message: 'Several textures, line styles or symbols are used but there is no key.',
      box: whole,
      elementIds: [],
    });
  }

  // --- Score ----------------------------------------------------------------------------
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const i of issues) counts[i.severity]++;
  const penalty = counts.error * 9 + counts.warning * 3 + counts.info * 0.5;
  const score = Math.max(0, Math.round(100 - penalty));
  const verdict = counts.error === 0 && score >= 90 ? 'ready' : score >= 65 ? 'review' : 'rework';

  const prims = graphic ? pagePrimitives(doc, 0) : [];
  let inkArea = 0;
  for (const p of prims) {
    if (p.type === 'dot') inkArea += Math.PI * p.r * p.r;
    else if (p.type === 'stroke') inkArea += polylineLength(p.points, p.closed) * p.width;
    else inkArea += polygonArea(p.rings);
  }
  const usable = Math.max(
    1,
    (doc.page.width - 2 * doc.page.margin) * (doc.page.height - 2 * doc.page.margin),
  );

  issues.sort((a, b) => {
    const order = { error: 0, warning: 1, info: 2 };
    return order[a.severity] - order[b.severity] || a.page - b.page;
  });

  return {
    score,
    verdict,
    issues,
    counts,
    stats: {
      elements: doc.pages.reduce((n, p) => n + p.elements.length, 0),
      labels: doc.pages.reduce(
        (n, p) => n + p.elements.filter((e) => e.kind === 'label').length,
        0,
      ),
      textures: textures.size,
      lineStyles: lineStyles.size,
      symbolShapes: shapes.size,
      coverage: Math.min(1, inkArea / usable),
    },
    rules,
  };
}

/** One-line human summary of a report. */
export function summarizeReport(r: TouchReport): string {
  const v = { ready: 'Ready to print', review: 'Review the flagged areas', rework: 'Needs rework' }[
    r.verdict
  ];
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`;
  return `Touch score ${r.score}/100 — ${v} (${n(r.counts.error, 'error')}, ${n(r.counts.warning, 'warning')}, ${n(r.counts.info, 'note')})`;
}
