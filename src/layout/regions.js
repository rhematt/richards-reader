import { containsCenter, union } from './geometry.js';

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};
const clean = text => text.replace(/\s+/g, ' ').trim();
const ids = lines => lines.flatMap(line => line.runs.map(run => run.id));

export function detectSourceRegions({ lines, imageBoxes, page, width, height, medianSize }) {
  const regions = [];
  const claimed = new Set();
  const add = region => {
    region.sourceObjectIds.forEach(id => claimed.add(id));
    regions.push(region);
  };

  // PDF image operators are authoritative geometry. Any embedded text within
  // their bounds (axis labels, graph ticks, panel letters) belongs to them.
  for (const box of imageBoxes) {
    const members = lines.filter(line => containsCenter(box, line.box, 2));
    add({ id: `p${page}-i${regions.length}`, type: 'image', page,
      bbox: box, bounds: box, text: 'Figure or image from source',
      sourceObjectIds: ids(members), confidence: 'PDF image operator' });
  }

  const available = () => lines.filter(line => line.runs.every(run => !claimed.has(run.id)));
  const candidates = available().map(line => ({
    line,
    cells: line.runs.filter(run => run.text.trim()).map(run => ({ text: clean(run.text), x: run.x }))
  })).filter(row => row.cells.length >= 2 && row.cells.length <= 12 &&
    row.line.runs.some((run, index) => index && run.x - (row.line.runs[index - 1].x + row.line.runs[index - 1].w) > medianSize * 1.5));
  let rows = [];
  const finish = () => {
    if (rows.length >= 3) {
      const count = median(rows.map(row => row.cells.length));
      const columns = Array.from({ length: count }, (_, index) => median(rows.map(row => row.cells[index]?.x).filter(Number.isFinite)));
      const regular = rows.every(row => row.cells.length === count && row.cells.every((cell, index) => Math.abs(cell.x - columns[index]) < Math.max(12, medianSize * 1.2)));
      const box = union(rows.map(row => row.line.box));
      add({ id: `p${page}-t${regions.length}`, page, type: 'table', bbox: box, bounds: box,
        text: rows.map(row => row.cells.map(cell => cell.text).join(' | ')).join('\n'),
        rows: regular ? rows.map(row => row.cells.map(cell => cell.text)) : null,
        confidence: regular ? 'aligned text rows' : 'source region only',
        sourceObjectIds: ids(rows.map(row => row.line)) });
    }
    rows = [];
  };
  for (const row of candidates.sort((a, b) => a.line.box.y - b.line.box.y)) {
    if (rows.length && row.line.box.y - (rows.at(-1).line.box.y + rows.at(-1).line.box.h) > medianSize * 1.9) finish();
    rows.push(row);
  }
  finish();

  // A display equation is short, visually isolated and math-heavy. An inline
  // expression in a normal sentence remains in prose.
  const equationLines = available().filter(line =>
    /[=∑∫√≈≤≥]/u.test(line.text) && line.text.length < 100 &&
    line.box.x > width * .12 && line.box.w < width * .76);
  for (const line of equationLines) {
    const number = available().find(other => other !== line &&
      /^\(\d+[a-z]?\)$/.test(other.text) &&
      Math.abs(other.box.y - line.box.y) <= Math.max(line.box.h, other.box.h));
    const members = number ? [line, number] : [line];
    const box = union(members.map(member => member.box));
    add({ id: `p${page}-e${regions.length}`, page, type: 'equation', bbox: box, bounds: box,
      text: number ? `Equation ${number.text.slice(1, -1)}` : 'Equation',
      equationNumber: number?.text.slice(1, -1) || null,
      sourceObjectIds: ids(members), confidence: 'isolated math geometry' });
  }

  for (const line of available()) {
    const isNumber = line.box.y > height * .94 && /^\d{1,4}$/.test(line.text);
    const type = isNumber ? 'page_number' :
      line.box.y < height * .045 && line.fontSize <= medianSize * 1.2 ? 'header' :
      line.box.y > height * .94 && line.fontSize <= medianSize * 1.2 ? 'footer' : null;
    if (!type) continue;
    add({ id: `p${page}-f${regions.length}`, page, type,
      bbox: line.box, bounds: line.box, text: line.text,
      sourceObjectIds: ids([line]), confidence: 'page furniture geometry' });
  }
  return regions;
}
