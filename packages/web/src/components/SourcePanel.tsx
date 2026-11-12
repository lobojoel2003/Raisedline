import { useId, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { PAGE_PRESETS, type ChartType, type TraceMode } from '@raisedline/core';
import { CHART_EXAMPLES, IMAGE_EXAMPLES, MAP_EXAMPLES, SVG_EXAMPLES } from '../examples';
import type { Inputs, Settings, SourceKind } from '../model';
import { ChartIcon, DiagramIcon, FolderIcon, ImageIcon, MapIcon, UploadIcon } from './Icons';

interface Props {
  kind: SourceKind;
  setKind: (k: SourceKind) => void;
  inputs: Inputs;
  update: <K extends keyof Inputs>(k: K, patch: Partial<NonNullable<Inputs[K]>>) => void;
  settings: Settings;
  setSettings: (s: Settings) => void;
  liblouisTables: string[] | null;
  onFile: (file: File, kind?: SourceKind) => void;
  loadExample: (kind: SourceKind, id: string) => void;
  activeExample: string | null;
}

const TABS: { kind: SourceKind; label: string; icon: ReactNode }[] = [
  { kind: 'chart', label: 'Chart', icon: <ChartIcon size={17} /> },
  { kind: 'svg', label: 'Diagram', icon: <DiagramIcon size={17} /> },
  { kind: 'image', label: 'Image', icon: <ImageIcon size={17} /> },
  { kind: 'map', label: 'Map', icon: <MapIcon size={17} /> },
  { kind: 'project', label: 'Project', icon: <FolderIcon size={17} /> },
];

const ACCEPT: Record<SourceKind, string> = {
  chart: '.csv,.tsv,text/csv',
  svg: '.svg,image/svg+xml',
  image: 'image/png,image/jpeg,image/webp,image/gif',
  map: '.geojson,.json,application/geo+json',
  project: '.json',
};

const DROP_TEXT: Record<SourceKind, string> = {
  chart: 'CSV with a header row',
  svg: 'SVG from Illustrator, Inkscape, matplotlib…',
  image: 'PNG or JPEG scan or drawing',
  map: 'GeoJSON (lon/lat or planar)',
  project: 'Raisedline project (.raisedline.json)',
};

function DropZone({ kind, onFile }: { kind: SourceKind; onFile: Props['onFile'] }) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f, kind);
  };
  return (
    <>
      <button
        type="button"
        className={`dropzone${over ? ' over' : ''}`}
        style={{ width: '100%' }}
        onClick={() => ref.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <UploadIcon size={20} />
        <div>
          <strong>Choose a file</strong> or drop it here
        </div>
        <small>{DROP_TEXT[kind]}</small>
      </button>
      <input
        ref={ref}
        type="file"
        accept={ACCEPT[kind]}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f, kind);
          e.target.value = '';
        }}
      />
    </>
  );
}

function Examples({
  items,
  kind,
  load,
  active,
}: {
  items: { id: string; label: string }[];
  kind: SourceKind;
  load: Props['loadExample'];
  active: string | null;
}) {
  return (
    <div className="examples" role="group" aria-label="Examples">
      {items.map((e) => (
        <button
          key={e.id}
          type="button"
          className="chip"
          aria-pressed={active === e.id}
          onClick={() => load(kind, e.id)}
        >
          {e.label}
        </button>
      ))}
    </div>
  );
}

