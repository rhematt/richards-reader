import test from 'node:test';
import assert from 'node:assert/strict';
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import { runnerImport } from 'vite';
import { ordinaryPdf, twoColumnPdf, figureAndTablePdf, manyItemsPdf } from './pdf-fixture.mjs';

// Node 24 lacks two ES2025 methods already present in newer browsers.
// These keep the test focused on the missing ReadableStream async iterator.
Uint8Array.prototype.toHex ??= function () { return Buffer.from(this).toString('hex'); };
Map.prototype.getOrInsertComputed ??= function (key, callback) {
  if (!this.has(key)) this.set(key, callback());
  return this.get(key);
};

test('IPAD-PDF-001: local PDF extraction works without stream async iteration', async () => {
  const originalIterator = Object.getOwnPropertyDescriptor(ReadableStream.prototype, Symbol.asyncIterator);
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  try {
    const { module: { openPdf, readTextContent } } = await runnerImport('/src/model.js');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href;
    for (const [name, bytes] of [['ordinary', ordinaryPdf()], ['multi-chunk', manyItemsPdf()]]) {
      const parityTask = pdfjs.getDocument({ data: bytes, useSystemFonts: true, enableScripting: false, isEvalSupported: false });
      try {
        const page = await (await parityTask.promise).getPage(1);
        const expected = await page.getTextContent();
        if (name === 'multi-chunk') {
          assert.ok(expected.items.length > 100, 'fixture crosses PDF.js text chunk boundary');
          const reader = page.streamTextContent().getReader();
          let chunks = 0;
          while (!(await reader.read()).done) chunks++;
          reader.releaseLock();
          assert.ok(chunks > 1, 'PDF.js actually delivers multiple text chunks');
        }
        assert.deepEqual(await readTextContent(page), expected, `${name}: chunk order, styles and language match PDF.js aggregation`);
      } finally {
        await parityTask.destroy();
      }
    }
    delete ReadableStream.prototype[Symbol.asyncIterator];
    globalThis.fetch = async () => { fetchCalls++; throw new Error('Local PDF extraction attempted a network request'); };
    assert.equal(typeof ReadableStream.prototype.getReader, 'function');

    for (const [name, bytes] of [['ordinary', ordinaryPdf()], ['two-column', twoColumnPdf()], ['figure/table', figureAndTablePdf()]]) {
      const model = await openPdf(bytes);
      try {
        assert.equal(model.pages.length, 1, `${name}: original page exists`);
        assert.ok(model.pages[0].source.getViewport({ scale: 1 }).width > 0, `${name}: original can render`);
        assert.ok(model.usableText, `${name}: text extraction completed`);
        assert.ok(model.pages[0].blocks.length > 0, `${name}: accessible blocks exist`);
        for (const block of model.pages[0].blocks) {
          assert.equal(block.page, 1, `${name}: source page identity`);
          assert.ok(block.bbox && [block.bbox.x, block.bbox.y, block.bbox.w, block.bbox.h].every(Number.isFinite), `${name}: source bounding box`);
        }
        if (name === 'two-column') {
          const text = model.pages[0].blocks.map(block => block.text).join(' ');
          assert.ok(text.indexOf('Left column line 7') < text.indexOf('Right column line 1'), 'left column remains before right column');
        }
        if (name === 'figure/table') {
          assert.ok(model.pages[0].blocks.some(block => block.type === 'image'), 'figure retains a source image region');
          assert.ok(model.pages[0].blocks.some(block => block.type === 'figure_caption'), 'figure caption is retained');
          assert.ok(model.pages[0].blocks.some(block => block.type === 'table' && block.rows), 'aligned table remains a real table');
          assert.ok(model.pages[0].blocks.some(block => block.type === 'table_caption'), 'table caption is retained');
        }
      } finally {
        await model.task.destroy();
      }
    }
    assert.equal(fetchCalls, 0, 'local PDF bytes trigger no fetch or upload');
  } finally {
    Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, originalIterator);
    globalThis.fetch = originalFetch;
  }
});
