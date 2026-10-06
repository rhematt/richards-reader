"""Create synthetic PDFs for manual Reader checks. Requires reportlab and Pillow.

Usage: python3 scripts/generate-fixtures.py /tmp/reader-fixtures
Generated PDFs are ignored by Git and must not be committed.
"""
from pathlib import Path
import sys
from io import BytesIO

from PIL import Image, ImageDraw
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/reader-fixtures')
OUT.mkdir(parents=True, exist_ok=True)
W, H = A4


def lines(pdf, text, x, y, width=80, leading=16):
    words = text.split()
    buffer = ''
    for word in words:
        trial = f'{buffer} {word}'.strip()
        if pdf.stringWidth(trial, 'Helvetica', 11) > width and buffer:
            pdf.drawString(x, y, buffer)
            y -= leading
            buffer = word
        else:
            buffer = trial
    if buffer:
        pdf.drawString(x, y, buffer)
        y -= leading
    return y


prose = ('This synthetic paragraph describes how a reader can compare a clear reflowed view '
         'with its authoritative PDF page. It contains ordinary punctuation and enough text '
         'to produce several lines of prose for source-coordinate checks. ')

pdf = canvas.Canvas(str(OUT / 'ordinary.pdf'), pagesize=A4)
pdf.setTitle('Synthetic ordinary document')
pdf.setFont('Helvetica-Bold', 22)
pdf.drawString(54, H - 65, 'A Synthetic Reading Sample')
pdf.setFont('Helvetica', 11)
y = H - 105
for _ in range(8):
    y = lines(pdf, prose, 54, y, W - 108)
    y -= 12
pdf.setFont('Helvetica', 9)
pdf.drawString(54, 42, '1')
pdf.save()

pdf = canvas.Canvas(str(OUT / 'academic.pdf'), pagesize=A4)
pdf.setTitle('Synthetic two-column paper')
pdf.setFont('Helvetica-Bold', 18)
pdf.drawString(50, H - 54, 'A Synthetic Two-Column Study')
pdf.setFont('Helvetica', 10)
pdf.drawString(50, H - 75, 'Alex Example and Casey Sample')
left_x, right_x, column_width = 50, W / 2 + 14, W / 2 - 65
pdf.setFont('Helvetica-Bold', 13)
pdf.drawString(left_x, H - 112, 'Introduction')
pdf.setFont('Helvetica', 11)
y = H - 135
for index in range(6):
    text = prose + (' Previous work demonstrates this effect [17, 21, 34].' if index == 1 else '')
    y = lines(pdf, text, left_x, y, column_width)
    y -= 10
pdf.setFont('Helvetica-Bold', 13)
pdf.drawString(right_x, H - 112, 'Results')
pdf.setFont('Helvetica', 11)
y = H - 135
for index in range(5):
    text = prose + (' This is consistent with Example and Sample (2021).' if index == 2 else '')
    y = lines(pdf, text, right_x, y, column_width)
    y -= 10
pdf.setFont('Helvetica', 8)
pdf.drawString(50, 65, '1. This synthetic footnote remains attached to its original page.')
pdf.drawString(50, 42, '2')
pdf.showPage()
pdf.setFont('Helvetica-Bold', 16)
pdf.drawString(50, H - 65, 'References')
pdf.setFont('Helvetica', 11)
pdf.drawString(50, H - 95, 'Example, A. and Sample, C. (2021). A fictional article.')
pdf.drawString(50, H - 116, 'Smith, J. (2020). Another fictional article.')
pdf.setFont('Helvetica', 8)
pdf.drawString(50, 42, '3')
pdf.save()

image = Image.new('RGB', (480, 260), '#e5eee8')
draw = ImageDraw.Draw(image)
draw.line((35, 220, 440, 45), fill='#276f61', width=8)
draw.line((35, 220, 440, 220), fill='#263b34', width=3)
draw.line((35, 220, 35, 30), fill='#263b34', width=3)
draw.text((60, 35), 'SYNTHETIC FIGURE', fill='#1a4a3c')
blob = BytesIO()
image.save(blob, 'PNG')
blob.seek(0)
pdf = canvas.Canvas(str(OUT / 'image-table.pdf'), pagesize=A4)
pdf.setTitle('Synthetic image and table paper')
pdf.setFont('Helvetica-Bold', 19)
pdf.drawString(50, H - 60, 'Image and Table Preservation')
pdf.setFont('Helvetica', 11)
lines(pdf, prose, 50, H - 95, W - 100)
pdf.drawImage(ImageReader(blob), 60, H - 410, width=400, height=217)
pdf.setFont('Helvetica-Bold', 10)
pdf.drawString(60, H - 427, 'Figure 1. Synthetic rising trend, drawn for testing.')
pdf.drawString(50, H - 465, 'Table 1. Synthetic measurements.')
pdf.setFont('Helvetica', 11)
rows = [('Condition', 'Before', 'After'), ('Control', '12', '13'), ('Reader', '12', '19'), ('Difference', '0', '6')]
for i, row in enumerate(rows):
    y = H - 490 - i * 23
    for x, value in zip((55, 240, 390), row):
        pdf.drawString(x, y, value)
    pdf.line(50, y - 7, 520, y - 7)
pdf.save()

pdf = canvas.Canvas(str(OUT / 'irregular-table.pdf'), pagesize=A4)
pdf.setTitle('Synthetic irregular table')
pdf.setFont('Helvetica-Bold', 18)
pdf.drawString(50, H - 60, 'An Uncertain Table')
pdf.setFont('Helvetica-Bold', 10)
pdf.drawString(50, H - 100, 'Table 1. Irregular source cells should remain a source region.')
pdf.setFont('Helvetica', 11)
rows = [('Item', 'Cost', 'Notes'), ('A', '12'), ('B', '15', 'Long note'), ('Total', '27')]
for i, row in enumerate(rows):
    y = H - 135 - i * 25
    for x, value in zip((55, 240, 390), row):
        pdf.drawString(x, y, value)
    pdf.line(50, y - 7, 520, y - 7)
pdf.save()

scan = Image.new('RGB', (900, 1200), 'white')
ImageDraw.Draw(scan).text((90, 120), 'SCANNED SYNTHETIC PAGE - NO TEXT LAYER', fill='black')
blob = BytesIO()
scan.save(blob, 'PNG')
blob.seek(0)
pdf = canvas.Canvas(str(OUT / 'scan.pdf'), pagesize=A4)
pdf.setTitle('Synthetic image-only scan')
pdf.drawImage(ImageReader(blob), 0, 0, width=W, height=H)
pdf.save()

for path in OUT.glob('*.pdf'):
    print(path)
