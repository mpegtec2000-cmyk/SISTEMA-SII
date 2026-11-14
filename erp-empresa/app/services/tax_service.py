import datetime
from typing import Dict, Any, List
from app.database import query_all, query_one, execute_commit, execute_insert
from app.models import formatear_rut

def _summary_docs(direction: str, mes_str: str) -> List[Dict[str, Any]]:
    """Totales por tipo de documento desde un 'Resumen' del RCV (cuando no hay detalle con folios)."""
    rows = query_all("SELECT * FROM rcv_summary WHERE direction = ? AND period = ?", (direction, mes_str.replace("-", "")))
    return [{"dte_type": r["dte_type"], "net_amount": r["net_amount"], "iva_amount": r["iva_amount"], "_count": r["doc_count"]} for r in rows]


def get_monthly_tax_projection(year: int, month: int, company_id: int = None) -> Dict[str, Any]:
    """
    Calcula en tiempo real la proyección tributaria del mes:
    - IVA Débito (Ventas emitidas)
    - IVA Crédito (Compras recibidas)
    - Balance de IVA (A pagar o Remanente de crédito)
    - Base imponible de ventas netas
    - Estimación de PPM (Pago Provisional Mensual) según tasa de la empresa
    - Total proyectado Formulario 29 (F29)
    """
    # Si no se indica empresa, buscar la predeterminada
    if not company_id:
        default_company = query_one("SELECT * FROM companies WHERE is_default = 1 LIMIT 1")
        if not default_company:
            default_company = query_one("SELECT * FROM companies ORDER BY id ASC LIMIT 1")
        company_id = default_company["id"] if default_company else None
        ppm_rate = default_company["ppm_rate"] if default_company else 1.5
    else:
        comp = query_one("SELECT * FROM companies WHERE id = ?", (company_id,))
        ppm_rate = comp["ppm_rate"] if comp else 1.5

    # Filtrar por año y mes en emission_date (formato YYYY-MM-DD o DD-MM-YYYY)
    mes_str = f"{year:04d}-{month:02d}"
    
    # DTEs emitidos (Ventas)
    dtes_ventas = query_all("""
        SELECT * FROM dte_documents 
        WHERE direction = 'EMITIDO' 
        AND strftime('%Y-%m', emission_date) = ?
    """, (mes_str,))
    
    # Si la fecha estaba en otro formato (DD/MM/YYYY), también soportarlo
    if not dtes_ventas:
        dtes_ventas = query_all("""
            SELECT * FROM dte_documents 
            WHERE direction = 'EMITIDO' 
            AND (emission_date LIKE ? OR emission_date LIKE ?)
        """, (f"{mes_str}%", f"%/{month:02d}/{year:04d}%"))

    # DTEs recibidos (Compras)
    dtes_compras = query_all("""
        SELECT * FROM dte_documents 
        WHERE direction = 'RECIBIDO' 
        AND (strftime('%Y-%m', emission_date) = ? OR emission_date LIKE ?)
    """, (mes_str, f"{mes_str}%"))
    
    if not dtes_compras:
        dtes_compras = query_all("""
            SELECT * FROM dte_documents 
            WHERE direction = 'RECIBIDO' 
            AND (emission_date LIKE ? OR emission_date LIKE ?)
        """, (f"{mes_str}%", f"%/{month:02d}/{year:04d}%"))

    if not dtes_ventas:
        dtes_ventas = _summary_docs('EMITIDO', mes_str)
    if not dtes_compras:
        dtes_compras = _summary_docs('RECIBIDO', mes_str)

    # Calcular Ventas
    ventas_neto = sum(d["net_amount"] for d in dtes_ventas if d["dte_type"] != 61)
    # Si hay notas de crédito de venta (tipo 61), restan
    nc_ventas_neto = sum(d["net_amount"] for d in dtes_ventas if d["dte_type"] == 61)
    base_ventas_neta = max(0.0, ventas_neto - nc_ventas_neto)

    iva_debito = sum(d["iva_amount"] for d in dtes_ventas if d["dte_type"] != 61)
    nc_iva_debito = sum(d["iva_amount"] for d in dtes_ventas if d["dte_type"] == 61)
    iva_debito_neto = max(0.0, iva_debito - nc_iva_debito)

    # Calcular Compras
    compras_neto = sum(d["net_amount"] for d in dtes_compras if d["dte_type"] != 61)
    nc_compras_neto = sum(d["net_amount"] for d in dtes_compras if d["dte_type"] == 61)
    base_compras_neta = max(0.0, compras_neto - nc_compras_neto)

    iva_credito = sum(d["iva_amount"] for d in dtes_compras if d["dte_type"] != 61)
    nc_iva_credito = sum(d["iva_amount"] for d in dtes_compras if d["dte_type"] == 61)
    iva_credito_neto = max(0.0, iva_credito - nc_iva_credito)

    # Balance IVA
    diferencia_iva = iva_debito_neto - iva_credito_neto
    iva_a_pagar = diferencia_iva if diferencia_iva > 0 else 0.0
    remanente_iva = abs(diferencia_iva) if diferencia_iva < 0 else 0.0

    # PPM
    monto_ppm = round(base_ventas_neta * (ppm_rate / 100.0))

    # Total Formulario 29 proyectado
    total_f29_pagar = round(iva_a_pagar + monto_ppm)

    return {
        "periodo": f"{year}-{month:02d}",
        "ppm_rate": ppm_rate,
        "base_ventas_neta": base_ventas_neta,
        "iva_debito": iva_debito_neto,
        "cant_facturas_emitidas": sum(d.get("_count", 1) for d in dtes_ventas),
        "base_compras_neta": base_compras_neta,
        "iva_credito": iva_credito_neto,
        "cant_facturas_recibidas": sum(d.get("_count", 1) for d in dtes_compras),
        "iva_a_pagar": iva_a_pagar,
        "remanente_iva": remanente_iva,
        "monto_ppm": monto_ppm,
        "total_f29_pagar": total_f29_pagar,
        "estado_iva": "A_PAGAR" if iva_a_pagar > 0 else "REMANENTE_FAVOR"
    }

