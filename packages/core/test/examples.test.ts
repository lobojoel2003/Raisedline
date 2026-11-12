import { describe, expect, it } from 'vitest';
import { buildChart, buildMap, chartFromCsv, checkDocument, importSvg } from '@raisedline/core';
import { example } from './helpers';

describe('bundled examples', () => {
  it('flag the crossing temperature lines in the "needs work" example', () => {
    const { tactile } = buildChart(
      chartFromCsv(example('temperatures.csv'), { type: 'line', title: 'Temperatures' }),
    );
    const report = checkDocument(tactile);
    expect(report.verdict).not.toBe('ready');
    expect(report.issues.some((i) => i.rule === 'symbol-crowding')).toBe(true);
  });

  it.each([
    ['water cycle', () => importSvg(example('water-cycle.svg')).tactile],
    ['campus map', () => buildMap(example('riverside-campus.geojson')).tactile],
  ])('%s is ready to print', (_name, build) => {
    expect(checkDocument(build()).verdict).toBe('ready');
  });
});
