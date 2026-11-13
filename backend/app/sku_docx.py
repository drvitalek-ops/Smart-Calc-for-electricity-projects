"""Editable SKU list. Only item names, brands, quantities and units enter the document."""
import io
from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT,WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Mm,Pt,RGBColor


def quantity_text(value):
    text=format(value,'f')
    if '.' in text:text=text.rstrip('0').rstrip('.')
    return text.replace('.',',')


def export_sku(quote):
    document=Document()
    section=document.sections[0]
    section.page_width=Mm(210);section.page_height=Mm(297)
    section.top_margin=section.bottom_margin=section.left_margin=section.right_margin=Mm(15)
    style=document.styles['Normal'];style.font.name='Arial';style.font.size=Pt(10)
    style.paragraph_format.space_after=Pt(4)
    document.core_properties.title='SKU — Перечень позиций'
    document.core_properties.author='Smart Home Calc'
    title=document.add_paragraph()
    title.paragraph_format.space_after=Pt(12)
    run=title.add_run('SKU'+(' к КП № '+quote.number if quote.number else ' — Перечень позиций'))
    run.bold=True;run.font.size=Pt(16);run.font.color.rgb=RGBColor.from_string('173D3B')
    table=document.add_table(rows=1,cols=5)
    table.style='Table Grid';table.alignment=WD_TABLE_ALIGNMENT.CENTER;table.autofit=False
    widths=(10,98,32,25,15)
    for column,width in zip(table.columns,widths):column.width=Mm(width)
    for cell,width,label in zip(table.rows[0].cells,widths,('№','Наименование','Бренд','Количество','Ед.')):
        cell.width=Mm(width);cell.text=label
        shading=OxmlElement('w:shd');shading.set(qn('w:fill'),'E8F2EE');cell._tc.get_or_add_tcPr().append(shading)
        for run in cell.paragraphs[0].runs:run.bold=True
    repeat=OxmlElement('w:tblHeader');table.rows[0]._tr.get_or_add_trPr().append(repeat)
    for index,item in enumerate(quote.lines,1):
        row=table.add_row()
        row._tr.get_or_add_trPr().append(OxmlElement('w:cantSplit'))
        for column,(cell,width,text) in enumerate(zip(row.cells,widths,(str(index),item.name,item.manufacturer,quantity_text(item.quantity),item.unit))):
            cell.width=Mm(width);cell.text=text;cell.vertical_alignment=WD_CELL_VERTICAL_ALIGNMENT.CENTER
            if column==3:cell.paragraphs[0].alignment=WD_ALIGN_PARAGRAPH.RIGHT
            elif column in (0,4):cell.paragraphs[0].alignment=WD_ALIGN_PARAGRAPH.CENTER
    output=io.BytesIO();document.save(output)
    return output.getvalue()
