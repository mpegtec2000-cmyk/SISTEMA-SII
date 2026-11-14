"""Seguimiento y control comercial de cotizaciones (pipeline): tablero, lista, trazabilidad, alertas y KPIs."""
import io
import os
import re
import secrets
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from app.database import (DB_DIR, active_company_id, execute_commit, execute_insert, get_db_connection, query_all,
                          query_one, tenant_file_prefix)
from app.services import folder_documents_export as exporter
from app.services.inventory_service import reserve_inventory_for_quotation

router = APIRouter(prefix="/api/pipeline", tags=["Seguimiento de Cotizaciones"])

STATUSES = ["BORRADOR", "ENVIADA", "EN_NEGOCIACION", "ACEPTADA", "RECHAZADA", "FACTURADA"]
STATUS_LABEL = {"BORRADOR": "Borrador", "ENVIADA": "Enviada / Publicada", "EN_NEGOCIACION": "En negociación / revisión",
                "ACEPTADA": "Aceptada / Adjudicada", "RECHAZADA": "Rechazada / Perdida", "FACTURADA": "Facturada"}
LOSS_REASONS = ["Precio alto", "Tiempo de entrega", "Competencia", "Licitación desierta", "Incumplimiento técnico / bases",
                "Cliente desistió / sin presupuesto", "Otro"]
OPEN_STATES = ("ENVIADA", "EN_NEGOCIACION")
EXPIRY_ALERT_HOURS = 48

_NEW_COLS = [
    "ALTER TABLE quotations ADD COLUMN owner TEXT",
    "ALTER TABLE quotations ADD COLUMN loss_reason TEXT",
    "ALTER TABLE quotations ADD COLUMN loss_detail TEXT",
    "ALTER TABLE quotations ADD COLUMN follow_up_days INTEGER DEFAULT 5",
    "ALTER TABLE quotations ADD COLUMN due_date TEXT",
    "ALTER TABLE quotations ADD COLUMN sent_at TEXT",
    "ALTER TABLE quotations ADD COLUMN status_changed_at TEXT",
    "ALTER TABLE quotations ADD COLUMN parent_id INTEGER",
    "ALTER TABLE quotations ADD COLUMN share_token TEXT",
    "ALTER TABLE quotations ADD COLUMN sample_status TEXT DEFAULT 'NO_REQUERIDA'",
    "ALTER TABLE quotations ADD COLUMN sample_detail TEXT",
    "ALTER TABLE quotations ADD COLUMN sample_due_date TEXT",
]


def _ensure():
    with get_db_connection() as conn:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(quotations)")}
        for stmt in _NEW_COLS:
            name = stmt.split("ADD COLUMN ")[1].split()[0]
            if name not in cols:
                conn.execute(stmt)
        conn.execute("""CREATE TABLE IF NOT EXISTS quotation_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT, quotation_id INTEGER NOT NULL, kind TEXT DEFAULT 'AUTO',
            message TEXT NOT NULL, created_by TEXT, created_at TEXT DEFAULT (datetime('now','localtime')))""")
        conn.commit()


def _user(request: Request) -> str:
    try:
        from app.routers.auth import current_user
        u = current_user(request)
        return u.get("full_name") or u.get("username") or "Sistema"
    except Exception:
        return "Sistema"


def _log(q_id: int, message: str, kind: str = "AUTO", by: str = "Sistema"):
    execute_commit("INSERT INTO quotation_events (quotation_id, kind, message, created_by) VALUES (?,?,?,?)", (q_id, kind, message, by))


def _d(s: Optional[str]) -> Optional[date]:
    try:
        return datetime.strptime((s or "")[:10], "%Y-%m-%d").date()
    except Exception:
        return None


def _expires(q: Dict[str, Any]) -> Optional[date]:
    if q.get("due_date"):
        return _d(q["due_date"])
    base = _d(q.get("date"))
    return base + timedelta(days=int(q.get("validity_days") or 15)) if base else None


