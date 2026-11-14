import datetime
from fastapi import APIRouter, HTTPException, Query, UploadFile, File
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from app.database import query_all, query_one, execute_insert, execute_commit
from app.models import BankTransactionModel, ReconciliationRequestModel
from app.services.reconciliation_service import (
    find_reconciliation_matches,
    reconcile_transaction,
    get_aging_dashboard,
    get_counterparty_ledger
)

router = APIRouter(prefix="/api/banking", tags=["Bancos & Conciliación"])


def _ensure_debts_table():
    execute_commit("""
        CREATE TABLE IF NOT EXISTS financial_debts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_name TEXT NOT NULL,
            debt_type TEXT NOT NULL DEFAULT 'TARJETA_CREDITO',
            description TEXT DEFAULT '',
            total_limit REAL DEFAULT 0.0,
            used_amount REAL DEFAULT 0.0,
            monthly_installment REAL DEFAULT 0.0,
            due_day INTEGER DEFAULT 5,
            next_due_date TEXT DEFAULT '',
            interest_rate_pct REAL DEFAULT 1.8,
            status TEXT DEFAULT 'AL_DIA',
            notes TEXT DEFAULT '',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)

class BankAccountCreate(BaseModel):
    bank_name: str
    account_number: str
    account_type: str = "Cuenta Corriente"
    currency: str = "CLP"
    balance: float = 0.0

@router.get("/accounts")
def get_accounts():
    return query_all("SELECT * FROM bank_accounts ORDER BY id ASC")

@router.post("/accounts")
def create_account(data: BankAccountCreate):
    from app.database import active_company_id
    cid = active_company_id() or 1
    acc_id = execute_insert(
        """INSERT INTO bank_accounts (bank_name, account_number, account_type, company_id, currency, balance, provider)
           VALUES (?, ?, ?, ?, ?, ?, 'MANUAL')""",
        (data.bank_name, data.account_number, data.account_type, cid, data.currency, data.balance)
    )
    return {"message": "Cuenta bancaria creada exitosamente", "id": acc_id}

@router.delete("/accounts/{account_id}")
def delete_account(account_id: int):
    execute_commit("DELETE FROM bank_transactions WHERE account_id = ?", (account_id,))
    execute_commit("DELETE FROM bank_accounts WHERE id = ?", (account_id,))
    return {"message": "Cuenta bancaria eliminada"}

@router.get("/transactions")
def get_transactions(account_id: Optional[int] = None, unreconciled_only: bool = False):
    query = """
        SELECT t.*, a.bank_name, a.account_number,
               d.folio as dte_folio, d.dte_type, d.direction as dte_direction,
               f.code as folder_code, f.title as folder_title
        FROM bank_transactions t
        JOIN bank_accounts a ON t.account_id = a.id
        LEFT JOIN dte_documents d ON t.reconciled_dte_id = d.id
        LEFT JOIN business_folders f ON t.folder_id = f.id
        WHERE 1=1
    """
    params = []
    if account_id:
        query += " AND t.account_id = ?"
        params.append(account_id)
    if unreconciled_only:
        query += " AND t.is_reconciled = 0"
    query += " ORDER BY t.transaction_date DESC, t.id DESC"
    return query_all(query, tuple(params))

@router.get("/reconciliation-suggestions")
def get_suggestions():
    """
    Ejecuta el motor de conciliación inteligente cruzando cartolas y facturas.
    """
    return find_reconciliation_matches()

@router.post("/reconcile")
def apply_reconciliation(data: ReconciliationRequestModel):
    """
    Aplica la conciliación de un movimiento bancario con un DTE en 1 clic.
    """
    ok = reconcile_transaction(data.transaction_id, data.dte_id, data.folder_id)
    if not ok:
        raise HTTPException(status_code=400, detail="No se pudo conciliar el movimiento")
    return {"message": "Movimiento y factura conciliados con éxito"}

@router.post("/transactions")
def create_transaction(data: BankTransactionModel):
    tx_id = execute_insert("""
        INSERT INTO bank_transactions (
            account_id, transaction_date, description, amount, transaction_type, balance, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (
        data.account_id, data.transaction_date, data.description,
        data.amount, data.transaction_type, data.balance, data.notes
    ))
    return {"message": "Movimiento bancario registrado", "id": tx_id}

@router.get("/aging-dashboard")
def get_aging(month: Optional[str] = None, year: Optional[int] = None):
    """
    Dashboard de vencimientos para Cuentas por Cobrar (CxC) y por Pagar (CxP).
    Soporta filtro por mes ('YYYY-MM') o año + mes.
    """
    if year and month and len(str(month)) <= 2:
        month = f"{year:04d}-{int(month):02d}"
    return get_aging_dashboard(month=month)

@router.get("/ledger/{rut}")
def get_ledger(rut: str):
    """
    Ficha consolidada de cuenta corriente por Cliente o Proveedor.
    """
    return get_counterparty_ledger(rut)


class FinancialDebtModel(BaseModel):
    entity_name: str
    debt_type: str = "TARJETA_CREDITO"  # TARJETA_CREDITO, CREDITO_COMERCIAL, AVANCE, LINEA_CREDITO, LEASING
    description: Optional[str] = ""
    total_limit: float = 0.0
    used_amount: float = 0.0
    monthly_installment: float = 0.0
    due_day: int = 5
    next_due_date: Optional[str] = ""
    interest_rate_pct: float = 1.8
    status: str = "AL_DIA"
    notes: Optional[str] = ""


def _classify_movement(desc: str, tx_type: str) -> Dict[str, str]:
    d = (desc or "").upper()
    if tx_type == "ABONO":
        if any(k in d for k in ("TESORERIA", "MERCADO PUBLICO", "HOSPITAL", "MUNICIPALIDAD", "SERVICIO")):
            return {"code": "INGRESOS_ESTADO", "label": "Cobranza Mercado Público / Estado"}
        return {"code": "INGRESOS_VENTAS", "label": "Abonos y Pago Facturas Clientes"}
    if any(k in d for k in ("SII", "F29", "TESORERIA", "IMPUESTO", "PATENTE")):
        return {"code": "IMPUESTOS_F29", "label": "Impuestos SII / F29 / Tesorería"}
    if any(k in d for k in ("SUELDO", "REMUNERACION", "PREVIRED", "AFC", "HONORARIO", "NOMINA")):
        return {"code": "REMUNERACIONES_LEYES", "label": "Remuneraciones, Previred y Honorarios"}
    if any(k in d for k in ("CREDITO", "TARJETA", "CUOTA", "INTERES", "COMISION", "AVANCE", "LEASING", "BANCO")):
        return {"code": "DEUDA_FINANCIERA", "label": "Cuotas Créditos, Tarjetas y Gastos Bancarios"}
    if any(k in d for k in ("ARRIENDO", "LUZ", "AGUA", "INTERNET", "ENTEL", "WOM", "MOVISTAR", "FLETE", "TRANSPORTE", "BENCINA", "COPEC")):
        return {"code": "OPERACION_FIJA", "label": "Gastos Operativos, Servicios y Logística"}
    return {"code": "PROVEEDORES_INSUMOS", "label": "Pago a Proveedores e Insumos (RCV)"}


@router.get("/debts")
def list_financial_debts():
    _ensure_debts_table()
    rows = query_all("SELECT * FROM financial_debts ORDER BY next_due_date ASC, due_day ASC, id DESC")
    today = datetime.date.today()
    enriched = []
    total_debt = 0.0
    total_limit = 0.0
    total_monthly = 0.0
    urgent_count = 0

    for r in rows:
        item = dict(r)
        used = float(item.get("used_amount") or 0)
        limit_amt = float(item.get("total_limit") or 0)
        inst = float(item.get("monthly_installment") or 0)
        total_debt += used
        total_limit += max(limit_amt, used)
        if item.get("status") != "PAGADO_MES":
            total_monthly += inst

        due_str = item.get("next_due_date") or ""
        days_to_due = None
        if due_str:
            try:
                due_dt = datetime.date.fromisoformat(due_str[:10])
                days_to_due = (due_dt - today).days
            except Exception:
                pass
        if days_to_due is None:
            due_day = max(1, min(28, int(item.get("due_day") or 5)))
            candidate = datetime.date(today.year, today.month, due_day)
            if candidate < today and item.get("status") == "PAGADO_MES":
                m = today.month + 1
                y = today.year + (1 if m > 12 else 0)
                m = 1 if m > 12 else m
                candidate = datetime.date(y, m, due_day)
            days_to_due = (candidate - today).days
            item["next_due_date"] = candidate.isoformat()

        item["days_to_due"] = days_to_due
        if item.get("status") == "PAGADO_MES":
            item["alert_level"] = "OK"
            item["alert_label"] = "Cuota del mes pagada"
        elif days_to_due < 0:
            item["alert_level"] = "CRITICA"
            item["alert_label"] = f"En mora ({abs(days_to_due)}d) · Riesgo DICOM"
            urgent_count += 1
        elif days_to_due <= 5:
            item["alert_level"] = "ALTA"
            item["alert_label"] = f"Vence en {days_to_due} día(s) · Evitar mora"
            urgent_count += 1
        else:
            item["alert_level"] = "MEDIA"
            item["alert_label"] = f"Vence en {days_to_due} días"

        enriched.append(item)

    utilization_pct = round((total_debt / total_limit * 100), 1) if total_limit > 0 else 0.0
    return {
        "items": enriched,
        "summary": {
            "total_debt": round(total_debt),
            "total_limit": round(total_limit),
            "available_credit": round(max(0.0, total_limit - total_debt)),
            "total_monthly_installment": round(total_monthly),
            "utilization_pct": utilization_pct,
            "urgent_count": urgent_count,
        }
    }


@router.post("/debts")
def create_financial_debt(data: FinancialDebtModel):
    _ensure_debts_table()
    today = datetime.date.today()
    due_day = max(1, min(28, int(data.due_day or 5)))
    next_due = data.next_due_date
    if not next_due:
        next_due = datetime.date(today.year, today.month, due_day).isoformat()
    did = execute_insert("""
        INSERT INTO financial_debts (
            entity_name, debt_type, description, total_limit, used_amount,
            monthly_installment, due_day, next_due_date, interest_rate_pct, status, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        data.entity_name.strip(), data.debt_type, data.description or "",
        data.total_limit, data.used_amount, data.monthly_installment,
        due_day, next_due, data.interest_rate_pct, data.status or "AL_DIA", data.notes or ""
    ))
    return {"id": did, "message": "Obligación financiera registrada en el control anti-mora"}


@router.put("/debts/{debt_id}/pay-month")
def pay_financial_debt_month(debt_id: int):
    _ensure_debts_table()
    d = query_one("SELECT * FROM financial_debts WHERE id = ?", (debt_id,))
    if not d:
        raise HTTPException(status_code=404, detail="Obligación financiera no encontrada")
    inst = float(d.get("monthly_installment") or 0)
    new_used = max(0.0, float(d.get("used_amount") or 0) - inst)
    today = datetime.date.today()
    due_day = max(1, min(28, int(d.get("due_day") or 5)))
    m = today.month + 1
    y = today.year + (1 if m > 12 else 0)
    m = 1 if m > 12 else m
    next_due = datetime.date(y, m, due_day).isoformat()
    execute_commit("""
        UPDATE financial_debts
        SET used_amount = ?, status = 'PAGADO_MES', next_due_date = ?
        WHERE id = ?
    """, (new_used, next_due, debt_id))
    return {"message": f"Cuota mensual de {d['entity_name']} marcada como pagada. Próximo vencimiento: {next_due}"}


@router.delete("/debts/{debt_id}")
def delete_financial_debt(debt_id: int):
    _ensure_debts_table()
    execute_commit("DELETE FROM financial_debts WHERE id = ?", (debt_id,))
    return {"message": "Obligación financiera eliminada"}


@router.get("/intelligent-analysis")
def get_intelligent_bank_analysis(month: Optional[str] = None, year: Optional[int] = None):
    """
    Cuadratura 100% Banco + SII, dinero compacto, clasificación inteligente de cada movimiento
    y estrategias mensuales personalizadas para el manejo del flujo de caja.
    """
    _ensure_debts_table()
    if year and month and len(str(month)) <= 2:
        month = f"{year:04d}-{int(month):02d}"

    accounts = query_all("SELECT * FROM bank_accounts ORDER BY id ASC")
    cash_in_bank = sum(float(a.get("balance") or 0) for a in accounts)

    aging = get_aging_dashboard(month=month)
    cxc_total = float(aging.get("cxc", {}).get("total_monto") or 0)
    cxp_total = float(aging.get("cxp", {}).get("total_monto") or 0)

    debts_data = list_financial_debts()
    debt_summary = debts_data["summary"]
    monthly_debt = float(debt_summary.get("total_monthly_installment") or 0)

    # Facturas pagadas vs pendientes en el período
    dtes = query_all("SELECT * FROM dte_documents ORDER BY emission_date DESC")
    if month:
        filtered = [d for d in dtes if str(d.get("emission_date") or "").startswith(month)]
        if filtered:
            dtes = filtered

    ventas_pagadas = sum(float(d.get("paid_amount") or 0) for d in dtes if d.get("direction") == "EMITIDO" and int(d.get("dte_type") or 33) != 61)
    ventas_pendientes = sum(max(0.0, float(d.get("total_amount") or 0) - float(d.get("paid_amount") or 0)) for d in dtes if d.get("direction") == "EMITIDO" and int(d.get("dte_type") or 33) != 61)
    compras_pagadas = sum(float(d.get("paid_amount") or 0) for d in dtes if d.get("direction") == "RECIBIDO" and int(d.get("dte_type") or 33) != 61)
    compras_pendientes = sum(max(0.0, float(d.get("total_amount") or 0) - float(d.get("paid_amount") or 0)) for d in dtes if d.get("direction") == "RECIBIDO" and int(d.get("dte_type") or 33) != 61)

    txs = query_all("SELECT * FROM bank_transactions ORDER BY transaction_date DESC")
    categories: Dict[str, Dict[str, Any]] = {}
    total_egresos = 0.0
    total_ingresos = 0.0

    for t in txs:
        amt = abs(float(t.get("amount") or 0))
        tx_type = (t.get("transaction_type") or ("ABONO" if float(t.get("amount") or 0) >= 0 else "CARGO")).upper()
        cat = _classify_movement(t.get("description") or "", tx_type)
        if tx_type == "ABONO":
            total_ingresos += amt
        else:
            total_egresos += amt
            entry = categories.setdefault(cat["code"], {"code": cat["code"], "label": cat["label"], "amount": 0.0, "count": 0})
            entry["amount"] += amt
            entry["count"] += 1

    # Si aún no hay cargos en cartola pero sí hay compras en SII, reflejar las compras SII en el desglose inteligente
    if total_egresos == 0 and (compras_pagadas + compras_pendientes) > 0:
        amt_sii = compras_pagadas + compras_pendientes
        total_egresos = amt_sii
        categories["PROVEEDORES_INSUMOS"] = {
            "code": "PROVEEDORES_INSUMOS",
            "label": "Compras y Proveedores Registrados en SII (RCV)",
            "amount": amt_sii,
            "count": sum(1 for d in dtes if d.get("direction") == "RECIBIDO")
        }

    expense_breakdown = sorted(categories.values(), key=lambda x: x["amount"], reverse=True)
    for eb in expense_breakdown:
        eb["share_pct"] = round((eb["amount"] / total_egresos * 100), 1) if total_egresos > 0 else 0.0

    net_projected_liquidity = cash_in_bank + cxc_total - cxp_total - monthly_debt

    # Generar estrategias mensuales inteligentes
    strategies = []
    if cxp_total > 0 and cash_in_bank < cxp_total:
        deficit = cxp_total - cash_in_bank
        strategies.append({
            "priority": "ALTA",
            "title": "Cobertura de Pagos a Proveedores SII",
            "advice": f"Tienes facturas recibidas pendientes de pago por ${int(cxp_total):,} y un saldo bancario actual de ${int(cash_in_bank):,}. Prioriza la cobranza de clientes (${int(cxc_total):,}) o pacta pago en cuotas/cheque para cubrir la brecha de ${int(deficit):,} sin caer en mora.".replace(",", ".")
        })
    else:
        strategies.append({
            "priority": "OK",
            "title": "Solvencia de Corto Plazo Saludable",
            "advice": f"Tu posición compacta proyectada es de ${int(net_projected_liquidity):,}. El saldo disponible más cuentas por cobrar cubre las facturas de compra registradas en el SII.".replace(",", ".")
        })

    if debt_summary["urgent_count"] > 0 or debt_summary["utilization_pct"] > 65:
        strategies.append({
            "priority": "CRITICA",
            "title": "Prevención de Mora y Protección DICOM / CMF",
            "advice": f"Registras {debt_summary['urgent_count']} obligación(es) financiera(s) próximas a vencer y un uso de cupo del {debt_summary['utilization_pct']}%. Paga antes del día de corte para evitar intereses rotativos y mantener tu informe CMF/DICOM limpio."
        })
    else:
        strategies.append({
            "priority": "MEDIA",
            "title": "Optimización de Deuda Financiera y Cupos Bancarios",
            "advice": "Mantén el uso de tarjetas de crédito empresariales y líneas de sobregiro bajo el 35% del cupo autorizado al día 25 de cada mes para mejorar tu calificación crediticia ante los bancos."
        })

    strategies.append({
        "priority": "MEDIA",
        "title": "Cuadratura 100% SII vs Cartola Bancaria",
        "advice": f"Facturas de venta cobradas: ${int(ventas_pagadas):,} (por cobrar: ${int(ventas_pendientes):,}) · Facturas de compra pagadas: ${int(compras_pagadas):,} (por pagar: ${int(compras_pendientes):,}). Concilia cada abono o cargo para que el F29 y el flujo de caja cierren al peso.".replace(",", ".")
    })

    return {
        "compact_money": {
            "cash_in_bank": round(cash_in_bank),
            "cxc_pending": round(cxc_total),
            "cxp_pending": round(cxp_total),
            "monthly_debt_installments": round(monthly_debt),
            "net_projected_liquidity": round(net_projected_liquidity),
            "ventas_pagadas": round(ventas_pagadas),
            "ventas_pendientes": round(ventas_pendientes),
            "compras_pagadas": round(compras_pagadas),
            "compras_pendientes": round(compras_pendientes),
        },
        "expense_breakdown": expense_breakdown,
        "strategies": strategies,
    }
