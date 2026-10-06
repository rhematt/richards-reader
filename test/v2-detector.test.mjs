import test from 'node:test';
import assert from 'node:assert/strict';
import { needsLayoutInference, decodeDetections } from '../src/layout/detector.js';
import { mergeDetectedRegions } from '../src/layout/regions.js';

test('LAYOUT-ML-001: trivial prose skips inference; ambiguity and visual objects request it', () => {
  const page = { width: 600, height: 800, imageBoxes: [], lines: Array.from({ length: 12 }, (_, i) => ({ box: { x: 50, y: 80 + i * 24, w: 470, h: 12 }, text: `Prose line ${i}` })) };
  assert.equal(needsLayoutInference(page), false);
  assert.equal(needsLayoutInference({ ...page, imageBoxes: [{ x: 80, y: 200, w: 180, h: 120 }] }), true);
  assert.equal(needsLayoutInference({ ...page, lines: [
    ...page.lines.slice(0, 6).map(line => ({ ...line, box: { ...line.box, w: 220 } })),
    ...page.lines.slice(6).map(line => ({ ...line, box: { ...line.box, x: 325, w: 220 } }))
  ] }), true);
});

test('LAYOUT-ML-002: ONNX class boxes map to PDF-space generic regions', () => {
  const rows = new Float32Array([
    8, .92, 40, 100, 500, 250,
    7, .84, 60, 330, 490, 390,
    18, .24, 20, 20, 90, 80
  ]);
  assert.deepEqual(decodeDetections(rows, 3, 600, 800, 600, 800).map(region => [region.type, region.bounds]), [
    ['table', { x: 40, y: 100, w: 460, h: 150 }],
    ['equation', { x: 60, y: 330, w: 430, h: 60 }]
  ]);
});

test('LAYOUT-ML-004: visual detections own embedded labels without claiming adjacent caption or prose', () => {
  const line = (id, text, x, y, w = 90) => ({ text, box: { x, y, w, h: 10 }, runs: [{ id, text }] });
  const lines = [
    line('axis', 'Accuracy', 80, 140), line('tick', '0.6', 160, 250),
    line('caption', 'Figure 2. Trial results.', 80, 310, 300),
    line('prose', 'The study continues.', 80, 350, 300)
  ];
  const regions = mergeDetectedRegions([], [{ type: 'image', confidence: .93,
    bounds: { x: 60, y: 120, w: 360, h: 165 } }], lines, 1);
  assert.equal(regions.length, 1);
  assert.deepEqual(regions[0].sourceObjectIds, ['axis', 'tick']);
  assert.equal(regions[0].type, 'image');
});

test('LAYOUT-ML-005: weak detections cannot swallow prose or duplicate source regions', () => {
  const lines = [{ text: 'Ordinary paragraph.', box: { x: 50, y: 150, w: 430, h: 12 },
    runs: [{ id: 'prose', text: 'Ordinary paragraph.' }] }];
  const existing = [{ id: 'p1-i0', type: 'image', page: 1, bbox: { x: 50, y: 100, w: 430, h: 100 },
    bounds: { x: 50, y: 100, w: 430, h: 100 }, sourceObjectIds: [] }];
  const merged = mergeDetectedRegions(existing, [
    { type: 'table', confidence: .60, bounds: { x: 40, y: 130, w: 450, h: 50 } },
    { type: 'image', confidence: .95, bounds: { x: 48, y: 98, w: 434, h: 104 } }
  ], lines, 1);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'p1-i0');
  assert.deepEqual(merged[0].sourceObjectIds, ['prose']);
});

test('MATH-010: a detected display formula claims its external equation number', () => {
  const lines = [
    { text: 'E = m c 2', box: { x: 170, y: 290, w: 150, h: 16 }, runs: [{ id: 'formula', text: 'E = m c 2' }] },
    { text: '(4)', box: { x: 480, y: 291, w: 25, h: 12 }, runs: [{ id: 'number', text: '(4)' }] },
    { text: 'Next paragraph.', box: { x: 50, y: 340, w: 200, h: 12 }, runs: [{ id: 'prose', text: 'Next paragraph.' }] }
  ];
  const regions = mergeDetectedRegions([], [{ type: 'equation', confidence: .95,
    bounds: { x: 160, y: 285, w: 180, h: 27 } }], lines, 1);
  assert.deepEqual(regions[0].sourceObjectIds, ['formula', 'number']);
  assert.equal(regions[0].equationNumber, '4');
  assert.equal(regions[0].text, 'Equation 4');
});
