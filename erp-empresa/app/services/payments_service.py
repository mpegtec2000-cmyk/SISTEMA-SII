"""Control de pagos y vencimientos de DTE: conciliación automática (banco) y registro manual de pagos.

Reglas:
- Un DTE tiene saldo = total - paid_amount. Con saldo 0 queda PAGADA (is_reconciled=1) y sus alertas se cierran.
- Con abono parcial queda PARCIAL (is_reconciled=0): sigue vigente y sus alertas se calculan sobre el saldo.
- Cada pago (manual o bancario) se registra en dte_payments con fecha, medio y referencia/comprobante.
"""
import datetime
from typing import Any, Dict, List, Optional

from app.database import query_all, query_one, execute_commit, execute_insert

METHODS = {
    "EFECTIVO": "Efectivo / Caja chica",
    "CONTADO": "Al contado",
    "CHEQUE": "Cheque (al día o a fecha)",
    "TRANSFERENCIA_EXTERNA": "Transferencia bancaria / Al contado",
    "CREDITO_DIRECTO": "Crédito directo proveedor/cliente",
    "TARJETA_COMERCIAL": "Tarjeta de crédito empresarial",
    "COMPENSACION_NC": "Compensación / Nota de crédito",
    "TRANSFERENCIA_BANCO": "Transferencia (cuenta enlazada)",
}
ALERT_DAYS = (10, 5, 2)


def saldo_of(dte: Dict[str, Any]) -> float:
    return max(0.0, round(float(dte.get("total_amount") or 0) - float(dte.get("paid_amount") or 0), 2))


def due_date_of(dte: Dict[str, Any]) -> datetime.date:
    try:
        if dte.get("expiration_date"):
            return datetime.date.fromisoformat(str(dte["expiration_date"])[:10])
        return datetime.date.fromisoformat(str(dte["emission_date"])[:10]) + datetime.timedelta(days=30)
    except Exception:
        return datetime.date.today()


def _recompute(dte_id: int) -> Dict[str, Any]:
    dte = query_one("SELECT * FROM dte_documents WHERE id = ?", (dte_id,))
    row = query_one("SELECT COALESCE(SUM(amount),0) s, MAX(paid_date) d FROM dte_payments WHERE dte_id = ?", (dte_id,))
    paid = round(float(row["s"] or 0), 2)
    total = float(dte["total_amount"] or 0)
    last = query_one("SELECT method, transfer_ref FROM dte_payments WHERE dte_id = ? ORDER BY id DESC LIMIT 1", (dte_id,)) or {}
    if paid <= 0:
        status, rec = "PENDIENTE", 0
    elif paid + 0.5 >= total:
        status, rec = "PAGADA", 1
    else:
        status, rec = "PARCIAL", 0
    execute_commit(
        "UPDATE dte_documents SET paid_amount=?, payment_status=?, is_reconciled=?, paid_date=?, payment_method=?, payment_ref=? WHERE id=?",
        (paid, status, rec, row["d"] if paid > 0 else None, last.get("method"), last.get("transfer_ref"), dte_id))
    return query_one("SELECT * FROM dte_documents WHERE id = ?", (dte_id,))


