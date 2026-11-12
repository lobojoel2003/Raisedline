import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  DEFAULT_RULES,
  groupByOwner,
  pagePrimitives,
  primitiveBounds,
  renderTactileSvg,
  unionBox,
  type Box,
  type TactileDocument,
  type TouchIssue,
  type TouchReport,
} from '@raisedline/core';
import { HandIcon } from './Icons';

interface Props {
  doc: TactileDocument | null;
  sighted: string | null;
  report: TouchReport | null;
  selectedIssue: TouchIssue | null;
  onSelectIssue: (i: TouchIssue | null) => void;
  error: string | null;
  page: number;
  setPage: (n: number) => void;
}

type Zoom = 'fit' | '100' | '150' | '200';

const SEVERITY_COLOR = { error: '#d1342c', warning: '#d48806', info: '#2a62c9' };

function closestId(target: EventTarget | null, attr: string): Element | null {
  let el = target as Element | null;
  while (el && el instanceof Element) {
    if (el.hasAttribute(attr)) return el;
    el = el.parentElement;
  }
  return null;
}

function Toggle({
  on,
  set,
  children,
  title,
}: {
  on: boolean;
  set: (v: boolean) => void;
  children: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      className="toggle"
      aria-pressed={on}
      onClick={() => set(!on)}
      title={title}
    >
      <span className="knob" aria-hidden />
      {children}
    </button>
  );
}

