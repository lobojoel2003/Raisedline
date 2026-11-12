import { readFileSync } from 'node:fs';
import {
  createDocument,
  makeLabel,
  uebGrade1,
  type TactileDocument,
  type TactileElement,
} from '@raisedline/core';

export const example = (name: string) =>
  readFileSync(new URL(`../../../examples/${name}`, import.meta.url), 'utf8');

export function docWith(elements: TactileElement[], key = false): TactileDocument {
  const doc = createDocument({ title: 'Test', source: 'manual' });
  const title = makeLabel(
    { id: 'title', text: 'Test', at: { x: 20, y: 15 }, role: 'title' },
    uebGrade1,
    doc.braille.metrics,
  );
  doc.pages[0].elements = [title, ...elements];
  if (key) doc.key = [{ swatch: { kind: 'texture', texture: 'dots' }, text: 'x' }];
  return doc;
}

export function hline(id: string, y: number, x0 = 40, x1 = 200, width = 1): TactileElement {
  return {
    kind: 'line',
    id,
    role: 'feature',
    name: id,
    points: [
      { x: x0, y },
      { x: x1, y },
    ],
    width,
    style: 'solid',
  };
}
