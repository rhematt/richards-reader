import test from 'node:test';
import assert from 'node:assert/strict';
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import { runnerImport } from 'vite';
import { v2CompositePdf } from './pdf-fixture.mjs';

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