def _last_activity(q: Dict[str, Any]) -> Optional[datetime]:
    cands = [q.get("sent_at"), q.get("status_changed_at"), q.get("last_event")]
    best = None
    for c in cands:
        if not c:
            continue
        try:
            dt = datetime.fromisoformat(str(c).replace("T", " ")[:19])
        except Exception:
            continue
        if best is None or dt > best:
            best = dt
    if best is None:
        d0 = _d(q.get("date"))
        best = datetime.combine(d0, datetime.min.time()) if d0 else None
    return best


def _alerts_for(q: Dict[str, Any], now: Optional[datetime] = None) -> List[Dict[str, str]]:
    now = now or datetime.now()
    out = []
    if q["status"] not in OPEN_STATES:
        return out
    exp = _expires(q)
    if exp:
        hours = (datetime.combine(exp, datetime.max.time()) - now).total_seconds() / 3600
        if hours < 0:
            out.append({"kind": "VENCIDA", "level": "ALTA", "message": f"Oferta vencida hace {abs(int(hours // 24))} día(s)"})
        elif hours <= EXPIRY_ALERT_HOURS:
            out.append({"kind": "POR_VENCER", "level": "ALTA", "message": "Vence en menos de 48 horas: contactar al cliente"})
    last = _last_activity(q)
    x = int(q.get("follow_up_days") or 5)
    if last and (now - last).days >= x:
        out.append({"kind": "SIN_RESPUESTA", "level": "MEDIA", "message": f"{(now - last).days} día(s) sin respuesta (alerta a los {x})"})
    if q.get("sample_status") == "PENDIENTE_ENVIO":
        out.append({"kind": "MUESTRA_PENDIENTE", "level": "ALTA", "message": "Entrega de muestra física pendiente al cliente"})
    return out


_BASE_SQL = """
SELECT q.*, f.code AS folder_code, f.title AS folder_title,
  (SELECT COUNT(*) FROM quotation_items qi WHERE qi.quotation_id = q.id) AS items_count,
  (SELECT COALESCE(SUM(qi.unit_cost * qi.quantity), 0) FROM quotation_items qi WHERE qi.quotation_id = q.id) AS cost_total,
  (SELECT MAX(e.created_at) FROM quotation_events e WHERE e.quotation_id = q.id) AS last_event
FROM quotations q LEFT JOIN business_folders f ON f.id = q.folder_id"""


def _shape(q: Dict[str, Any]) -> Dict[str, Any]:
    net = float(q.get("net_amount") or 0)
    cost = float(q.get("cost_total") or 0)
    exp = _expires(q)
    today = date.today()
    q["expires_at"] = exp.isoformat() if exp else None
    q["days_to_expire"] = (exp - today).days if exp else None
    q["margin_pct"] = round((net - cost) / net * 100, 1) if net > 0 and cost > 0 else None
    q["alerts"] = _alerts_for(q)
    q.pop("signature_data_url", None)
    return q


@router.get("/meta")
def meta():
    return {"statuses": STATUSES, "labels": STATUS_LABEL, "loss_reasons": LOSS_REASONS}


