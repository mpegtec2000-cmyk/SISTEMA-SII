import re
import datetime
from typing import Dict, Any, List, Optional
from app.database import query_all, query_one, execute_commit
from app.services import payments_service

def find_reconciliation_matches() -> List[Dict[str, Any]]:
    """
    Algoritmo inteligente de conciliación bancaria:
    Cruza los movimientos bancarios no conciliados con los DTEs emitidos/recibidos pendientes de cobro/pago.
    Reglas de cruce:
    1. Coincidencia exacta de monto total y presencia del número de folio o RUT en la descripción/glosa.
    2. Coincidencia exacta de monto total con factura del mismo sentido (Abono -> Factura Venta, Cargo -> Factura Compra).
    3. Similitud de nombre de contraparte o mención de 'FAC', 'FACT', 'F.', 'FOLIO' + número de folio.
    """
    # Movimientos bancarios pendientes
    unreconciled_txs = query_all("""
        SELECT t.*, a.bank_name, a.account_number 
        FROM bank_transactions t
        JOIN bank_accounts a ON t.account_id = a.id
        WHERE t.is_reconciled = 0
        ORDER BY t.transaction_date DESC
    """)

    # DTEs no conciliados
    unreconciled_dtes = query_all("""
        SELECT * FROM dte_documents 
        WHERE is_reconciled = 0
        ORDER BY emission_date DESC
    """)

    suggestions = []

    for tx in unreconciled_txs:
        tx_amount = abs(float(tx["amount"]))
        tx_type = tx["transaction_type"] # 'ABONO' o 'CARGO'
        tx_desc = tx["description"].upper()
        
        # Sentido esperado del DTE
        expected_direction = 'EMITIDO' if tx_type == 'ABONO' else 'RECIBIDO'

        best_match = None
        match_confidence = 0 # 0 a 100
        match_reason = ""

        # Extraer posibles folios de la glosa mediante regex (ej: F1234, FAC 456, FOLIO 789, o secuencias de 3 a 8 dígitos)
        folio_candidates = re.findall(r'(?:FAC|FOLIO|F|DOC|FACTURA|N[°º]?)?\s*(\d{3,8})', tx_desc)
        folio_nums = [int(f) for f in folio_candidates if f.isdigit()]

        for dte in unreconciled_dtes:
            if dte["direction"] != expected_direction:
                continue

            dte_total = payments_service.saldo_of(dte)  # se compara contra el saldo pendiente
            if dte_total <= 0:
                continue
            dte_folio = int(dte["folio"])
            rut_contraparte = (dte["rut_receptor"] if dte["direction"] == 'EMITIDO' else dte["rut_emisor"]).replace(".", "").replace("-", "").upper()
            nombre_contraparte = (dte["razon_social_receptor"] if dte["direction"] == 'EMITIDO' else dte["razon_social_emisor"]).upper()

            # 1. Coincidencia exacta de monto Y folio en glosa
            if abs(tx_amount - dte_total) < 1.0 and dte_folio in folio_nums:
                best_match = dte
                match_confidence = 98
                match_reason = f"Monto exacto (${int(tx_amount):,}) y folio #{dte_folio} explícito en glosa"
                break

            # 2. Coincidencia de monto Y RUT en glosa
            rut_cuerpo = rut_contraparte[:-1] if len(rut_contraparte) > 2 else rut_contraparte
            if abs(tx_amount - dte_total) < 1.0 and (rut_cuerpo in tx_desc.replace(".", "").replace("-", "") or rut_contraparte in tx_desc):
                if match_confidence < 95:
                    best_match = dte
                    match_confidence = 95
                    match_reason = f"Monto exacto y RUT coincidente ({dte['rut_receptor' if dte['direction'] == 'EMITIDO' else 'rut_emisor']})"

            # 3. Coincidencia exacta de monto Y nombre de cliente/proveedor presente en glosa
            primeras_palabras = [w for w in nombre_contraparte.split() if len(w) > 3]
            nombre_en_glosa = any(w in tx_desc for w in primeras_palabras) if primeras_palabras else False
            
            if abs(tx_amount - dte_total) < 1.0 and nombre_en_glosa:
                if match_confidence < 90:
                    best_match = dte
                    match_confidence = 90
                    match_reason = f"Monto exacto y razón social en glosa ({dte['razon_social_receptor' if dte['direction'] == 'EMITIDO' else 'razon_social_emisor']})"

            # 4. Coincidencia exacta de monto únicamente
            if abs(tx_amount - dte_total) < 1.0:
                if match_confidence < 75:
                    best_match = dte
                    match_confidence = 75
                    match_reason = f"Monto idéntico (${int(tx_amount):,}) con DTE #{dte_folio} pendiente"

        if best_match:
            suggestions.append({
                "transaction": tx,
                "dte": best_match,
                "confidence": match_confidence,
                "reason": match_reason
            })

    return suggestions

def reconcile_transaction(transaction_id: int, dte_id: int, folder_id: Optional[int] = None) -> bool:
    """
    Aplica la conciliación entre un movimiento bancario y un DTE.
    Si se especifica folder_id o el DTE ya tiene carpeta, asocia ambos.
    """
    dte = query_one("SELECT * FROM dte_documents WHERE id = ?", (dte_id,))
    if not dte:
        return False

    target_folder_id = folder_id or dte["folder_id"]

    # Marcar movimiento bancario
    execute_commit("""
        UPDATE bank_transactions SET
            is_reconciled = 1,
            reconciled_dte_id = ?,
            folder_id = ?
        WHERE id = ?
    """, (dte_id, target_folder_id, transaction_id))

    # Registrar el pago bancario en el DTE (monto, fecha e identificador de transferencia);
    # queda PAGADA o PARCIAL y se cierran las alertas de vencimiento si el saldo llega a 0.
    tx = query_one("SELECT * FROM bank_transactions WHERE id = ?", (transaction_id,))
    if tx:
        payments_service.apply_bank_payment(tx, dte_id)
    execute_commit("UPDATE dte_documents SET folder_id = COALESCE(?, folder_id) WHERE id = ?", (target_folder_id, dte_id))

    return True