def register_payment(dte_id: int, amount: float, paid_date: str, method: str, source: str = "MANUAL",
                     bank_transaction_id: Optional[int] = None, transfer_ref: Optional[str] = None,
                     receipt_path: Optional[str] = None, receipt_name: Optional[str] = None,
                     notes: Optional[str] = None, created_by: Optional[str] = None) -> Dict[str, Any]:
    dte = query_one("SELECT * FROM dte_documents WHERE id = ?", (dte_id,))
    if not dte:
        raise ValueError("Documento no encontrado")
    if method not in METHODS:
        raise ValueError("Medio de pago no válido")
    try:
        amount = round(float(amount), 2)
    except Exception:
        raise ValueError("Monto no válido")
    if amount <= 0:
        raise ValueError("El monto pagado debe ser mayor que 0")
    saldo = saldo_of(dte)
    if saldo <= 0:
        raise ValueError("El documento ya está pagado en su totalidad")
    if amount > saldo + 0.5:
        raise ValueError(f"El monto excede el saldo pendiente (${int(saldo):,}".replace(",", ".") + ")")
    try:
        datetime.date.fromisoformat(str(paid_date)[:10])
    except Exception:
        raise ValueError("Fecha de pago no válida (use AAAA-MM-DD)")
    pid = execute_insert(
        """INSERT INTO dte_payments (dte_id, amount, paid_date, method, source, bank_transaction_id, transfer_ref,
           receipt_path, receipt_name, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        (dte_id, amount, str(paid_date)[:10], method, source, bank_transaction_id, transfer_ref,
         receipt_path, receipt_name, notes, created_by))
    updated = _recompute(dte_id)
    return {"payment_id": pid, "dte": updated, "saldo": saldo_of(updated)}


def delete_payment(payment_id: int) -> Optional[Dict[str, Any]]:
    p = query_one("SELECT * FROM dte_payments WHERE id = ?", (payment_id,))
    if not p:
        return None
    execute_commit("DELETE FROM dte_payments WHERE id = ?", (payment_id,))
    if p.get("bank_transaction_id"):
        execute_commit("UPDATE bank_transactions SET is_reconciled=0, reconciled_dte_id=NULL WHERE id=?", (p["bank_transaction_id"],))
    return _recompute(p["dte_id"])


def apply_bank_payment(tx: Dict[str, Any], dte_id: int) -> Optional[Dict[str, Any]]:
    """Conciliación automática: un cargo/abono bancario paga (total o parcialmente) un DTE."""
    exists = query_one("SELECT id FROM dte_payments WHERE bank_transaction_id = ? AND dte_id = ?", (tx["id"], dte_id))
    if exists:
        return None
    dte = query_one("SELECT * FROM dte_documents WHERE id = ?", (dte_id,))
    saldo = saldo_of(dte)
    if saldo <= 0:
        return None
    amount = min(abs(float(tx["amount"])), saldo)
    ref = tx.get("external_id") or f"mov-{tx['id']}"
    desc = (tx.get("description") or "")[:120]
    return register_payment(dte_id, amount, str(tx["transaction_date"])[:10], "TRANSFERENCIA_BANCO", source="BANCO",
                            bank_transaction_id=tx["id"], transfer_ref=ref,
                            notes=f"Conciliación automática con movimiento bancario: {desc}", created_by="Banco")


def payment_alert(dte: Dict[str, Any], today: Optional[datetime.date] = None) -> Optional[Dict[str, Any]]:
    """Alerta de vencimiento (10/5/2 días y vencidas). None si el documento está pagado."""
    today = today or datetime.date.today()
    if (dte.get("payment_status") == "PAGADA") or saldo_of(dte) <= 0:
        return None
    days = (due_date_of(dte) - today).days
    if days < 0:
        return {"level": "VENCIDA", "days": days, "label": f"Vencida hace {-days} día(s)"}
    for d, lv in ((2, "CRITICA"), (5, "ALTA"), (10, "MEDIA")):
        if days <= d:
            return {"level": lv, "days": days, "label": "Vence hoy" if days == 0 else f"Vence en {days} día(s)"}
    return None


def overview(month: Optional[str] = None) -> Dict[str, Any]:
    query = "SELECT * FROM dte_documents WHERE COALESCE(payment_status,'PENDIENTE') != 'PAGADA'"
    params = []
    if month:
        partes = month.split("-")
        alt = f"%/{partes[1]}/{partes[0]}%" if len(partes) == 2 else f"{month}%"
        query += " AND (emission_date LIKE ? OR emission_date LIKE ? OR expiration_date LIKE ? OR expiration_date LIKE ?)"
        params = [f"{month}%", alt, f"{month}%", alt]
    query += " ORDER BY emission_date"
    docs = query_all(query, tuple(params) if params else ())
    items: List[Dict[str, Any]] = []
    tot = {"cxc": 0.0, "cxp": 0.0}
    for d in docs:
        saldo = saldo_of(d)
        if saldo <= 0:
            continue
        tot["cxc" if d["direction"] == "EMITIDO" else "cxp"] += saldo
        al = payment_alert(d)
        items.append({
            "id": d["id"], "direction": d["direction"], "dte_type": d["dte_type"], "folio": d["folio"],
            "counterparty": d["razon_social_receptor"] if d["direction"] == "EMITIDO" else d["razon_social_emisor"],
            "rut": d["rut_receptor"] if d["direction"] == "EMITIDO" else d["rut_emisor"],
            "total": d["total_amount"], "paid": d.get("paid_amount") or 0, "saldo": saldo,
            "due_date": due_date_of(d).isoformat(), "payment_status": d.get("payment_status") or "PENDIENTE",
            "alert": al,
        })
    order = {"VENCIDA": 0, "CRITICA": 1, "ALTA": 2, "MEDIA": 3}
    items.sort(key=lambda x: (order.get((x["alert"] or {}).get("level"), 9), x["due_date"]))
    return {"items": items, "alerts": [i for i in items if i["alert"]],
            "pendiente_cobrar": round(tot["cxc"]), "pendiente_pagar": round(tot["cxp"])}
