import test from 'node:test';
import assert from 'node:assert/strict';
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import { runnerImport } from 'vite';
import { v2CompositePdf, v2MixedBandsPdf, v2VectorGraphPdf, v2BodyScalePdf, v2TitleHeadingsPdf, v2DenseVectorFigurePdf } from './pdf-fixture.mjs';

Uint8Array.prototype.toHex ??= function () { return Buffer.from(this).toString('hex'); };
Map.prototype.getOrInsertComputed ??= function (key, callback) {
  if (!this.has(key)) this.set(key, callback());
  return this.get(key);
};

const expected = [
  ['title', 'Source-Faithful Reading'],
  ['heading', '1 Introduction'],
  ['body', 'The opening paragraph introduces the comparison.'],
  ['body', 'A second paragraph leads into the graphic.'],
  ['image', null],
  ['figure_caption', 'Figure 1. A source graph with internal labels.'],
  ['body', 'The discussion resumes after the figure.'],
  ['table', null],
  ['table_caption', 'Table 1. Synthetic measurements.'],
  ['body', 'The next paragraph introduces an equation.'],
  ['equation', null],
  ['body', 'The closing paragraph follows the equation.']
];

test('V2-STRUCT-001: source regions own graph, table and display-equation text in exact reading order', async () => {
  const { module: { openPdf, speechText } } = await runnerImport('/src/model.js');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Local PDF sent a network request'); };
  const bytes = v2CompositePdf();
  const before = Buffer.from(bytes).toString('hex');
  let model;
  try {
    model = await openPdf(bytes);
    const blocks = model.pages[0].blocks.filter(block => !['header', 'footer', 'page_number', 'table_source_text'].includes(block.type));
    assert.deepEqual(blocks.map(block => [block.type, ['image', 'table', 'equation'].includes(block.type) ? null : block.text]), expected);
    const prose = blocks.filter(block => ['title', 'heading', 'body'].includes(block.type)).map(block => block.text).join(' ');
    for (const forbidden of ['Accuracy', 'Control', '0.6', 'Condition', 'Before', 'After', 'Treatment', 'E = m c 2', '(4)', 'SYNTHETIC JOURNAL HEADER']) {
      assert.ok(!prose.includes(forbidden), `${forbidden} is not prose`);
    }
    assert.equal(blocks[1].level, 1, 'first section is H1');
    for (const block of blocks) {
      assert.equal(block.page, 1);
      assert.ok(block.bbox && [block.bbox.x, block.bbox.y, block.bbox.w, block.bbox.h].every(Number.isFinite), `${block.type} retains PDF source bounds`);
    }
    const spoken = blocks.filter(block => ['title', 'heading', 'body'].includes(block.type)).map(speechText).join(' ');
    assert.ok(!spoken.includes('Control') && !spoken.includes('E = m c 2'), 'speech excludes owned visual glyphs');
    assert.equal(Buffer.from(bytes).toString('hex'), before, 'source bytes remain unchanged');
  } finally {
    if (model) await model.task.destroy();
    globalThis.fetch = originalFetch;
  }
});

test('LAYOUT-004/005: a spanning heading splits two-column reading into ordered bands', async () => {
  const { module: { openPdf } } = await runnerImport('/src/model.js');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href;
  const model = await openPdf(v2MixedBandsPdf());
  try {
    assert.deepEqual(model.pages[0].blocks.map(block => block.text), [
      'Mixed Layout Study',
      ...Array.from({ length: 4 }, (_, i) => `Before left ${i + 1}.`),
      ...Array.from({ length: 4 }, (_, i) => `Before right ${i + 1}.`),
      '2 Results and Interpretation Across Both Columns',
      ...Array.from({ length: 4 }, (_, i) => `After left ${i + 1}.`),
      ...Array.from({ length: 4 }, (_, i) => `After right ${i + 1}.`)
    ]);
    assert.equal(model.pages[0].blocks[9].level, 1);
  } finally {
    await model.task.destroy();
  }
});

