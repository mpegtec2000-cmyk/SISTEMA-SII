"""Órdenes de Compra (a proveedores) y Cotizaciones comerciales directas, con correlativo y trazabilidad por negocio."""
import io
import json
import os
from datetime import date, timedelta
from typing import Any, Dict, List, Optional
from xml.sax.saxutils import escape

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from app.database import current_company_id, execute_commit, execute_insert, query_all, query_one
from app.models import formatear_rut

router = APIRouter(prefix="/api/commercial-docs", tags=["Facturación: OC y Cotizaciones"])

IVA = 0.19
PREFIX = {"OC": "OC", "COTIZACION": "CD"}


class DocItem(BaseModel):
    sku: Optional[str] = ""
    description: str
    quantity: float = 1
    unit: Optional[str] = "UND"
    unit_price: float = 0
    discount_pct: float = 0


class DocModel(BaseModel):
    doc_type: str                       # OC | COTIZACION
    folder_id: Optional[int] = None
    counterparty_rut: Optional[str] = ""
    counterparty_name: str
    counterparty_address: Optional[str] = ""
    counterparty_email: Optional[str] = ""
    counterparty_contact: Optional[str] = ""
    issue_date: Optional[str] = None
    delivery_date: Optional[str] = None
    validity_days: int = 15
    payment_terms: Optional[str] = "30 días"
    delivery_place: Optional[str] = ""
    notes: Optional[str] = ""
    items: List[DocItem]


def _totals(items: List[DocItem]):
    net = sum(round(i.quantity * i.unit_price * (1 - i.discount_pct / 100)) for i in items)
    tax = round(net * IVA)
    return net, tax, net + tax


def _next_folio(doc_type: str) -> str:
    pref = PREFIX[doc_type]
    year = date.today().year
    row = query_one("SELECT folio FROM commercial_docs WHERE folio LIKE ? ORDER BY id DESC LIMIT 1", (f"{pref}-{year}-%",))
    n = int(row["folio"].rsplit("-", 1)[1]) + 1 if row else 1
    return f"{pref}-{year}-{n:04d}"


def _validate(d: DocModel):
    if d.doc_type not in PREFIX:
        raise HTTPException(status_code=400, detail="Tipo de documento inválido (OC o COTIZACION)")
    if not d.items:
        raise HTTPException(status_code=400, detail="Agregue al menos un ítem")
    if any(i.quantity <= 0 or i.unit_price < 0 for i in d.items):
        raise HTTPException(status_code=400, detail="Cantidades y precios deben ser válidos")


@router.get("")
@router.get("/")
def list_docs(doc_type: str = "", folder_id: Optional[int] = None):
    sql, params = """SELECT d.*, f.code AS folder_code FROM commercial_docs d
                     LEFT JOIN business_folders f ON f.id = d.folder_id WHERE 1=1""", []
    if doc_type:
        sql += " AND d.doc_type = ?"
        params.append(doc_type)
    if folder_id:
        sql += " AND d.folder_id = ?"
        params.append(folder_id)
    return query_all(sql + " ORDER BY d.id DESC", tuple(params))


@router.get("/{doc_id}")
def get_doc(doc_id: int):
    d = query_one("""SELECT d.*, f.code AS folder_code FROM commercial_docs d
                     LEFT JOIN business_folders f ON f.id = d.folder_id WHERE d.id = ?""", (doc_id,))
    if not d:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    d["items"] = json.loads(d.get("items_json") or "[]")
    return d


