import { cellCount, BLANK_CELL } from '../braille/cells.js';
import type { BrailleTranslator } from '../braille/translator.js';
import { uebGrade1 } from '../braille/translator.js';
import { DEFAULT_PAGE, LINE_WEIGHTS } from '../config.js';
import { addKeyPage, createDocument, layoutKey, measureKey } from '../document.js';
import { subtractBoxesFromSegment } from '../geometry/polygon.js';
import { inflate, pointSegmentDistance } from '../geometry/vec.js';
import { brailleSize, cellsThatFit, labelBox, makeLabel, wrapBraille } from '../layout/labels.js';
import { escapeXml } from '../render/svg.js';
import { LINE_STYLE_ORDER, SIGHTED_PALETTE, SYMBOL_ORDER, TEXTURE_ORDER } from '../styles.js';
import type {
  AreaElement,
  BrailleSettings,
  BuildResult,
  Box,
  KeyEntry,
  LabelElement,
  LineElement,
  PageSpec,
  Point,
  TactileElement,
} from '../types.js';

export type ChartType = 'bar' | 'line' | 'scatter' | 'pie';

export interface ChartSeries {
  name: string;
  values: number[];
  /** X values (scatter charts only). */
  x?: number[];
}

export interface ChartSpec {
  type: ChartType;
  title: string;
  /** Category names for bar, line and pie charts. */
  categories?: string[];
  series: ChartSeries[];
  xLabel?: string;
  yLabel?: string;
  yMin?: number;
  yMax?: number;
  /** Dotted guide lines at each value tick (default: on for line and scatter charts). */
  gridlines?: boolean;
  page?: PageSpec;
  /** Extra sentence(s) appended to the generated description. */
  description?: string;
}

export interface ChartBuildOptions {
  translator?: BrailleTranslator;
  braille?: Partial<BrailleSettings>;
}

// ---------------------------------------------------------------------------------------
// Scales
// ---------------------------------------------------------------------------------------

export interface NiceScale {
  min: number;
  max: number;
  step: number;
  ticks: number[];
}

/** "Nice" tick values (1, 2, 2.5, 5 × 10ⁿ) covering [min, max] with at most `maxTicks` ticks. */
export function niceScale(min: number, max: number, maxTicks = 6): NiceScale {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0;
    max = 1;
  }
  if (min === max) {
    if (min === 0) max = 1;
    else if (min > 0) min = 0;
    else max = 0;
  }
  const span = max - min;
  const rough = span / Math.max(1, maxTicks - 1);
  const mag = 10 ** Math.floor(Math.log10(rough));
  let step = mag * 10;
  for (const f of [1, 2, 2.5, 5, 10]) {
    if (f * mag >= rough) {
      step = f * mag;
      break;
    }
  }
  const lo = Math.floor(min / step + 1e-9) * step;
  const hi = Math.ceil(max / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step * 1e-6; v += step) ticks.push(Math.round(v / step) * step);
  return { min: lo, max: hi, step, ticks };
}

export function formatNumber(v: number, step = 1): string {
  const decimals = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step) - 1e-9));
  const s = v.toFixed(decimals);
  return decimals > 0 ? s.replace(/\.?0+$/, '') : s === '-0' ? '0' : s;
}

/** Short unique lowercase codes for key abbreviations. */
export function abbreviationCodes(labels: string[]): string[] {
  const used = new Set<string>();
  return labels.map((label, i) => {
    const letters = label
      .toLowerCase()
      .normalize('NFD')
      .replace(/[^a-z]/g, '');
    for (let n = 1; n <= Math.min(3, letters.length); n++) {
      const code = letters.slice(0, n);
      if (!used.has(code)) {
        used.add(code);
        return code;
      }
    }
    for (let k = 1; ; k++) {
      const base = letters[0] ?? 'x';
      const code = `${base}${String.fromCharCode(97 + ((i + k) % 26))}`;
      if (!used.has(code)) {
        used.add(code);
        return code;
      }
    }
  });
}

// ---------------------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------------------

/** RFC 4180-ish CSV parser (quotes, escaped quotes, CRLF, `,` `;` or tab delimiters). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const delim = [',', ';', '\t'].sort(
    (a, b) => firstLine.split(b).length - firstLine.split(a).length,
  )[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === delim) {
      row.push(field.trim());
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field.trim());
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field.trim());
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

function toNumber(s: string): number {
  const cleaned = s.replace(/[\s,$€£%]/g, '').replace(/^\((.*)\)$/, '-$1');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Turn CSV text into a chart spec. The first row holds headers; the first column holds category
 * names (or x values for scatter charts); every other column becomes a series.
 */