test('FIGURE-002/003/004/010: model proposal isolates vector graph labels and prose resumes', async () => {
  const { module: { openPdf, refinePdfPage } } = await runnerImport('/src/model.js');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href;
  const model = await openPdf(v2VectorGraphPdf());
  try {
    const visual = { type: 'image', confidence: .96, source: 'synthetic model proposal',
      bounds: { x: 65, y: 235, w: 235, h: 165 } };
    await refinePdfPage(model, 1, [visual]);
    const blocks = model.pages[0].blocks;
    assert.deepEqual(blocks.filter(block => !['header', 'footer', 'page_number'].includes(block.type))
      .map(block => [block.type, block.type === 'image' ? null : block.text]), [
      ['title', 'Vector Graph Study'], ['body', 'Prose before the graph.'],
      ['image', null], ['figure_caption', 'Figure 2. Synthetic vector graph.'],
      ['body', 'Prose after the graph.']
    ]);
    assert.equal(model.pages[0].regions.find(region => region.type === 'image').sourceObjectIds.length, 5);
  } finally { await model.task.destroy(); }
});

test('MATH-TTS-001: display equations announce only their semantic label', async () => {
  const { module: { equationSpeechText } } = await runnerImport('/src/model.js');
  const equation = { type: 'equation', text: 'E = m c 2', equationNumber: '4' };
  assert.equal(equationSpeechText(equation, 'skip'), '');
  assert.equal(equationSpeechText(equation, 'announce'), 'Equation 4');
  assert.equal(equationSpeechText({ ...equation, equationNumber: null }, 'announce'), 'Equation');
});

test('HEAD-014/TABLE-011: small figure labels cannot turn abstract prose into headings or authors into a table', async () => {
  const { module: { openPdf } } = await runnerImport('/src/model.js');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href;
  const model = await openPdf(v2BodyScalePdf());
  try {
    const blocks = model.pages[0].blocks;
    assert.equal(blocks.filter(block => block.type === 'table').length, 0, 'three-column author metadata is not a table');
    for (let index = 1; index <= 8; index++) {
      const block = blocks.find(item => item.text.includes(`abstract sentence ${index}`));
      assert.equal(block?.type, 'body', `abstract sentence ${index} stays prose`);
    }
    const prose = blocks.filter(block => block.type === 'body').map(block => block.text).join(' ');
    assert.ok(!prose.includes('t21'), 'small figure labels belong to the source image');
  } finally { await model.task.destroy(); }
});

test('HEAD-015: wrapped document title and same-size uppercase section headings retain hierarchy', async () => {
  const { module: { openPdf } } = await runnerImport('/src/model.js');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href;
  const model = await openPdf(v2TitleHeadingsPdf());
  try {
    assert.deepEqual(model.pages[0].blocks.map(block => [block.type, block.text]), [
      ['title', 'A Study of Source-Faithful Academic Reading'],
      ['body', 'Ada Example'],
      ['heading', 'ABSTRACT'],
      ['body', 'This sentence is abstract prose.'],
      ['heading', '2 RELATED WORK'],
      ['body', 'This sentence belongs to related work.']
    ]);
    assert.equal(model.pages[0].blocks[4].level, 1);
  } finally { await model.task.destroy(); }
});

test('FIGURE-011: a dense vector montage beside prose owns its internal text through caption geometry', async () => {
  const { module: { openPdf } } = await runnerImport('/src/model.js');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href;
  const model = await openPdf(v2DenseVectorFigurePdf());
  try {
    const blocks = model.pages[0].blocks;
    assert.equal(blocks.filter(block => block.type === 'image').length, 1);
    assert.ok(blocks.some(block => block.type === 'figure_caption' && block.text === 'Figure 1. Dense source montage.'));
    const prose = blocks.filter(block => ['title', 'heading', 'body'].includes(block.type)).map(block => block.text).join(' ');
    for (const forbidden of ['Panel label', 'AIRPORT SKETCH']) assert.ok(!prose.includes(forbidden), `${forbidden} belongs to figure`);
    assert.ok(prose.includes('Left prose 1') && prose.includes('Right prose continues'));
  } finally { await model.task.destroy(); }
});
