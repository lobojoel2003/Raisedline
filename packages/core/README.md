# @raisedline/core

The engine behind [Raisedline](https://github.com/lobojoel2003/Raisedline): it turns charts,
SVG diagrams, raster images and GeoJSON maps into tactile graphics, runs a touch-readability
check, and exports PDF (swell paper), SVG, STL (3D printing), BRF (any braille embosser) and
G-code (BrailleRAP-compatible embossers).

```ts
import { buildChart, checkDocument, exportPdf } from '@raisedline/core';

const { tactile } = buildChart({
  type: 'bar',
  title: 'Rainfall by season',
  categories: ['Spring', 'Summer', 'Autumn', 'Winter'],
  series: [{ name: 'Rainfall (mm)', values: [120, 60, 140, 180] }],
});
const report = checkDocument(tactile);
const pdfBytes = exportPdf(tactile);
```

See the main repository README for the full documentation.