@router.get("/board")
def board(date_from: str = "", date_to: str = "", client: str = "", status: str = "", owner: str = "",
          min_amount: float = 0, max_amount: float = 0, q: str = "", kind: str = ""):
    _ensure()
    sql, params = _BASE_SQL + " WHERE 1=1", []
    if date_from:
        sql += " AND q.date >= ?"; params.append(date_from)
    if date_to:
        sql += " AND q.date <= ?"; params.append(date_to)
    if client:
        sql += " AND (q.client_name LIKE ? OR q.client_rut LIKE ?)"; params += [f"%{client}%"] * 2
    if status:
        sql += " AND q.status = ?"; params.append(status)
    if owner:
        sql += " AND COALESCE(q.owner,'') = ?"; params.append(owner)
    if min_amount:
        sql += " AND q.total_amount >= ?"; params.append(min_amount)
    if max_amount:
        sql += " AND q.total_amount <= ?"; params.append(max_amount)
    if kind:
        sql += " AND q.type = ?"; params.append(kind)
    if q:
        sql += " AND (q.folio LIKE ? OR q.client_name LIKE ? OR f.code LIKE ? OR q.tender_id LIKE ?)"; params += [f"%{q}%"] * 4
    rows = [_shape(r) for r in query_all(sql + " ORDER BY q.date DESC, q.id DESC", tuple(params))]
    return {"items": rows, "kpis": _kpis(), "alerts": _all_alerts(), "meta": meta(),
            "owners": [r["o"] for r in query_all("SELECT DISTINCT owner AS o FROM quotations WHERE owner IS NOT NULL AND owner != ''")],
            "loss_metrics": query_all("""SELECT loss_reason AS reason, COUNT(*) AS n, COALESCE(SUM(total_amount),0) AS amount
                                         FROM quotations WHERE status='RECHAZADA' AND loss_reason IS NOT NULL GROUP BY loss_reason ORDER BY n DESC""")}


def _kpis() -> Dict[str, Any]:
    allq = [_shape(r) for r in query_all(_BASE_SQL)]
    month = date.today().strftime("%Y-%m")
    month_total = sum(float(x["total_amount"] or 0) for x in allq if (x.get("date") or "").startswith(month) and x["status"] != "BORRADOR")
    month_total_all = sum(float(x["total_amount"] or 0) for x in allq if (x.get("date") or "").startswith(month))
    won = sum(1 for x in allq if x["status"] in ("ACEPTADA", "FACTURADA"))
    sent = sum(1 for x in allq if x["status"] != "BORRADOR")
    pipeline = [x for x in allq if x["status"] in OPEN_STATES]
    expiring = [x for x in pipeline if any(a["kind"] in ("POR_VENCER", "VENCIDA") for a in x["alerts"])]
    return {"month_total": month_total, "month_total_incl_drafts": month_total_all,
            "conversion_pct": round(won / sent * 100, 1) if sent else 0, "won": won, "sent": sent,
            "pipeline_amount": sum(float(x["total_amount"] or 0) for x in pipeline), "pipeline_count": len(pipeline),
            "expiring_count": len(expiring), "expiring_amount": sum(float(x["total_amount"] or 0) for x in expiring)}


def _all_alerts() -> List[Dict[str, Any]]:
    out = []
    for r in query_all(_BASE_SQL + " WHERE q.status IN ('ENVIADA','EN_NEGOCIACION')"):
        s = _shape(r)
        for a in s["alerts"]:
            out.append({"quotation_id": s["id"], "folio": s["folio"], "client_name": s["client_name"], **a})
    out.sort(key=lambda a: 0 if a["level"] == "ALTA" else 1)
    return out


def _get(q_id: int) -> Dict[str, Any]:
    _ensure()
    r = query_one(_BASE_SQL + " WHERE q.id = ?", (q_id,))
    if not r:
        raise HTTPException(status_code=404, detail="Cotización no encontrada")
    return r


@router.get("/{q_id}")
def detail(q_id: int):
    q = _shape(_get(q_id))
    q["items"] = query_all("SELECT * FROM quotation_items WHERE quotation_id = ? ORDER BY id", (q_id,))
    q["events"] = query_all("SELECT * FROM quotation_events WHERE quotation_id = ? ORDER BY id DESC", (q_id,))
    base = re.sub(r"-V\d+$", "", q["folio"])
    q["versions"] = query_all("SELECT id, folio, status, total_amount FROM quotations WHERE folio = ? OR folio LIKE ? ORDER BY id",
                              (base, base + "-V%"))
    q["invoices"] = query_all("SELECT id, dte_type, folio, emission_date, total_amount FROM dte_documents WHERE quotation_id = ?", (q_id,))
    return q


class StatusIn(BaseModel):
    status: str
    loss_reason: Optional[str] = None
    loss_detail: Optional[str] = None