def get_aging_dashboard(month: Optional[str] = None) -> Dict[str, Any]:
    """
    Calcula el estado de Cuentas por Cobrar (CxC) y Cuentas por Pagar (CxP):
    - Al día (aún no vence)
    - Próximas a vencer (próximos 7 días)
    - Vencidas 1-30 días
    - Vencidas 31-60 días
    - Vencidas +60 días
    Soporta filtrado por mes fiscal ('YYYY-MM').
    """
    today = datetime.date.today()

    cxc_query = "SELECT * FROM dte_documents WHERE direction = 'EMITIDO' AND is_reconciled = 0"
    cxp_query = "SELECT * FROM dte_documents WHERE direction = 'RECIBIDO' AND is_reconciled = 0"
    params = []

    if month:
        partes = month.split("-")
        alt = f"%/{partes[1]}/{partes[0]}%" if len(partes) == 2 else f"{month}%"
        cxc_query += " AND (emission_date LIKE ? OR emission_date LIKE ?)"
        cxp_query += " AND (emission_date LIKE ? OR emission_date LIKE ?)"
        params = [f"{month}%", alt]

    # Facturas de venta no conciliadas (por cobrar)
    cxc_docs = query_all(cxc_query, tuple(params) if params else ())
    cxc_docs = [dict(d, total_amount=payments_service.saldo_of(d)) for d in cxc_docs if payments_service.saldo_of(d) > 0]

    # Facturas de compra no conciliadas (por pagar)
    cxp_docs = query_all(cxp_query, tuple(params) if params else ())
    cxp_docs = [dict(d, total_amount=payments_service.saldo_of(d)) for d in cxp_docs if payments_service.saldo_of(d) > 0]

    def classify_docs(docs: List[Dict[str, Any]]) -> Dict[str, Any]:
        al_dia = 0.0
        por_vencer_7d = 0.0
        vencidas_1_30 = 0.0
        vencidas_31_60 = 0.0
        vencidas_mas_60 = 0.0
        total_monto = 0.0

        items_classified = []

        for d in docs:
            monto = float(d["total_amount"])
            total_monto += monto
            
            # Fecha vencimiento (o emisión + 30 días si no tiene fecha explícita)
            venc_str = d.get("expiration_date")
            try:
                if venc_str:
                    venc_date = datetime.date.fromisoformat(venc_str)
                else:
                    emis_date = datetime.date.fromisoformat(d["emission_date"][:10])
                    venc_date = emis_date + datetime.timedelta(days=30)
            except Exception:
                venc_date = today

            dias_dif = (venc_date - today).days

            if dias_dif > 7:
                estado_plazo = "AL_DIA"
                al_dia += monto
            elif 0 <= dias_dif <= 7:
                estado_plazo = "POR_VENCER_7D"
                por_vencer_7d += monto
            elif -30 <= dias_dif < 0:
                estado_plazo = "VENCIDA_1_30"
                vencidas_1_30 += monto
            elif -60 <= dias_dif < -30:
                estado_plazo = "VENCIDA_31_60"
                vencidas_31_60 += monto
            else:
                estado_plazo = "VENCIDA_60_MAS"
                vencidas_mas_60 += monto

            doc_copy = dict(d)
            doc_copy["dias_restantes"] = dias_dif
            doc_copy["estado_plazo"] = estado_plazo
            doc_copy["vencimiento_calculado"] = venc_date.isoformat()
            items_classified.append(doc_copy)

        return {
            "total_monto": round(total_monto),
            "cantidad_documentos": len(docs),
            "al_dia": round(al_dia),
            "por_vencer_7d": round(por_vencer_7d),
            "vencidas_1_30": round(vencidas_1_30),
            "vencidas_31_60": round(vencidas_31_60),
            "vencidas_mas_60": round(vencidas_mas_60),
            "items": items_classified
        }

    return {
        "cxc": classify_docs(cxc_docs),
        "cxp": classify_docs(cxp_docs)
    }

def get_counterparty_ledger(rut: str) -> Dict[str, Any]:
    """
    Ficha consolidada por Proveedor o Cliente:
    Muestra total facturado, pagos/abonos aplicados y saldo pendiente en cuenta corriente.
    """
    rut_clean = rut.replace(".", "").replace("-", "").strip().upper()

    dtes = query_all("""
        SELECT * FROM dte_documents 
        WHERE replace(replace(rut_receptor, '.', ''), '-', '') = ?
           OR replace(replace(rut_emisor, '.', ''), '-', '') = ?
        ORDER BY emission_date DESC
    """, (rut_clean, rut_clean))

    total_facturado = sum(d["total_amount"] for d in dtes)
    total_conciliado = sum(d["total_amount"] for d in dtes if d["is_reconciled"] == 1)
    saldo_pendiente = total_facturado - total_conciliado

    # Obtener nombre
    nombre = "Contraparte"
    for d in dtes:
        if d["direction"] == 'EMITIDO':
            nombre = d["razon_social_receptor"]
            break
        else:
            nombre = d["razon_social_emisor"]
            break

    return {
        "rut": rut,
        "razon_social": nombre,
        "total_facturado": round(total_facturado),
        "total_conciliado": round(total_conciliado),
        "saldo_pendiente": round(saldo_pendiente),
        "documentos": dtes
    }
