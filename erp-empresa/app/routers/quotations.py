from fastapi import APIRouter, HTTPException
from typing import List, Dict, Any
from app.database import query_all, query_one, execute_insert, execute_commit
from app.models import QuotationModel, formatear_rut
from app.services.inventory_service import reserve_inventory_for_quotation

router = APIRouter(prefix="/api/quotations", tags=["Cotizaciones"])

@router.get("")
@router.get("/")
def get_quotations():
    return query_all("""
        SELECT q.*, c.razon_social as company_name, f.code as folder_code,
            (SELECT COUNT(*) FROM quotation_items qi WHERE qi.quotation_id = q.id) as items_count
        FROM quotations q
        JOIN companies c ON q.company_id = c.id
        LEFT JOIN business_folders f ON q.folder_id = f.id
        ORDER BY q.id DESC
    """)

@router.get("/{quotation_id}")
def get_quotation(quotation_id: int):
    q = query_one("""
        SELECT q.*, c.razon_social as company_name, c.rut as company_rut, c.direccion as company_address,
               c.email as company_email, c.telefono as company_phone, c.giro as company_giro,
               f.code as folder_code, f.title as folder_title
        FROM quotations q
        JOIN companies c ON q.company_id = c.id
        LEFT JOIN business_folders f ON q.folder_id = f.id
        WHERE q.id = ?
    """, (quotation_id,))
    if not q:
        raise HTTPException(status_code=404, detail="Cotización no encontrada")

    items = query_all("SELECT * FROM quotation_items WHERE quotation_id = ? ORDER BY id ASC", (quotation_id,))
    q["items"] = items
    return q

@router.post("")
@router.post("/")
def create_quotation(data: QuotationModel):
    # Generar folio si no viene
    folio = data.folio
    if not folio:
        count = query_one("SELECT COUNT(*) as c FROM quotations")["c"] + 1
        folio = f"COT-2026-{count:04d}"

    rut_fmt = formatear_rut(data.client_rut)
    q_id = execute_insert("""
        INSERT INTO quotations (
            folio, folder_id, company_id, client_name, client_rut,
            client_address, client_contact, client_email, date, validity_days,
            currency, payment_terms, delivery_time, subtotal, discount_amount,
            net_amount, tax_amount, total_amount, notes, type, tender_id,
            warranty_doc, status, signature_data_url, signer_name, signer_rut
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        folio, data.folder_id, data.company_id, data.client_name, rut_fmt,
        data.client_address, data.client_contact, data.client_email, data.date,
        data.validity_days, data.currency, data.payment_terms, data.delivery_time,
        data.subtotal, data.discount_amount, data.net_amount, data.tax_amount,
        data.total_amount, data.notes, data.type, data.tender_id, data.warranty_doc,
        data.status, data.signature_data_url, data.signer_name, formatear_rut(data.signer_rut or "")
    ))

    # Guardar ítems
    for it in data.items:
        execute_insert("""
            INSERT INTO quotation_items (
                quotation_id, sku, description, unit, quantity,
                unit_cost, unit_price, discount_pct, margin_pct, subtotal
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            q_id, it.sku, it.description, it.unit, it.quantity,
            it.unit_cost, it.unit_price, it.discount_pct, it.margin_pct, it.subtotal
        ))

    # Si se crea como ACEPTADA, reservar inventario automáticamente
    if data.status == "ACEPTADA":
        reserve_inventory_for_quotation(q_id)

    return {"message": "Cotización creada exitosamente", "id": q_id, "folio": folio}

@router.put("/{quotation_id}/status")
def update_quotation_status(quotation_id: int, payload: Dict[str, str]):
    new_status = payload.get("status")
    if not new_status:
        raise HTTPException(status_code=400, detail="Estado requerido")

    prev = query_one("SELECT status FROM quotations WHERE id = ?", (quotation_id,))
    execute_commit("UPDATE quotations SET status = ? WHERE id = ?", (new_status, quotation_id))

    # Si pasa a ACEPTADA y antes no lo estaba, reservar inventario
    if new_status == "ACEPTADA" and prev and prev["status"] != "ACEPTADA":
        reserve_inventory_for_quotation(quotation_id)

    return {"message": f"Estado cambiado a {new_status}"}
