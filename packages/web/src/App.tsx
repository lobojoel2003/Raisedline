import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BUILD_INFO,
  parseDocument,
  uebGrade1,
  versionString,
  type TouchIssue,
} from '@raisedline/core';
import { ExportMenu } from './components/ExportMenu';
import { GithubIcon, Logo } from './components/Icons';
import { Inspector } from './components/Inspector';
import { SourcePanel } from './components/SourcePanel';
import { Stage } from './components/Stage';
import { CHART_EXAMPLES, IMAGE_EXAMPLES, MAP_EXAMPLES, SVG_EXAMPLES } from './examples';
import {
  buildOutcome,
  loadImage,
  readAsDataUrl,
  remoteTranslator,
  sanitizeSvg,
  type Inputs,
  type Outcome,
  type Settings,
  type SourceKind,
} from './model';

const REPO = 'https://github.com/lobojoel2003/Raisedline';

const initialInputs: Inputs = {
  chart: {
    csv: CHART_EXAMPLES[0].csv,
    type: CHART_EXAMPLES[0].type,
    title: CHART_EXAMPLES[0].title,
    xLabel: '',
    yLabel: '',
    gridlines: 'auto',
  },
  svg: { text: SVG_EXAMPLES[0].text, name: 'water-cycle.svg', title: '', simplify: 0.4 },
  image: {
    image: null,
    href: '',
    name: '',
    title: 'Plant cell',
    mode: 'auto',
    threshold: null,
    invert: false,
    colors: 4,
    smoothing: 1,
    simplify: 0.6,
  },
  map: {
    text: MAP_EXAMPLES[0].text,
    name: 'riverside-campus.geojson',
    title: '',
    labelProperty: 'name',
    north: true,
  },
  project: null,
};

function useServerInfo(): string[] | null {
  const [tables, setTables] = useState<string[] | null>(null);
  useEffect(() => {
    if (location.protocol === 'file:') return;
    fetch('./api/info')
      .then((r) => (r.ok ? r.json() : null))
      .then((info: { liblouis?: { tables: string[] } | null } | null) => {
        if (!info?.liblouis) return;
        const preferred = ['en-ueb-g2.ctb', 'en-ueb-g1.ctb', 'en-us-g2.ctb'];
        const list = info.liblouis.tables;
        setTables([
          ...preferred.filter((t) => list.includes(t)),
          ...list.filter((t) => !preferred.includes(t)),
        ]);
      })
      .catch(() => {});
  }, []);
  return tables;
}

