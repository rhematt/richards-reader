import test from 'node:test';
import assert from 'node:assert/strict';
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import { ordinaryPdf } from './pdf-fixture.mjs';
import { AnnotationStore, screenToPdfPoint, pdfToScreenPoint } from '../src/review/annotations.js';
import { exportMarkedPdf } from '../src/review/export.js';
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';

Uint8Array.prototype.toHex ??= function () { return Buffer.from(this).toString('hex'); };
Map.prototype.getOrInsertComputed ??= function (key, callback) {
  if (!this.has(key)) this.set(key, callback());
  return this.get(key);
};
pdfjs.GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href;

test('ANNOT-001..004: ink coordinates survive zoom, resize, navigation and rotation', async () => {
  const task = pdfjs.getDocument({ data: ordinaryPdf() });
  try {
    const page = await (await task.promise).getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const rect = { left: 40, top: 70, width: viewport.width, height: viewport.height };
    const point = screenToPdfPoint(viewport, rect, 140, 270);
    assert.deepEqual(point, { x: 100, y: 600 });
    for (const scale of [.5, 1, 1.7, 2.5]) {
      const view = page.getViewport({ scale });
      const moved = { left: 200, top: 120, width: view.width, height: view.height };
      const screen = pdfToScreenPoint(view, moved, point);
      assert.deepEqual(screenToPdfPoint(view, moved, screen.x, screen.y), point);
    }
    const rotated = page.getViewport({ scale: 1.5, rotation: 90 });
    const moved = { left: 25, top: 35, width: rotated.width, height: rotated.height };
    const screen = pdfToScreenPoint(rotated, moved, point);
    assert.deepEqual(screenToPdfPoint(rotated, moved, screen.x, screen.y), point);
    const store = new AnnotationStore();
    store.add({ id: 'ink-1', type: 'ink', page: 1, geometry: { paths: [[point, { x: 120, y: 580 }]] }, appearance: { color: '#b91c1c', width: 2 } });
    assert.deepEqual(store.list()[0].geometry.paths[0][0], point);
  } finally { await task.destroy(); }
});

test('ANNOT-006/007/009/022/027: markup and free text export preserves existing marks and untouched pages', async () => {
  const source = await PDFDocument.load(ordinaryPdf());
  source.addPage([600, 800]);
  const withExisting = await exportMarkedPdf(await source.save(), [
    { id: 'existing-note', type: 'note', page: 1, geometry: { point: { x: 60, y: 540 } }, text: 'Existing comment' }
  ]);
  const marked = await exportMarkedPdf(withExisting, [
    { id: 'underline', type: 'underline', page: 1, geometry: { rect: { x1: 50, y1: 640, x2: 210, y2: 654 } } },
    { id: 'strikeout', type: 'strikeout', page: 1, geometry: { rect: { x1: 50, y1: 615, x2: 210, y2: 629 } } },
    { id: 'freetext', type: 'freetext', page: 1, geometry: { rect: { x1: 260, y1: 580, x2: 420, y2: 615 } }, text: 'Review text' }
  ]);
  const task = pdfjs.getDocument({ data: marked });
  try {
    const document = await task.promise;
    assert.equal(document.numPages, 2);
    const first = await document.getPage(1);
    assert.equal((await first.getAnnotations()).length, 4);
    assert.ok((await first.getTextContent()).items.some(item => item.str.includes('Reader preserves')));
    const second = await document.getPage(2);
    assert.equal((await second.getAnnotations()).length, 0);
    assert.equal((await second.getTextContent()).items.length, 0);
  } finally { await task.destroy(); }
});

test('ANNOT-010..017: edit/delete/undo/redo and hide/show leave exact session state and source bytes', () => {
  const source = ordinaryPdf();
  const before = Buffer.from(source).toString('hex');
  const store = new AnnotationStore();
  store.add({ id: 'note-1', type: 'note', page: 1, geometry: { point: { x: 40, y: 600 } }, text: 'First note' });
  const first = store.list();
  store.update('note-1', { text: 'Revised note' });
  store.remove('note-1');
  assert.equal(store.list().length, 0);
  store.undo(); assert.equal(store.list()[0].text, 'Revised note');
  store.undo(); assert.deepEqual(store.list(), first);
  store.redo(); assert.equal(store.list()[0].text, 'Revised note');
  store.setVisible(false); assert.equal(store.list().length, 1);
  store.setVisible(true); assert.equal(store.list().length, 1);
  assert.equal(Buffer.from(source).toString('hex'), before);
});

test('ANNOT-018..023: marked export is valid, searchable, coordinate-correct and repeatable', async () => {
  const source = ordinaryPdf();
  const before = Buffer.from(source).toString('hex');
  const annotations = [
    { id: 'ink-1', type: 'ink', page: 1, geometry: { paths: [[{ x: 50, y: 600 }, { x: 110, y: 610 }]] }, appearance: { color: '#b91c1c', width: 2 } },
    { id: 'highlight-1', type: 'highlight', page: 1, geometry: { rect: { x1: 50, y1: 650, x2: 240, y2: 665 } }, appearance: { color: '#facc15' } },
    { id: 'note-1', type: 'note', page: 1, geometry: { point: { x: 180, y: 550 } }, text: 'Review comment' }
  ];
  const exported = await exportMarkedPdf(source, annotations);
  const twice = await exportMarkedPdf(source, annotations);
  const reopened = await PDFDocument.load(exported.slice());
  assert.equal(Buffer.from(source).toString('hex'), before, 'original bytes unchanged');
  for (const bytes of [exported, twice]) {
    assert.ok(bytes.length > source.length, 'new PDF contains annotations');
    const task = pdfjs.getDocument({ data: bytes });
    try {
      const page = await (await task.promise).getPage(1);
      const text = (await page.getTextContent()).items.map(item => item.str).join(' ');
      assert.ok(text.includes('Reader preserves the original source'), 'original text remains selectable');
      const notes = await page.getAnnotations();
      assert.equal(notes.length, 3, 'exactly one copy of each session annotation');
      assert.ok(notes.some(note => note.contentsObj?.str === 'Review comment' || note.contents === 'Review comment'), 'comment survives reopening');
      assert.ok(notes.some(note => Math.abs(note.rect[0] - 50) < 2), 'source coordinates survive export');
    } finally { await task.destroy(); }
  }
  const ink = reopened.getPage(0).node.normalizedEntries().Annots.lookup(0, PDFDict);
  const normalAppearance = ink.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'), PDFRawStream);
  assert.match(normalAppearance.getContentsString(), /\bm\b[\s\S]*\bl\b[\s\S]*\bS\b/, 'ink has an explicit stroked appearance for Preview interoperability');
});
