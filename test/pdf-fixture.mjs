// Tiny public-domain synthetic PDFs for deterministic extraction tests.
// Text is deliberately stored as separate PDF text operations so source
// coordinates and multi-column reading order can be checked.
function escape(text) {
  return text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

export function pdfFixture(lines, { image = false } = {}) {
  const commands = lines.map(({ x, y, text, size = 12 }) =>
    `BT /F1 ${size} Tf 1 0 0 1 ${x} ${y} Tm (${escape(text)}) Tj ET`
  ).join('\n') + (image ? '\nq 160 0 0 100 60 400 cm /Im1 Do Q' : '');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >>${image ? ' /XObject << /Im1 6 0 R >>' : ''} >> /Contents 5 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(commands)} >>\nstream\n${commands}\nendstream`,
    ...(image ? ['<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 3 >>\nstream\nRGB\nendstream'] : [])
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, 'latin1'));
}

export const ordinaryPdf = () => pdfFixture([
  { x: 52, y: 745, text: 'A Synthetic Reading Sample', size: 22 },
  ...Array.from({ length: 12 }, (_, i) => ({
    x: 52, y: 710 - i * 22,
    text: `Paragraph ${i + 1}: Reader preserves the original source and its accessible text.`
  }))
]);

export const manyItemsPdf = () => pdfFixture(Array.from({ length: 150 }, (_, i) => ({
  x: 50 + Math.floor(i / 30) * 105,
  y: 750 - (i % 30) * 23,
  text: `Item ${i + 1}`
})));

export const twoColumnPdf = () => pdfFixture([
  { x: 50, y: 754, text: 'A Synthetic Two-Column Study', size: 20 },
  ...Array.from({ length: 7 }, (_, i) => ({ x: 50, y: 710 - i * 26, text: `Left column line ${i + 1} has source text.` })),
  ...Array.from({ length: 7 }, (_, i) => ({ x: 325, y: 710 - i * 26, text: `Right column line ${i + 1} has source text.` }))
]);

export const figureAndTablePdf = () => pdfFixture([
  { x: 50, y: 754, text: 'Figure and Table Preservation', size: 20 },
  { x: 60, y: 375, text: 'Figure 1. A synthetic figure with a source image.' },
  { x: 50, y: 335, text: 'Table 1. Synthetic measurements.' },
  ...[
    ['Condition', 'Before', 'After'],
    ['Control', '12', '13'],
    ['Reader', '12', '19'],
    ['Difference', '0', '6']
  ].flatMap((row, i) => row.map((text, j) => ({ x: [55, 240, 390][j], y: 305 - i * 24, text })))
], { image: true });