export function chartFromCsv(
  csv: string,
  base: Omit<ChartSpec, 'series' | 'categories'>,
): ChartSpec {
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new Error('CSV needs a header row and at least one data row');
  const header = rows[0];
  const body = rows.slice(1);
  if (header.length < 2) throw new Error('CSV needs at least two columns (categories and values)');
  const series: ChartSeries[] = [];
  for (let c = 1; c < header.length; c++) {
    const values = body.map((r) => toNumber(r[c] ?? ''));
    if (values.every((v) => Number.isNaN(v))) continue;
    series.push({
      name: header[c] || `Series ${c}`,
      values,
      ...(base.type === 'scatter' ? { x: body.map((r) => toNumber(r[0] ?? '')) } : {}),
    });
  }
  if (series.length === 0) throw new Error('No numeric columns found in the CSV');
  return {
    ...base,
    xLabel: base.xLabel ?? (base.type === 'pie' ? undefined : header[0] || undefined),
    yLabel:
      base.yLabel ?? (series.length === 1 && base.type !== 'pie' ? series[0].name : undefined),
    categories: body.map((r) => r[0] ?? ''),
    series,
  };
}

// ---------------------------------------------------------------------------------------
// Description
// ---------------------------------------------------------------------------------------

export function describeChart(spec: ChartSpec): string {
  const cats = spec.categories ?? [];
  const typeName = {
    bar: 'Bar chart',
    line: 'Line graph',
    scatter: 'Scatter plot',
    pie: 'Pie chart',
  }[spec.type];
  const parts: string[] = [`${typeName} titled "${spec.title}".`];
  if (spec.type === 'pie') {
    const vals = spec.series[0]?.values ?? [];
    const total = vals.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0) || 1;
    parts.push(
      `${cats.length} slices: ` +
        cats.map((c, i) => `${c} ${Math.round(((vals[i] ?? 0) / total) * 100)}%`).join(', ') +
        '.',
    );
  } else {
    if (spec.xLabel) parts.push(`The horizontal axis shows ${spec.xLabel}.`);
    if (spec.yLabel) parts.push(`The vertical axis shows ${spec.yLabel}.`);
    for (const s of spec.series) {
      const finite = s.values.map((v, i) => ({ v, i })).filter((p) => Number.isFinite(p.v));
      if (!finite.length) continue;
      const hi = finite.reduce((a, b) => (b.v > a.v ? b : a));
      const lo = finite.reduce((a, b) => (b.v < a.v ? b : a));
      const name = (i: number) =>
        spec.type === 'scatter' ? `x = ${s.x?.[i]}` : (cats[i] ?? `#${i + 1}`);
      if (spec.type === 'scatter') {
        parts.push(
          `${s.name}: ${finite.length} points, y from ${formatNumber(lo.v, 0.01)} to ${formatNumber(hi.v, 0.01)}.`,
        );
      } else {
        parts.push(
          `${s.name}: ` +
            finite.map((p) => `${name(p.i)} ${formatNumber(p.v, 0.01)}`).join(', ') +
            `. Highest is ${name(hi.i)} (${formatNumber(hi.v, 0.01)}), lowest is ${name(lo.i)} (${formatNumber(lo.v, 0.01)}).`,
        );
      }
    }
  }
  if (spec.description) parts.push(spec.description);
  return parts.join(' ');
}

// ---------------------------------------------------------------------------------------
// Tactile layout
// ---------------------------------------------------------------------------------------

const AXIS_W = 1.4;
const TICK_LEN = 4;
/** Clear space between a tick end and its braille label (edge to edge ≥ 3 mm). */
const LABEL_GAP = 3.8;
/** Space kept between the axes and the nearest data point. */
const DATA_PAD = 8.5;

