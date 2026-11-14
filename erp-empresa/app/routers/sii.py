import datetime
from fastapi import APIRouter, HTTPException, Query, UploadFile, File
from typing import List, Dict, Any, Optional
from app.database import query_all, query_one, execute_insert, execute_commit
from app.models import DteModel, DteAssignFolderModel, formatear_rut
from app.services.tax_service import get_monthly_tax_projection, import_rcv_data
from app.services.inventory_service import deduct_inventory_for_invoice, add_inventory_for_purchase
from app.services.payments_service import register_payment

router = APIRouter(prefix="/api/sii", tags=["SII & Facturación"])

@router.get("/dtes")
def get_dtes(
    direction: Optional[str] = None, # 'EMITIDO', 'RECIBIDO'
    unassigned_only: bool = False,
    month: Optional[str] = None, # 'YYYY-MM' o mes '10'
    year: Optional[int] = None
):
    query = """
        SELECT d.*, f.code as folder_code, f.title as folder_title
        FROM dte_documents d
        LEFT JOIN business_folders f ON d.folder_id = f.id
        WHERE 1=1
    """
    params = []

    if direction:
        query += " AND d.direction = ?"
        params.append(direction)

    if unassigned_only:
        query += " AND d.folder_id IS NULL"

    if year and month and len(str(month)) <= 2:
        month = f"{year:04d}-{int(month):02d}"

    if month:
        query += " AND (d.emission_date LIKE ? OR d.emission_date LIKE ?)"
        params.append(f"{month}%")
        # También considerar formato DD/MM/YYYY
        partes = month.split("-")
        if len(partes) == 2:
            params.append(f"%/{partes[1]}/{partes[0]}%")
        else:
            params.append(f"{month}%")

    query += " ORDER BY d.emission_date DESC, d.id DESC"
    return query_all(query, tuple(params))

@router.put("/dtes/assign")
def assign_dte_to_folder(data: DteAssignFolderModel):
    """
    Asigna (o desasigna) un DTE a una Carpeta de Negocio (imputación centro de costos).
    """
    execute_commit("UPDATE dte_documents SET folder_id = ? WHERE id = ?", (data.folder_id, data.dte_id))
    return {"message": "DTE asignado exitosamente a la Carpeta de Negocio"}

@router.post("/dtes/emit")
def emit_dte_direct(data: DteModel):
    """
    Emisión o registro directo de Documento Tributario Electrónico (DTE 33, 34, 52, 56, 61) desde la app.
    Está integrado con el control de Stock SKU (descuenta en venta / guía, suma en compra / nota de crédito)
    y registra el medio de pago si se pagó al contado / cheque / transferencia.
    """
    rut_emisor = formatear_rut(data.rut_emisor)
    rut_receptor = formatear_rut(data.rut_receptor)
    direction = (data.direction or "EMITIDO").upper()

    # Validar que no exista el mismo folio emitido
    existente = query_one("SELECT id FROM dte_documents WHERE dte_type = ? AND folio = ? AND rut_emisor = ?", (data.dte_type, data.folio, rut_emisor))
    if existente:
        raise HTTPException(status_code=400, detail=f"Ya existe un DTE tipo {data.dte_type} con el folio {data.folio}")

    dte_id = execute_insert("""
        INSERT INTO dte_documents (
            dte_type, folio, rut_emisor, razon_social_emisor,
            rut_receptor, razon_social_receptor, emission_date, expiration_date,
            net_amount, exempt_amount, iva_amount, total_amount, direction,
            status_sii, folder_id, quotation_id, source, payment_method
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACEPTADO', ?, ?, 'EMISION_DIRECTA', ?)
    """, (
        data.dte_type, data.folio, rut_emisor, data.razon_social_emisor,
        rut_receptor, data.razon_social_receptor, data.emission_date,
        data.expiration_date or data.emission_date, data.net_amount,
        data.exempt_amount, data.iva_amount, data.total_amount,
        direction, data.folder_id, data.quotation_id, data.payment_method
    ))

    # Si está vinculado a una cotización, marcarla como FACTURADA y descontar inventario
    if data.quotation_id:
        execute_commit("UPDATE quotations SET status = 'FACTURADA' WHERE id = ?", (data.quotation_id,))
        items = query_all("SELECT sku, quantity FROM quotation_items WHERE quotation_id = ?", (data.quotation_id,))
        deduct_inventory_for_invoice(data.folio, items)
    elif data.sku and data.quantity > 0:
        item_entry = [{"sku": data.sku, "quantity": data.quantity}]
        if direction == "EMITIDO" and data.dte_type in (33, 34, 52):
            deduct_inventory_for_invoice(data.folio, item_entry)
        elif (direction == "EMITIDO" and data.dte_type == 61) or (direction == "RECIBIDO" and data.dte_type in (33, 34, 52)):
            add_inventory_for_purchase(data.folio, item_entry, ref_type="NOTA_CREDITO" if data.dte_type == 61 else "FACTURA_COMPRA")

    # Si el medio de pago es CONTADO o EFECTIVO, registrar el pago automáticamente
    if data.payment_method in ("CONTADO", "EFECTIVO") and data.total_amount > 0:
        try:
            register_payment(
                dte_id=dte_id,
                amount=data.total_amount,
                paid_date=data.emission_date,
                method=data.payment_method,
                source="EMISION_DTE",
                notes=f"Pago inmediato ({data.payment_method}) al emitir DTE #{data.folio}"
            )
        except Exception:
            pass

    return {
        "message": f"DTE {data.dte_type} Folio #{data.folio} emitido y sincronizado con SII / Stock con éxito",
        "id": dte_id,
        "folio": data.folio
    }

