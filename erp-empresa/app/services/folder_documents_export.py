"""
Generación de documentos finales de la Carpeta de Negocio:
 - Anexos/declaraciones completados y firmados (PDF + Word)
 - Cotización formal (PDF + Word)
"""
import base64
import io
import json
import os
import re
from datetime import date
from typing import Any, Dict, List, Optional

from app.database import DB_DIR, query_one, query_all, active_company_id

GEN_DIR = os.path.join(DB_DIR, "generated")


def _fmt(n) -> str:
    try:
        return "$" + f"{round(float(n)):,}".replace(",", ".")
    except Exception:
        return "$0"


def _sig_bytes(data_url: Optional[str]) -> Optional[bytes]:
    if not data_url or "," not in data_url:
        return None
    try:
        return base64.b64decode(data_url.split(",", 1)[1])
    except Exception:
        return None


def _safe(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_\-]+", "_", s)[:60]


def _annex_original_text(folder_id: int, title: str) -> str:
    """Rescata del texto de las bases el contenido original del formato (si fue analizado)."""
    code = re.match(r"\s*(2\.\d)", title or "")
    if not code:
        return ""
    for row in query_all("SELECT extracted_text FROM tender_documents WHERE folder_id=? AND extracted_text IS NOT NULL", (folder_id,)):
        txt = (row["extracted_text"] or "").replace("\r", "")
        ms = list(re.finditer(r"(?m)^\s*" + re.escape(code.group(1)) + r"\s+(?:FORMATO|CRITERIO)[^\n]*\n", txt))
        if ms:
            body = txt[ms[-1].end(): ms[-1].end() + 3500]
            nxt = re.search(r"(?m)^\s*2\.\d\s+(?:FORMATO|CRITERIO)", body)
            if nxt:
                body = body[: nxt.start()]
            body = re.sub(r"=====PAGE", "", body)
            return re.sub(r"[ \t]+", " ", body).strip()
    return ""


# ------------------------------------------------------------------ Anexo firmado
def build_annex_context(doc: Dict[str, Any]) -> Dict[str, Any]:
    folder = query_one("SELECT * FROM business_folders WHERE id=?", (doc["folder_id"],)) or {}
    company = query_one("SELECT * FROM companies WHERE id=?", (folder.get("company_id") or active_company_id(),)) or {}
    try:
        form = json.loads(doc.get("form_data_json") or "{}")
    except Exception:
        form = {}
    return {"doc": doc, "folder": folder, "company": company, "form": form,
            "original": _annex_original_text(doc["folder_id"], doc["name"])}


