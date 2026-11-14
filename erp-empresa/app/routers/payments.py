"""API de pagos y vencimientos: pago manual con comprobante, historial, deshacer y panel de alertas."""
import os
import re
import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.database import query_all, query_one, tenant_file_prefix
from app.services import payments_service as ps

router = APIRouter(prefix="/api/payments", tags=["Pagos y vencimientos"])

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RECEIPT_DIR = os.path.join(BASE, "data", "uploads", "payment_receipts")
ALLOWED = {".pdf", ".png", ".jpg", ".jpeg", ".webp"}
MAX_BYTES = 10 * 1024 * 1024


def _user(request: Request) -> str:
    try:
        from app.routers.auth import current_user
        u = current_user(request)
        return u.get("full_name") or u.get("username") or "Usuario"
    except Exception:
        return "Usuario"


@router.get("/methods")
def methods():
    return {k: v for k, v in ps.METHODS.items() if k != "TRANSFERENCIA_BANCO"}


@router.get("/overview")
def overview(month: Optional[str] = None, year: Optional[int] = None):
    if year and month and len(str(month)) <= 2:
        month = f"{year:04d}-{int(month):02d}"
    return ps.overview(month=month)


@router.get("/dte/{dte_id}")
def dte_payments(dte_id: int):
    d = query_one("SELECT * FROM dte_documents WHERE id = ?", (dte_id,))
    if not d:
        raise HTTPException(404, "Documento no encontrado")
    rows = query_all("SELECT * FROM dte_payments WHERE dte_id = ? ORDER BY paid_date, id", (dte_id,))
    for r in rows:
        r["has_receipt"] = bool(r.get("receipt_path"))
        r.pop("receipt_path", None)
        r["method_label"] = ps.METHODS.get(r["method"], r["method"])
    return {"dte": d, "saldo": ps.saldo_of(d), "payments": rows}


@router.post("/dte/{dte_id}")
async def pay_manual(dte_id: int, request: Request,
                     amount: float = Form(...), paid_date: str = Form(...), method: str = Form(...),
                     notes: Optional[str] = Form(None), file: Optional[UploadFile] = File(None)):
    if method == "TRANSFERENCIA_BANCO":
        raise HTTPException(400, "Medio de pago no válido para registro manual")
    path = name = None
    if file is not None and file.filename:
        ext = os.path.splitext(file.filename)[1].lower()
        if ext not in ALLOWED:
            raise HTTPException(400, "El comprobante debe ser imagen (PNG/JPG/WEBP) o PDF")
        data = await file.read()
        if len(data) > MAX_BYTES:
            raise HTTPException(400, "El comprobante supera 10 MB")
        os.makedirs(RECEIPT_DIR, exist_ok=True)
        safe = re.sub(r"[^A-Za-z0-9_.-]", "_", os.path.splitext(file.filename)[0])[:40]
        fname = f"{tenant_file_prefix()}pay{dte_id}_{datetime.datetime.now():%Y%m%d%H%M%S}_{safe}{ext}"
        path = os.path.join(RECEIPT_DIR, fname)
        with open(path, "wb") as f:
            f.write(data)
        name = file.filename
    try:
        res = ps.register_payment(dte_id, amount, paid_date, method, source="MANUAL", receipt_path=path,
                                  receipt_name=name, notes=(notes or None), created_by=_user(request))
    except ValueError as e:
        if path and os.path.exists(path):
            os.remove(path)
        raise HTTPException(400, str(e))
    d = res["dte"]
    return {"message": "Pago registrado: documento " + ("PAGADO" if d["payment_status"] == "PAGADA" else "con PAGO PARCIAL"),
            "payment_status": d["payment_status"], "paid_amount": d["paid_amount"], "saldo": res["saldo"],
            "payment_id": res["payment_id"]}


@router.get("/receipt/{payment_id}")
def receipt(payment_id: int):
    p = query_one("SELECT receipt_path, receipt_name FROM dte_payments WHERE id = ?", (payment_id,))
    if not p or not p.get("receipt_path") or not os.path.exists(p["receipt_path"]):
        raise HTTPException(404, "Sin comprobante")
    return FileResponse(p["receipt_path"], filename=p.get("receipt_name") or os.path.basename(p["receipt_path"]))


@router.delete("/{payment_id}")
def undo(payment_id: int):
    d = ps.delete_payment(payment_id)
    if d is None:
        raise HTTPException(404, "Pago no encontrado")
    return {"message": "Pago anulado", "payment_status": d["payment_status"], "saldo": ps.saldo_of(d)}


class FactoringSimulateModel(BaseModel):
    amount: float
    days: int = 45
    monthly_rate_pct: float = 1.8
    retention_pct: float = 10.0
    commission_pct: float = 0.5


@router.post("/factoring-simulate")
def simulate_factoring(data: FactoringSimulateModel):
    amt = float(data.amount)
    if amt <= 0:
        raise HTTPException(status_code=400, detail="El monto de la factura debe ser mayor a 0")
    days = max(1, int(data.days))
    rate_monthly = float(data.monthly_rate_pct) / 100.0
    interest = amt * rate_monthly * (days / 30.0)
    commission = amt * (float(data.commission_pct) / 100.0)
    retention = amt * (float(data.retention_pct) / 100.0)
    liquid = max(0, amt - interest - commission - retention)
    annual_eff = ((1 + rate_monthly) ** 12 - 1) * 100.0

    return {
        "invoice_amount": round(amt),
        "days": days,
        "monthly_rate_pct": data.monthly_rate_pct,
        "retention_pct": data.retention_pct,
        "commission_pct": data.commission_pct,
        "interest_cost": round(interest),
        "commission_cost": round(commission),
        "total_financial_cost": round(interest + commission),
        "retention_amount": round(retention),
        "liquid_amount": round(liquid),
        "annual_effective_rate_pct": round(annual_eff, 1)
    }

