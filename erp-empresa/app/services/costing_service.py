from typing import Dict, Any, List
from app.database import query_all, query_one

def calculate_folder_financials(folder_id: int) -> Dict[str, Any]:
    """
    Calcula en tiempo real los indicadores financieros de una Carpeta de Negocio:
    - Ingresos: Facturas de venta emitidas asignadas + Cotizaciones aprobadas (si no están facturadas)
    - Costos Directos: Facturas de compra recibidas asignadas (DTEs)
    - Gastos Operativos Asociados: Gastos registrados manualmente (fletes, honorarios, viáticos)
    - Utilidad Neta en $
    - Margen Neto en %
    - Semáforo de Rentabilidad: VERDE (>= 25%), AMARILLO (10% - 25%), ROJO (< 10%)
    """
    folder = query_one("SELECT * FROM business_folders WHERE id = ?", (folder_id,))
    if not folder:
        return {}

    # DTEs emitidos asignados (Ingresos facturados)
    dtes_emitidos = query_all("""
        SELECT * FROM dte_documents 
        WHERE folder_id = ? AND direction = 'EMITIDO'
    """, (folder_id,))
    
    # Cotizaciones aceptadas asociadas a esta carpeta
    cotizaciones = query_all("""
        SELECT * FROM quotations 
        WHERE folder_id = ? AND status IN ('ACEPTADA', 'FACTURADA')
    """, (folder_id,))

    # DTEs recibidos asignados (Costos directos de compra)
    dtes_recibidos = query_all("""
        SELECT * FROM dte_documents 
        WHERE folder_id = ? AND direction = 'RECIBIDO'
    """, (folder_id,))

    # Gastos adicionales asociados
    gastos_extras = query_all("""
        SELECT * FROM folder_expenses 
        WHERE folder_id = ?
    """, (folder_id,))

    # Productos solicitados extraídos
    req_items = query_all("SELECT id FROM folder_requested_items WHERE folder_id = ?", (folder_id,))
    
    # Documentos y anexos asociados
    docs = query_all("SELECT id, status FROM tender_documents WHERE folder_id = ?", (folder_id,))
    docs_firmados = [d for d in docs if d.get("status") == "FIRMADO"]

    # Calcular Ingreso Total (Neto)
    total_facturado_neto = sum(d["net_amount"] for d in dtes_emitidos if d["dte_type"] != 61) - sum(d["net_amount"] for d in dtes_emitidos if d["dte_type"] == 61)
    total_cotizado_neto = sum(q["net_amount"] for q in cotizaciones)
    
    status = (folder.get("status") or "").upper()
    is_awarded_stage = status in ("ADJUDICADA", "EN_EJECUCION", "CERRADA")
    awarded_amount = float(folder.get("awarded_amount") or 0)
    presupuesto_estimado_mp = float(folder.get("budget_amount") or 0)

    # REGLA FINANCIERA:
    # El presupuesto estimado de Mercado Público es referencial y NO es venta neta mientras esté
    # en fases previas (1. Levantamiento / Bases, 2. Oferta enviada).
    # La Venta Neta contable solo se devenga al pasar a '3. Adjudicado / OC' (usando el monto de la OC
    # o cotización aceptada) o si ya existen facturas de venta (DTEs) emitidas reales.
    if is_awarded_stage:
        if total_facturado_neto > 0:
            venta_neta = total_facturado_neto
        elif awarded_amount > 0:
            venta_neta = awarded_amount
        elif total_cotizado_neto > 0:
            venta_neta = total_cotizado_neto
        else:
            venta_neta = 0.0
    else:
        # Fases iniciales: Presupuesto Estimado MP con Venta Neta: $0
        venta_neta = total_facturado_neto if total_facturado_neto > 0 else 0.0

    venta_bruta = round(venta_neta * 1.19)  # Con IVA

    # Calcular Costo Directo (Neto de compras)
    costo_directo = sum(d["net_amount"] for d in dtes_recibidos if d["dte_type"] != 61) - sum(d["net_amount"] for d in dtes_recibidos if d["dte_type"] == 61)
    
    # Calcular Gastos Operativos
    gastos_asociados = sum(g["amount"] for g in gastos_extras)

    # Costo Total
    costo_total = costo_directo + gastos_asociados

    # Utilidad Neta
    utilidad_neta = venta_neta - costo_total

    # Margen %: Solo se computa sobre venta neta devengada real
    if venta_neta > 0:
        margen_pct = round((utilidad_neta / venta_neta) * 100.0, 2)
    else:
        margen_pct = 0.0

    # Semáforo de Rentabilidad
    target_margin = float(folder.get("target_margin_pct", 25.0))
    if not is_awarded_stage and venta_neta == 0:
        semaforo = "AMARILLO" if costo_total > 0 else "AMARILLO"
        semaforo_color = "amber"
    elif margen_pct >= target_margin:
        semaforo = "VERDE"
        semaforo_color = "emerald"
    elif margen_pct >= 10.0:
        semaforo = "AMARILLO"
        semaforo_color = "amber"
    else:
        semaforo = "ROJO"
        semaforo_color = "rose"

    progress_pct = folder.get("progress_pct")
    if progress_pct is None:
        status_map = {
            "EN_PREPARACION": 20,
            "ENVIADA": 45,
            "ADJUDICADA": 65,
            "EN_EJECUCION": 80,
            "CERRADA": 100,
            "PERDIDA": 100
        }
        progress_pct = status_map.get(folder.get("status", "EN_EJECUCION"), 65)

    return {
        "folder_id": folder_id,
        "code": folder["code"],
        "title": folder["title"],
        "client_name": folder["client_name"],
        "client_rut": folder["client_rut"],
        "status": folder["status"],
        "type": folder["type"],
        "tender_id": folder.get("tender_id"),
        "tender_closing_date": folder.get("tender_closing_date"),
        "budget_amount": folder.get("budget_amount", 0),
        "presupuesto_estimado_mp": round(presupuesto_estimado_mp),
        "is_awarded_stage": is_awarded_stage,
        "awarded_amount": round(awarded_amount),
        "oc_number": folder.get("oc_number") or "",
        "target_margin_pct": target_margin,
        "progress_pct": int(progress_pct),
        "venta_neta": round(venta_neta),
        "venta_bruta": round(venta_bruta),
        "total_facturado_neto": round(total_facturado_neto),
        "total_cotizado_neto": round(total_cotizado_neto),
        "costo_directo": round(costo_directo),
        "gastos_asociados": round(gastos_asociados),
        "costo_total": round(costo_total),
        "utilidad_neta": round(utilidad_neta),
        "margen_pct": margen_pct,
        "semaforo": semaforo,
        "semaforo_color": semaforo_color,
        "dtes_emitidos_count": len(dtes_emitidos),
        "dtes_recibidos_count": len(dtes_recibidos),
        "gastos_count": len(gastos_extras),
        "cotizaciones_count": len(cotizaciones),
        "requested_items_count": len(req_items),
        "docs_count": len(docs),
        "docs_firmados_count": len(docs_firmados)
    }

def get_all_folders_summary() -> List[Dict[str, Any]]:
    """
    Retorna el resumen financiero de todas las carpetas activas.
    """
    folders = query_all("SELECT id FROM business_folders ORDER BY id DESC")
    return [calculate_folder_financials(f["id"]) for f in folders]
