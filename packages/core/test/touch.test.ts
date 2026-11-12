import { describe, expect, it } from 'vitest';
import {
  checkDocument,
  makeLabel,
  summarizeReport,
  uebGrade1,
  type TactileElement,
} from '@raisedline/core';
import { docWith, hline } from './helpers';

const rules = (doc: ReturnType<typeof docWith>) => checkDocument(doc).issues.map((i) => i.rule);

describe('touch check', () => {
  it('passes a clean graphic with a perfect score', () => {
    const report = checkDocument(docWith([hline('a', 60), hline('b', 80)]));
    expect(report.counts.error).toBe(0);
    expect(report.counts.warning).toBe(0);
    expect(report.score).toBe(100);
    expect(report.verdict).toBe('ready');
    expect(summarizeReport(report)).toMatch(/100\/100/);
  });

  it('flags parallel lines closer than the minimum gap', () => {
    const report = checkDocument(docWith([hline('a', 60), hline('b', 62)]));
    const issue = report.issues.find((i) => i.rule === 'line-gap')!;
    expect(issue).toBeDefined();
    expect(issue.measured).toBeCloseTo(1, 1);
    expect(issue.severity).toBe('error');
    expect(issue.elementIds.sort()).toEqual(['a', 'b']);
    // One issue for the whole run, not one per segment.
    expect(report.issues.filter((i) => i.rule === 'line-gap')).toHaveLength(1);
    expect(report.verdict).not.toBe('ready');
  });

  it('respects a custom minimum gap', () => {
    const doc = docWith([hline('a', 60), hline('b', 64)]);
    expect(checkDocument(doc).issues.some((i) => i.rule === 'line-gap')).toBe(false);
    expect(checkDocument(doc, { minLineGap: 5 }).issues.some((i) => i.rule === 'line-gap')).toBe(
      true,
    );
  });

  it('flags shallow crossings but not right angles or T-junctions', () => {
    const shallow: TactileElement = {
      kind: 'line',
      id: 's',
      role: 'feature',
      points: [
        { x: 40, y: 55 },
        { x: 200, y: 75 },
      ],
      width: 1,
      style: 'solid',
    };
    expect(rules(docWith([hline('a', 65), shallow]))).toContain('shallow-crossing');
    const vertical: TactileElement = {
      kind: 'line',
      id: 'v',
      role: 'feature',
      points: [
        { x: 100, y: 40 },
        { x: 100, y: 120 },
      ],
      width: 1,
      style: 'solid',
    };
    expect(rules(docWith([hline('a', 65), vertical]))).not.toContain('shallow-crossing');
    const tee: TactileElement = {
      kind: 'line',
      id: 't',
      role: 'feature',
      points: [
        { x: 100, y: 65 },
        { x: 100, y: 120 },
      ],
      width: 1,
      style: 'solid',
    };
    const r = rules(docWith([hline('a', 65), tee]));
    expect(r).not.toContain('line-gap');
    expect(r).not.toContain('shallow-crossing');
  });

  it('flags a line that folds back on itself', () => {
    const hairpin: TactileElement = {
      kind: 'line',
      id: 'h',
      role: 'feature',
      width: 1,
      style: 'solid',
      points: [
        { x: 40, y: 60 },
        { x: 160, y: 60 },
        { x: 160, y: 62.5 },
        { x: 40, y: 62.5 },
      ],
    };
    expect(rules(docWith([hairpin]))).toContain('self-gap');
  });

  it('checks braille labels against lines and each other', () => {
    const doc = docWith([hline('a', 70)]);
    const m = doc.braille.metrics;
    const onLine = makeLabel({ id: 'l1', text: 'Road', at: { x: 60, y: 67 } }, uebGrade1, m);
    const other = makeLabel({ id: 'l2', text: 'Lake', at: { x: 62, y: 67 } }, uebGrade1, m);
    doc.pages[0].elements.push(onLine, other);
    const r = checkDocument(doc).issues.map((i) => i.rule);
    expect(r).toContain('label-collision');
    expect(r).toContain('label-overlap');
  });

  it('flags small symbols, small textured areas and short dashed lines', () => {
    const doc = docWith([
      {
        kind: 'symbol',
        id: 'sym',
        role: 'feature',
        at: { x: 100, y: 100 },
        shape: 'circle',
        size: 3,
      },
      {
        kind: 'area',
        id: 'tiny',
        role: 'feature',
        rings: [
          [
            { x: 150, y: 100 },
            { x: 158, y: 100 },
            { x: 158, y: 140 },
            { x: 150, y: 140 },
          ],
        ],
        texture: 'dots',
        outline: { width: 1, style: 'solid' },
      },
      {
        kind: 'line',
        id: 'dash',
        role: 'feature',
        points: [
          { x: 40, y: 150 },
          { x: 48, y: 150 },
        ],
        width: 1,
        style: 'dashed',
      },
      {
        kind: 'line',
        id: 'thin',
        role: 'feature',
        points: [
          { x: 40, y: 170 },
          { x: 120, y: 170 },
        ],
        width: 0.2,
        style: 'solid',
      },
    ]);
    const r = rules(doc);
    expect(r).toEqual(
      expect.arrayContaining([
        'symbol-size',
        'area-too-small',
        'pattern-too-short',
        'line-too-thin',
      ]),
    );
  });

  it('ignores contact between attached elements', () => {
    const line = hline('a', 80);
    const marker: TactileElement = {
      kind: 'symbol',
      id: 'm',
      role: 'data',
      at: { x: 100, y: 80 },
      shape: 'circle',
      size: 6.5,
      attachedTo: ['a'],
    };
    expect(rules(docWith([line, marker]))).not.toContain('symbol-crowding');
    const loose: TactileElement = { ...marker, id: 'm2', attachedTo: undefined };
    expect(rules(docWith([line, loose]))).toContain('symbol-crowding');
  });

  it('flags content outside the page and asks for a title and key', () => {
    const r = rules(docWith([hline('a', 60, 200, 300)]));
    expect(r).toContain('outside-page');
    const doc = docWith([
      {
        kind: 'area',
        id: 'a1',
        role: 'feature',
        rings: [
          [
            { x: 40, y: 40 },
            { x: 90, y: 40 },
            { x: 90, y: 90 },
            { x: 40, y: 90 },
          ],
        ],
        texture: 'dots',
        outline: null,
      },
      {
        kind: 'area',
        id: 'a2',
        role: 'feature',
        rings: [
          [
            { x: 120, y: 40 },
            { x: 170, y: 40 },
            { x: 170, y: 90 },
            { x: 120, y: 90 },
          ],
        ],
        texture: 'grid',
        outline: null,
      },
    ]);
    doc.pages[0].elements = doc.pages[0].elements.filter((e) => e.role !== 'title');
    const r2 = rules(doc);
    expect(r2).toContain('missing-title');
    expect(r2).toContain('missing-key');
  });

  it('counts textures, line styles and coverage', () => {
    const report = checkDocument(docWith([hline('a', 60)]));
    expect(report.stats.labels).toBe(1);
    expect(report.stats.coverage).toBeGreaterThan(0);
    expect(report.stats.coverage).toBeLessThan(0.05);
  });
});
