const NS = 'http://www.w3.org/2000/svg';
function node(name, attributes = {}) {
  const element = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}
function viewportRect(viewport, rect) {
  const [a, b] = viewport.convertToViewportPoint(rect.x1, rect.y1);
  const [c, d] = viewport.convertToViewportPoint(rect.x2, rect.y2);
  return { x: Math.min(a, c), y: Math.min(b, d), w: Math.abs(c - a), h: Math.abs(d - b) };
}

export function drawAnnotations(svg, page, annotations, zoom, selectedId = null) {
  const viewport = page.source.getViewport({ scale: zoom });
  svg.setAttribute('viewBox', `0 0 ${viewport.width} ${viewport.height}`);
  svg.replaceChildren();
  for (const item of annotations) {
    if (item.page !== page.number) continue;
    const color = item.appearance?.color || '#b91c1c';
    const selected = item.id === selectedId;
    const group = node('g', { 'data-annotation-id': item.id });
    if (item.type === 'ink') {
      for (const path of item.geometry.paths) {
        const d = path.map((point, index) => {
          const [x, y] = viewport.convertToViewportPoint(point.x, point.y);
          return `${index ? 'L' : 'M'}${x} ${y}`;
        }).join(' ');
        group.append(node('path', { d, fill: 'none', stroke: selected ? '#176eb3' : color,
          'stroke-width': (item.appearance?.width || 2) * zoom, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      }
    } else if (['highlight', 'underline', 'strikeout', 'freetext'].includes(item.type)) {
      const box = viewportRect(viewport, item.geometry.rect);
      if (item.type === 'highlight') group.append(node('rect', { ...box, fill: color, opacity: selected ? .65 : .36 }));
      else if (item.type === 'freetext') {
        group.append(node('rect', { ...box, fill: '#fffbea', stroke: selected ? '#176eb3' : color, 'stroke-width': 1.5 }));
        const text = node('text', { x: box.x + 4, y: box.y + 16, fill: '#202820', 'font-size': 13 });
        text.textContent = (item.text || '').slice(0, 60); group.append(text);
      } else {
        const y = item.type === 'underline' ? box.y + box.h - 2 : box.y + box.h / 2;
        group.append(node('line', { x1: box.x, x2: box.x + box.w, y1: y, y2: y,
          stroke: selected ? '#176eb3' : color, 'stroke-width': 2 * zoom }));
      }
    } else if (item.type === 'note') {
      const [x, y] = viewport.convertToViewportPoint(item.geometry.point.x, item.geometry.point.y);
      group.append(node('circle', { cx: x, cy: y, r: 10 * zoom, fill: selected ? '#176eb3' : color }));
      const text = node('text', { x: x - 4 * zoom, y: y + 4 * zoom, fill: 'white', 'font-size': 13 * zoom });
      text.textContent = '✎'; group.append(text);
    }
    svg.append(group);
  }
}
