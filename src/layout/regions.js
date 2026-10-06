import { containsCenter, overlapFraction, union } from './geometry.js';

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
  // Some academic figures are vector montages of other document pages. Their
  // tiny extractable labels have no image operator, but a nearby caption and
  // dense microtext establish a visual region in one column.
  for (const caption of available().filter(line => /^fig(?:ure)?\.?\s*\d+[.:\s]/i.test(line.text))) {
    const columnLeft = caption.box.x - 24;
    const candidates = available().filter(line => line !== caption &&
      line.box.x + line.box.w / 2 >= columnLeft &&
      line.box.y < caption.box.y - 6 && line.box.y > caption.box.y - height * .48);
    const tiny = candidates.filter(line => line.fontSize < medianSize * .72);
    if (tiny.length < 5) continue;
    const top = Math.max(0, Math.min(...tiny.map(line => line.box.y)) - 6);
    const left = Math.max(0, Math.min(caption.box.x, ...tiny.map(line => line.box.x)) - 8);
    const right = Math.min(width, Math.max(caption.box.x + caption.box.w,
      ...tiny.map(line => line.box.x + line.box.w), caption.box.x + width * .38) + 8);
    const box = { x: left, y: top, w: right - left, h: caption.box.y - top - 5 };
    const members = candidates.filter(line => containsCenter(box, line.box));
    if (members.length < 5) continue;
    add({ id: `p${page}-v${regions.length}`, type: 'image', page, bbox: box, bounds: box,
      text: 'Figure or graph from source', sourceObjectIds: ids(members),
      confidence: 'dense vector figure adjacent to caption' });
  }

  const candidates = available().map(line => ({
    line,
    cells: line.runs.filter(run => run.text.trim()).map(run => ({ text: clean(run.text), x: run.x }))
  })).filter(row => row.cells.length >= 2 && row.cells.length <= 12 &&
    row.line.runs.some((run, index) => index && run.x - (row.line.runs[index - 1].x + row.line.runs[index - 1].w) > medianSize * 1.5));
  let rows = [];
  const finish = () => {
    if (rows.length >= 3) {
      const box = union(rows.map(row => row.line.box));
      // Author names, affiliations and addresses often form three aligned
      // first-page rows. Their position under the title disambiguates them
      // from a data table; retain their exact text in the prose projection.
      const nearbyTableCaption = available().some(line => /^table\s*\d+[.:\s]/i.test(line.text) &&
        Math.abs(line.box.y - box.y) < height * .18);
      if (page === 1 && box.y < height * .24 && !nearbyTableCaption) { rows = []; return; }
      const count = median(rows.map(row => row.cells.length));
      const columns = Array.from({ length: count }, (_, index) => median(rows.map(row => row.cells[index]?.x).filter(Number.isFinite)));
      const regular = rows.every(row => row.cells.length === count && row.cells.every((cell, index) => Math.abs(cell.x - columns[index]) < Math.max(12, medianSize * 1.2)));
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

// A detector proposes boundaries; PDF objects remain the final authority for
// ownership. Its generic classes are translated here, outside the document
// model, so changing model weights does not change Reader's source schema.
export function mergeDetectedRegions(sourceRegions, detections, lines, page) {
  const regions = sourceRegions.map(region => ({ ...region, sourceObjectIds: [...region.sourceObjectIds] }));
  const protectedTypes = new Set(['image', 'table', 'equation', 'header', 'footer', 'page_number']);
  for (const detection of detections) {
    if (!protectedTypes.has(detection.type) || detection.confidence < .75) continue;
    const box = detection.bounds;
    const matching = regions.find(region => region.type === detection.type &&
      (overlapFraction(region.bbox, box) > .5 || overlapFraction(box, region.bbox) > .5));
    const overlapsOther = regions.some(region => region !== matching && protectedTypes.has(region.type) &&
      (overlapFraction(region.bbox, box) > .55 || overlapFraction(box, region.bbox) > .55));
    if (overlapsOther) continue;
    const members = lines.filter(line => containsCenter(box, line.box, 0) &&
      !regions.some(region => region !== matching && region.sourceObjectIds.some(id => line.runs.some(run => run.id === id))));
    if (!matching && !members.length) continue;
    if (!matching && detection.type === 'equation' && !members.some(line => /[=∑∫√≈≤≥()\[\]{}]/u.test(line.text))) {
      const rowHeight = median(members.map(line => line.box.h));
      const alignedMatrix = detection.confidence >= .94 && members.length >= 2 &&
        box.h >= rowHeight * 2.5 && members.every(line => line.text.length <= 35 && line.box.w <= box.w * .9);
      if (!alignedMatrix) continue;
    }
    if (!matching && detection.type === 'table' && members.length < 2 && detection.confidence < .9) continue;
    if (!matching && detection.type === 'image' && box.w < 45 && box.h < 35) continue;
    const equationNumberLine = detection.type === 'equation' ? lines.find(line =>
      !members.includes(line) && /^\(\d+[a-z]?\)$/.test(line.text) &&
      members.some(member => Math.abs(member.box.y - line.box.y) <= Math.max(member.box.h, line.box.h)) &&
      !regions.some(region => region !== matching && region.sourceObjectIds.some(id => line.runs.some(run => run.id === id)))) : null;
    if (equationNumberLine) members.push(equationNumberLine);
    const ids = members.flatMap(line => line.runs.map(run => run.id));
    const regionBox = equationNumberLine ? union([box, equationNumberLine.box]) : box;
    if (matching) {
      matching.sourceObjectIds = [...new Set([...matching.sourceObjectIds, ...ids])];
      matching.bbox = matching.bounds = union([matching.bbox, regionBox]);
      if (equationNumberLine) {
        matching.equationNumber = equationNumberLine.text.slice(1, -1);
        matching.text = `Equation ${matching.equationNumber}`;
      }
      matching.confidence = `${matching.confidence}; ${detection.source || 'local layout model'} ${detection.confidence.toFixed(2)}`;
    } else regions.push({
      id: `p${page}-ml${regions.length}`, page, type: detection.type,
      bbox: regionBox, bounds: regionBox, sourceObjectIds: ids,
      rows: null, equationNumber: equationNumberLine?.text.slice(1, -1) || null,
      text: detection.type === 'equation' ? `Equation${equationNumberLine ? ` ${equationNumberLine.text.slice(1, -1)}` : ''}` :
        detection.type === 'table' ? 'Source table' :
        detection.type === 'image' ? 'Figure or image from source' : members.map(line => line.text).join(' '),
      confidence: `${detection.source || 'local layout model'} ${detection.confidence.toFixed(2)}`
    });
  }
  return regions;
}
