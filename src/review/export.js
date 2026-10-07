import { PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';

function bounds(rect) {
  return [Math.min(rect.x1, rect.x2), Math.min(rect.y1, rect.y2),
    Math.max(rect.x1, rect.x2), Math.max(rect.y1, rect.y2)];
}
function color(hex = '#d62828') {
  const value = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#d62828';
  return [1, 3, 5].map(index => parseInt(value.slice(index, index + 2), 16) / 255);
}
function annotationDictionary(context, item) {
  const common = {
    Type: PDFName.of('Annot'), F: 4,
    NM: PDFHexString.fromText(item.id),
    M: PDFString.of(new Date(item.createdAt || Date.now()).toISOString()),
    Contents: PDFHexString.fromText(item.text || ''),
    C: color(item.appearance?.color),
  };
  if (item.type === 'ink') {
    const points = item.geometry.paths.flat();
    const xs = points.map(point => point.x), ys = points.map(point => point.y);
    const width = Math.max(.5, Number(item.appearance?.width) || 2);
    const x1 = Math.min(...xs) - width, y1 = Math.min(...ys) - width;
    const x2 = Math.max(...xs) + width, y2 = Math.max(...ys) + width;
    const [red, green, blue] = color(item.appearance?.color);
    // PDF viewers do not consistently synthesize an appearance from InkList.
    // Keep the standard Ink annotation and provide its stroked normal appearance.
    const strokes = item.geometry.paths.filter(path => path.length).map(path =>
      `${path[0].x - x1} ${path[0].y - y1} m\n${path.slice(1).map(point =>
        `${point.x - x1} ${point.y - y1} l`).join('\n')}\nS`).join('\n');
    const appearance = context.register(context.stream(
      `q\n${red} ${green} ${blue} RG\n${width} w\n1 J\n1 j\n${strokes}\nQ\n`,
      { Type: PDFName.of('XObject'), Subtype: PDFName.of('Form'), FormType: 1,
        BBox: [0, 0, x2 - x1, y2 - y1], Matrix: [1, 0, 0, 1, 0, 0], Resources: {} }));
    return context.obj({ ...common, Subtype: PDFName.of('Ink'),
      Rect: [x1, y1, x2, y2], AP: { N: appearance },
      InkList: item.geometry.paths.map(path => path.flatMap(point => [point.x, point.y])),
      BS: { Type: PDFName.of('Border'), W: width, S: PDFName.of('S') } });
  }
  if (['highlight', 'underline', 'strikeout'].includes(item.type)) {
    const [x1, y1, x2, y2] = bounds(item.geometry.rect);
    const subtype = { highlight: 'Highlight', underline: 'Underline', strikeout: 'StrikeOut' }[item.type];
    return context.obj({ ...common, Subtype: PDFName.of(subtype), Rect: [x1, y1, x2, y2],
      QuadPoints: [x1, y2, x2, y2, x1, y1, x2, y1], CA: item.type === 'highlight' ? .4 : 1 });
  }
  if (item.type === 'note') {
    const { x, y } = item.geometry.point;
    return context.obj({ ...common, Subtype: PDFName.of('Text'), Name: PDFName.of('Comment'),
      Rect: [x, y, x + 20, y + 20], Open: false });
  }
  if (item.type === 'freetext') {
    return context.obj({ ...common, Subtype: PDFName.of('FreeText'),
      C: [1, 1, .94],
      Rect: bounds(item.geometry.rect), DA: PDFString.of('/Helv 12 Tf 0 0 0 rg'),
      Q: 0 });
  }
  throw new Error(`Unsupported annotation: ${item.type}`);
}

export async function exportMarkedPdf(originalBytes, annotations) {
  // Always load the untouched source. Repeated exports cannot duplicate the
  // current session layer, and pre-existing third-party annotations remain.
  const document = await PDFDocument.load(originalBytes.slice());
  const pages = document.getPages();
  for (const item of annotations) {
    const page = pages[item.page - 1];
    if (!page) throw new Error(`Annotation page ${item.page} is absent`);
    const dictionary = annotationDictionary(document.context, item);
    const reference = document.context.register(dictionary);
    page.node.normalizedEntries().Annots.push(reference);
  }
  return document.save({ useObjectStreams: false });
}