@router.put("/{q_id}/status")
def set_status(q_id: int, d: StatusIn, request: Request):
    q = _get(q_id)
    if d.status not in STATUSES:
        raise HTTPException(status_code=400, detail="Estado inválido")
    if d.status == "RECHAZADA" and not (d.loss_reason or "").strip():
        raise HTTPException(status_code=400, detail="Indique el motivo de pérdida")
    if d.status == q["status"]:
        return {"message": "Sin cambios"}
    now = datetime.now().isoformat(sep=" ", timespec="seconds")
    sets, params = ["status=?", "status_changed_at=?"], [d.status, now]
    if d.status == "ENVIADA" and not q.get("sent_at"):
        sets.append("sent_at=?"); params.append(now)
    if d.status == "RECHAZADA":
        sets += ["loss_reason=?", "loss_detail=?"]; params += [d.loss_reason, d.loss_detail or ""]
    elif q["status"] == "RECHAZADA":
        sets += ["loss_reason=NULL", "loss_detail=NULL"]
    execute_commit(f"UPDATE quotations SET {', '.join(sets)} WHERE id=?", tuple(params) + (q_id,))
    if d.status == "ACEPTADA" and q["status"] != "ACEPTADA":
        try:
            reserve_inventory_for_quotation(q_id)
        except Exception:
            pass
    msg = f"Cambio de estado: {STATUS_LABEL.get(q['status'], q['status'])} → {STATUS_LABEL[d.status]}"
    if d.status == "RECHAZADA":
        msg += f" (motivo: {d.loss_reason}" + (f" — {d.loss_detail}" if d.loss_detail else "") + ")"
    _log(q_id, msg, "AUTO", _user(request))
    return {"message": f"Estado: {STATUS_LABEL[d.status]}"}


class SettingsIn(BaseModel):
    due_date: Optional[str] = None
    follow_up_days: Optional[int] = None
    owner: Optional[str] = None
    sample_status: Optional[str] = None
    sample_detail: Optional[str] = None
    sample_due_date: Optional[str] = None


@router.put("/{q_id}/settings")
def settings(q_id: int, d: SettingsIn, request: Request):
    q = _get(q_id)
    if d.due_date and not _d(d.due_date):
        raise HTTPException(status_code=400, detail="Fecha de vencimiento inválida (AAAA-MM-DD)")
    sample_st = d.sample_status if d.sample_status is not None else (q.get("sample_status") or "NO_REQUERIDA")
    sample_det = d.sample_detail if d.sample_detail is not None else (q.get("sample_detail") or "")
    sample_due = d.sample_due_date if d.sample_due_date is not None else (q.get("sample_due_date") or None)
    execute_commit(
        "UPDATE quotations SET due_date=?, follow_up_days=?, owner=?, sample_status=?, sample_detail=?, sample_due_date=? WHERE id=?",
        (d.due_date or None, max(1, d.follow_up_days or 5), (d.owner or "").strip() or None, sample_st, sample_det, sample_due, q_id)
    )
    _log(q_id, f"Seguimiento y muestras actualizados (muestra: {sample_st}, vence: {d.due_date or 'según validez'}, responsable: {d.owner or '—'})", "AUTO", _user(request))
    return {"message": "Seguimiento y muestras guardados"}


class EventIn(BaseModel):
    kind: str = "NOTA"      # NOTA | LLAMADO | CORREO | MUESTRA | WHATSAPP | REUNION
    message: str


@router.post("/{q_id}/events")
def add_event(q_id: int, d: EventIn, request: Request):
    _get(q_id)
    if not d.message.strip():
        raise HTTPException(status_code=400, detail="Escriba la nota o conversación")
    kind = d.kind if d.kind in ("NOTA", "LLAMADO", "CORREO", "MUESTRA", "WHATSAPP", "REUNION") else "NOTA"
    _log(q_id, d.message.strip(), kind, _user(request))
    return {"message": "Actividad registrada en bitácora"}


