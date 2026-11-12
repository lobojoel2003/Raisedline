import { useState } from 'react';
import {
  LINE_STYLES,
  SYMBOLS,
  TEXTURES,
  texturePrimitives,
  styledLine,
  symbolPrimitives,
  type KeyEntry,
  type Primitive,
  type TactileDocument,
  type TouchIssue,
  type TouchReport,
} from '@raisedline/core';
import { CheckIcon, CopyIcon } from './Icons';

interface Props {
  doc: TactileDocument | null;
  report: TouchReport | null;
  notes: string[];
  selectedIssue: TouchIssue | null;
  onSelectIssue: (i: TouchIssue | null) => void;
  ms: number;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const VERDICT = {
  ready: 'Ready to print',
  review: 'Review the flagged areas',
  rework: 'Needs rework',
};

function Gauge({ score, verdict }: { score: number; verdict: TouchReport['verdict'] }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const color =
    verdict === 'ready' ? 'var(--ok)' : verdict === 'review' ? 'var(--warning)' : 'var(--error)';
  return (
    <svg
      className="gauge"
      width={84}
      height={84}
      viewBox="0 0 84 84"
      role="img"
      aria-label={`Touch score ${score} out of 100`}
    >
      <circle cx={42} cy={42} r={r} fill="none" stroke="var(--line)" strokeWidth={8} />
      <circle
        cx={42}
        cy={42}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={8}
        strokeLinecap="round"
        strokeDasharray={`${(score / 100) * c} ${c}`}
        transform="rotate(-90 42 42)"
        style={{ transition: 'stroke-dasharray .4s ease' }}
      />
      <text x={42} y={47} textAnchor="middle" fontSize={22} fontWeight={800} fill="var(--ink)">
        {score}
      </text>
    </svg>
  );
}

function prims(p: Primitive[]) {
  return p.map((q, i) =>
    q.type === 'dot' ? (
      <circle key={i} cx={q.x} cy={q.y} r={q.r} fill="#2b2620" />
    ) : q.type === 'stroke' ? (
      <polyline
        key={i}
        points={q.points.map((pt) => `${pt.x},${pt.y}`).join(' ')}
        fill="none"
        stroke="#2b2620"
        strokeWidth={q.width}
        strokeLinecap="round"
      />
    ) : (
      <path
        key={i}
        d={q.rings.map((r) => 'M' + r.map((pt) => `${pt.x} ${pt.y}`).join('L') + 'Z').join('')}
        fill="#2b2620"
      />
    ),
  );
}

function Swatch({ entry }: { entry: KeyEntry }) {
  const s = entry.swatch;
  const ring = [
    { x: 1, y: 1 },
    { x: 23, y: 1 },
    { x: 23, y: 15 },
    { x: 1, y: 15 },
  ];
  let content;
  if (s.kind === 'texture')
    content = [
      ...prims(texturePrimitives([ring], s.texture, 'k')),
      <rect
        key="o"
        x={1}
        y={1}
        width={22}
        height={14}
        fill="none"
        stroke="#2b2620"
        strokeWidth={0.8}
      />,
    ];
  else if (s.kind === 'line')
    content = [
      ...prims(
        styledLine(
          [
            { x: 1, y: 8 },
            { x: 23, y: 8 },
          ],
          s.width,
          s.style,
          false,
          'k',
        ),
      ),
      ...(s.symbol
        ? prims(
            symbolPrimitives({
              kind: 'symbol',
              id: 'k',
              role: 'key',
              at: { x: 12, y: 8 },
              shape: s.symbol,
              size: 6,
            }),
          )
        : []),
    ];
  else if (s.kind === 'symbol')
    content = prims(
      symbolPrimitives({
        kind: 'symbol',
        id: 'k',
        role: 'key',
        at: { x: 12, y: 8 },
        shape: s.shape,
        size: 7,
      }),
    );
  else
    content = (
      <text x={12} y={11} textAnchor="middle" fontSize={8} fontWeight={700} fill="#2b2620">
        {s.code}
      </text>
    );
  const label =
    s.kind === 'texture'
      ? TEXTURES[s.texture].label
      : s.kind === 'line'
        ? LINE_STYLES[s.style].label
        : s.kind === 'symbol'
          ? SYMBOLS[s.shape].label
          : `Abbreviation ${s.code}`;
  return (
    <svg width={48} height={32} viewBox="0 0 24 16" role="img" aria-label={label}>
      {content}
    </svg>
  );
}

export function Inspector({ doc, report, notes, selectedIssue, onSelectIssue, ms }: Props) {
  const [copied, setCopied] = useState(false);
  const icon = { error: '!', warning: '?', info: 'i' };
  return (
    <aside className="panel inspector" aria-label="Touch check">
      <div className="scroll">
        <div className="section">
          <h2>Touch check</h2>
          {report ? (
            <div className="score-card">
              <Gauge score={report.score} verdict={report.verdict} />
              <div>
                <div className={`verdict ${report.verdict}`}>{VERDICT[report.verdict]}</div>
                <div className="counts">
                  <span className="count error">{plural(report.counts.error, 'error')}</span>
                  <span className="count warning">{plural(report.counts.warning, 'warning')}</span>
                  <span className="count info">{plural(report.counts.info, 'note')}</span>
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 6 }}>
                  {plural(report.stats.labels, 'braille label')} ·{' '}
                  {Math.round(report.stats.coverage * 100)}% raised · {ms.toFixed(0)} ms
                </div>
              </div>
            </div>
          ) : (
            <div style={{ color: 'var(--muted)' }}>No graphic yet.</div>
          )}
        </div>
        {report && (
          <div className="section">
            <h2>Findings</h2>
            {report.issues.length === 0 ? (
              <div className="all-good">
                <CheckIcon /> Every line, label and texture has room to be felt.
              </div>
            ) : (
              <ul className="issues">
                {report.issues.map((i) => (
                  <li key={i.id}>
                    <button
                      type="button"
                      className={`issue ${i.severity}`}
                      aria-pressed={selectedIssue?.id === i.id}
                      onClick={() => onSelectIssue(selectedIssue?.id === i.id ? null : i)}
                    >
                      <span className={`issue-icon ${i.severity}`} aria-hidden>
                        {icon[i.severity]}
                      </span>
                      <span>
                        <span className="sr-only">{i.severity}: </span>
                        <div className="msg">{i.message}</div>
                        <div className="hint">{i.hint}</div>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {doc && doc.key.length > 0 && (
          <div className="section">
            <h2>Key</h2>
            <ul className="key-list">
              {doc.key.map((k, i) => (
                <li key={i}>
                  <Swatch entry={k} />
                  <span>{k.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {doc?.description && (
          <div className="section">
            <h2 style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              Description
              <button
                type="button"
                className="btn small ghost"
                onClick={() => {
                  void navigator.clipboard?.writeText(doc.description);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}{' '}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </h2>
            <div className="desc">{doc.description}</div>
          </div>
        )}
        {notes.length > 0 && (
          <div className="section">
            <h2>Notes</h2>
            <ul className="notes">
              {notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </aside>
  );
}
