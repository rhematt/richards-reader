// Navigation derives from classified heading blocks; it never guesses a
// second hierarchy from rendered styles or PDF coordinates.
export function buildOutline(pages) {
  const roots = [];
  const stack = [];
  for (const block of pages.flatMap(page => page.blocks)) {
    if (block.type !== 'heading') continue;
    const requested = Math.max(1, Math.min(6, Number(block.level) || 1));
    const level = Math.min(requested, (stack.at(-1)?.level || 0) + 1);
    while (stack.length && stack.at(-1).level >= level) stack.pop();
    const node = { id: block.id, text: block.text, page: block.page,
      bbox: block.bbox, level, children: [] };
    if (stack.length) stack.at(-1).children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}

export function flattenOutline(nodes) {
  return nodes.flatMap(node => [node, ...flattenOutline(node.children)]);
}