export default function App() {
  const [kind, setKind] = useState<SourceKind>(() => {
    const h = location.hash.replace('#', '');
    return (['chart', 'svg', 'image', 'map'] as SourceKind[]).includes(h as SourceKind)
      ? (h as SourceKind)
      : 'chart';
  });
  const [inputs, setInputs] = useState<Inputs>(initialInputs);
  const [settings, setSettings] = useState<Settings>({
    page: 'letter-landscape',
    margin: 12,
    table: 'ueb-grade1',
    minLineGap: 3,
  });
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<TouchIssue | null>(null);
  const [page, setPage] = useState(0);
  const [activeExample, setActiveExample] = useState<string | null>(CHART_EXAMPLES[0].id);
  const [brailleRev, setBrailleRev] = useState(0);
  const [announce, setAnnounce] = useState('');
  const cache = useRef(new Map<string, string>());
  const liblouisTables = useServerInfo();

  const update = useCallback(
    <K extends keyof Inputs>(k: K, patch: Partial<NonNullable<Inputs[K]>>) => {
      setInputs((prev) => ({ ...prev, [k]: { ...(prev[k] as object), ...patch } }));
      if (k !== 'project') setActiveExample(null);
    },
    [],
  );

  // Load the example image lazily (it needs a canvas).
  useEffect(() => {
    if (kind !== 'image' || inputs.image.image) return;
    const ex = IMAGE_EXAMPLES[0];
    loadImage(ex.url)
      .then((image) =>
        setInputs((p) => ({
          ...p,
          image: { ...p.image, image, href: ex.url, name: 'plant-cell.png' },
        })),
      )
      .catch(() => {});
  }, [kind, inputs.image.image]);

  useEffect(() => {
    if (kind !== 'project') history.replaceState(null, '', `#${kind}`);
    setPage(0);
    setSelectedIssue(null);
  }, [kind]);

  // Rebuild (debounced) whenever inputs or settings change.
  useEffect(() => {
    const id = setTimeout(() => {
      const o = buildOutcome(kind, inputs, settings, cache.current);
      setOutcome(o);
      setSelectedIssue(null);
      if (o.report)
        setAnnounce(
          `Touch score ${o.report.score}: ${o.report.counts.error} errors, ${o.report.counts.warning} warnings.`,
        );
      // Fetch braille the server has not translated yet, then rebuild once.
      if (o.pending.length && settings.table.startsWith('liblouis:')) {
        const table = settings.table.slice('liblouis:'.length);
        fetch('./api/braille', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ table, texts: o.pending }),
        })
          .then((r) => r.json())
          .then((res: { braille?: string[] }) => {
            res.braille?.forEach((b, i) => cache.current.set(o.pending[i], b));
            setBrailleRev((n) => n + 1);
          })
          .catch(() => {});
      }
    }, 180);
    return () => clearTimeout(id);
  }, [kind, inputs, settings, brailleRev]);

  const loadExample = useCallback((k: SourceKind, id: string) => {
    setActiveExample(id);
    if (k === 'chart') {
      const ex = CHART_EXAMPLES.find((e) => e.id === id)!;
      setInputs((p) => ({
        ...p,
        chart: {
          ...p.chart,
          csv: ex.csv,
          type: ex.type,
          title: ex.title,
          xLabel: ex.xLabel ?? '',
          yLabel: ex.yLabel ?? '',
        },
      }));
    } else if (k === 'svg') {
      const ex = SVG_EXAMPLES.find((e) => e.id === id)!;
      setInputs((p) => ({
        ...p,
        svg: { ...p.svg, text: ex.text, name: `${ex.id}.svg`, title: '' },
      }));
    } else if (k === 'map') {
      const ex = MAP_EXAMPLES.find((e) => e.id === id)!;
      setInputs((p) => ({
        ...p,
        map: { ...p.map, text: ex.text, name: `${ex.id}.geojson`, title: '' },
      }));
    } else if (k === 'image') {
      const ex = IMAGE_EXAMPLES.find((e) => e.id === id)!;
      void loadImage(ex.url).then((image) =>
        setInputs((p) => ({
          ...p,
          image: { ...p.image, image, href: ex.url, name: `${ex.id}.png`, title: ex.title },
        })),
      );
    }
  }, []);

  const onFile = useCallback(async (file: File, hint?: SourceKind) => {
    const name = file.name;
    const ext = name.toLowerCase().split('.').pop() ?? '';
    const base = name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
    try {
      if (ext === 'csv' || ext === 'tsv') {
        const text = await file.text();
        setInputs((p) => ({
          ...p,
          chart: { ...p.chart, csv: text, title: base, xLabel: '', yLabel: '' },
        }));
        setKind('chart');
      } else if (ext === 'svg') {
        const text = await file.text();
        setInputs((p) => ({ ...p, svg: { ...p.svg, text, name, title: '' } }));
        setKind('svg');
      } else if (ext === 'geojson' || (ext === 'json' && hint === 'map')) {
        const text = await file.text();
        setInputs((p) => ({ ...p, map: { ...p.map, text, name, title: '' } }));
        setKind('map');
      } else if (ext === 'json') {
        const text = await file.text();
        const data = JSON.parse(text);
        if (data?.type === 'FeatureCollection' || data?.type === 'Feature') {
          setInputs((p) => ({ ...p, map: { ...p.map, text, name, title: '' } }));
          setKind('map');
        } else {
          const doc = parseDocument(data);
          setInputs((p) => ({
            ...p,
            project: {
              doc,
              sighted: typeof data.sighted === 'string' ? sanitizeSvg(data.sighted) : null,
              name,
            },
          }));
          setKind('project');
        }
      } else if (file.type.startsWith('image/')) {
        const [image, href] = await Promise.all([loadImage(file), readAsDataUrl(file)]);
        setInputs((p) => ({ ...p, image: { ...p.image, image, href, name, title: base } }));
        setKind('image');
      } else {
        throw new Error(
          `Raisedline cannot open "${name}". Try CSV, SVG, PNG, JPEG, GeoJSON or a project file.`,
        );
      }
      setActiveExample(null);
    } catch (e) {
      setOutcome({ result: null, report: null, error: (e as Error).message, ms: 0, pending: [] });
    }
  }, []);

  // Drop files anywhere on the page.
  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer?.files[0];
      if (f) void onFile(f);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [onFile]);

  const doc = outcome?.result?.tactile ?? null;
  const translator = useMemo(
    () =>
      settings.table.startsWith('liblouis:')
        ? remoteTranslator(settings.table.slice(9), cache.current, new Set())
        : uebGrade1,
    [settings.table],
  );

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to the graphic
      </a>
      <header className="topbar">
        <div className="brand">
          <Logo />
          <div style={{ minWidth: 0 }}>
            <div className="brand-name">Raisedline</div>
            <div className="brand-tag">Charts and maps you can read by touch</div>
          </div>
        </div>
        <div className="topbar-spacer" />
        <a
          className="btn ghost"
          href={REPO}
          target="_blank"
          rel="noreferrer"
          aria-label="Source code on GitHub"
        >
          <GithubIcon /> <span className="hide-sm">GitHub</span>
        </a>
        <ExportMenu doc={doc} sighted={outcome?.result?.sighted ?? null} translator={translator} />
      </header>
      <div className="workspace">
        <SourcePanel
          kind={kind}
          setKind={setKind}
          inputs={inputs}
          update={update}
          settings={settings}
          setSettings={setSettings}
          liblouisTables={liblouisTables}
          onFile={onFile}
          loadExample={loadExample}
          activeExample={activeExample}
        />
        <main id="main" style={{ minWidth: 0, minHeight: 0, display: 'flex' }}>
          <Stage
            doc={doc}
            sighted={outcome?.result ? outcome.result.sighted || null : null}
            report={outcome?.report ?? null}
            selectedIssue={selectedIssue}
            onSelectIssue={setSelectedIssue}
            error={outcome?.error ?? null}
            page={page}
            setPage={setPage}
          />
        </main>
        <Inspector
          doc={doc}
          report={outcome?.report ?? null}
          notes={outcome?.result?.notes ?? []}
          selectedIssue={selectedIssue}
          onSelectIssue={setSelectedIssue}
          ms={outcome?.ms ?? 0}
        />
      </div>
      <footer className="footer">
        <span>
          Raisedline {versionString(BUILD_INFO)} · {BUILD_INFO.channel} build
          {BUILD_INFO.date ? ` · ${BUILD_INFO.date.slice(0, 10)}` : ''} · GPL-3.0
        </span>
        <span>
          Touch rules follow common tactile-graphics guidance (about 3 mm between features, 6 mm
          symbols). Always proof on real swell paper.{' '}
          <a href={`${REPO}#readme`} target="_blank" rel="noreferrer">
            Guide
          </a>
        </span>
      </footer>
      <div className="sr-only" aria-live="polite">
        {announce}
      </div>
    </div>
  );
}
