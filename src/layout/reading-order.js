// Read each structural band in column order. A spanning region closes the
// preceding band and starts the next; a page-wide y/x sort cannot do this.
export function orderRegions(blocks, width, height) {
  const byY = [...blocks].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
  const narrow = byY.filter(block => block.bbox.w < width * .54 && block.bbox.y > height * .05 && block.bbox.y < height * .9);
  const left = narrow.filter(block => block.bbox.x + block.bbox.w / 2 < width / 2);
  const right = narrow.filter(block => block.bbox.x + block.bbox.w / 2 >= width / 2);
  if (left.length < 3 || right.length < 3) return byY;
  const spanning = block => block.bbox.x < width * .4 && block.bbox.x + block.bbox.w > width * .6 &&
    (block.bbox.w > width * .6 || ['title', 'heading', 'image', 'table', 'equation'].includes(block.type));
  const barriers = byY.filter(spanning);
  const bands = [];
  let current = [];
  for (const block of byY) {
    if (barriers.includes(block)) {
      if (current.length) bands.push(current);
      bands.push([block]);
      current = [];
    } else current.push(block);
  }
  if (current.length) bands.push(current);
  return bands.flatMap(band => {
    if (band.length === 1) return band;
    const a = band.filter(block => block.bbox.x + block.bbox.w / 2 < width / 2);
    const b = band.filter(block => !a.includes(block));
    if (a.length < 2 || b.length < 2) return band;
    return [...a.sort((x, y) => x.bbox.y - y.bbox.y), ...b.sort((x, y) => x.bbox.y - y.bbox.y)];
  });
}