@router.get("/projection")
def get_tax_projection(year: Optional[int] = None, month: Optional[str] = None, company_id: Optional[int] = None):
    """
    Retorna la proyección tributaria en vivo del mes (IVA Débito, IVA Crédito, PPM y F29).
    Acepta month='YYYY-MM' o year=YYYY y month=MM.
    """
    today = datetime.date.today()
    y = year or today.year
    m = today.month

    if month is not None:
        month_str = str(month).strip()
        if "-" in month_str:
            partes = month_str.split("-")
            y = int(partes[0])
            m = int(partes[1])
        else:
            m = int(month_str)
    return get_monthly_tax_projection(y, m, company_id)


@router.get("/f29-closing-optimization")
def get_f29_closing_optimization(year: Optional[int] = None, month: Optional[str] = None):
    """
    Semáforo Tributario de Cierre de Mes (Optimización F29):
    Evalúa la brecha entre IVA Débito acumulado e IVA Crédito, proyectando el monto
    de compras netas requeridas antes de fin de mes para calibrar y optimizar el F29.
    """
    today = datetime.date.today()
    y = year or today.year
    m = today.month
    if month is not None:
        month_str = str(month).strip()
        if "-" in month_str:
            partes = month_str.split("-")
            y = int(partes[0])
            m = int(partes[1])
        else:
            m = int(month_str)

    proj = get_monthly_tax_projection(y, m)
    iva_debito = float(proj.get("iva_debito") or 0)
    iva_credito = float(proj.get("iva_credito") or 0)
    remanente = float(proj.get("remanente_iva") or 0)
    iva_pagar = float(proj.get("iva_a_pagar") or 0)
    ppm = float(proj.get("monto_ppm") or 0)
    total_f29 = float(proj.get("total_f29_pagar") or 0)

    import calendar
    _, last_day = calendar.monthrange(y, m)
    days_left = max(0, last_day - today.day) if (y == today.year and m == today.month) else 0

    brecha = iva_debito - iva_credito
    if brecha > 0:
        compras_netas_sugeridas = round(brecha / 0.19)
        status_semaforo = "ALERTA_PAGO"
        badge_color = "rose"
        mensaje = (f"Brecha fiscal detectada: IVA a Pagar proyectado de ${int(brecha):,}. "
                   f"Para compensar este impuesto antes del cierre de mes ({last_day:02d}/{m:02d}), "
                   f"se sugiere evaluar compras netas de insumos/servicios por ${int(compras_netas_sugeridas):,} neto.")
    else:
        compras_netas_sugeridas = 0
        status_semaforo = "OPTIMIZADO"
        badge_color = "emerald"
        mensaje = (f"Crédito fiscal favorable. El IVA de compras cubre la totalidad de las ventas, "
                   f"proyectando un Remanente tributario de ${int(abs(brecha)):,}.")

    sales_net = float(proj.get("base_ventas_neta") or 0)
    purchases_net = float(proj.get("base_compras_neta") or 0)
    current_day = today.day if (y == today.year and m == today.month) else last_day
    days_remaining = max(0, last_day - today.day) if (y == today.year and m == today.month) else max(0, last_day - today.day)

    return {
        "year": y,
        "month": m,
        "periodo": f"{y:04d}-{m:02d}",
        "current_day": today.day,
        "days_remaining_in_month": max(0, last_day - today.day),
        "days_left_in_month": days_left,
        "is_closing_window": days_left <= 11 or today.day >= 20,
        "iva_debito": round(iva_debito),
        "debito_fiscal": round(iva_debito),
        "iva_credito": round(iva_credito),
        "credito_fiscal": round(iva_credito),
        "sales_net": round(sales_net),
        "purchases_net": round(purchases_net),
        "iva_pagar": round(iva_pagar),
        "remanente": round(remanente),
        "ppm_amount": round(ppm),
        "total_f29_pagar": round(total_f29),
        "projected_f29_tax": round(total_f29),
        "brecha_iva": round(brecha),
        "tax_gap": round(brecha),
        "compras_netas_sugeridas": round(compras_netas_sugeridas),
        "suggested_net_purchases_to_balance": round(compras_netas_sugeridas),
        "status_semaforo": status_semaforo,
        "badge_color": badge_color,
        "mensaje": mensaje.replace(",", ".")
    }