function rectRing(x: number, y: number, w: number, h: number): Point[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

function finiteValues(spec: ChartSpec): number[] {
  return spec.series.flatMap((s) => s.values.filter((v) => Number.isFinite(v)));
}

interface CartesianLayout {
  elements: TactileElement[];
  key: KeyEntry[];
}

function buildCartesian(
  spec: ChartSpec,
  page: PageSpec,
  t: BrailleTranslator,
  doc: ReturnType<typeof createDocument>,
  notes: string[],
): CartesianLayout {
  const m = doc.braille.metrics;
  const { margin } = page;
  const x0 = margin;
  const x1 = page.width - margin;
  const y1 = page.height - margin;
  const contentW = x1 - x0;
  const contentH = y1 - margin;
  const elements: TactileElement[] = [];
  const isScatter = spec.type === 'scatter';
  const cats = spec.categories ?? [];

  // Title.
  const title = makeLabel(
    {
      id: 'title',
      text: spec.title,
      at: { x: x0, y: margin },
      maxWidth: contentW,
      role: 'title',
      sourceId: 'title',
    },
    t,
    m,
  );
  elements.push(title);
  let top = margin + brailleSize(title.braille, m).h + 7;

  // Y axis title sits horizontally above the axis (braille cannot be rotated).
  if (spec.yLabel) {
    const yTitle = makeLabel(
      {
        id: 'y-title',
        text: spec.yLabel,
        at: { x: x0, y: top },
        maxWidth: contentW * 0.7,
        role: 'label',
        sourceId: 'y-title',
        name: `Vertical axis: ${spec.yLabel}`,
      },
      t,
      m,
    );
    elements.push(yTitle);
    top += brailleSize(yTitle.braille, m).h + 6;
  }

  // Value scale.
  const vals = finiteValues(spec);
  const dataMin = Math.min(0, ...vals);
  const dataMax = Math.max(...vals, spec.type === 'bar' ? 0 : -Infinity);
  const lo =
    spec.yMin ??
    (spec.type === 'bar'
      ? Math.min(0, dataMin)
      : isScatter || spec.type === 'line'
        ? Math.min(...vals)
        : dataMin);
  const hi = spec.yMax ?? dataMax;

  // Series key entries and category abbreviations (decided before final layout).
  const key: KeyEntry[] = [];
  const multi = spec.series.length > 1;
  spec.series.forEach((s, i) => {
    if (!multi) return;
    if (spec.type === 'bar')
      key.push({
        swatch: { kind: 'texture', texture: TEXTURE_ORDER[i % TEXTURE_ORDER.length] },
        text: s.name,
      });
    else if (spec.type === 'line')
      key.push({
        swatch: {
          kind: 'line',
          style: LINE_STYLE_ORDER[i % LINE_STYLE_ORDER.length],
          width: LINE_WEIGHTS.medium,
          symbol: SYMBOL_ORDER[i % SYMBOL_ORDER.length],
        },
        text: s.name,
      });
    else
      key.push({
        swatch: { kind: 'symbol', shape: SYMBOL_ORDER[i % SYMBOL_ORDER.length] },
        text: s.name,
      });
  });

  // Estimate y tick label width to size the plot.
  const scaleGuess = niceScale(lo, hi, 7);
  const tickTexts = scaleGuess.ticks.map((v) => formatNumber(v, scaleGuess.step));
  const yTickW = Math.max(...tickTexts.map((s) => brailleSize([t.translate(s)], m).w));
  const plotX0 = x0 + yTickW + LABEL_GAP + TICK_LEN;
  const plotX1 = x1 - 4;
  const plotW = plotX1 - plotX0;

  // Category labels: full text if it fits under its slot, otherwise key abbreviations.
  let catTexts = cats;
  let catLines: string[][] = [];
  const slotW = cats.length
    ? plotW / Math.max(1, spec.type === 'line' ? cats.length - 1 || 1 : cats.length)
    : plotW;
  if (!isScatter && cats.length) {
    const fit = cellsThatFit(slotW - m.cellSpacing, m);
    const tryLines = cats.map((c) => wrapBraille(t.translate(c), fit));
    const fits = tryLines.every(
      (lines, i) =>
        lines.length <= 2 &&
        t
          .translate(cats[i])
          .split(BLANK_CELL)
          .every((w) => cellCount(w) <= fit),
    );
    if (fits) catLines = tryLines;
    else {
      const codes = abbreviationCodes(cats);
      catTexts = codes;
      catLines = codes.map((c) => [t.translate(c)]);
      cats.forEach((c, i) =>
        key.push({ swatch: { kind: 'abbreviation', code: codes[i] }, text: c }),
      );
      notes.push(
        'Category names were too long to fit under the chart, so key abbreviations are used.',
      );
    }
  }
  const catLineCount = Math.max(1, ...catLines.map((l) => l.length));

  // X axis title.
  const xTitleH = spec.xLabel
    ? brailleSize(wrapBraille(t.translate(spec.xLabel), cellsThatFit(contentW, m)), m).h
    : 0;

  // Decide whether the key fits on the graphic page.
  let keyH = key.length ? measureKey(key, contentW, t, doc) : 0;
  const keyOnPage = key.length > 0 && keyH <= contentH * 0.3;
  if (!keyOnPage) keyH = 0;
  const xTickLabelH = (catLineCount - 1) * m.lineSpacing + 2 * m.dotSpacing + m.dotDiameter;
  const bottomReserve =
    (keyOnPage ? keyH + 8 : 0) +
    (spec.xLabel ? xTitleH + 6 : 0) +
    xTickLabelH +
    LABEL_GAP +
    (spec.type === 'bar' ? 1 : TICK_LEN);
  const plotY1 = y1 - bottomReserve;
  const plotY0 = top + 3;
  const plotH = plotY1 - plotY0;
  if (plotH < 40) notes.push('The plot area is very small; use a larger page or fewer labels.');

  // Final value ticks with ≥ 14 mm spacing.
  const maxTicks = Math.max(2, Math.min(8, Math.floor(plotH / 14) + 1));
  const ys = niceScale(lo, hi, maxTicks);
  const pad = spec.type === 'bar' ? 0 : DATA_PAD;
  const Y = (v: number) => plotY1 - pad - ((v - ys.min) / (ys.max - ys.min)) * (plotH - pad);
  const baseY = Y(Math.max(ys.min, Math.min(ys.max, 0)));

  // Axes.
  const yAxis: LineElement = {
    kind: 'line',
    id: 'y-axis',
    role: 'axis',
    name: 'Vertical axis',
    sourceId: 'y-axis',
    points: [
      { x: plotX0, y: plotY0 - 2 },
      { x: plotX0, y: plotY1 },
    ],
    width: AXIS_W,
    style: 'solid',
  };
  const xAxisY = spec.type === 'bar' ? baseY : plotY1;
  const xAxis: LineElement = {
    kind: 'line',
    id: 'x-axis',
    role: 'axis',
    name: 'Horizontal axis',
    sourceId: 'x-axis',
    points: [
      { x: plotX0, y: xAxisY },
      { x: plotX1, y: xAxisY },
    ],
    width: AXIS_W,
    style: 'solid',
    attachedTo: ['y-axis'],
  };
  elements.push(yAxis, xAxis);

  // Y ticks and labels.
  const yTickLabels: LabelElement[] = [];
  ys.ticks.forEach((v, i) => {
    const y = Y(v);
    elements.push({
      kind: 'line',
      id: `y-tick-${i}`,
      role: 'tick',
      group: 'y-ticks',
      name: `Tick ${formatNumber(v, ys.step)}`,
      points: [
        { x: plotX0 - TICK_LEN, y },
        { x: plotX0, y },
      ],
      width: LINE_WEIGHTS.medium,
      style: 'solid',
      attachedTo: ['y-axis', 'x-axis'],
    });
    const lab = makeLabel(
      {
        id: `y-tick-label-${i}`,
        text: formatNumber(v, ys.step),
        at: { x: plotX0 - TICK_LEN - LABEL_GAP, y },
        align: 'end',
        valign: 'middle',
        sourceId: `ytick-${i}`,
        name: `Value ${formatNumber(v, ys.step)}`,
      },
      t,
      m,
    );
    lab.group = 'y-tick-labels';
    yTickLabels.push(lab);
    elements.push(lab);
  });

  // Data.
  const blockers: Box[] = [];
  const catX = (i: number) =>
    spec.type === 'line'
      ? cats.length <= 1
        ? plotX0 + plotW / 2
        : plotX0 + DATA_PAD + ((plotW - 2 * DATA_PAD) * i) / (cats.length - 1)
      : plotX0 + slotW * (i + 0.5);
  let xs: NiceScale | null = null;

  if (spec.type === 'bar') {
    const k = spec.series.length;
    // Leave a fingertip-readable gap (≥ 3 mm clear, plus outlines) between bars and groups.
    const groupPad = Math.max(8.8, slotW * 0.18);
    const barGap = k > 1 ? 4.1 : 0;
    const barW = (slotW - groupPad - (k - 1) * barGap) / k;
    if (barW < 8)
      notes.push(
        `Bars are only ${barW.toFixed(1)} mm wide; consider fewer categories or a wider page.`,
      );
    cats.forEach((c, ci) => {
      const gx = plotX0 + slotW * ci + groupPad / 2;
      spec.series.forEach((s, si) => {
        const v = s.values[ci];
        if (!Number.isFinite(v) || v === 0) return;
        const yv = Y(v);
        const x = gx + si * (barW + barGap);
        const yTop = Math.min(yv, baseY);
        const h = Math.abs(baseY - yv);
        const area: AreaElement = {
          kind: 'area',
          id: `bar-${si}-${ci}`,
          role: 'data',
          sourceId: `bar-${si}-${ci}`,
          name: `${s.name}, ${c}: ${formatNumber(v, 0.01)}`,
          rings: [rectRing(x, yTop, barW, h)],
          texture: TEXTURE_ORDER[si % TEXTURE_ORDER.length],
          outline: { width: LINE_WEIGHTS.medium, style: 'solid' },
          attachedTo: ['x-axis'],
        };
        blockers.push({ x, y: yTop, w: barW, h });
        elements.push(area);
      });
    });
  } else if (spec.type === 'line') {
    spec.series.forEach((s, si) => {
      const pts: Point[] = [];
      const lineId = `series-${si}`;
      s.values.forEach((v, i) => {
        if (Number.isFinite(v)) pts.push({ x: catX(i), y: Y(v) });
      });
      elements.push({
        kind: 'line',
        id: lineId,
        role: 'data',
        sourceId: lineId,
        name: s.name,
        points: pts,
        width: LINE_WEIGHTS.medium + 0.2,
        style: LINE_STYLE_ORDER[si % LINE_STYLE_ORDER.length],
      });
      s.values.forEach((v, i) => {
        if (!Number.isFinite(v)) return;
        elements.push({
          kind: 'symbol',
          id: `point-${si}-${i}`,
          role: 'data',
          sourceId: `pt-${si}-${i}`,
          name: `${s.name}, ${cats[i] ?? i + 1}: ${formatNumber(v, 0.01)}`,
          at: { x: catX(i), y: Y(v) },
          shape: SYMBOL_ORDER[si % SYMBOL_ORDER.length],
          size: 6.5,
          attachedTo: [lineId],
        });
      });
    });
    // Category ticks.
    cats.forEach((_, i) => {
      elements.push({
        kind: 'line',
        id: `x-tick-${i}`,
        role: 'tick',
        group: 'x-ticks',
        name: `Tick ${cats[i]}`,
        points: [
          { x: catX(i), y: plotY1 },
          { x: catX(i), y: plotY1 + TICK_LEN },
        ],
        width: LINE_WEIGHTS.medium,
        style: 'solid',
        attachedTo: ['x-axis'],
      });
    });
  } else {
    const allX = spec.series.flatMap((s) => (s.x ?? []).filter((v) => Number.isFinite(v)));
    // Fewer ticks until neighbouring braille labels have at least one blank cell between them.
    for (let n = 9; n >= 2; n--) {
      xs = niceScale(Math.min(...allX), Math.max(...allX), n);
      const widest = Math.max(
        ...xs.ticks.map((v) => brailleSize([t.translate(formatNumber(v, xs!.step))], m).w),
      );
      const spacing = (plotW - 2 * DATA_PAD) / Math.max(1, xs.ticks.length - 1);
      if (spacing >= widest + m.cellSpacing + 1) break;
    }
    const X = (v: number) =>
      plotX0 + DATA_PAD + ((v - xs!.min) / (xs!.max - xs!.min)) * (plotW - 2 * DATA_PAD);
    spec.series.forEach((s, si) => {
      s.values.forEach((v, i) => {
        const xv = s.x?.[i];
        if (!Number.isFinite(v) || xv === undefined || !Number.isFinite(xv)) return;
        elements.push({
          kind: 'symbol',
          id: `point-${si}-${i}`,
          role: 'data',
          sourceId: `pt-${si}-${i}`,
          name: `${s.name}: (${formatNumber(xv, 0.01)}, ${formatNumber(v, 0.01)})`,
          at: { x: X(xv), y: Y(v) },
          shape: SYMBOL_ORDER[si % SYMBOL_ORDER.length],
          size: 6.5,
        });
      });
    });
    xs!.ticks.forEach((v, i) => {
      const x = X(v);
      elements.push({
        kind: 'line',
        id: `x-tick-${i}`,
        role: 'tick',
        group: 'x-ticks',
        name: `Tick ${formatNumber(v, xs!.step)}`,
        points: [
          { x, y: plotY1 },
          { x, y: plotY1 + TICK_LEN },
        ],
        width: LINE_WEIGHTS.medium,
        style: 'solid',
        attachedTo: ['x-axis'],
      });
      const lab = makeLabel(
        {
          id: `x-tick-label-${i}`,
          text: formatNumber(v, xs!.step),
          at: { x, y: plotY1 + TICK_LEN + LABEL_GAP },
          align: 'middle',
          sourceId: `xtick-${i}`,
          name: `Value ${formatNumber(v, xs!.step)}`,
        },
        t,
        m,
      );
      lab.group = 'x-tick-labels';
      elements.push(lab);
    });
  }

  // Category labels under the axis.
  if (!isScatter) {
    catLines.forEach((lines, i) => {
      const size = brailleSize(lines, m);
      const cx = catX(i);
      const y = plotY1 + (spec.type === 'bar' ? AXIS_W / 2 + 0.2 : TICK_LEN) + LABEL_GAP;
      const label: LabelElement = {
        kind: 'label',
        id: `x-label-${i}`,
        role: 'label',
        group: 'x-labels',
        sourceId: `cat-${i}`,
        name: cats[i],
        text: catTexts[i],
        braille: lines,
        at: { x: Math.max(x0, Math.min(x1 - size.w, cx - size.w / 2)), y },
      };
      elements.push(label);
    });
  }

  // Gridlines, cut around bars and labels so they never touch data.
  const grid = spec.gridlines ?? spec.type !== 'bar';
  if (grid) {
    const cut = [...blockers.map((b) => inflate(b, 3.4))];
    const dataLines: LineElement[] = [];
    for (const el of elements) {
      if (el.kind === 'symbol' && el.role === 'data') {
        cut.push(
          inflate(
            { x: el.at.x - el.size / 2, y: el.at.y - el.size / 2, w: el.size, h: el.size },
            3.4,
          ),
        );
      }
      if (el.kind === 'line' && el.role === 'data') dataLines.push(el);
    }
    ys.ticks.forEach((v, i) => {
      const y = Y(v);
      if (Math.abs(y - xAxisY) < 1) return;
      // Break the gridline wherever a data line comes within reach, so data lines stay clear.
      const lineCuts: Box[] = [];
      const step = 0.5;
      let runStart: number | null = null;
      for (let x = plotX0 + 5; x <= plotX1 + step; x += step) {
        let near = false;
        if (x <= plotX1) {
          for (const dl of dataLines) {
            const reachD = 3.4 + dl.width / 2 + 0.3;
            for (let k = 1; k < dl.points.length && !near; k++) {
              if (pointSegmentDistance({ x, y }, dl.points[k - 1], dl.points[k]) < reachD)
                near = true;
            }
            if (near) break;
          }
        }
        if (near && runStart === null) runStart = x;
        if (!near && runStart !== null) {
          lineCuts.push({ x: runStart - 0.5, y: y - 1, w: x - runStart + 0.5, h: 2 });
          runStart = null;
        }
      }
      const pieces = subtractBoxesFromSegment({ x: plotX0 + 5, y }, { x: plotX1, y }, [
        ...cut,
        ...lineCuts,
      ]);
      pieces.forEach(([a, b], k) => {
        if (b.x - a.x < 13) return;
        elements.push({
          kind: 'line',
          id: `grid-${i}-${k}`,
          role: 'grid',
          group: 'grid',
          name: `Gridline ${formatNumber(v, ys.step)}`,
          points: [a, b],
          width: 0.6,
          style: 'dotted',
        });
      });
    });
  }

  // X axis title.
  if (spec.xLabel) {
    const yy = plotY1 + (spec.type === 'bar' ? 1 : TICK_LEN) + LABEL_GAP + xTickLabelH + 6;
    const lab = makeLabel(
      {
        id: 'x-title',
        text: spec.xLabel,
        at: { x: plotX0 + plotW / 2, y: yy },
        align: 'middle',
        maxWidth: contentW,
        sourceId: 'x-title',
        name: `Horizontal axis: ${spec.xLabel}`,
      },
      t,
      m,
    );
    const b = labelBox(lab, m);
    lab.at.x = Math.max(x0, Math.min(x1 - b.w, lab.at.x));
    elements.push(lab);
  }

  // Key on the page, below everything else.
  if (keyOnPage) {
    const k = layoutKey(key, { x: x0, y: y1 - keyH }, contentW, t, doc);
    elements.push(...k.elements);
  }
  void yTickLabels;
  doc.key = key;
  return { elements, key: keyOnPage ? [] : key };
}

function buildPie(
  spec: ChartSpec,
  page: PageSpec,
  t: BrailleTranslator,
  doc: ReturnType<typeof createDocument>,
  notes: string[],
): CartesianLayout {
  const m = doc.braille.metrics;
  const { margin } = page;
  const contentW = page.width - 2 * margin;
  const elements: TactileElement[] = [];
  const title = makeLabel(
    {
      id: 'title',
      text: spec.title,
      at: { x: margin, y: margin },
      maxWidth: contentW,
      role: 'title',
      sourceId: 'title',
    },
    t,
    m,
  );
  elements.push(title);
  const top = margin + brailleSize(title.braille, m).h + 8;
  let cats = (spec.categories ?? []).slice();
  let vals = (spec.series[0]?.values ?? []).map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  // Readers cannot tell more than ~6 textures apart: fold the smallest slices into "Other".
  if (cats.length > 6) {
    const order = vals.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
    const keep = new Set(order.slice(0, 5).map((o) => o.i));
    const other = vals.reduce((a, v, i) => (keep.has(i) ? a : a + v), 0);
    cats = cats.filter((_, i) => keep.has(i)).concat('Other');
    vals = vals.filter((_, i) => keep.has(i)).concat(other);
    notes.push('More than six slices: the smallest were combined into "Other".');
  }
  const total = vals.reduce((a, b) => a + b, 0) || 1;
  const key: KeyEntry[] = cats.map((c, i) => ({
    swatch: { kind: 'texture', texture: TEXTURE_ORDER[i % TEXTURE_ORDER.length] },
    text: `${c} ${Math.round((vals[i] / total) * 100)}%`,
  }));
  const keyW = Math.min(contentW * 0.45, 130);
  const keyH = measureKey(key, keyW, t, doc);
  const availH = page.height - margin - top;
  const keyBeside = keyH <= availH;
  const pieAreaW = keyBeside ? contentW - keyW - 10 : contentW;
  const r = Math.max(20, Math.min(pieAreaW, availH) / 2 - 4);
  const cx = margin + (keyBeside ? pieAreaW / 2 : contentW / 2);
  const cy = top + availH / 2;
  let a0 = -Math.PI / 2;
  vals.forEach((v, i) => {
    const sweep = (v / total) * Math.PI * 2;
    if (sweep <= 0) return;
    const n = Math.max(2, Math.ceil((sweep / (Math.PI * 2)) * 96));
    const ring: Point[] = sweep >= Math.PI * 2 - 1e-9 ? [] : [{ x: cx, y: cy }];
    for (let k = 0; k <= n; k++) {
      const a = a0 + (sweep * k) / n;
      ring.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    elements.push({
      kind: 'area',
      id: `slice-${i}`,
      role: 'data',
      sourceId: `slice-${i}`,
      name: `${cats[i]}: ${Math.round((v / total) * 100)}%`,
      rings: [ring],
      texture: TEXTURE_ORDER[i % TEXTURE_ORDER.length],
      outline: { width: LINE_WEIGHTS.medium, style: 'solid' },
    });
    if ((v / total) * 360 < 14)
      notes.push(`Slice "${cats[i]}" is very thin and may be hard to find by touch.`);
    a0 += sweep;
  });
  doc.key = key;
  if (keyBeside) {
    const k = layoutKey(
      key,
      { x: page.width - margin - keyW, y: top + Math.max(0, (availH - keyH) / 2) },
      keyW,
      t,
      doc,
    );
    elements.push(...k.elements);
    return { elements, key: [] };
  }
  return { elements, key };
}

// ---------------------------------------------------------------------------------------
// Sighted rendering
// ---------------------------------------------------------------------------------------

function sightedChart(spec: ChartSpec): string {
  const W = 180;
  const H = 120;
  const cats = spec.categories ?? [];
  const parts: string[] = [];
  const font = 'font-family="Inter, system-ui, -apple-system, Segoe UI, sans-serif"';
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeXml(spec.title)}">`,
  );
  parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  parts.push(
    `<text data-rl-id="title" x="8" y="10" font-size="5" font-weight="650" fill="#1d1d1f" ${font}>${escapeXml(spec.title)}</text>`,
  );
  const color = (i: number) => SIGHTED_PALETTE[i % SIGHTED_PALETTE.length];
  if (spec.type === 'pie') {
    const vals = (spec.series[0]?.values ?? []).map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const cx = 60;
    const cy = 66;
    const r = 42;
    let a0 = -Math.PI / 2;
    vals.forEach((v, i) => {
      const sweep = (v / total) * Math.PI * 2;
      if (sweep <= 0) return;
      const a1 = a0 + sweep;
      const large = sweep > Math.PI ? 1 : 0;
      const p0 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)];
      const p1 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)];
      const d =
        sweep >= Math.PI * 2 - 1e-9
          ? `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`
          : `M${cx} ${cy}L${p0[0].toFixed(2)} ${p0[1].toFixed(2)}A${r} ${r} 0 ${large} 1 ${p1[0].toFixed(2)} ${p1[1].toFixed(2)}Z`;
      parts.push(
        `<path data-rl-id="slice-${i}" d="${d}" fill="${color(i)}" stroke="#fff" stroke-width="0.6"/>`,
      );
      a0 = a1;
    });
    cats.forEach((c, i) => {
      const y = 32 + i * 9;
      parts.push(`<rect x="116" y="${y - 4}" width="5" height="5" rx="1" fill="${color(i)}"/>`);
      parts.push(
        `<text x="124" y="${y}" font-size="4" fill="#333" ${font}>${escapeXml(`${c} (${Math.round(((vals[i] ?? 0) / total) * 100)}%)`)}</text>`,
      );
    });
    parts.push('</svg>');
    return parts.join('');
  }
  const multi = spec.series.length > 1;
  const px0 = 22;
  const px1 = W - 8;
  const py0 = spec.yLabel ? 24 : 18;
  const py1 = H - (multi ? 26 : 18);
  const vals = finiteValues(spec);
  const lo = spec.yMin ?? (spec.type === 'bar' ? Math.min(0, ...vals) : Math.min(...vals));
  const ys = niceScale(lo, spec.yMax ?? Math.max(...vals), 6);
  const Y = (v: number) => py1 - ((v - ys.min) / (ys.max - ys.min)) * (py1 - py0);
  if (spec.yLabel)
    parts.push(
      `<text data-rl-id="y-title" x="8" y="18" font-size="3.4" fill="#555" ${font}>${escapeXml(spec.yLabel)}</text>`,
    );
  ys.ticks.forEach((v, i) => {
    const y = Y(v);
    parts.push(
      `<line x1="${px0}" x2="${px1}" y1="${y.toFixed(2)}" y2="${y.toFixed(2)}" stroke="#e5e5ea" stroke-width="0.3"/>`,
    );
    parts.push(
      `<text data-rl-id="ytick-${i}" x="${px0 - 2}" y="${(y + 1.2).toFixed(2)}" font-size="3.2" text-anchor="end" fill="#666" ${font}>${formatNumber(v, ys.step)}</text>`,
    );
  });
  const plotW = px1 - px0;
  const slot = plotW / Math.max(1, cats.length);
  let X: (v: number) => number = (i) => px0 + slot * (i + 0.5);
  if (spec.type === 'line')
    X = (i) =>
      cats.length <= 1 ? px0 + plotW / 2 : px0 + 4 + ((plotW - 8) * i) / (cats.length - 1);
  if (spec.type === 'bar') {
    const k = spec.series.length;
    const bw = (slot * 0.72) / k;
    cats.forEach((_, ci) =>
      spec.series.forEach((s, si) => {
        const v = s.values[ci];
        if (!Number.isFinite(v)) return;
        const x = px0 + slot * ci + slot * 0.14 + si * bw;
        const y = Math.min(Y(v), Y(Math.max(ys.min, 0)));
        const h = Math.abs(Y(v) - Y(Math.max(ys.min, 0)));
        parts.push(
          `<rect data-rl-id="bar-${si}-${ci}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(bw * 0.92).toFixed(2)}" height="${h.toFixed(2)}" rx="0.6" fill="${color(si)}"/>`,
        );
      }),
    );
  } else if (spec.type === 'line') {
    spec.series.forEach((s, si) => {
      const pts = s.values
        .map((v, i) => (Number.isFinite(v) ? `${X(i).toFixed(2)},${Y(v).toFixed(2)}` : ''))
        .filter(Boolean);
      parts.push(
        `<polyline data-rl-id="series-${si}" points="${pts.join(' ')}" fill="none" stroke="${color(si)}" stroke-width="0.8" stroke-linejoin="round"/>`,
      );
      s.values.forEach((v, i) => {
        if (Number.isFinite(v))
          parts.push(
            `<circle data-rl-id="pt-${si}-${i}" cx="${X(i).toFixed(2)}" cy="${Y(v).toFixed(2)}" r="1.1" fill="${color(si)}"/>`,
          );
      });
    });
  } else {
    const allX = spec.series.flatMap((s) => (s.x ?? []).filter((v) => Number.isFinite(v)));
    const xs = niceScale(Math.min(...allX), Math.max(...allX), 8);
    const SX = (v: number) => px0 + 3 + ((v - xs.min) / (xs.max - xs.min)) * (plotW - 6);
    xs.ticks.forEach((v, i) =>
      parts.push(
        `<text data-rl-id="xtick-${i}" x="${SX(v).toFixed(2)}" y="${py1 + 5}" font-size="3.2" text-anchor="middle" fill="#666" ${font}>${formatNumber(v, xs.step)}</text>`,
      ),
    );
    spec.series.forEach((s, si) =>
      s.values.forEach((v, i) => {
        const xv = s.x?.[i];
        if (Number.isFinite(v) && xv !== undefined && Number.isFinite(xv))
          parts.push(
            `<circle data-rl-id="pt-${si}-${i}" cx="${SX(xv).toFixed(2)}" cy="${Y(v).toFixed(2)}" r="1.2" fill="${color(si)}" fill-opacity="0.85"/>`,
          );
      }),
    );
  }
  parts.push(
    `<line data-rl-id="x-axis" x1="${px0}" x2="${px1}" y1="${py1}" y2="${py1}" stroke="#333" stroke-width="0.4"/>`,
  );
  parts.push(
    `<line data-rl-id="y-axis" x1="${px0}" x2="${px0}" y1="${py0 - 2}" y2="${py1}" stroke="#333" stroke-width="0.4"/>`,
  );
  if (spec.type !== 'scatter') {
    cats.forEach((c, i) =>
      parts.push(
        `<text data-rl-id="cat-${i}" x="${X(i).toFixed(2)}" y="${py1 + 5}" font-size="3.2" text-anchor="middle" fill="#444" ${font}>${escapeXml(c)}</text>`,
      ),
    );
  }
  if (spec.xLabel)
    parts.push(
      `<text data-rl-id="x-title" x="${(px0 + px1) / 2}" y="${py1 + 11}" font-size="3.4" text-anchor="middle" fill="#555" ${font}>${escapeXml(spec.xLabel)}</text>`,
    );
  if (multi) {
    let lx = px0;
    spec.series.forEach((s, si) => {
      parts.push(`<rect x="${lx}" y="${H - 9}" width="4" height="4" rx="1" fill="${color(si)}"/>`);
      parts.push(
        `<text x="${lx + 5.5}" y="${H - 5.6}" font-size="3.4" fill="#333" ${font}>${escapeXml(s.name)}</text>`,
      );
      lx += 12 + s.name.length * 1.9;
    });
  }
  parts.push('</svg>');
  return parts.join('');
}