@router.post("")
@router.post("/")
def create_doc(d: DocModel):
    _validate(d)
    net, tax, total = _totals(d.items)
    folio = _next_folio(d.doc_type)
    today = date.today()
    doc_id = execute_insert("""INSERT INTO commercial_docs (doc_type, folio, folder_id, counterparty_rut, counterparty_name,
        counterparty_address, counterparty_email, counterparty_contact, issue_date, delivery_date, validity_days, payment_terms,
        delivery_place, notes, items_json, net_amount, tax_amount, total_amount, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'EMITIDA')""",
                            (d.doc_type, folio, d.folder_id, formatear_rut(d.counterparty_rut) if d.counterparty_rut else "",
                             d.counterparty_name, d.counterparty_address, d.counterparty_email, d.counterparty_contact,
                             d.issue_date or today.isoformat(), d.delivery_date, d.validity_days, d.payment_terms,
                             d.delivery_place, d.notes, json.dumps([i.model_dump() for i in d.items], ensure_ascii=False),
                             net, tax, total))
    return {"message": f"{'Orden de Compra' if d.doc_type == 'OC' else 'Cotización'} {folio} emitida", "id": doc_id, "folio": folio}


@router.put("/{doc_id}")
def update_doc(doc_id: int, d: DocModel):
    _validate(d)
    cur = query_one("SELECT status FROM commercial_docs WHERE id = ?", (doc_id,))
    if not cur:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    if cur["status"] == "ANULADA":
        raise HTTPException(status_code=400, detail="Un documento anulado no se puede modificar")
    net, tax, total = _totals(d.items)
    execute_commit("""UPDATE commercial_docs SET folder_id=?, counterparty_rut=?, counterparty_name=?, counterparty_address=?,
        counterparty_email=?, counterparty_contact=?, issue_date=?, delivery_date=?, validity_days=?, payment_terms=?,
        delivery_place=?, notes=?, items_json=?, net_amount=?, tax_amount=?, total_amount=? WHERE id=?""",
                   (d.folder_id, formatear_rut(d.counterparty_rut) if d.counterparty_rut else "", d.counterparty_name,
                    d.counterparty_address, d.counterparty_email, d.counterparty_contact, d.issue_date, d.delivery_date,
                    d.validity_days, d.payment_terms, d.delivery_place, d.notes,
                    json.dumps([i.model_dump() for i in d.items], ensure_ascii=False), net, tax, total, doc_id))
    return {"message": "Documento actualizado"}


class StatusModel(BaseModel):
    status: str


@router.put("/{doc_id}/status")
def set_status(doc_id: int, s: StatusModel):
    if s.status not in ("EMITIDA", "ENVIADA", "ACEPTADA", "ANULADA"):
        raise HTTPException(status_code=400, detail="Estado inválido")
    execute_commit("UPDATE commercial_docs SET status = ? WHERE id = ?", (s.status, doc_id))
    return {"message": f"Estado: {s.status}"}


@router.post("/oc-from-selection/{folder_id}")
def oc_from_selection(folder_id: int):
    """Genera una OC por proveedor con las líneas elegidas en el comparador de la carpeta."""
    folder = query_one("SELECT * FROM business_folders WHERE id = ?", (folder_id,))
    if not folder:
        raise HTTPException(status_code=404, detail="Carpeta no encontrada")
    lines = query_all("""SELECT l.*, i.quantity AS item_qty, i.unit AS item_unit, i.product_name
                         FROM supplier_quote_lines l JOIN folder_requested_items i ON i.id = l.requested_item_id
                         WHERE l.folder_id = ? AND l.is_selected = 1""", (folder_id,))
    if not lines:
        raise HTTPException(status_code=400, detail="Primero elija proveedores en el comparador")
    groups: Dict[str, List[Dict[str, Any]]] = {}
    for l in lines:
        groups.setdefault(l["supplier_name"], []).append(l)
    created = []
    for sname, ls in groups.items():
        items = [DocItem(sku=l["sku"] or "", description=l["description"] or l["product_name"], quantity=l["item_qty"] or 1,
                         unit=l["item_unit"] or "UND", unit_price=l["unit_price"]) for l in ls]
        lead = max((l["lead_time_days"] or 0) for l in ls)
        doc = DocModel(doc_type="OC", folder_id=folder_id, counterparty_rut=ls[0]["supplier_rut"] or "", counterparty_name=sname,
                       delivery_date=(date.today() + timedelta(days=lead)).isoformat() if lead else None,
                       notes=f"Compra asociada a la carpeta {folder['code']} — {folder['title']}", items=items)
        created.append(create_doc(doc)["folio"])
    return {"message": f"OC emitidas: {', '.join(created)}", "folios": created}


