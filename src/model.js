import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export const BLOCK_TYPES = Object.freeze([
  'body', 'heading', 'image', 'figure_caption', 'table', 'table_caption',
  'equation', 'code', 'footnote', 'endnote', 'inline_citation',
  'bibliography', 'header', 'footer', 'page_number', 'sidebar', 'source_region', 'table_source_text'
]);

const citationPattern = /\[(?:\d+[\s,;–-]*)+\]|\((?:[A-Z][\p{L}'-]+(?:\s+(?:et al\.|&|and|[A-Z][\p{L}'-]+))*[, ]+\d{4}[a-z]?(?:\s*;\s*)?)+\)|\b[A-Z][\p{L}'-]+(?:\s+(?:and|&)\s+[A-Z][\p{L}'-]+)?\s+\(\d{4}[a-z]?\)/gu;
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};
const union = boxes => ({
  x: Math.min(...boxes.map(b => b.x)), y: Math.min(...boxes.map(b => b.y)),
  w: Math.max(...boxes.map(b => b.x + b.w)) - Math.min(...boxes.map(b => b.x)),
  h: Math.max(...boxes.map(b => b.y + b.h)) - Math.min(...boxes.map(b => b.y))
});
const clean = text => text.replace(/\s+/g, ' ').trim();

function textRuns(content, viewport) {
  return content.items.filter(item => typeof item.str === 'string' && item.str.trim()).map(item => {
    const t = pdfjs.Util.transform(viewport.transform, item.transform);
    const height = Math.max(4, Math.hypot(t[2], t[3]));
    const width = Math.max(1, item.width);
    return {
      text: item.str,
      x: t[4], y: t[5] - height,
      w: width, h: height,
      font: item.fontName,
      fontSize: height,
      bold: /bold|black|heavy|semibold/i.test(item.fontName),
      eol: item.hasEOL
    };
  });
}

function toLines(runs, pageWidth) {
  const lines = [];
  for (const run of [...runs].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const line = lines.find(l => Math.abs(l.y - run.y) <= Math.max(3, run.h * .36) && Math.abs(l.fontSize - run.fontSize) < run.h * .45);
    if (line) line.runs.push(run);
    else lines.push({ y: run.y, fontSize: run.fontSize, runs: [run] });
  }
  return lines.flatMap(line => {
    line.runs.sort((a, b) => a.x - b.x);
    const groups = [];
    let group = [];
    for (const run of line.runs) {
      const previous = group.at(-1);
      const gap = previous ? run.x - (previous.x + previous.w) : 0;
      const crossesCentre = previous && previous.x + previous.w < pageWidth / 2 && run.x > pageWidth / 2;
      const startsRightColumn = previous && previous.x < pageWidth * .18 && run.x >= pageWidth * .5 && run.x < pageWidth * .63 && gap > 4;
      if (previous && (startsRightColumn || (crossesCentre && (gap > pageWidth * .28 || (gap > Math.max(4, run.fontSize * .4) && previous.w > pageWidth * .2 && run.w > pageWidth * .2))))) {
        groups.push(group); group = [];
      }
      group.push(run);
    }
    if (group.length) groups.push(group);
    return groups.map(runs => ({ ...line, runs }));
  }).map(line => {
    let text = '';
    let previous;
    for (const run of line.runs) {
      const gap = previous ? run.x - (previous.x + previous.w) : 0;
      if (previous && gap > Math.max(2, run.fontSize * .18) && !text.endsWith(' ') && !run.text.startsWith(' ')) text += ' ';
      text += run.text;
      previous = run;
    }
    return { ...line, text: clean(text), box: union(line.runs), bold: line.runs.some(r => r.bold) };
  }).filter(line => line.text);
}

function readingOrder(lines, width, height) {
  const narrow = lines.filter(l => l.box.w < width * .57 && l.box.y > height * .05 && l.box.y < height * .88);
  const left = narrow.filter(l => l.box.x + l.box.w / 2 < width / 2);
  const right = narrow.filter(l => l.box.x + l.box.w / 2 >= width / 2);
  if (left.length < 5 || right.length < 5) return lines.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  const firstColumnY = Math.min(...left.map(l => l.box.y), ...right.map(l => l.box.y));
  const lastColumnY = Math.max(...left.map(l => l.box.y), ...right.map(l => l.box.y));
  const wide = lines.filter(l => !narrow.includes(l));
  return [
    ...wide.filter(l => l.box.y < firstColumnY).sort((a, b) => a.box.y - b.box.y),
    ...left.sort((a, b) => a.box.y - b.box.y),
    ...right.sort((a, b) => a.box.y - b.box.y),
    ...wide.filter(l => l.box.y >= firstColumnY && l.box.y <= lastColumnY).sort((a, b) => a.box.y - b.box.y),
    ...wide.filter(l => l.box.y > lastColumnY).sort((a, b) => a.box.y - b.box.y)
  ];
}