def annex_pdf(doc: Dict[str, Any]) -> str:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image, Table, TableStyle
    from reportlab.lib import colors

    ctx = build_annex_context(doc)
    os.makedirs(GEN_DIR, exist_ok=True)
    path = os.path.join(GEN_DIR, f"anexo_{doc['id']}_{_safe(doc['name'])}.pdf")
    styles = getSampleStyleSheet()
    body = ParagraphStyle("b", parent=styles["BodyText"], fontSize=10, leading=14)
    small = ParagraphStyle("s", parent=body, fontSize=8, leading=11, textColor=colors.HexColor("#444444"))
    el = []
    f, c, form = ctx["folder"], ctx["company"], ctx["form"]
    from app.services.branding import logo_flowable
    _lg = logo_flowable()
    if _lg:
        el.append(_lg)
    el.append(Paragraph(f"<b>{doc['name']}</b>", styles["Title"]))
    el.append(Paragraph(f"Licitación / Negocio: <b>{f.get('tender_id') or f.get('code', '')}</b> — {f.get('title', '')}", body))
    el.append(Paragraph(f"Entidad: {f.get('client_name', '')}", body))
    el.append(Spacer(1, 10))
    rows = [["Razón social oferente", form.get("razon_social") or c.get("razon_social", "")],
            ["RUT oferente", form.get("rut") or c.get("rut", "")],
            ["Representante legal", form.get("rep_legal") or doc.get("signer_name") or ""],
            ["RUT representante", form.get("rut_rep") or doc.get("signer_rut") or ""],
            ["Domicilio", form.get("direccion") or c.get("direccion", "")],
            ["Correo electrónico", form.get("email") or c.get("email", "")],
            ["Teléfono", form.get("telefono") or c.get("telefono", "")],
            ["Giro", form.get("giro") or c.get("giro", "")]]
    for k, v in form.items():
        if k not in ("razon_social", "rut", "rep_legal", "rut_rep", "direccion", "email", "telefono", "giro") and v:
            rows.append([k.replace("_", " ").capitalize(), str(v)])
    t = Table(rows, colWidths=[5.5 * cm, 11 * cm])
    t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.4, colors.grey), ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#EEF2F7")),
                           ("FONTSIZE", (0, 0), (-1, -1), 9), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    el.append(t)
    el.append(Spacer(1, 12))
    el.append(Paragraph(
        f"El firmante, en representación de <b>{form.get('razon_social') or c.get('razon_social', '')}</b>, declara que la información "
        f"consignada es veraz y completa, y que conoce y acepta las bases de licitación {f.get('tender_id') or ''}.", body))
    if ctx["original"]:
        el.append(Spacer(1, 8))
        el.append(Paragraph("<b>Texto del formato original (referencia)</b>", small))
        for para in ctx["original"].split("\n"):
            if para.strip():
                el.append(Paragraph(para.strip().replace("&", "&amp;").replace("<", "&lt;"), small))
    el.append(Spacer(1, 26))
    sig = _sig_bytes(doc.get("signature_data_url"))
    if sig:
        el.append(Image(io.BytesIO(sig), width=6 * cm, height=2.4 * cm, kind="proportional"))
    el.append(Paragraph("______________________________", body))
    prof = query_one("SELECT * FROM signer_profiles ORDER BY is_default DESC, id DESC LIMIT 1") or {}
    rep_name = doc.get('signer_name') or form.get('rep_legal') or prof.get('name') or ''
    rep_rut = doc.get('signer_rut') or form.get('rut_rep') or prof.get('rut') or ''
    comp_name = form.get('razon_social') or c.get('razon_social', '') or prof.get('company_name', '')
    comp_rut = form.get('rut') or c.get('rut', '') or prof.get('company_rut', '')

    stamp = Table([[Paragraph(f"<b>{comp_name}</b><br/>RUT {comp_rut}<br/>Firmado digitalmente · {date.today().strftime('%d-%m-%Y')}", small)]], colWidths=[7 * cm])
    stamp.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#1e3a8a")), ("LEFTPADDING", (0, 0), (-1, -1), 6)]))
    stamp.hAlign = "LEFT"
    if sig:
        el.append(stamp)
    el.append(Paragraph(f"<b>{rep_name}</b>", body))
    el.append(Paragraph(f"RUT {rep_rut} — Representante Legal", body))
    el.append(Paragraph(f"En representación de: <b>{comp_name}</b> (RUT: {comp_rut})", body))
    el.append(Paragraph(f"Fecha de firma digital: {date.today().strftime('%d-%m-%Y')}", body))
    SimpleDocTemplate(path, pagesize=A4, leftMargin=2 * cm, rightMargin=2 * cm, topMargin=2 * cm, bottomMargin=2 * cm).build(el)
    return path


