import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import {
  checkDocument,
  exportBrf,
  exportGcode,
  exportPdf,
  exportStl,
  renderTactileSvg,
  serializeDocument,
  type BrailleTranslator,
  type RasterImage,
  type TactileDocument,
  type TouchReport,
} from '@raisedline/core';

export const FORMATS = ['pdf', 'svg', 'stl', 'brf', 'gcode', 'json', 'report'] as const;
export type Format = (typeof FORMATS)[number];

const EXT: Record<Format, string> = {
  pdf: '.pdf',
  svg: '.svg',
  stl: '.stl',
  brf: '.brf',
  gcode: '.gcode',
  json: '.raisedline.json',
  report: '.report.json',
};

export function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

export function decodeImage(path: string): RasterImage {
  const buf = readFileSync(path);
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 512 });
    return { width: img.width, height: img.height, data: img.data };
  }
  throw new Error(`${basename(path)}: only PNG and JPEG images are supported`);
}

export function dataUrl(path: string): string {
  const buf = readFileSync(path);
  const mime = buf[0] === 0x89 ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/** Work out output files from `--out` and `--format`. */
export function planOutputs(
  input: string | undefined,
  out: string | undefined,
  format: string | undefined,
): { path: string; format: Format }[] {
  let formats: Format[];
  if (format) {
    formats = format.split(',').map((f) => f.trim().toLowerCase()) as Format[];
    for (const f of formats) {
      if (!FORMATS.includes(f))
        throw new Error(`Unknown format "${f}". Use: ${FORMATS.join(', ')}`);
    }
  } else if (out && extname(out)) {
    const ext = extname(out).slice(1).toLowerCase();
    const f = ext === 'json' ? 'json' : (ext as Format);
    if (!FORMATS.includes(f)) throw new Error(`Cannot infer a format from "${out}". Use --format.`);
    formats = [f];
  } else formats = ['pdf'];
  let base: string;
  if (out && extname(out) && formats.length === 1)
    return [{ path: resolve(out), format: formats[0] }];
  if (out) base = resolve(out.replace(/\.[^./\\]+$/, ''));
  else base = resolve(basename(input ?? 'raisedline').replace(/\.[^.]+$/, '') + '-tactile');
  return formats.map((f) => ({ path: base + EXT[f], format: f }));
}

export interface WriteOptions {
  interline?: boolean;
  mirror?: boolean;
  transcriberNotes?: boolean;
  translator?: BrailleTranslator;
  report?: TouchReport;
}

export function writeOutputs(
  doc: TactileDocument,
  outputs: { path: string; format: Format }[],
  opts: WriteOptions = {},
): string[] {
  const written: string[] = [];
  for (const o of outputs) {
    mkdirSync(dirname(o.path), { recursive: true });
    switch (o.format) {
      case 'pdf':
        writeFileSync(
          o.path,
          exportPdf(doc, {
            interline: opts.interline,
            mirror: opts.mirror,
            transcriberNotes: opts.transcriberNotes,
          }),
        );
        break;
      case 'svg':
        if (doc.pages.length === 1)
          writeFileSync(
            o.path,
            renderTactileSvg(doc, 0, { interactive: false, interline: opts.interline }),
          );
        else {
          doc.pages.forEach((_, i) => {
            const p = i === 0 ? o.path : o.path.replace(/\.svg$/, `-page${i + 1}.svg`);
            writeFileSync(
              p,
              renderTactileSvg(doc, i, { interactive: false, interline: opts.interline }),
            );
            if (i > 0) written.push(p);
          });
        }
        break;
      case 'stl':
        writeFileSync(o.path, exportStl(doc));
        break;
      case 'brf':
        writeFileSync(o.path, exportBrf(doc, { translator: opts.translator }));
        break;
      case 'gcode':
        writeFileSync(o.path, exportGcode(doc, { mirror: opts.mirror }));
        break;
      case 'json':
        writeFileSync(o.path, serializeDocument(doc));
        break;
      case 'report':
        writeFileSync(o.path, JSON.stringify(opts.report ?? checkDocument(doc), null, 2));
        break;
    }
    written.push(o.path);
  }
  return written;
}

export function relative(p: string): string {
  const cwd = process.cwd();
  return p.startsWith(cwd + '/') ? p.slice(cwd.length + 1) : p;
}

export { join };