function makeTextBlocks(lines, page, pageWidth, pageHeight, medianSize) {
  const blocks = [];
  let group = [];
  const flush = () => {
    if (!group.length) return;
    const text = clean(group.map((line, index) => {
      if (index && group[index - 1].text.endsWith('-') && /^[a-z]/.test(line.text)) return line.text;
      return (index ? ' ' : '') + line.text;
    }).join('').replace(/- (?=[a-z])/g, ''));
    const box = union(group.map(l => l.box));
    const fontSize = median(group.map(l => l.fontSize));
    const block = { id: `p${page}-b${blocks.length}`, page, bbox: box, text, fontSize, bold: group.some(l => l.bold), type: 'body', confidence: 'heuristic', citations: [...text.matchAll(citationPattern)].map(match => ({ start: match.index, end: match.index + match[0].length, text: match[0], type: 'inline_citation' })) };
    if (/^(figure|fig\.?|image)\s*\d+[.:\s]/i.test(text)) block.type = 'figure_caption';
    else if (/^table\s*\d+[.:\s]/i.test(text)) block.type = 'table_caption';
    else if (/^(references|bibliography|works cited|endnotes|notes)$/i.test(text)) block.type = 'heading';
    else if (box.y < pageHeight * .065 && fontSize <= medianSize * 1.15) block.type = 'header';
    else if (box.y > pageHeight * .94 && /^\d{1,4}$/.test(text)) block.type = 'page_number';
    else if (box.y > pageHeight * .94 && fontSize <= medianSize * 1.15) block.type = 'footer';
    else if ((fontSize > medianSize * 1.18 || block.bold) && text.length < 140 && !/[.!?]$/.test(text)) block.type = 'heading';
    else if (/^(?:\d+[.)]|[*†‡])\s+/.test(text) && box.y > pageHeight * .72 && fontSize < medianSize * .95) block.type = 'footnote';
    else if (/^(?:def |class |function |import |const |let |var |#include\b)/.test(text) || (/monospace|courier/i.test(group[0].runs[0]?.font) && text.length > 8)) block.type = 'code';
    else if (/[=∑∫√≈≤≥]/.test(text) && text.length < 100 && fontSize >= medianSize * .85) block.type = 'equation';
    else if (box.x > pageWidth * .15 && box.w < pageWidth * .28 && fontSize < medianSize * .92 && text.length < 400) block.type = 'sidebar';
    if (block.type === 'heading') block.level = fontSize > medianSize * 1.55 ? 1 : /^\d+(?:\.\d+)+/.test(text) ? 3 : 2;
    blocks.push(block);
    group = [];
  };
  for (const line of lines) {
    const previous = group.at(-1);
    const gap = previous ? line.box.y - (previous.box.y + previous.box.h) : 0;
    const sameColumn = previous && Math.abs(line.box.x - previous.box.x) < Math.max(18, medianSize * 2);
    const isShortDistinct = line.text.length < 80 && (line.bold || line.fontSize > medianSize * 1.18);
    if (previous && (gap > Math.max(8, medianSize * .9) || gap < -medianSize || !sameColumn || isShortDistinct || /^table\s+\d+|^fig(?:ure)?\.?\s+\d+/i.test(line.text))) flush();
    group.push(line);
  }
  flush();
  return blocks;
}

function imageRegions(operatorList, viewport) {
  const regions = [];
  let transform = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const ops = pdfjs.OPS;
  for (let index = 0; index < operatorList.fnArray.length; index++) {
    const fn = operatorList.fnArray[index];
    const args = operatorList.argsArray[index];
    if (fn === ops.save) stack.push([...transform]);
    else if (fn === ops.restore) transform = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === ops.transform) transform = pdfjs.Util.transform(transform, args);
    else if ([ops.paintImageXObject, ops.paintInlineImageXObject, ops.paintJpegXObject].includes(fn)) {
      const t = pdfjs.Util.transform(viewport.transform, transform);
      const points = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => ({ x: t[0] * x + t[2] * y + t[4], y: t[1] * x + t[3] * y + t[5] }));
      const box = union(points.map(p => ({ x: p.x, y: p.y, w: 0, h: 0 })));
      if (box.w > 45 && box.h > 35 && box.w < viewport.width * 1.1 && box.h < viewport.height * 1.1) regions.push(box);
    }
  }
  return regions;
}

