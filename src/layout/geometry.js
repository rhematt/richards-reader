export function union(boxes) {
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map(box => box.x));
  const y = Math.min(...boxes.map(box => box.y));
  return {
    x, y,
    w: Math.max(...boxes.map(box => box.x + box.w)) - x,
    h: Math.max(...boxes.map(box => box.y + box.h)) - y
  };
}

export function containsCenter(outer, inner, padding = 0) {
  const x = inner.x + inner.w / 2;
  const y = inner.y + inner.h / 2;
  return x >= outer.x - padding && x <= outer.x + outer.w + padding &&
    y >= outer.y - padding && y <= outer.y + outer.h + padding;
}

export function overlapFraction(a, b) {
  const width = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return width * height / Math.max(1, a.w * a.h);
}