@router.post("/{q_id}/duplicate")
def duplicate(q_id: int, request: Request):
    q = _get(q_id)
    base = re.sub(r"-V\d+$", "", q["folio"])
    n = 2
    while query_one("SELECT 1 FROM quotations WHERE folio = ?", (f"{base}-V{n}",)):
        n += 1
    folio = f"{base}-V{n}"
    cols = ["folder_id", "company_id", "client_name", "client_rut", "client_address", "client_contact", "client_email",
            "validity_days", "currency", "payment_terms", "delivery_time", "subtotal", "discount_amount", "net_amount",
            "tax_amount", "total_amount", "notes", "type", "tender_id", "warranty_doc", "owner"]
    vals = [q.get(c) for c in cols]
    new_id = execute_insert(
        f"INSERT INTO quotations (folio, date, status, parent_id, {', '.join(cols)}) VALUES (?,?,'BORRADOR',?,{','.join('?' for _ in cols)})",
        tuple([folio, date.today().isoformat(), q_id] + vals))
    for it in query_all("SELECT * FROM quotation_items WHERE quotation_id = ?", (q_id,)):
        execute_insert("""INSERT INTO quotation_items (quotation_id, sku, description, unit, quantity, unit_cost, unit_price,
                          discount_pct, margin_pct, subtotal) VALUES (?,?,?,?,?,?,?,?,?,?)""",
                       (new_id, it["sku"], it["description"], it["unit"], it["quantity"], it["unit_cost"], it["unit_price"],
                        it["discount_pct"], it["margin_pct"], it["subtotal"]))
    _log(new_id, f"Nueva versión creada a partir de {q['folio']}", "AUTO", _user(request))
    _log(q_id, f"Se creó la versión {folio}", "AUTO", _user(request))
    return {"message": f"Cotización {folio} creada como borrador", "id": new_id, "folio": folio}


@router.get("/{q_id}/invoice-candidates")
def invoice_candidates(q_id: int):
    q = _get(q_id)
    return query_all("""SELECT id, dte_type, folio, emission_date, total_amount, razon_social_receptor FROM dte_documents
                        WHERE direction='EMITIDO' AND dte_type IN (33,34) AND rut_receptor = ? AND quotation_id IS NULL
                        ORDER BY emission_date DESC LIMIT 30""", (q["client_rut"],))


class LinkInvoice(BaseModel):
    dte_id: int


@router.post("/{q_id}/link-invoice")
def link_invoice(q_id: int, d: LinkInvoice, request: Request):
    q = _get(q_id)
    dte = query_one("SELECT * FROM dte_documents WHERE id = ?", (d.dte_id,))
    if not dte:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    execute_commit("UPDATE dte_documents SET quotation_id=?, folder_id=COALESCE(folder_id, ?) WHERE id=?", (q_id, q.get("folder_id"), d.dte_id))
    execute_commit("UPDATE quotations SET status='FACTURADA', status_changed_at=? WHERE id=?",
                   (datetime.now().isoformat(sep=" ", timespec="seconds"), q_id))
    _log(q_id, f"Factura N° {dte['folio']} (tipo {dte['dte_type']}) vinculada. Estado → Facturada", "AUTO", _user(request))
    return {"message": f"Factura {dte['folio']} vinculada; cotización facturada"}


@router.post("/{q_id}/mark-sent")
def mark_sent(q_id: int, payload: Dict[str, Any], request: Request):
    q = _get(q_id)
    via = payload.get("via") or "correo"
    now = datetime.now().isoformat(sep=" ", timespec="seconds")
    if q["status"] == "BORRADOR":
        execute_commit("UPDATE quotations SET status='ENVIADA', sent_at=?, status_changed_at=? WHERE id=?", (now, now, q_id))
    elif not q.get("sent_at"):
        execute_commit("UPDATE quotations SET sent_at=? WHERE id=?", (now, q_id))
    _log(q_id, f"Cotización enviada por {via}" + (f" a {payload.get('to')}" if payload.get("to") else ""), "AUTO", _user(request))
    return {"message": "Envío registrado"}