function detectTables(lines, page, medianSize) {
  const candidates = lines.map(line => ({
    line,
    cells: line.runs.filter(run => run.text.trim()).map(run => ({ text: clean(run.text), x: run.x }))
  })).filter(row => row.cells.length >= 2 && row.cells.length <= 12 && row.line.runs.some((run, i) => i && run.x - (row.line.runs[i - 1].x + row.line.runs[i - 1].w) > medianSize * 1.5));
  const tables = [];
  let rows = [];
  const finish = () => {
    if (rows.length >= 3) {
      const count = median(rows.map(r => r.cells.length));
      const columns = Array.from({ length: count }, (_, index) => median(rows.map(row => row.cells[index]?.x).filter(Number.isFinite)));
      const regular = rows.every(row => row.cells.length === count && row.cells.every((cell, index) => Math.abs(cell.x - columns[index]) < Math.max(12, medianSize * 1.2)));
      tables.push({ id: `p${page}-t${tables.length}`, page, type: 'table', bbox: union(rows.map(r => r.line.box)), text: rows.map(r => r.cells.map(c => c.text).join(' | ')).join('\n'), rows: regular ? rows.map(r => r.cells.map(c => c.text)) : null, confidence: regular ? 'aligned text rows' : 'source region only' });
    }
    rows = [];
  };
  for (const row of candidates.sort((a, b) => a.line.box.y - b.line.box.y)) {
    if (rows.length && row.line.box.y - (rows.at(-1).line.box.y + rows.at(-1).line.box.h) > medianSize * 1.9) finish();
    rows.push(row);
  }
  finish();
  return tables;
}

function postProcess(pages) {
  const repeated = new Map();
  for (const page of pages) for (const block of page.blocks.filter(b => ['header', 'footer'].includes(b.type))) {
    const key = block.text.toLowerCase().replace(/\d+/g, '#');
    repeated.set(key, (repeated.get(key) || 0) + 1);
  }
  let inReferences = false;
  let inEndnotes = false;
  for (const page of pages) for (const block of page.blocks) {
    const key = block.text.toLowerCase().replace(/\d+/g, '#');
    if (['header', 'footer'].includes(block.type) && repeated.get(key) < 2) block.type = 'body';
    if (block.type === 'heading' && /^(references|bibliography|works cited)$/i.test(block.text)) { inReferences = true; inEndnotes = false; block.section = 'bibliography'; }
    else if (block.type === 'heading' && /^(endnotes|notes)$/i.test(block.text)) { inEndnotes = true; inReferences = false; block.section = 'endnote'; }
    else if (block.type === 'heading' && block.fontSize > 17) { inReferences = false; inEndnotes = false; }
    else if (inReferences && block.type === 'body') block.type = 'bibliography';
    else if (inEndnotes && block.type === 'body') block.type = 'endnote';
  }
}

export async function openPdf(data, onProgress = () => {}) {
  const task = pdfjs.getDocument({ data, useSystemFonts: true, enableScripting: false, isEvalSupported: false });
  try {
    const pdf = await task.promise;
    const pages = [];
    let usableCharacters = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
    const source = await pdf.getPage(number);
    const viewport = source.getViewport({ scale: 1 });
    const content = await source.getTextContent();
    const runs = textRuns(content, viewport);
    usableCharacters += runs.map(run => run.text.trim().length).reduce((a, b) => a + b, 0);
    const lines = toLines(runs, viewport.width);
    const medianSize = median(lines.map(l => l.fontSize)) || 12;
    const blocks = makeTextBlocks(readingOrder(lines, viewport.width, viewport.height), number, viewport.width, viewport.height, medianSize);
    const operators = await source.getOperatorList();
    for (const [index, bbox] of imageRegions(operators, viewport).entries()) blocks.push({ id: `p${number}-i${index}`, page: number, type: 'image', bbox, text: 'Figure or image from source', confidence: 'PDF image operator' });
    const tables = detectTables(lines, number, medianSize);
    for (const table of tables) {
      blocks.push(table);
      for (const block of blocks.filter(b => b.type === 'body' && b.bbox.y >= table.bbox.y - 2 && b.bbox.y + b.bbox.h <= table.bbox.y + table.bbox.h + 2)) block.type = 'table_source_text';
    }
    const ordered = readingOrder(blocks.map(block => ({ ...block, box: block.bbox })), viewport.width, viewport.height);
    pages.push({ number, width: viewport.width, height: viewport.height, blocks: ordered, source });
    onProgress(number, pdf.numPages);
    }
    postProcess(pages);
    return { pdf, task, pages, usableText: usableCharacters >= Math.max(30, pdf.numPages * 12) };
  } catch (error) {
    await task.destroy();
    throw error;
  }
}

export function speechText(block) {
  return clean(block.text.replace(citationPattern, '')).replace(/\s+([.,;:!?])/g, '$1');
}

export function citationsIn(text) {
  return [...text.matchAll(citationPattern)].map(match => ({ start: match.index, end: match.index + match[0].length, text: match[0] }));
}
