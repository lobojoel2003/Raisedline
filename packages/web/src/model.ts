import {
  buildChart,
  buildMap,
  chartFromCsv,
  checkDocument,
  createLookupTranslator,
  importSvg,
  pagePreset,
  traceImage,
  uebGrade1,
  type BrailleTranslator,
  type BuildResult,
  type ChartType,
  type RasterImage,
  type TactileDocument,
  type TouchReport,
  type TraceMode,
} from '@raisedline/core';

export type SourceKind = 'chart' | 'svg' | 'image' | 'map' | 'project';

export interface Settings {
  page: string;
  margin: number;
  /** `ueb-grade1` or `liblouis:<table>` (needs `raisedline serve`). */
  table: string;
  minLineGap: number;
}

export interface ChartInput {
  csv: string;
  type: ChartType;
  title: string;
  xLabel: string;
  yLabel: string;
  gridlines: 'auto' | 'on' | 'off';
}

export interface SvgInput {
  text: string;
  name: string;
  title: string;
  simplify: number;
}

export interface ImageInput {
  image: RasterImage | null;
  href: string;
  name: string;
  title: string;
  mode: TraceMode;
  threshold: number | null;
  invert: boolean;
  colors: number;
  smoothing: number;
  simplify: number;
}

export interface MapInput {
  text: string;
  name: string;
  title: string;
  labelProperty: string;
  north: boolean;
}

export interface ProjectInput {
  doc: TactileDocument;
  sighted: string | null;
  name: string;
}

export interface Inputs {
  chart: ChartInput;
  svg: SvgInput;
  image: ImageInput;
  map: MapInput;
  project: ProjectInput | null;
}

export interface Outcome {
  result: BuildResult | null;
  report: TouchReport | null;
  error: string | null;
  ms: number;
  /** Texts the remote braille table has not translated yet. */
  pending: string[];
}

/** Translator that serves cached liblouis results and records what is missing. */
export function remoteTranslator(
  table: string,
  cache: Map<string, string>,
  missing: Set<string>,
): BrailleTranslator {
  const lookup = createLookupTranslator(`liblouis:${table}`, `liblouis ${table}`, cache, uebGrade1);
  return {
    ...lookup,
    translate(text: string) {
      const key = text.trim();
      if (!cache.has(key) && !/^\{brf:/.test(key)) missing.add(key);
      return lookup.translate(text);
    },
  };
}

export function buildOutcome(
  kind: SourceKind,
  inputs: Inputs,
  settings: Settings,
  cache: Map<string, string>,
): Outcome {
  const t0 = performance.now();
  const missing = new Set<string>();
  const translator = settings.table.startsWith('liblouis:')
    ? remoteTranslator(settings.table.slice('liblouis:'.length), cache, missing)
    : uebGrade1;
  const page = pagePreset(settings.page, settings.margin);
  try {
    let result: BuildResult;
    switch (kind) {
      case 'chart': {
        const c = inputs.chart;
        const spec = chartFromCsv(c.csv, {
          type: c.type,
          title: c.title || 'Untitled chart',
          xLabel: c.xLabel || undefined,
          yLabel: c.yLabel || undefined,
        });
        if (c.gridlines !== 'auto') spec.gridlines = c.gridlines === 'on';
        spec.page = page;
        result = buildChart(spec, { translator });
        break;
      }
      case 'svg': {
        const s = inputs.svg;
        if (!s.text) throw new Error('Choose an SVG file or an example.');
        result = importSvg(s.text, {
          title: s.title || undefined,
          page,
          translator,
          simplify: s.simplify,
        });
        break;
      }
      case 'image': {
        const i = inputs.image;
        if (!i.image) throw new Error('Choose an image or an example.');
        result = traceImage(i.image, {
          title: i.title || i.name || 'Traced image',
          page,
          translator,
          mode: i.mode,
          threshold: i.threshold ?? undefined,
          invert: i.invert,
          colors: i.colors,
          smoothing: i.smoothing,
          simplify: i.simplify,
          imageHref: i.href,
        });
        break;
      }
      case 'map': {
        const m = inputs.map;
        if (!m.text) throw new Error('Choose a GeoJSON file or an example.');
        result = buildMap(m.text, {
          title: m.title || undefined,
          page,
          translator,
          labelProperty: m.labelProperty || undefined,
          northArrow: m.north,
        });
        break;
      }
      case 'project': {
        const p = inputs.project;
        if (!p) throw new Error('Open a Raisedline project file (.raisedline.json).');
        result = {
          tactile: p.doc,
          sighted: p.sighted ?? '',
          notes: p.sighted ? [] : ['This project has no sighted version.'],
        };
        break;
      }
    }
    const report = checkDocument(result.tactile, { minLineGap: settings.minLineGap });
    return { result, report, error: null, ms: performance.now() - t0, pending: [...missing] };
  } catch (e) {
    return {
      result: null,
      report: null,
      error: (e as Error).message,
      ms: performance.now() - t0,
      pending: [],
    };
  }
}

export async function loadImage(src: string | Blob): Promise<RasterImage> {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const max = 1400;
    const f = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * f));
    const h = Math.max(1, Math.round(img.naturalHeight * f));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    return { width: w, height: h, data: data.data };
  } finally {
    if (typeof src !== 'string') URL.revokeObjectURL(url);
  }
}

export function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function download(name: string, data: BlobPart, type: string): void {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'raisedline'
  );
}

/**
 * Make an SVG from an untrusted project file safe to inline: drop scripts, foreign content,
 * event handlers and non-image links. Returns null if the markup is not valid SVG.
 */
export function sanitizeSvg(svg: string): string | null {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (doc.querySelector('parsererror') || doc.documentElement.nodeName.toLowerCase() !== 'svg')
    return null;
  doc
    .querySelectorAll('script, foreignObject, iframe, object, embed, animate, set')
    .forEach((el) => el.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      else if (
        name.endsWith('href') &&
        !/^(#|data:image\/(png|jpeg|gif|webp);base64,)/i.test(value)
      ) {
        el.removeAttribute(attr.name);
      } else if (name === 'style' && /url\(|expression\(/i.test(value))
        el.removeAttribute(attr.name);
    }
  });
  return new XMLSerializer().serializeToString(doc.documentElement);
}