def annex_docx(doc: Dict[str, Any]) -> str:
    import docx
    from docx.shared import Cm, Pt

    ctx = build_annex_context(doc)
    os.makedirs(GEN_DIR, exist_ok=True)
    path = os.path.join(GEN_DIR, f"anexo_{doc['id']}_{_safe(doc['name'])}.docx")
    f, c, form = ctx["folder"], ctx["company"], ctx["form"]
    d = docx.Document()
    d.add_heading(doc["name"], level=1)
    d.add_paragraph(f"Licitación / Negocio: {f.get('tender_id') or f.get('code', '')} — {f.get('title', '')}")
    d.add_paragraph(f"Entidad: {f.get('client_name', '')}")
    rows = [("Razón social oferente", form.get("razon_social") or c.get("razon_social", "")),
            ("RUT oferente", form.get("rut") or c.get("rut", "")),
            ("Representante legal", form.get("rep_legal") or doc.get("signer_name") or ""),
            ("RUT representante", form.get("rut_rep") or doc.get("signer_rut") or ""),
            ("Domicilio", form.get("direccion") or c.get("direccion", "")),
            ("Correo electrónico", form.get("email") or c.get("email", "")),
            ("Teléfono", form.get("telefono") or c.get("telefono", "")),
            ("Giro", form.get("giro") or c.get("giro", ""))]
    tbl = d.add_table(rows=0, cols=2)
    tbl.style = "Table Grid"
    for k, v in rows:
        r = tbl.add_row().cells
        r[0].text, r[1].text = k, str(v)
    d.add_paragraph()
    d.add_paragraph(f"El firmante, en representación de {form.get('razon_social') or c.get('razon_social', '')}, declara que la información "
                    f"consignada es veraz y completa, y que conoce y acepta las bases de licitación {f.get('tender_id') or ''}.")
    if ctx["original"]:
        p = d.add_paragraph()
        r = p.add_run("Texto del formato original (referencia)")
        r.bold = True
        r.font.size = Pt(9)
        for para in ctx["original"].split("\n"):
            if para.strip():
                pp = d.add_paragraph(para.strip())
                for run in pp.runs:
                    run.font.size = Pt(8)
    d.add_paragraph()
    sig = _sig_bytes(doc.get("signature_data_url"))
    if sig:
        d.add_picture(io.BytesIO(sig), width=Cm(5))
    d.add_paragraph("______________________________")
    if sig:
        d.add_paragraph(f"[Timbre digital] {form.get('razon_social') or c.get('razon_social', '')} · RUT {form.get('rut') or c.get('rut', '')} · Firmado digitalmente {date.today().strftime('%d-%m-%Y')}")
    d.add_paragraph(f"{doc.get('signer_name') or form.get('rep_legal') or ''}")
    d.add_paragraph(f"RUT {doc.get('signer_rut') or form.get('rut_rep') or ''} — Representante Legal")
    d.add_paragraph(f"Fecha: {date.today().strftime('%d-%m-%Y')}")
    d.save(path)
    return path


# ------------------------------------------------------------------ Cotización
def _quotation_full(q_id: int) -> Dict[str, Any]:
    q = query_one("""SELECT q.*, c.razon_social AS company_name, c.rut AS company_rut, c.direccion AS company_address,
                            c.email AS company_email, c.telefono AS company_phone, c.giro AS company_giro
                     FROM quotations q JOIN companies c ON q.company_id=c.id WHERE q.id=?""", (q_id,))
    q["items"] = query_all("SELECT * FROM quotation_items WHERE quotation_id=? ORDER BY id", (q_id,))
    return q