# ------------------------------------------------------------------ exportación
def _company() -> Dict[str, Any]:
    return (query_one("SELECT * FROM companies WHERE id = ?", (current_company_id(),))
            or query_one("SELECT * FROM companies ORDER BY id LIMIT 1") or {})


def _title(d: Dict[str, Any]) -> str:
    return "ORDEN DE COMPRA" if d["doc_type"] == "OC" else "COTIZACIÓN"


def _clp(n) -> str:
    return "$" + f"{round(n or 0):,}".replace(",", ".")


def _pdf(d: Dict[str, Any]) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    co = _company()
    ss = getSampleStyleSheet()
    n = ParagraphStyle("n", parent=ss["Normal"], fontSize=9, leading=12)
    sm = ParagraphStyle("s", parent=n, fontSize=8, textColor=colors.HexColor("#475569"))
    h = ParagraphStyle("h", parent=ss["Title"], fontSize=18, textColor=colors.HexColor("#1e3a8a"), alignment=2)
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=14 * mm, bottomMargin=14 * mm,
                            title=f"{_title(d)} {d['folio']}")
    from app.services.branding import logo_list
    head = Table([[logo_list() + [Paragraph(f"<b>{escape(co.get('razon_social', ''))}</b>", n),
                    Paragraph(f"RUT {escape(co.get('rut', ''))}<br/>{escape(co.get('giro') or '')}<br/>"
                              f"{escape(co.get('direccion') or '')} {escape(co.get('comuna') or '')}<br/>"
                              f"{escape(co.get('telefono') or '')} · {escape(co.get('email') or '')}", sm)],
                   [Paragraph(_title(d), h), Paragraph(f"N° {d['folio']}", ParagraphStyle("f", parent=n, alignment=2, fontSize=12)),
                    Paragraph(f"Emisión: {d.get('issue_date') or ''}", ParagraphStyle("e", parent=sm, alignment=2))]]],
                 colWidths=[100 * mm, 80 * mm])
    head.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    who = "Proveedor" if d["doc_type"] == "OC" else "Cliente"
    info = Table([[Paragraph(f"<b>{who}:</b> {escape(d['counterparty_name'])}<br/><b>RUT:</b> {escape(d.get('counterparty_rut') or '-')}<br/>"
                             f"<b>Dirección:</b> {escape(d.get('counterparty_address') or '-')}<br/>"
                             f"<b>Contacto:</b> {escape(d.get('counterparty_contact') or '-')} {escape(d.get('counterparty_email') or '')}", n),
                   Paragraph(f"<b>Condición de pago:</b> {escape(d.get('payment_terms') or '-')}<br/>"
                             f"<b>Fecha de entrega:</b> {escape(d.get('delivery_date') or '-')}<br/>"
                             f"<b>Lugar de entrega:</b> {escape(d.get('delivery_place') or '-')}<br/>"
                             + (f"<b>Validez:</b> {d.get('validity_days')} días<br/>" if d["doc_type"] == "COTIZACION" else "")
                             + (f"<b>Negocio:</b> {escape(d.get('folder_code') or '')}" if d.get("folder_code") else ""), n)]],
                 colWidths=[95 * mm, 85 * mm])
    info.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                              ("LEFTPADDING", (0, 0), (-1, -1), 6), ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
    rows = [["#", "Código", "Descripción", "Cant.", "Unid.", "P. Unit.", "Dto.", "Total"]]
    for i, it in enumerate(d["items"], 1):
        tot = round(it["quantity"] * it["unit_price"] * (1 - it.get("discount_pct", 0) / 100))
        rows.append([str(i), Paragraph(escape(it.get("sku") or ""), sm), Paragraph(escape(it["description"]), sm),
                     f"{it['quantity']:g}", it.get("unit") or "UND", _clp(it["unit_price"]),
                     f"{it.get('discount_pct', 0):g}%" if it.get("discount_pct") else "", _clp(tot)])
    t = Table(rows, colWidths=[8 * mm, 24 * mm, 70 * mm, 14 * mm, 14 * mm, 22 * mm, 12 * mm, 24 * mm], repeatRows=1)
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e3a8a")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                           ("FONTSIZE", (0, 0), (-1, -1), 8), ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#cbd5e1")),
                           ("ALIGN", (3, 1), (-1, -1), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    tot = Table([["Neto", _clp(d["net_amount"])], ["IVA 19%", _clp(d["tax_amount"])], ["TOTAL", _clp(d["total_amount"])]],
                colWidths=[30 * mm, 32 * mm], hAlign="RIGHT")
    tot.setStyle(TableStyle([("FONTSIZE", (0, 0), (-1, -1), 9), ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                             ("FONTNAME", (0, 2), (-1, 2), "Helvetica-Bold"), ("LINEABOVE", (0, 2), (-1, 2), 0.8, colors.black)]))
    story = [head, Spacer(1, 6 * mm), info, Spacer(1, 5 * mm), t, Spacer(1, 4 * mm), tot]
    if d.get("notes"):
        story += [Spacer(1, 5 * mm), Paragraph(f"<b>Observaciones:</b> {escape(d['notes'])}", sm)]
    doc.build(story)
    return buf.getvalue()


def _docx(d: Dict[str, Any]) -> bytes:
    from docx import Document
    co = _company()
    doc = Document()
    doc.add_heading(f"{_title(d)} N° {d['folio']}", level=1)
    doc.add_paragraph(f"{co.get('razon_social', '')} · RUT {co.get('rut', '')}\n{co.get('direccion') or ''} · {co.get('telefono') or ''} · {co.get('email') or ''}")
    who = "Proveedor" if d["doc_type"] == "OC" else "Cliente"
    doc.add_paragraph(f"{who}: {d['counterparty_name']}  |  RUT: {d.get('counterparty_rut') or '-'}\n"
                      f"Dirección: {d.get('counterparty_address') or '-'}\nEmisión: {d.get('issue_date') or ''}  |  Entrega: {d.get('delivery_date') or '-'}"
                      f"  |  Pago: {d.get('payment_terms') or '-'}")
    t = doc.add_table(rows=1, cols=6)
    t.style = "Light Grid Accent 1"
    for c, txt in zip(t.rows[0].cells, ["Código", "Descripción", "Cant.", "Unid.", "P. Unit.", "Total"]):
        c.text = txt
    for it in d["items"]:
        r = t.add_row().cells
        r[0].text, r[1].text = it.get("sku") or "", it["description"]
        r[2].text, r[3].text = f"{it['quantity']:g}", it.get("unit") or "UND"
        r[4].text = _clp(it["unit_price"])
        r[5].text = _clp(round(it["quantity"] * it["unit_price"] * (1 - it.get("discount_pct", 0) / 100)))
    doc.add_paragraph(f"\nNeto: {_clp(d['net_amount'])}   IVA 19%: {_clp(d['tax_amount'])}   TOTAL: {_clp(d['total_amount'])}")
    if d.get("notes"):
        doc.add_paragraph(f"Observaciones: {d['notes']}")
    b = io.BytesIO()
    doc.save(b)
    return b.getvalue()


@router.get("/{doc_id}/export")
def export_doc(doc_id: int, fmt: str = "pdf"):
    d = get_doc(doc_id)
    if fmt == "docx":
        return Response(_docx(d), media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                        headers={"Content-Disposition": f'attachment; filename="{d["folio"]}.docx"'})
    return Response(_pdf(d), media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{d["folio"]}.pdf"'})