export function SourcePanel(p: Props) {
  const uid = useId();
  const { inputs, update, kind } = p;
  return (
    <aside className="panel sidebar" aria-label="Source">
      <div className="section">
        <div className="segmented" role="tablist" aria-label="What are you converting?">
          {TABS.map((t) => (
            <button
              key={t.kind}
              role="tab"
              type="button"
              aria-selected={kind === t.kind}
              id={`${uid}-tab-${t.kind}`}
              onClick={() => p.setKind(t.kind)}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="scroll" role="tabpanel" aria-labelledby={`${uid}-tab-${kind}`}>
        <div className="section">
          <h2>Input</h2>
          <DropZone kind={kind} onFile={p.onFile} />
          {kind === 'chart' && (
            <Examples
              items={CHART_EXAMPLES}
              kind="chart"
              load={p.loadExample}
              active={p.activeExample}
            />
          )}
          {kind === 'svg' && (
            <Examples
              items={SVG_EXAMPLES}
              kind="svg"
              load={p.loadExample}
              active={p.activeExample}
            />
          )}
          {kind === 'image' && (
            <Examples
              items={IMAGE_EXAMPLES}
              kind="image"
              load={p.loadExample}
              active={p.activeExample}
            />
          )}
          {kind === 'map' && (
            <Examples
              items={MAP_EXAMPLES}
              kind="map"
              load={p.loadExample}
              active={p.activeExample}
            />
          )}
        </div>

        {kind === 'chart' && (
          <div className="section">
            <h2>Chart</h2>
            <div className="field">
              <span id={`${uid}-ct`}>Chart type</span>
              <div className="segmented" role="group" aria-labelledby={`${uid}-ct`}>
                {(['bar', 'line', 'scatter', 'pie'] as ChartType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={inputs.chart.type === t}
                    onClick={() => update('chart', { type: t })}
                  >
                    {t[0].toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <label className="field">
              <span>Title</span>
              <input
                type="text"
                value={inputs.chart.title}
                onChange={(e) => update('chart', { title: e.target.value })}
              />
            </label>
            <div className="row">
              <label className="field">
                <span>X axis</span>
                <input
                  type="text"
                  value={inputs.chart.xLabel}
                  placeholder="from CSV"
                  onChange={(e) => update('chart', { xLabel: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Y axis</span>
                <input
                  type="text"
                  value={inputs.chart.yLabel}
                  placeholder="optional"
                  onChange={(e) => update('chart', { yLabel: e.target.value })}
                />
              </label>
            </div>
            <label className="field">
              <span>Gridlines</span>
              <select
                value={inputs.chart.gridlines}
                onChange={(e) => update('chart', { gridlines: e.target.value as 'auto' })}
              >
                <option value="auto">Automatic</option>
                <option value="on">On (dotted, broken around data)</option>
                <option value="off">Off</option>
              </select>
            </label>
            <label className="field">
              <span>Data (CSV)</span>
              <textarea
                value={inputs.chart.csv}
                spellCheck={false}
                onChange={(e) => update('chart', { csv: e.target.value })}
                aria-describedby={`${uid}-csvhelp`}
              />
              <small id={`${uid}-csvhelp`}>
                First row: headers. First column: categories (x values for scatter). Other columns:
                series.
              </small>
            </label>
          </div>
        )}

        {kind === 'svg' && (
          <div className="section">
            <h2>Diagram</h2>
            <label className="field">
              <span>Title</span>
              <input
                type="text"
                value={inputs.svg.title}
                placeholder="from the SVG <title>"
                onChange={(e) => update('svg', { title: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Simplify detail below {inputs.svg.simplify.toFixed(1)} mm</span>
              <input
                type="range"
                min={0}
                max={3}
                step={0.1}
                value={inputs.svg.simplify}
                onChange={(e) => update('svg', { simplify: Number(e.target.value) })}
              />
            </label>
            {inputs.svg.name && <small>Loaded: {inputs.svg.name}</small>}
          </div>
        )}

        {kind === 'image' && (
          <div className="section">
            <h2>Tracing</h2>
            <label className="field">
              <span>Title</span>
              <input
                type="text"
                value={inputs.image.title}
                onChange={(e) => update('image', { title: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Mode</span>
              <select
                value={inputs.image.mode}
                onChange={(e) => update('image', { mode: e.target.value as TraceMode })}
              >
                <option value="auto">Auto — lines and solid shapes</option>
                <option value="lines">Lines — follow the centre of strokes</option>
                <option value="outlines">Outlines — trace edges of dark shapes</option>
                <option value="regions">Regions — colours become textures</option>
              </select>
            </label>
            {inputs.image.mode === 'regions' ? (
              <label className="field">
                <span>Colour regions: {inputs.image.colors}</span>
                <input
                  type="range"
                  min={2}
                  max={6}
                  value={inputs.image.colors}
                  onChange={(e) => update('image', { colors: Number(e.target.value) })}
                />
              </label>
            ) : (
              <>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={inputs.image.threshold === null}
                    onChange={(e) => update('image', { threshold: e.target.checked ? null : 128 })}
                  />
                  Automatic threshold
                </label>
                {inputs.image.threshold !== null && (
                  <label className="field">
                    <span>Threshold: {inputs.image.threshold}</span>
                    <input
                      type="range"
                      min={10}
                      max={245}
                      value={inputs.image.threshold}
                      onChange={(e) => update('image', { threshold: Number(e.target.value) })}
                    />
                  </label>
                )}
                <label className="check">
                  <input
                    type="checkbox"
                    checked={inputs.image.invert}
                    onChange={(e) => update('image', { invert: e.target.checked })}
                  />
                  Light drawing on a dark background
                </label>
              </>
            )}
            <label className="field">
              <span>Smoothing: {inputs.image.smoothing.toFixed(1)} px</span>
              <input
                type="range"
                min={0}
                max={4}
                step={0.5}
                value={inputs.image.smoothing}
                onChange={(e) => update('image', { smoothing: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              <span>Simplify detail below {inputs.image.simplify.toFixed(1)} mm</span>
              <input
                type="range"
                min={0.2}
                max={3}
                step={0.1}
                value={inputs.image.simplify}
                onChange={(e) => update('image', { simplify: Number(e.target.value) })}
              />
            </label>
          </div>
        )}

        {kind === 'map' && (
          <div className="section">
            <h2>Map</h2>
            <label className="field">
              <span>Title</span>
              <input
                type="text"
                value={inputs.map.title}
                placeholder="from the GeoJSON name"
                onChange={(e) => update('map', { title: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Label property</span>
              <input
                type="text"
                value={inputs.map.labelProperty}
                onChange={(e) => update('map', { labelProperty: e.target.value })}
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={inputs.map.north}
                onChange={(e) => update('map', { north: e.target.checked })}
              />
              North arrow
            </label>
          </div>
        )}

        {kind === 'project' && (
          <div className="section">
            <h2>Project</h2>
            <p style={{ margin: 0, color: 'var(--muted)' }}>
              {inputs.project
                ? `Opened ${inputs.project.name}.`
                : 'Open a project saved from Raisedline or written by the command-line tool.'}
            </p>
          </div>
        )}

        <div className="section">
          <h2>Page &amp; braille</h2>
          <label className="field">
            <span>Page size</span>
            <select
              value={p.settings.page}
              onChange={(e) => p.setSettings({ ...p.settings, page: e.target.value })}
            >
              {Object.entries(PAGE_PRESETS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Braille</span>
            <select
              value={p.settings.table}
              onChange={(e) => p.setSettings({ ...p.settings, table: e.target.value })}
            >
              <option value="ueb-grade1">UEB Grade 1 (built in)</option>
              {(p.liblouisTables ?? []).map((t) => (
                <option key={t} value={`liblouis:${t}`}>
                  liblouis: {t}
                </option>
              ))}
            </select>
            {!p.liblouisTables && (
              <small>
                For Grade 2 and other languages, run <code>raisedline serve</code> with liblouis
                installed.
              </small>
            )}
          </label>
          <div className="row">
            <label className="field">
              <span>Margin (mm)</span>
              <input
                type="number"
                min={0}
                max={40}
                value={p.settings.margin}
                onChange={(e) =>
                  p.setSettings({ ...p.settings, margin: Math.max(0, Number(e.target.value) || 0) })
                }
              />
            </label>
            <label className="field">
              <span>Min. line gap</span>
              <select
                value={p.settings.minLineGap}
                onChange={(e) =>
                  p.setSettings({ ...p.settings, minLineGap: Number(e.target.value) })
                }
              >
                <option value={2}>2 mm</option>
                <option value={2.5}>2.5 mm</option>
                <option value={3}>3 mm (1/8 in)</option>
                <option value={4}>4 mm</option>
                <option value={5}>5 mm</option>
              </select>
            </label>
          </div>
        </div>
      </div>
    </aside>
  );
}
