import { toPathData } from '../geometry/pathdata.js';
import { labelBox } from '../layout/labels.js';
import type { Primitive, TactileDocument } from '../types.js';
import { groupByOwner, pagePrimitives } from './primitives.js';

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const n = (v: number) => {
  const s = v.toFixed(2);
  return s.replace(/\.?0+$/, '') || '0';
};

function primitiveSvg(p: Primitive, ink: string): string {
  switch (p.type) {
    case 'stroke':
      return `<path d="${toPathData(p.points, p.closed)}" fill="none" stroke="${ink}" stroke-width="${n(p.width)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    case 'fill':
      return `<path d="${p.rings.map((r) => toPathData(r, true)).join('')}" fill="${ink}" fill-rule="evenodd"/>`;
    case 'dot':
      return `<circle cx="${n(p.x)}" cy="${n(p.y)}" r="${n(p.r)}" fill="${ink}"/>`;
  }
}

export interface TactileSvgOptions {
  /** Add `data-rl-*` hooks for interactive highlighting (default true). */
  interactive?: boolean;
  /** Print the text under each braille label for sighted readers (default false). */
  interline?: boolean;
  /** Render as raised material on swell paper instead of flat black (default false). */
  raised?: boolean;
  /** Paper colour (default white, or cream when raised). */
  paper?: string;
  /** Ink colour (default black). */
  ink?: string;
  /** Draw the page margin as a faint guide (default false). */
  showMargin?: boolean;
  /**
   * Override the SVG width/height attributes (e.g. "100%"). Defaults to real size in mm. When only
   * `width` is given the height attribute is omitted so the viewBox sets the aspect ratio.
   */
  width?: string;
  height?: string;
}

const RAISED_FILTER = `<filter id="rl-raised" x="-2%" y="-2%" width="104%" height="104%" color-interpolation-filters="sRGB">
<feGaussianBlur in="SourceAlpha" stdDeviation="0.32" result="blur"/>
<feSpecularLighting in="blur" surfaceScale="2.2" specularConstant="0.75" specularExponent="16" lighting-color="#ffffff" result="spec"><feDistantLight azimuth="235" elevation="48"/></feSpecularLighting>
<feComposite in="spec" in2="SourceAlpha" operator="in" result="shine"/>
<feOffset in="blur" dx="0.28" dy="0.42" result="drop"/>
<feColorMatrix in="drop" type="matrix" values="0 0 0 0 0.25  0 0 0 0 0.2  0 0 0 0 0.12  0 0 0 0.45 0" result="shadow"/>
<feMerge><feMergeNode in="shadow"/><feMergeNode in="SourceGraphic"/><feMergeNode in="shine"/></feMerge>
</filter>`;

/** Render one page of a tactile document as SVG (real-world size in millimetres). */
export function renderTactileSvg(
  doc: TactileDocument,
  pageIndex = 0,
  opts: TactileSvgOptions = {},
): string {
  const page = doc.pages[pageIndex];
  const { width: W, height: H, margin } = doc.page;
  const interactive = opts.interactive ?? true;
  const raised = opts.raised ?? false;
  const ink = opts.ink ?? (raised ? '#2b2620' : '#000000');
  const paper = opts.paper ?? (raised ? '#f7f1e3' : '#ffffff');
  const prims = groupByOwner(pagePrimitives(doc, pageIndex));
  const m = doc.braille.metrics;
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.width ?? `${n(W)}mm`}"${opts.width && !opts.height ? '' : ` height="${opts.height ?? `${n(H)}mm`}"`} viewBox="0 0 ${n(W)} ${n(H)}" role="img" aria-label="${escapeXml(`Tactile version: ${doc.title}`)}">`,
  );
  parts.push(
    `<title>${escapeXml(`${doc.title} (tactile${page ? `, ${page.title}` : ''})`)}</title>`,
  );
  if (doc.description) parts.push(`<desc>${escapeXml(doc.description)}</desc>`);
  if (raised) parts.push(`<defs>${RAISED_FILTER}</defs>`);
  parts.push(`<rect class="rl-paper" width="${n(W)}" height="${n(H)}" fill="${paper}"/>`);
  if (opts.showMargin) {
    parts.push(
      `<rect class="rl-margin" x="${n(margin)}" y="${n(margin)}" width="${n(W - 2 * margin)}" height="${n(H - 2 * margin)}" fill="none" stroke="#b9ad96" stroke-width="0.3" stroke-dasharray="2 2"/>`,
    );
  }
  parts.push(`<g class="rl-ink"${raised ? ' filter="url(#rl-raised)"' : ''}>`);
  if (page) {
    for (const el of page.elements) {
      const list = prims.get(el.id) ?? [];
      if (list.length === 0) continue;
      const attrs = interactive
        ? ` data-rl-id="${escapeXml(el.id)}" data-rl-kind="${el.kind}" data-rl-role="${el.role}"${el.sourceId ? ` data-rl-source="${escapeXml(el.sourceId)}"` : ''}`
        : '';
      // Invisible hit areas make whole areas and thin lines easy to point at.
      let hit = '';
      if (interactive && el.kind === 'area') {
        hit = `<path d="${el.rings.map((r) => toPathData(r, true)).join('')}" fill="#000" fill-opacity="0" fill-rule="evenodd"/>`;
      } else if (interactive && el.kind === 'line') {
        hit = `<path d="${toPathData(el.points, !!el.closed)}" fill="none" stroke="#000" stroke-opacity="0" stroke-width="${n(el.width + 3)}"/>`;
      }
      parts.push(`<g${attrs}>${hit}${list.map((p) => primitiveSvg(p, ink)).join('')}</g>`);
    }
  }
  parts.push('</g>');
  if (opts.interline && page) {
    parts.push('<g class="rl-interline" font-family="system-ui, sans-serif" fill="#7a4b12">');
    for (const el of page.elements) {
      if (el.kind !== 'label') continue;
      const b = labelBox(el, m);
      parts.push(
        `<text x="${n(b.x)}" y="${n(b.y + b.h + 3.2)}" font-size="3" ${interactive ? `data-rl-for="${escapeXml(el.id)}"` : ''}>${escapeXml(el.text)}</text>`,
      );
    }
    parts.push('</g>');
  }
  parts.push('</svg>');
  return parts.join('');
}
