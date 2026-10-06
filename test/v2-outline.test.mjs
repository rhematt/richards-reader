import test from 'node:test';
import assert from 'node:assert/strict';
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import { runnerImport } from 'vite';
import { v2HierarchyPdf } from './pdf-fixture.mjs';

Uint8Array.prototype.toHex ??= function () { return Buffer.from(this).toString('hex'); };
Map.prototype.getOrInsertComputed ??= function (key, callback) {
  if (!this.has(key)) this.set(key, callback());
  return this.get(key);
};

test('HEAD-001/004/005/011/012/013: source hierarchy creates the only outline', async () => {
  const { module: { openPdf } } = await runnerImport('/src/model.js');
  const { module: { buildOutline } } = await runnerImport('/src/layout/outline.js');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href;
  const model = await openPdf(v2HierarchyPdf());
  try {
    const blocks = model.pages[0].blocks;
    assert.deepEqual(blocks.filter(block => ['title', 'heading'].includes(block.type)).map(block => [block.type, block.level, block.text]), [
      ['title', undefined, 'A Study of Clear Structure'],
      ['heading', 1, '1 Methods'],
      ['heading', 2, '1.1 Participants'],
      ['heading', 3, '1.1.1 Eligibility'],
      ['heading', 1, '2 Results']
    ]);
    assert.equal(blocks.find(block => block.text === 'Journal of Synthetic Examples').type, 'header');
    assert.equal(blocks.find(block => block.text === '1').type, 'page_number');
    const outline = buildOutline(model.pages);
    assert.deepEqual(outline.map(node => [node.text, node.children.map(child => [child.text, child.children.map(grandchild => grandchild.text)])]), [
      ['1 Methods', [['1.1 Participants', ['1.1.1 Eligibility']]]],
      ['2 Results', []]
    ]);
    assert.equal(outline[0].page, 1);
    assert.ok(outline[0].bbox.w > 0);
  } finally {
    await model.task.destroy();
  }
});