export function Stage({
  doc,
  sighted,
  report,
  selectedIssue,
  onSelectIssue,
  error,
  page,
  setPage,
}: Props) {
  const [touch, setTouch] = useState(true);
  const [raised, setRaised] = useState(true);
  const [interline, setInterline] = useState(false);
  const [showSighted, setShowSighted] = useState(true);
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [hover, setHover] = useState<{
    ids: string[];
    sources: string[];
    name: string;
    braille?: string;
    x: number;
    y: number;
  } | null>(null);
  const [finger, setFinger] = useState<{ x: number; y: number; count: number } | null>(null);
  const tactileRef = useRef<HTMLDivElement>(null);
  const sightedRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const pageIndex = doc ? Math.min(page, doc.pages.length - 1) : 0;
  const tactileSvg = useMemo(
    () =>
      doc
        ? renderTactileSvg(doc, pageIndex, { raised, interline, width: '100%', showMargin: touch })
        : '',
    [doc, pageIndex, raised, interline, touch],
  );
  const byId = useMemo(
    () => new Map((doc?.pages[pageIndex]?.elements ?? []).map((e) => [e.id, e] as const)),
    [doc, pageIndex],
  );
  const boxes = useMemo(() => {
    if (!doc) return new Map<string, Box>();
    const out = new Map<string, Box>();
    for (const [id, prims] of groupByOwner(pagePrimitives(doc, pageIndex))) {
      let b: Box | null = null;
      for (const p of prims) b = unionBox(b, primitiveBounds(p));
      if (b) out.set(id, b);
    }
    return out;
  }, [doc, pageIndex]);
  const pageIssues = useMemo(
    () => (report?.issues ?? []).filter((i) => i.page === pageIndex),
    [report, pageIndex],
  );

  // Linked highlighting between the two views.
  useEffect(() => {
    const t = tactileRef.current;
    const s = sightedRef.current;
    for (const root of [t, s]) {
      root?.classList.remove('has-hover');
      root?.querySelectorAll('.rl-hl').forEach((el) => el.classList.remove('rl-hl'));
    }
    const ids = new Set<string>(hover?.ids ?? selectedIssue?.elementIds ?? []);
    const sources = new Set<string>(hover?.sources ?? []);
    for (const id of ids) {
      const el = byId.get(id);
      if (el?.sourceId) sources.add(el.sourceId);
    }
    if (t && (ids.size || sources.size)) {
      t.querySelectorAll('[data-rl-id]').forEach((el) => {
        const id = el.getAttribute('data-rl-id')!;
        const src = el.getAttribute('data-rl-source');
        if (ids.has(id) || (src && sources.has(src))) el.classList.add('rl-hl');
      });
      if (hover) t.classList.add('has-hover');
    }
    if (s && sources.size) {
      s.querySelectorAll('[data-rl-id]').forEach((el) => {
        const id = el.getAttribute('data-rl-id')!;
        if (sources.has(id) || [...sources].some((x) => id.startsWith(`${x}-`)))
          el.classList.add('rl-hl');
      });
      if (hover) s.classList.add('has-hover');
    }
  }, [hover, selectedIssue, byId, tactileSvg, sighted]);

  // Bring a selected issue into view.
  useEffect(() => {
    if (!selectedIssue || !doc || !tactileRef.current || !viewportRef.current) return;
    if (selectedIssue.page !== pageIndex) {
      setPage(selectedIssue.page);
      return;
    }
    const rect = tactileRef.current.getBoundingClientRect();
    const vp = viewportRef.current.getBoundingClientRect();
    const k = rect.width / doc.page.width;
    const cy = rect.top + (selectedIssue.box.y + selectedIssue.box.h / 2) * k;
    const cx = rect.left + (selectedIssue.box.x + selectedIssue.box.w / 2) * k;
    viewportRef.current.scrollBy({
      top: cy - (vp.top + vp.height / 2),
      left: cx - (vp.left + vp.width / 2),
      behavior: 'smooth',
    });
  }, [selectedIssue, doc, pageIndex, setPage]);

  const toMm = (e: ReactMouseEvent) => {
    const r = tactileRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * doc!.page.width,
      y: ((e.clientY - r.top) / r.height) * doc!.page.height,
    };
  };

  const onTactileMove = (e: ReactMouseEvent) => {
    if (!doc) return;
    const p = toMm(e);
    if (touch) {
      const r = DEFAULT_RULES.fingertip / 2;
      const groups = new Set<string>();
      for (const [id, b] of boxes) {
        const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.w));
        const dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.h));
        if (dx * dx + dy * dy <= r * r) groups.add(byId.get(id)?.group ?? id);
      }
      setFinger({ ...p, count: groups.size });
    }
    const hit = closestId(e.target, 'data-rl-id');
    if (hit) {
      const id = hit.getAttribute('data-rl-id')!;
      const el = byId.get(id);
      setHover({
        ids: [id],
        sources: el?.sourceId ? [el.sourceId] : [],
        name: el?.name ?? id,
        braille: el?.kind === 'label' ? el.braille.join(' ') : undefined,
        x: e.clientX,
        y: e.clientY,
      });
    } else setHover(null);
  };

  const onSightedMove = (e: ReactMouseEvent) => {
    const hit = closestId(e.target, 'data-rl-id');
    if (!hit) return setHover(null);
    const id = hit.getAttribute('data-rl-id')!;
    const base = id.replace(/-label$/, '');
    const matches = [...byId.values()].filter((el) => el.sourceId === base || el.sourceId === id);
    setHover({
      ids: matches.map((m) => m.id),
      sources: [base],
      name: matches[0]?.name ?? hit.textContent ?? id,
      x: e.clientX,
      y: e.clientY,
    });
  };

  const sheetStyle = (w: number) =>
    zoom === 'fit'
      ? { width: '100%', maxWidth: 1100 }
      : { width: `${(w * Number(zoom)) / 100}mm`, maxWidth: 'none' };

  const hasSighted = !!sighted && showSighted;
  const W = doc?.page.width ?? 279.4;
  const H = doc?.page.height ?? 215.9;

  return (
    <section className="panel stage" aria-label="Sighted and tactile views">
      <div className="stage-toolbar" role="toolbar" aria-label="View options">
        <Toggle
          on={touch}
          set={setTouch}
          title="Show touch-check findings and a fingertip-sized cursor"
        >
          Touch preview
        </Toggle>
        <Toggle
          on={raised}
          set={setRaised}
          title="Show the tactile version as raised material on swell paper"
        >
          Raised look
        </Toggle>
        <Toggle on={interline} set={setInterline} title="Print the text under each braille label">
          Print text
        </Toggle>
        {sighted !== null && (
          <Toggle on={showSighted} set={setShowSighted}>
            Side by side
          </Toggle>
        )}
        <span className="toolbar-sep" />
        <label className="sr-only" htmlFor="zoom">
          Zoom
        </label>
        <select
          id="zoom"
          value={zoom}
          onChange={(e) => setZoom(e.target.value as Zoom)}
          style={{ width: 'auto' }}
        >
          <option value="fit">Fit</option>
          <option value="100">Actual size</option>
          <option value="150">150%</option>
          <option value="200">200%</option>
        </select>
        {doc && doc.pages.length > 1 && (
          <span className="page-tabs" role="group" aria-label="Pages">
            {doc.pages.map((p, i) => (
              <button
                key={p.id}
                type="button"
                className="btn small"
                aria-pressed={i === pageIndex}
                style={
                  i === pageIndex
                    ? { borderColor: 'var(--accent)', color: 'var(--accent)' }
                    : undefined
                }
                onClick={() => setPage(i)}
              >
                {p.title}
              </button>
            ))}
          </span>
        )}
      </div>

      {error ? (
        <div className="error-box" role="alert">
          <strong>Could not build the tactile graphic.</strong>
          <div>{error}</div>
        </div>
      ) : !doc ? (
        <div className="empty">Choose an input on the left to begin.</div>
      ) : (
        <div className={`panes${hasSighted ? '' : ' single'}`}>
          {hasSighted && (
            <div className="pane">
              <div className="pane-head">
                <h3>Sighted</h3>
                <span>original, in colour</span>
              </div>
              <div className="viewport">
                <div
                  ref={sightedRef}
                  className="sheet sighted"
                  style={sheetStyle(W)}
                  onMouseMove={onSightedMove}
                  onMouseLeave={() => setHover(null)}
                  dangerouslySetInnerHTML={{
                    __html: sighted.replace(/width="[\d.]+mm" height="[\d.]+mm"/, 'width="100%"'),
                  }}
                />
              </div>
            </div>
          )}
          <div className="pane">
            <div className="pane-head">
              <h3>Tactile</h3>
              <span>
                {W} × {H} mm · {doc.pages[pageIndex]?.title}
              </span>
            </div>
            <div className="viewport" ref={viewportRef}>
              <div
                className="sheet tactile"
                style={sheetStyle(W)}
                onMouseMove={onTactileMove}
                onMouseLeave={() => {
                  setHover(null);
                  setFinger(null);
                }}
              >
                <div ref={tactileRef} dangerouslySetInnerHTML={{ __html: tactileSvg }} />
                {touch && (
                  <svg
                    className="overlay"
                    viewBox={`0 0 ${W} ${H}`}
                    preserveAspectRatio="none"
                    aria-hidden
                  >
                    {pageIssues
                      .filter((i) => i.box.w < W * 0.95 || i.box.h < H * 0.95)
                      .map((i) => {
                        const sel = selectedIssue?.id === i.id;
                        const c = SEVERITY_COLOR[i.severity];
                        return (
                          <g
                            key={i.id}
                            style={{ pointerEvents: 'all', cursor: 'pointer' }}
                            onClick={() => onSelectIssue(sel ? null : i)}
                          >
                            <rect
                              className={`issue-box${sel ? ' selected' : ''}`}
                              x={i.box.x - 1.5}
                              y={i.box.y - 1.5}
                              width={i.box.w + 3}
                              height={i.box.h + 3}
                              rx={2.5}
                              fill={c}
                              fillOpacity={i.severity === 'info' ? 0.05 : 0.12}
                              stroke={c}
                              strokeWidth={sel ? 1.2 : 0.6}
                              strokeDasharray={i.severity === 'info' ? '1.6 1.2' : undefined}
                            />
                            {i.severity !== 'info' && (
                              <g
                                transform={`translate(${i.box.x + i.box.w + 1.5} ${i.box.y - 1.5})`}
                              >
                                <circle r={2.6} fill={c} />
                                <text
                                  y={1.1}
                                  textAnchor="middle"
                                  fontSize={3.2}
                                  fontWeight={800}
                                  fill="#fff"
                                >
                                  {i.severity === 'error' ? '!' : '?'}
                                </text>
                              </g>
                            )}
                          </g>
                        );
                      })}
                    {finger && (
                      <g>
                        <circle
                          cx={finger.x}
                          cy={finger.y}
                          r={DEFAULT_RULES.fingertip / 2}
                          fill="#0f766e"
                          fillOpacity={0.08}
                          stroke="#0f766e"
                          strokeWidth={0.5}
                        />
                        <circle cx={finger.x} cy={finger.y} r={0.8} fill="#0f766e" />
                      </g>
                    )}
                  </svg>
                )}
              </div>
              {touch && finger && (
                <div className="fingertip-badge" aria-hidden>
                  <HandIcon size={13} /> {finger.count} feature{finger.count === 1 ? '' : 's'} under
                  one fingertip
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {hover && (
        <div className="tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }} role="status">
          {hover.name}
          {hover.braille && <span className="braille">{hover.braille}</span>}
        </div>
      )}
    </section>
  );
}