@router.post("/{q_id}/share")
def share(q_id: int, request: Request):
    _get(q_id)
    tok = query_one("SELECT share_token FROM quotations WHERE id=?", (q_id,))["share_token"]
    if not tok:
        tok = secrets.token_urlsafe(18)
        execute_commit("UPDATE quotations SET share_token=? WHERE id=?", (tok, q_id))
    _log(q_id, "Enlace web de la cotización generado", "AUTO", _user(request))
    return {"url": f"/share/quotation/{active_company_id()}/{tok}", "token": tok}


def _xlsx(q_id: int) -> str:
    import openpyxl
    from openpyxl.styles import Font, PatternFill
    q = exporter._quotation_full(q_id)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Cotización"
    ws.append([q["company_name"]]); ws["A1"].font = Font(bold=True, size=14)
    ws.append([f"COTIZACIÓN {q['folio']}", f"Fecha {q['date']}"])
    ws.append([f"Cliente: {q['client_name']}", f"RUT {q['client_rut']}"])
    ws.append([f"Validez {q['validity_days']} días", f"Pago: {q['payment_terms']}", f"Entrega: {q['delivery_time']}"])
    ws.append([])
    head = ["#", "SKU", "Descripción", "Unidad", "Cantidad", "P. Unitario", "Dcto %", "Subtotal"]
    ws.append(head)
    for c in ws[6]:
        c.font = Font(bold=True, color="FFFFFF"); c.fill = PatternFill("solid", fgColor="1E3A5F")
    for i, it in enumerate(q["items"], start=1):
        ws.append([i, it.get("sku"), it["description"], it.get("unit"), it["quantity"], it["unit_price"], it.get("discount_pct") or 0, it["subtotal"]])
    ws.append([]); ws.append(["", "", "", "", "", "", "Neto", q["net_amount"]]); ws.append(["", "", "", "", "", "", "IVA 19%", q["tax_amount"]])
    ws.append(["", "", "", "", "", "", "TOTAL", q["total_amount"]])
    for col, w in zip("ABCDEFGH", (5, 14, 60, 8, 10, 14, 8, 14)):
        ws.column_dimensions[col].width = w
    os.makedirs(exporter.GEN_DIR, exist_ok=True)
    path = os.path.join(exporter.GEN_DIR, f"cotizacion_{exporter._safe(q['folio'])}.xlsx")
    wb.save(path)
    return path


@router.get("/{q_id}/export")
def export(q_id: int, request: Request, fmt: str = "pdf"):
    q = _get(q_id)
    if fmt == "xlsx":
        path = _xlsx(q_id)
    elif fmt == "docx":
        path = exporter.quotation_docx(q_id)
    else:
        path = exporter.quotation_pdf(q_id)
    _log(q_id, {"pdf": "PDF descargado", "xlsx": "Excel exportado", "docx": "Word exportado"}.get(fmt, "Documento descargado"), "AUTO", _user(request))
    return FileResponse(path, filename=os.path.basename(path))


# ---------------------------------------------------------------- enlace público (sin sesión)
public_router = APIRouter(tags=["Enlace público"])


@public_router.get("/share/quotation/{company_id}/{token}")
def public_quotation(company_id: int, token: str):
    from app.database import reset_current_company, set_current_company
    tok = set_current_company(company_id)
    try:
        _ensure()
        q = query_one("SELECT id, folio FROM quotations WHERE share_token = ?", (token,)) if token else None
        if not q:
            raise HTTPException(status_code=404, detail="Enlace no válido")
        path = exporter.quotation_pdf(q["id"])
        _log(q["id"], "El cliente abrió el enlace web de la cotización", "AUTO", "Cliente")
        with open(path, "rb") as f:
            data = f.read()
    finally:
        reset_current_company(tok)
    return Response(content=data, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{q["folio"]}.pdf"'})
