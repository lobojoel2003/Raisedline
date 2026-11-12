import rainfall from '../../../examples/rainfall.csv?raw';
import plantGrowth from '../../../examples/plant-growth.csv?raw';
import heightArmspan from '../../../examples/height-armspan.csv?raw';
import schoolTravel from '../../../examples/school-travel.csv?raw';
import temperatures from '../../../examples/temperatures.csv?raw';
import waterCycle from '../../../examples/water-cycle.svg?raw';
import campus from '../../../examples/riverside-campus.geojson?raw';
import plantCellUrl from '../../../examples/plant-cell.png?url';
import type { ChartType } from '@raisedline/core';

export interface ChartExample {
  id: string;
  label: string;
  csv: string;
  type: ChartType;
  title: string;
  xLabel?: string;
  yLabel?: string;
}

export const CHART_EXAMPLES: ChartExample[] = [
  {
    id: 'rainfall',
    label: 'Rainfall (bar)',
    csv: rainfall,
    type: 'bar',
    title: 'Monthly rainfall (mm)',
  },
  {
    id: 'plants',
    label: 'Plant growth (line)',
    csv: plantGrowth,
    type: 'line',
    title: 'Plant growth',
    yLabel: 'Height (cm)',
  },
  {
    id: 'armspan',
    label: 'Arm span (scatter)',
    csv: heightArmspan,
    type: 'scatter',
    title: 'Height and arm span',
  },
  {
    id: 'travel',
    label: 'Travel to school (pie)',
    csv: schoolTravel,
    type: 'pie',
    title: 'How students get to school',
  },
  {
    id: 'temperatures',
    label: 'Temperatures (needs work)',
    csv: temperatures,
    type: 'line',
    title: 'Average high temperature',
    yLabel: 'Degrees C',
  },
];

export const SVG_EXAMPLES = [{ id: 'water-cycle', label: 'The water cycle', text: waterCycle }];

export const MAP_EXAMPLES = [{ id: 'campus', label: 'Riverside Campus', text: campus }];

export const IMAGE_EXAMPLES = [
  { id: 'plant-cell', label: 'Plant cell (line art)', url: plantCellUrl, title: 'Plant cell' },
];