// ---------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------

function validate(spec: ChartSpec): void {
  if (!spec.series?.length) throw new Error('A chart needs at least one data series');
  if (spec.type !== 'scatter' && !spec.categories?.length)
    throw new Error('Bar, line and pie charts need categories');
  if (spec.type === 'scatter' && spec.series.some((s) => !s.x || s.x.length !== s.values.length)) {
    throw new Error('Scatter series need x values matching their y values');
  }
  if (!finiteValues(spec).length) throw new Error('The chart has no numeric values');
}

/** Build the sighted and tactile versions of a chart. */
export function buildChart(spec: ChartSpec, opts: ChartBuildOptions = {}): BuildResult {
  validate(spec);
  const translator = opts.translator ?? uebGrade1;
  const page = spec.page ?? DEFAULT_PAGE;
  const doc = createDocument({
    title: spec.title,
    source: 'chart',
    page,
    braille: { table: translator.id, ...opts.braille },
    description: describeChart(spec),
  });
  const notes: string[] = [];
  const layout =
    spec.type === 'pie'
      ? buildPie(spec, page, translator, doc, notes)
      : buildCartesian(spec, page, translator, doc, notes);
  doc.pages[0].elements = layout.elements;
  if (layout.key.length) {
    addKeyPage(doc, translator);
    notes.push('The key did not fit beside the chart, so it is on its own page.');
  }
  return { sighted: sightedChart(spec), tactile: doc, notes };
}