def quotation_pdf(q_id: int) -> str:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image, Table, TableStyle
    from reportlab.lib import colors

    q = _quotation_full(q_id)
    os.makedirs(GEN_DIR, exist_ok=True)
    path = os.path.join(GEN_DIR, f"cotizacion_{_safe(q['folio'])}.pdf")
    styles = getSampleStyleSheet()
    body = ParagraphStyle("b", parent=styles["BodyText"], fontSize=9, leading=12)
    cell = ParagraphStyle("c", parent=body, fontSize=8, leading=10)
    el = [Paragraph(f"<b>{q['company_name']}</b>", styles["Title"]),
          Paragraph(f"RUT {q['company_rut']} — {q.get('company_giro') or ''}<br/>{q.get('company_address') or ''}", body),
          Spacer(1, 6), Paragraph(f"<b>COTIZACIÓN {q['folio']}</b> — Fecha {q['date']}", styles["Heading2"]),
          Paragraph(f"Cliente: <b>{q['client_name']}</b> (RUT {q['client_rut']})"
                    + (f" — Licitación {q['tender_id']}" if q.get("tender_id") else ""), body),
          Paragraph(f"Validez: {q['validity_days']} días — Pago: {q['payment_terms']} — Entrega: {q['delivery_time']}", body),
          Spacer(1, 8)]
    from app.services.branding import logo_flowable
    _lg = logo_flowable()
    if _lg:
        el.insert(0, _lg)
    data = [["#", "SKU", "Descripción", "Cant.", "P. Unit.", "Total"]]
    for i, it in enumerate(q["items"], start=1):
        data.append([str(i), it.get("sku") or "", Paragraph((it["description"] or "").replace("&", "&amp;").replace("<", "&lt;")[:600], cell),
                     f"{it['quantity']:g} {it.get('unit') or ''}", _fmt(it["unit_price"]), _fmt(it["subtotal"])])
    t = Table(data, colWidths=[0.8 * cm, 2.3 * cm, 7.2 * cm, 2 * cm, 2.3 * cm, 2.4 * cm], repeatRows=1)
    t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.3, colors.grey), ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E3A5F")),
                           ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("FONTSIZE", (0, 0), (-1, -1), 8),
                           ("ALIGN", (3, 1), (-1, -1), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    el.append(t)
    el.append(Spacer(1, 8))
    tot = Table([["Neto", _fmt(q["net_amount"])], ["IVA 19%", _fmt(q["tax_amount"])], ["TOTAL", _fmt(q["total_amount"])]],
                colWidths=[3 * cm, 3.5 * cm], hAlign="RIGHT")
    tot.setStyle(TableStyle([("FONTSIZE", (0, 0), (-1, -1), 9), ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                             ("FONTNAME", (0, 2), (-1, 2), "Helvetica-Bold"), ("LINEABOVE", (0, 2), (-1, 2), 0.8, colors.black)]))
    el.append(tot)
    if q.get("notes"):
        el.append(Spacer(1, 8))
        el.append(Paragraph("<b>Observaciones:</b> " + q["notes"].replace("&", "&amp;").replace("<", "&lt;"), body))
    sig = _sig_bytes(q.get("signature_data_url"))
    el.append(Spacer(1, 24))
    if sig:
        el.append(Image(io.BytesIO(sig), width=5 * cm, height=2 * cm, kind="proportional"))
    if q.get("signer_name"):
        el.append(Paragraph(f"<b>{q['signer_name']}</b><br/>RUT {q.get('signer_rut') or ''}", body))
    SimpleDocTemplate(path, pagesize=A4, leftMargin=1.6 * cm, rightMargin=1.6 * cm, topMargin=1.6 * cm, bottomMargin=1.6 * cm).build(el)
    return path


def quotation_docx(q_id: int) -> str:
    import docx
    from docx.shared import Cm

    q = _quotation_full(q_id)
    os.makedirs(GEN_DIR, exist_ok=True)
    path = os.path.join(GEN_DIR, f"cotizacion_{_safe(q['folio'])}.docx")
    d = docx.Document()
    d.add_heading(q["company_name"], level=1)
    d.add_paragraph(f"RUT {q['company_rut']} — {q.get('company_giro') or ''}\n{q.get('company_address') or ''}")
    d.add_heading(f"COTIZACIÓN {q['folio']} — {q['date']}", level=2)
    d.add_paragraph(f"Cliente: {q['client_name']} (RUT {q['client_rut']})" + (f" — Licitación {q['tender_id']}" if q.get("tender_id") else ""))
    d.add_paragraph(f"Validez: {q['validity_days']} días — Pago: {q['payment_terms']} — Entrega: {q['delivery_time']}")
    tbl = d.add_table(rows=1, cols=6)
    tbl.style = "Table Grid"
    for i, h in enumerate(["#", "SKU", "Descripción", "Cant.", "P. Unit.", "Total"]):
        tbl.rows[0].cells[i].text = h
    for i, it in enumerate(q["items"], start=1):
        r = tbl.add_row().cells
        r[0].text, r[1].text, r[2].text = str(i), it.get("sku") or "", it["description"] or ""
        r[3].text, r[4].text, r[5].text = f"{it['quantity']:g} {it.get('unit') or ''}", _fmt(it["unit_price"]), _fmt(it["subtotal"])
    d.add_paragraph()
    d.add_paragraph(f"Neto: {_fmt(q['net_amount'])}\nIVA 19%: {_fmt(q['tax_amount'])}\nTOTAL: {_fmt(q['total_amount'])}")
    if q.get("notes"):
        d.add_paragraph("Observaciones: " + q["notes"])
    sig = _sig_bytes(q.get("signature_data_url"))
    if sig:
        d.add_picture(io.BytesIO(sig), width=Cm(5))
    if q.get("signer_name"):
        d.add_paragraph(f"{q['signer_name']}\nRUT {q.get('signer_rut') or ''}")
    d.save(path)
    return path