def import_rcv_data(records: List[Dict[str, Any]], direction: str) -> Dict[str, Any]:
    """
    Importa masivamente registros normalizados del RCV (Ventas o Compras).
    """
    imported_count = 0
    updated_count = 0
    
    for rec in records:
        dte_type = int(rec.get("dte_type", 33))
        folio = int(rec.get("folio", 0))
        rut_emisor = formatear_rut(rec.get("rut_emisor", ""))
        razon_emisor = rec.get("razon_social_emisor", "Proveedor").strip()
        rut_receptor = formatear_rut(rec.get("rut_receptor", ""))
        razon_receptor = rec.get("razon_social_receptor", "Cliente").strip()
        fecha = str(rec.get("emission_date", datetime.date.today().isoformat()))
        vencimiento = rec.get("expiration_date", "")
        neto = float(rec.get("net_amount", 0.0))
        exento = float(rec.get("exempt_amount", 0.0))
        iva = float(rec.get("iva_amount", 0.0))
        total = float(rec.get("total_amount", neto + exento + iva))

        # Comprobar si ya existe por tipo, folio y RUT emisor
        existente = query_one("""
            SELECT id FROM dte_documents 
            WHERE dte_type = ? AND folio = ? AND rut_emisor = ?
        """, (dte_type, folio, rut_emisor))

        if existente:
            execute_commit("""
                UPDATE dte_documents SET
                    razon_social_emisor = ?,
                    rut_receptor = ?,
                    razon_social_receptor = ?,
                    emission_date = ?,
                    net_amount = ?,
                    exempt_amount = ?,
                    iva_amount = ?,
                    total_amount = ?,
                    direction = ?
                WHERE id = ?
            """, (razon_emisor, rut_receptor, razon_receptor, fecha, neto, exento, iva, total, direction, existente["id"]))
            updated_count += 1
        else:
            execute_insert("""
                INSERT INTO dte_documents (
                    dte_type, folio, rut_emisor, razon_social_emisor,
                    rut_receptor, razon_social_receptor, emission_date, expiration_date,
                    net_amount, exempt_amount, iva_amount, total_amount, direction,
                    status_sii, source
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACEPTADO', 'RCV')
            """, (dte_type, folio, rut_emisor, razon_emisor, rut_receptor, razon_receptor, fecha, vencimiento, neto, exento, iva, total, direction))
            imported_count += 1

    return {"imported": imported_count, "updated": updated_count, "total_processed": len(records)}