@router.get("/analytics")
def get_sii_analytics(month: Optional[str] = None, year: Optional[int] = None):
    """
    Análisis inteligente del RCV (SII):
    - Ranking de Top Clientes (a quién vendemos más)
    - Ranking de Top Proveedores (a quién compramos más)
    - Alertas preventivas SII (facturas sin asignar a carpeta, acuse de recibo 8 días, vencimientos)
    """
    dtes = get_dtes(month=month, year=year)
    if not dtes:
        # Si el mes filtrado no tiene folios individuales, mostrar acumulado histórico para ranking
        dtes = query_all("""
            SELECT d.*, f.code as folder_code, f.title as folder_title
            FROM dte_documents d
            LEFT JOIN business_folders f ON d.folder_id = f.id
            ORDER BY d.emission_date DESC, d.id DESC
        """)

    clientes_map: Dict[str, Dict[str, Any]] = {}
    proveedores_map: Dict[str, Dict[str, Any]] = {}
    total_ventas_neto = 0.0
    total_compras_neto = 0.0
    unassigned_purchases = 0
    unassigned_purchases_amount = 0.0
    pending_acuse_count = 0
    overdue_unpaid_count = 0
    today = datetime.date.today()

    for d in dtes:
        sign = -1.0 if int(d.get("dte_type") or 33) == 61 else 1.0
        neto = float(d.get("net_amount") or 0) * sign
        total = float(d.get("total_amount") or 0) * sign
        paid = float(d.get("paid_amount") or 0)
        saldo = max(0.0, float(d.get("total_amount") or 0) - paid) if sign > 0 else 0.0

        # Verificar vencimiento y acuse de recibo (8 días SII)
        try:
            em_date = datetime.date.fromisoformat(str(d.get("emission_date") or "")[:10])
        except Exception:
            em_date = today
        try:
            exp_date = datetime.date.fromisoformat(str(d.get("expiration_date") or "")[:10])
        except Exception:
            exp_date = em_date + datetime.timedelta(days=30)

        if d.get("direction") == "EMITIDO":
            key = (d.get("rut_receptor") or d.get("razon_social_receptor") or "S/R").strip()
            entry = clientes_map.setdefault(key, {
                "rut": d.get("rut_receptor") or "—",
                "name": d.get("razon_social_receptor") or "Cliente",
                "doc_count": 0,
                "net_amount": 0.0,
                "total_amount": 0.0,
                "pending_amount": 0.0,
            })
            entry["doc_count"] += 1
            entry["net_amount"] += neto
            entry["total_amount"] += total
            entry["pending_amount"] += saldo
            if neto > 0:
                total_ventas_neto += neto
        else:
            key = (d.get("rut_emisor") or d.get("razon_social_emisor") or "S/R").strip()
            entry = proveedores_map.setdefault(key, {
                "rut": d.get("rut_emisor") or "—",
                "name": d.get("razon_social_emisor") or "Proveedor",
                "doc_count": 0,
                "net_amount": 0.0,
                "total_amount": 0.0,
                "pending_amount": 0.0,
            })
            entry["doc_count"] += 1
            entry["net_amount"] += neto
            entry["total_amount"] += total
            entry["pending_amount"] += saldo
            if neto > 0:
                total_compras_neto += neto
            if not d.get("folder_id") and int(d.get("dte_type") or 33) in (33, 34):
                unassigned_purchases += 1
                unassigned_purchases_amount += max(0.0, neto)
            if 0 <= (today - em_date).days <= 8 and int(d.get("dte_type") or 33) == 33:
                pending_acuse_count += 1

        if saldo > 0 and exp_date < today and d.get("payment_status") != "PAGADA":
            overdue_unpaid_count += 1

    top_clients = sorted(clientes_map.values(), key=lambda x: x["total_amount"], reverse=True)[:8]
    for c in top_clients:
        c["share_pct"] = round((c["net_amount"] / total_ventas_neto * 100), 1) if total_ventas_neto > 0 else 100.0

    top_suppliers = sorted(proveedores_map.values(), key=lambda x: x["total_amount"], reverse=True)[:8]
    for s in top_suppliers:
        s["share_pct"] = round((s["net_amount"] / total_compras_neto * 100), 1) if total_compras_neto > 0 else 100.0

    alerts = []
    if unassigned_purchases > 0:
        alerts.append({
            "level": "MEDIA",
            "title": f"{unassigned_purchases} factura(s) de compra sin asignar a Carpeta de Negocio",
            "detail": f"Hay ${int(unassigned_purchases_amount):,} neto en compras que aún no están imputadas a un proyecto. Asígnalas en la tabla inferior para calcular la utilidad exacta de cada negocio.".replace(",", ".")
        })
    if pending_acuse_count > 0:
        alerts.append({
            "level": "ALTA",
            "title": f"{pending_acuse_count} factura(s) dentro del plazo legal de 8 días de Acuse de Recibo SII",
            "detail": "Recuerda aceptar o reclamar las facturas de compra a crédito en el portal del SII dentro de los 8 días corridos desde su recepción para asegurar el uso del IVA Crédito Fiscal en el mes."
        })
    if overdue_unpaid_count > 0:
        alerts.append({
            "level": "CRITICA",
            "title": f"{overdue_unpaid_count} documento(s) con fecha de vencimiento cumplida sin pago registrado",
            "detail": "Registra el medio de pago (transferencia, cheque, efectivo o crédito) o concilia con la cartola bancaria para evitar bloqueos con proveedores o atrasos de cobranza."
        })
    if not alerts:
        alerts.append({
            "level": "OK",
            "title": "Cumplimiento Tributario SII al Día",
            "detail": "Todas las facturas del período están conciliadas y asignadas a sus centros de costo correspondientes."
        })

    return {
        "top_clients": top_clients,
        "top_suppliers": top_suppliers,
        "total_ventas_neto": round(total_ventas_neto),
        "total_compras_neto": round(total_compras_neto),
        "alerts": alerts,
    }

