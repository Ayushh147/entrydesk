from pathlib import Path
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_LEFT
from xml.sax.saxutils import escape
import re

target=Path('output/approach.pdf')
styles=getSampleStyleSheet()
title=ParagraphStyle('TitleCustom',fontName='Helvetica-Bold',fontSize=18,leading=22,textColor=HexColor('#234b3d'),spaceAfter=14)
body=ParagraphStyle('BodyCustom',fontName='Helvetica',fontSize=9.6,leading=13.2,textColor=HexColor('#34473d'),spaceAfter=10,alignment=TA_LEFT)
story=[]
for block in Path('output/approach.md').read_text().strip().split('\n\n'):
    if block.startswith('# '):story.append(Paragraph(escape(block[2:]),title))
    else:story.append(Paragraph(re.sub(r'\*\*(.*?)\*\*',r'<b>\1</b>',escape(block)),body))
def footer(canvas,doc):
    canvas.setStrokeColor(HexColor('#d8e2d8'));canvas.line(42,40,570,40)
    canvas.setFont('Helvetica',8);canvas.setFillColor(HexColor('#8b9b8e'));canvas.drawString(42,26,'ENTRYDESK  /  SWE INTERN TAKE-HOME');canvas.drawRightString(570,26,'1 / 1')
SimpleDocTemplate(str(target),pagesize=(612,792),rightMargin=42,leftMargin=42,topMargin=39,bottomMargin=52).build(story,onFirstPage=footer,onLaterPages=footer)
print(target)
