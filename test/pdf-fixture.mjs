// Tiny public-domain synthetic PDFs for deterministic extraction tests.
// Text is deliberately stored as separate PDF text operations so source
// coordinates and multi-column reading order can be checked.
function escape(text) {
  return text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

export function pdfFixture(lines, { image = false, graphics = '' } = {}) {
  const commands = lines.map(({ x, y, text, size = 12, rotated = false }) =>
    `BT /F1 ${size} Tf ${rotated ? '0 1 -1 0' : '1 0 0 1'} ${x} ${y} Tm (${escape(text)}) Tj ET`
  ).join('\n') + (image ? '\nq 160 0 0 100 60 400 cm /Im1 Do Q' : '') + (graphics ? `\n${graphics}` : '');
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

// V2-STRUCT-001 combines source-owned text, page furniture and prose. The
// raster image occupies PDF coordinates x=60..220, y=400..500; its labels
// must remain inside the figure instead of entering the reading stream.
export const v2CompositePdf = () => pdfFixture([
  { x: 50, y: 782, text: 'SYNTHETIC JOURNAL HEADER', size: 9 },
  { x: 50, y: 748, text: 'Source-Faithful Reading', size: 22 },
  { x: 50, y: 711, text: '1 Introduction', size: 17 },
  { x: 50, y: 677, text: 'The opening paragraph introduces the comparison.' },
  { x: 50, y: 652, text: 'A second paragraph leads into the graphic.' },
  { x: 78, y: 463, text: 'Accuracy', size: 9 },
  { x: 90, y: 435, text: 'Control', size: 9 },
  { x: 153, y: 435, text: '0.6', size: 9 },
  { x: 50, y: 375, text: 'Figure 1. A source graph with internal labels.' },
  { x: 50, y: 338, text: 'The discussion resumes after the figure.' },
  ...[
    ['Condition', 'Before', 'After'],
    ['Control', '12', '13'],
    ['Treatment', '12', '19']
  ].flatMap((row, i) => row.map((text, j) => ({ x: [55, 245, 395][j], y: 297 - i * 23, text }))),
  { x: 50, y: 205, text: 'Table 1. Synthetic measurements.' },
  { x: 50, y: 171, text: 'The next paragraph introduces an equation.' },
  { x: 170, y: 137, text: 'E = m c 2', size: 15 },
  { x: 482, y: 137, text: '(4)', size: 12 },
  { x: 50, y: 103, text: 'The closing paragraph follows the equation.' },
  { x: 298, y: 20, text: '1', size: 9 }
], { image: true });

export const v2MixedBandsPdf = () => pdfFixture([
  { x: 50, y: 752, text: 'Mixed Layout Study', size: 22 },
  ...Array.from({ length: 4 }, (_, i) => ({ x: 50, y: 708 - i * 25, text: `Before left ${i + 1}.` })),
  ...Array.from({ length: 4 }, (_, i) => ({ x: 325, y: 708 - i * 25, text: `Before right ${i + 1}.` })),
  { x: 50, y: 560, text: '2 Results and Interpretation Across Both Columns', size: 17 },
  ...Array.from({ length: 4 }, (_, i) => ({ x: 50, y: 520 - i * 25, text: `After left ${i + 1}.` })),
  ...Array.from({ length: 4 }, (_, i) => ({ x: 325, y: 520 - i * 25, text: `After right ${i + 1}.` }))
]);

export const v2HierarchyPdf = () => pdfFixture([
  { x: 50, y: 782, text: 'Journal of Synthetic Examples', size: 9 },
  { x: 50, y: 747, text: 'A Study of Clear Structure', size: 22 },
  { x: 50, y: 704, text: '1 Methods', size: 17 },
  { x: 50, y: 669, text: 'Methods prose remains body text.' },
  { x: 50, y: 632, text: '1.1 Participants', size: 15 },
  { x: 50, y: 596, text: 'Participant prose remains body text.' },
  { x: 50, y: 559, text: '1.1.1 Eligibility', size: 15 },
  { x: 50, y: 523, text: 'Eligibility prose remains body text.' },
  { x: 50, y: 485, text: '2 Results', size: 17 },
  { x: 50, y: 449, text: 'Results prose remains body text.' },
  { x: 300, y: 20, text: '1', size: 9 }
]);

// Vector graph: no raster-image operator is present. Its labels require a
// layout proposal to establish one authoritative visual source region.
export const v2VectorGraphPdf = () => pdfFixture([
  { x: 50, y: 747, text: 'Vector Graph Study', size: 22 },
  { x: 50, y: 690, text: 'Prose before the graph.' },
  { x: 82, y: 530, text: 'Accuracy', size: 9 },
  { x: 120, y: 455, text: 'Control', size: 9 },
  { x: 205, y: 455, text: 'Treatment', size: 9 },
  { x: 75, y: 420, text: '0.2', size: 9 },
  { x: 75, y: 500, text: '0.6', size: 9 },
  { x: 50, y: 375, text: 'Figure 2. Synthetic vector graph.' },
  { x: 50, y: 330, text: 'Prose after the graph.' }
], { graphics: 'q 0.2 w 80 405 m 80 550 l 285 550 l S 80 420 m 240 525 l S Q' });

export const v2SymbolFreeMatrixPdf = () => pdfFixture([
  { x: 50, y: 747, text: 'Matrix Source Study', size: 25 },
  { x: 50, y: 683, text: 'Prose before the matrix remains readable.' },
  { x: 190, y: 618, text: 'a b c', size: 15 },
  { x: 190, y: 597, text: 'd e f', size: 15 },
  { x: 190, y: 576, text: 'g h i', size: 15 },
  { x: 485, y: 597, text: '(5)' },
  { x: 50, y: 527, text: 'Prose after the matrix resumes correctly.' }
], { graphics: 'q 1 w 177 565 m 177 632 l 181 632 l S 255 565 m 255 632 l 251 632 l S Q' });

export const v2BorderlessTablePdf = () => pdfFixture([
  { x: 50, y: 747, text: 'Borderless Source Table', size: 25 },
  { x: 50, y: 690, text: 'The prose before the table remains separate.' },
  { x: 50, y: 639, text: 'Table 3. Borderless outcomes.' },
  ...[['Group', 'Before', 'After'], ['Control', '12', '13'], ['Treatment', '12', '19']]
    .flatMap((row, i) => row.map((text, j) => ({ x: [55, 245, 395][j], y: 600 - i * 24, text }))),
  { x: 50, y: 492, text: 'The prose after the table continues.' }
]);

export const v2IrregularTablePdf = () => pdfFixture([
  { x: 50, y: 747, text: 'Irregular Source Table', size: 25 },
  { x: 50, y: 690, text: 'Prose introduces uncertain merged cells.' },
  ...[['Group', 'Combined outcome'], ['Control', '12', '13'], ['Treatment', '12', '19']]
    .flatMap((row, i) => row.map((text, j) => ({ x: [55, 245, 395][j], y: 625 - i * 24, text }))),
  { x: 50, y: 505, text: 'Table 4. Merged header cells.' },
  { x: 50, y: 465, text: 'The discussion continues after the source table.' }
]);

export const v2RotatedStampPdf = () => pdfFixture([
  { x: 32, y: 237, text: 'arXiv:0000.00000v1 [cs.CV] 1 Jan 2026', size: 20, rotated: true },
  { x: 52, y: 747, text: 'A Source Geometry Study', size: 25 },
  { x: 52, y: 690, text: '1 Introduction', size: 17 },
  { x: 52, y: 645, text: 'The first paragraph remains ordinary prose.' },
  { x: 52, y: 615, text: 'The second paragraph remains ordinary prose.' }
]);

export const v2WrappedCaptionPdf = () => pdfFixture([
  { x: 50, y: 750, text: 'Wrapped Caption Study', size: 22 },
  { x: 50, y: 680, text: 'A paragraph introduces the figure.', size: 9 },
  { x: 60, y: 375, text: 'Figure 1: An example with dif-', size: 9 },
  { x: 60, y: 357, text: 'ferent source labels.', size: 11 },
  { x: 50, y: 325, text: 'The paragraph after the figure continues.', size: 9 }
], { image: true });

// First-page metadata and a dense small-font figure must not make ordinary
// abstract lines look like headings or turn affiliations into a source table.
export const v2BodyScalePdf = () => pdfFixture([
  { x: 50, y: 750, text: 'A Realistic Paper Title', size: 20 },
  ...[690, 674, 658].flatMap((y, row) => [
    { x: 60, y, text: ['Ada Example', 'Institute One', 'ada@example.org'][row], size: 9 },
    { x: 245, y, text: ['Ben Sample', 'Institute Two', 'ben@example.org'][row], size: 9 },
    { x: 415, y, text: ['Cia Test', 'Institute Three', 'cia@example.org'][row], size: 9 }
  ]),
  { x: 50, y: 610, text: 'ABSTRACT', size: 11 },
  ...Array.from({ length: 8 }, (_, index) => ({ x: 50, y: 587 - index * 12,
    text: `This abstract sentence ${index + 1} remains ordinary academic prose.`, size: 9 })),
  ...Array.from({ length: 22 }, (_, index) => ({ x: 70 + index % 5 * 25, y: 470 - Math.floor(index / 5) * 10,
    text: `t${index}`, size: 4 }))
], { image: true });

export const v2TitleHeadingsPdf = () => pdfFixture([
  { x: 50, y: 750, text: 'A Study of Source-Faithful', size: 20 },
  { x: 120, y: 727, text: 'Academic Reading', size: 20 },
  { x: 50, y: 690, text: 'Ada Example', size: 12 },
  { x: 50, y: 660, text: 'ABSTRACT', size: 11 },
  { x: 50, y: 640, text: 'This sentence is abstract prose.', size: 9 },
  { x: 50, y: 610, text: '2 RELATED WORK', size: 9 },
  { x: 50, y: 585, text: 'This sentence belongs to related work.', size: 9 }
]);

export const v2DenseVectorFigurePdf = () => pdfFixture([
  { x: 50, y: 750, text: 'Dense Vector Figure Study', size: 20 },
  ...Array.from({ length: 6 }, (_, i) => ({ x: 50, y: 680 - i * 23, text: `Left prose ${i + 1} remains readable.` })),
  ...Array.from({ length: 18 }, (_, i) => ({ x: 330 + i % 3 * 75, y: 670 - Math.floor(i / 3) * 28,
    text: `Panel label ${i + 1}`, size: 4 })),
  { x: 335, y: 520, text: 'AIRPORT SKETCH', size: 9 },
  { x: 325, y: 400, text: 'Figure 1. Dense source montage.' },
  { x: 325, y: 365, text: 'Right prose continues after the figure.' }
], { graphics: 'q 0.2 w 325 490 m 560 490 l 560 690 l S Q' });
