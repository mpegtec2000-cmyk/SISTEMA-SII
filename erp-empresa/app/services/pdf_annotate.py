"""
Visor/editor de documentos: convierte cualquier documento de la carpeta a PDF visualizable y
estampa encima las anotaciones del usuario (campos de texto y firmas) para generar el PDF final.
"""
import base64
import io
import os
import re
from typing import Any, Dict, List, Optional


def _esc(s: str) -> str:
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def text_document_to_pdf(path: str, title: str) -> bytes:
    """Representación PDF de Word / Excel / TXT para poder leerlos y firmarlos en pantalla."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import cm
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

    ext = os.path.splitext(path.lower())[1]
    styles = getSampleStyleSheet()
    body = styles["BodyText"]
    story: List[Any] = []
    story.append(Paragraph(f"<b>{_esc(title)}</b>", styles["Title"]))
    story.append(Spacer(1, 8))

    def table(rows):
        rows = [[Paragraph(_esc(str(c or "")), body) for c in r] for r in rows if any((str(c or "").strip() for c in r))]
        if not rows:
            return
        n = max(len(r) for r in rows)
        rows = [r + [""] * (n - len(r)) for r in rows]
        t = Table(rows, colWidths=[(A4[0] - 4 * cm) / n] * n, repeatRows=0)
        t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.4, colors.grey), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
        story.append(t)
        story.append(Spacer(1, 8))

    if ext == ".docx":
        import docx
        d = docx.Document(path)
        # respeta el orden párrafos / tablas
        from docx.table import Table as DTable
        from docx.text.paragraph import Paragraph as DPara
        for child in d.element.body.iterchildren():
            if child.tag.endswith("}p"):
                p = DPara(child, d)
                if p.text.strip():
                    bold = any(r.bold for r in p.runs if r.text.strip())
                    txt = _esc(p.text)
                    story.append(Paragraph(f"<b>{txt}</b>" if bold else txt, body))
                else:
                    story.append(Spacer(1, 6))
            elif child.tag.endswith("}tbl"):
                t = DTable(child, d)
                table([[c.text.strip() for c in row.cells] for row in t.rows])
    elif ext in (".xlsx", ".xlsm", ".xls"):
        import openpyxl
        wb = openpyxl.load_workbook(path, data_only=True)
        for ws in wb.worksheets:
            story.append(Paragraph(f"<b>Hoja: {_esc(ws.title)}</b>", styles["Heading3"]))
            table([[("" if c is None else c) for c in row] for row in ws.iter_rows(values_only=True)])
    else:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            for line in f.read().split("\n"):
                story.append(Paragraph(_esc(line) or "&nbsp;", body))

    buf = io.BytesIO()
    SimpleDocTemplate(buf, pagesize=A4, leftMargin=2 * cm, rightMargin=2 * cm, topMargin=2 * cm, bottomMargin=2 * cm,
                      title=title).build(story)
    return buf.getvalue()


def _image_reader(data_url: str):
    from reportlab.lib.utils import ImageReader
    if not data_url or "," not in data_url:
        return None
    raw = base64.b64decode(data_url.split(",", 1)[1])
    return ImageReader(io.BytesIO(raw))


def apply_annotations(pdf_bytes: bytes, annotations: List[Dict[str, Any]]) -> bytes:
    """Estampa textos e imágenes (firmas). Coordenadas normalizadas 0..1 desde la esquina superior izquierda."""
    from pypdf import PdfReader, PdfWriter
    from reportlab.pdfgen import canvas

    reader = PdfReader(io.BytesIO(pdf_bytes))
    writer = PdfWriter()
    by_page: Dict[int, List[Dict[str, Any]]] = {}
    for a in annotations or []:
        try:
            by_page.setdefault(int(a.get("page", 1)), []).append(a)
        except Exception:
            continue
    for idx, page in enumerate(reader.pages, start=1):
        items = by_page.get(idx)
        if items:
            w = float(page.mediabox.width)
            h = float(page.mediabox.height)
            buf = io.BytesIO()
            c = canvas.Canvas(buf, pagesize=(w, h))
            for a in items:
                x = float(a.get("x", 0)) * w
                ytop = float(a.get("y", 0)) * h
                if a.get("type") == "image":
                    img = _image_reader(a.get("data_url") or "")
                    if img is None:
                        continue
                    iw = float(a.get("w", 0.2)) * w
                    ih = float(a.get("h", 0.08)) * h
                    img_bottom_y = h - ytop - ih
                    c.drawImage(img, x, img_bottom_y, width=iw, height=ih, mask="auto", preserveAspectRatio=True, anchor="sw")

                    footer = a.get("footer") or {}
                    signer_name = (footer.get("name") or a.get("signer_name") or "").strip()
                    signer_rut = (footer.get("rut") or a.get("signer_rut") or "").strip()
                    company_name = (footer.get("company") or a.get("company_name") or "").strip()

                    # Imprimir pie de firma formal obligatorio debajo de la imagen
                    if signer_name or signer_rut or company_name:
                        line_y = img_bottom_y - 2
                        c.setLineWidth(0.6)
                        c.setStrokeColorRGB(0.2, 0.2, 0.2)
                        c.line(x, line_y, x + max(iw, 140), line_y)

                        cur_y = line_y - 9
                        if signer_name:
                            c.setFont("Helvetica-Bold", 8)
                            c.setFillColorRGB(0.05, 0.05, 0.05)
                            c.drawString(x, cur_y, signer_name[:50])
                            cur_y -= 9.5
                        if signer_rut:
                            c.setFont("Helvetica", 7.5)
                            c.setFillColorRGB(0.2, 0.2, 0.2)
                            c.drawString(x, cur_y, f"RUT: {signer_rut}"[:50])
                            cur_y -= 9
                        if company_name:
                            c.setFont("Helvetica-Bold", 7.5)
                            c.setFillColorRGB(0.1, 0.2, 0.4)
                            c.drawString(x, cur_y, company_name[:55])
                else:
                    size = float(a.get("size", 11))
                    c.setFont("Helvetica-Bold" if a.get("bold") else "Helvetica", size)
                    c.setFillColorRGB(0.05, 0.05, 0.35 if a.get("blue", True) else 0.05)
                    for i, line in enumerate(str(a.get("text", "")).split("\n")):
                        c.drawString(x, h - ytop - size * 0.95 - i * size * 1.2, line)
            c.save()
            buf.seek(0)
            overlay = PdfReader(buf).pages[0]
            page.merge_page(overlay)
        writer.add_page(page)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()
