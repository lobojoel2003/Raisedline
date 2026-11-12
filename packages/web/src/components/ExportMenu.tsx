import { useEffect, useRef, useState } from 'react';
import {
  exportBrf,
  exportGcode,
  exportPdf,
  exportStl,
  renderTactileSvg,
  serializeDocument,
  type BrailleTranslator,
  type TactileDocument,
} from '@raisedline/core';
import { download, slug } from '../model';
import { DownloadIcon } from './Icons';

interface Props {
  doc: TactileDocument | null;
  sighted: string | null;
  translator: BrailleTranslator;
}

async function svgToPng(svg: string, widthMm: number, heightMm: number, dpi = 200): Promise<Blob> {
  const w = Math.round((widthMm / 25.4) * dpi);
  const h = Math.round((heightMm / 25.4) * dpi);
  const url = URL.createObjectURL(
    new Blob([svg.replace(/width="[\d.]+mm" height="[\d.]+mm"/, `width="${w}" height="${h}"`)], {
      type: 'image/svg+xml',
    }),
  );
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG export failed'))), 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ExportMenu({ doc, sighted, translator }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const name = doc ? slug(doc.title) : 'raisedline';
  const items = [
    {
      fmt: 'PDF',
      label: 'Swell paper (PDF)',
      sub: 'True size, black only, every page',
      run: (d: TactileDocument) => download(`${name}.pdf`, exportPdf(d), 'application/pdf'),
    },
    {
      fmt: 'PDF',
      label: 'Proof with print text',
      sub: 'Braille plus print labels and transcriber notes',
      run: (d: TactileDocument) =>
        download(
          `${name}-proof.pdf`,
          exportPdf(d, { interline: true, transcriberNotes: true }),
          'application/pdf',
        ),
    },
    {
      fmt: 'STL',
      label: '3D print (STL)',
      sub: 'Relief plate with domed braille dots',
      run: (d: TactileDocument) => download(`${name}.stl`, exportStl(d), 'model/stl'),
    },
    {
      fmt: 'BRF',
      label: 'Braille embosser (BRF)',
      sub: 'Graphic drawn in braille cells, plus key',
      run: (d: TactileDocument) =>
        download(`${name}.brf`, exportBrf(d, { translator }), 'text/plain'),
    },
    {
      fmt: 'GCODE',
      label: 'BrailleRAP embosser',
      sub: 'G-code for open-source XY embossers',
      run: (d: TactileDocument) => download(`${name}.gcode`, exportGcode(d), 'text/plain'),
    },
    {
      fmt: 'SVG',
      label: 'Vector (SVG)',
      sub: 'For further editing',
      run: (d: TactileDocument) =>
        download(`${name}.svg`, renderTactileSvg(d, 0, { interactive: false }), 'image/svg+xml'),
    },
    {
      fmt: 'PNG',
      label: 'Image (PNG, 200 dpi)',
      sub: 'Preview for worksheets and slides',
      run: async (d: TactileDocument) =>
        download(
          `${name}.png`,
          await svgToPng(
            renderTactileSvg(d, 0, { interactive: false }),
            d.page.width,
            d.page.height,
          ),
          'image/png',
        ),
    },
    {
      fmt: 'JSON',
      label: 'Project file',
      sub: 'Reopen here or export with the CLI',
      run: (d: TactileDocument) =>
        download(
          `${name}.raisedline.json`,
          JSON.stringify({ ...JSON.parse(serializeDocument(d)), sighted }, null, 2),
          'application/json',
        ),
    },
  ];
  return (
    <div className="export" ref={ref}>
      <button
        type="button"
        className="btn primary"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!doc}
        onClick={() => setOpen((o) => !o)}
      >
        <DownloadIcon size={16} /> Export
      </button>
      {open && doc && (
        <div className="menu" role="menu" aria-label="Export formats">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              disabled={!!busy}
              onClick={async () => {
                setBusy(it.label);
                try {
                  await it.run(doc);
                } finally {
                  setBusy(null);
                  setOpen(false);
                }
              }}
            >
              <span className="fmt">{it.fmt}</span>
              <span className="label">
                {busy === it.label ? 'Preparing…' : it.label}
                <span className="sub">{it.sub}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
