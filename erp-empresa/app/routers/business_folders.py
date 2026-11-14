import os
import re
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from typing import List, Dict, Any, Optional
from app.database import query_all, query_one, execute_insert, execute_commit, DB_DIR, tenant_file_prefix, active_company_id
from app.models import BusinessFolderModel, FolderExpenseModel, formatear_rut
from app.services.costing_service import calculate_folder_financials, get_all_folders_summary
from app.services.document_extractor_service import extract_products_from_file, parse_text_for_products

router = APIRouter(prefix="/api/folders", tags=["Carpetas de Negocio y Licitaciones"])

@router.get("")
@router.get("/")
def get_folders():
    """
    Retorna todas las Carpetas de Negocio (Mercado Público y Privadas) con métricas financieras y de avance.
    """
    return get_all_folders_summary()

@router.get("/{folder_id}")
def get_folder_detail(folder_id: int):
    financials = calculate_folder_financials(folder_id)
    if not financials:
        raise HTTPException(status_code=404, detail="Carpeta no encontrada")

    folder = query_one("SELECT * FROM business_folders WHERE id = ?", (folder_id,))
    dtes_emitidos = query_all("SELECT * FROM dte_documents WHERE folder_id = ? AND direction = 'EMITIDO' ORDER BY emission_date DESC", (folder_id,))
    dtes_recibidos = query_all("SELECT * FROM dte_documents WHERE folder_id = ? AND direction = 'RECIBIDO' ORDER BY emission_date DESC", (folder_id,))
    gastos = query_all("SELECT * FROM folder_expenses WHERE folder_id = ? ORDER BY date DESC", (folder_id,))
    cotizaciones = query_all("SELECT * FROM quotations WHERE folder_id = ? ORDER BY date DESC", (folder_id,))
    documentos_licitacion = query_all("SELECT * FROM tender_documents WHERE folder_id = ? ORDER BY id DESC", (folder_id,))
    requested_items = query_all("SELECT * FROM folder_requested_items WHERE folder_id = ? ORDER BY item_number ASC, id ASC", (folder_id,))

    return {
        "folder": folder,
        "financials": financials,
        "dtes_emitidos": dtes_emitidos,
        "dtes_recibidos": dtes_recibidos,
        "gastos": gastos,
        "cotizaciones": cotizaciones,
        "documentos_licitacion": documentos_licitacion,
        "requested_items": requested_items
    }

@router.post("")
@router.post("/")
def create_folder(data: BusinessFolderModel):
    code = data.code
    if not code:
        # correlativo robusto: mayor número existente + 1 (no se repite aunque se hayan borrado carpetas)
        nums = [int(m.group(1)) for r in query_all("SELECT code FROM business_folders")
                for m in [re.search(r"(\d+)$", r["code"] or "")] if m]
        code = f"CN-2026-{(max(nums) if nums else 0) + 1:03d}"

    rut_fmt = formatear_rut(data.client_rut)
    folder_id = execute_insert("""
        INSERT INTO business_folders (
            code, title, client_name, client_rut, status, type,
            tender_id, tender_closing_date, budget_amount, company_id,
            target_margin_pct, notes, progress_pct
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 25)
    """, (
        code, data.title, data.client_name, rut_fmt, data.status, data.type,
        data.tender_id, data.tender_closing_date, data.budget_amount,
        data.company_id or active_company_id(), data.target_margin_pct, data.notes
    ))
    return {"message": "Negocio creado exitosamente", "id": folder_id, "code": code}

@router.put("/{folder_id}/status")
def update_folder_status(folder_id: int, payload: Dict[str, Any]):
    new_status = payload.get("status")
    progress_pct = payload.get("progress_pct")
    if not new_status:
        raise HTTPException(status_code=400, detail="Estado requerido")
    
    if progress_pct is None:
        status_map = {
            "EN_PREPARACION": 20,
            "ENVIADA": 45,
            "ADJUDICADA": 65,
            "EN_EJECUCION": 85,
            "CERRADA": 100,
            "PERDIDA": 100
        }
        progress_pct = status_map.get(new_status, 50)

    awarded_amount = payload.get("awarded_amount")
    oc_number = payload.get("oc_number")

    if awarded_amount is not None:
        execute_commit(
            "UPDATE business_folders SET status = ?, progress_pct = ?, awarded_amount = ?, oc_number = COALESCE(?, oc_number), updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (new_status, int(progress_pct), float(awarded_amount or 0), oc_number, folder_id)
        )
    else:
        execute_commit(
            "UPDATE business_folders SET status = ?, progress_pct = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (new_status, int(progress_pct), folder_id)
        )
    return {"message": "Avance y estado del negocio actualizados", "status": new_status, "progress_pct": progress_pct}

@router.post("/{folder_id}/upload-and-extract")
async def upload_and_extract_products(
    folder_id: int,
    file: UploadFile = File(...),
    doc_type: str = Form("BASES_TECNICAS")
):
    """
    Adjunta un documento (PDF, Excel, Word, TXT) al negocio (público o privado),
    lo guarda en el gestor documental y extrae automáticamente los productos solicitados
    junto con sus detalles y especificaciones técnicas.
    """
    folder = query_one("SELECT * FROM business_folders WHERE id = ?", (folder_id,))
    if not folder:
        raise HTTPException(status_code=404, detail="Negocio no encontrado")

    file_bytes = await file.read()
    filename = file.filename or "Documento_Especificaciones.pdf"

    # Guardar archivo físico en /data/uploads
    uploads_dir = os.path.join(DB_DIR, "uploads")
    os.makedirs(uploads_dir, exist_ok=True)
    safe_path = os.path.join(uploads_dir, f"{tenant_file_prefix()}folder_{folder_id}_{filename}")
    with open(safe_path, "wb") as f_out:
        f_out.write(file_bytes)

    # Registrar en tender_documents (sirve tanto para Mercado Público como Privados)
    doc_id = execute_insert("""
        INSERT INTO tender_documents (
            folder_id, name, doc_type, original_filename, file_path, form_data_json, status
        ) VALUES (?, ?, ?, ?, ?, '{}', 'COMPLETADO')
    """, (
        folder_id,
        f"Documento Técnico: {filename}",
        doc_type,
        filename,
        safe_path
    ))

    # Extraer automáticamente productos y especificaciones técnicas del archivo
    extracted_items = extract_products_from_file(file_bytes, filename)

    # Obtener correlativo actual de ítems en la carpeta
    existing_count = query_one("SELECT COUNT(*) as c FROM folder_requested_items WHERE folder_id = ?", (folder_id,))["c"]

    saved_items = []
    for idx, item in enumerate(extracted_items, start=existing_count + 1):
        item_id = execute_insert("""
            INSERT INTO folder_requested_items (
                folder_id, item_number, product_name, technical_specs,
                quantity, unit, estimated_cost, offered_price,
                matched_sku, source_doc, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            folder_id,
            idx,
            item["product_name"],
            item["technical_specs"],
            item["quantity"],
            item["unit"],
            item["estimated_cost"],
            item["offered_price"],
            item["matched_sku"],
            filename,
            item["status"]
        ))
        item["id"] = item_id
        saved_items.append(item)

    return {
        "message": f"Documento '{filename}' adjuntado y leído con éxito: {len(saved_items)} productos y especificaciones técnicas detectados.",
        "document_id": doc_id,
        "extracted_count": len(saved_items),
        "items": saved_items
    }

@router.post("/{folder_id}/extract-from-text")
def extract_products_from_raw_text(folder_id: int, payload: Dict[str, Any]):
    """
    Extrae automáticamente productos y especificaciones técnicas a partir de texto pegado
    (pliego de condiciones, correo de cliente privado o ficha de licitación).
    """
    raw_text = payload.get("text", "").strip()
    doc_title = payload.get("doc_title", "Pliego Técnico / Solicitud de Cliente")
    if not raw_text:
        raise HTTPException(status_code=400, detail="Texto vacío")

    # Guardar documento de respaldo
    doc_id = execute_insert("""
        INSERT INTO tender_documents (
            folder_id, name, doc_type, original_filename, form_data_json, status
        ) VALUES (?, ?, 'BASES_TECNICAS', 'Texto_Especificaciones.txt', '{}', 'COMPLETADO')
    """, (folder_id, doc_title))

    extracted_items = parse_text_for_products(raw_text, doc_title)
    if not extracted_items:
        # Si el usuario pegó una línea libre, crearla como ítem con su especificación
        extracted_items = [{
            "item_number": 1,
            "product_name": raw_text[:80],
            "technical_specs": raw_text,
            "quantity": 1,
            "unit": "UND",
            "estimated_cost": 450000,
            "offered_price": 680000,
            "matched_sku": "COTIZAR-PROV",
            "source_doc": doc_title,
            "status": "EXTRAIDO_TEXTO"
        }]

    existing_count = query_one("SELECT COUNT(*) as c FROM folder_requested_items WHERE folder_id = ?", (folder_id,))["c"]
    saved_items = []
    for idx, item in enumerate(extracted_items, start=existing_count + 1):
        item_id = execute_insert("""
            INSERT INTO folder_requested_items (
                folder_id, item_number, product_name, technical_specs,
                quantity, unit, estimated_cost, offered_price,
                matched_sku, source_doc, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            folder_id,
            idx,
            item["product_name"],
            item["technical_specs"],
            item["quantity"],
            item["unit"],
            item["estimated_cost"],
            item["offered_price"],
            item["matched_sku"],
            doc_title,
            item["status"]
        ))
        item["id"] = item_id
        saved_items.append(item)

    return {
        "message": f"Se extrajeron {len(saved_items)} productos con sus especificaciones técnicas.",
        "document_id": doc_id,
        "items": saved_items
    }

@router.post("/{folder_id}/requested-items")
def add_requested_item_manual(folder_id: int, payload: Dict[str, Any]):
    existing_count = query_one("SELECT COUNT(*) as c FROM folder_requested_items WHERE folder_id = ?", (folder_id,))["c"]
    item_id = execute_insert("""
        INSERT INTO folder_requested_items (
            folder_id, item_number, product_name, technical_specs,
            quantity, unit, estimated_cost, offered_price,
            matched_sku, source_doc, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL')
    """, (
        folder_id,
        existing_count + 1,
        payload.get("product_name", "Producto Solicitado"),
        payload.get("technical_specs", "Sin especificaciones adicionales"),
        float(payload.get("quantity", 1)),
        payload.get("unit", "UND"),
        float(payload.get("estimated_cost", 0)),
        float(payload.get("offered_price", 0)),
        payload.get("matched_sku", "MANUAL"),
        payload.get("source_doc", "Ingreso Manual")
    ))
    return {"message": "Producto agregado al negocio", "id": item_id}

@router.delete("/requested-items/{item_id}")
def delete_requested_item(item_id: int):
    execute_commit("DELETE FROM folder_requested_items WHERE id = ?", (item_id,))
    return {"message": "Producto solicitado eliminado"}

@router.post("/expenses")
def add_folder_expense(data: FolderExpenseModel):
    expense_id = execute_insert("""
        INSERT INTO folder_expenses (
            folder_id, description, category, amount, date, doc_number, supplier_rut, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        data.folder_id, data.description, data.category, data.amount,
        data.date, data.doc_number, formatear_rut(data.supplier_rut or ""), data.notes
    ))
    return {"message": "Gasto registrado exitosamente", "id": expense_id}

@router.delete("/expenses/{expense_id}")
def delete_folder_expense(expense_id: int):
    execute_commit("DELETE FROM folder_expenses WHERE id = ?", (expense_id,))
    return {"message": "Gasto eliminado"}


def delete_folder_by_id(folder_id: int) -> Dict[str, Any]:
    folder = query_one("SELECT * FROM business_folders WHERE id = ?", (folder_id,))
    if not folder:
        raise HTTPException(status_code=404, detail="Carpeta no encontrada")

    # 1. Eliminar archivos físicos adjuntos a tender_documents
    docs = query_all("SELECT file_path, signed_file_path FROM tender_documents WHERE folder_id = ?", (folder_id,))
    for d in docs:
        for p in (d.get("file_path"), d.get("signed_file_path")):
            if p and os.path.exists(p):
                try:
                    os.remove(p)
                except Exception:
                    pass

    # 2. Eliminar registros de tablas dependientes
    execute_commit("DELETE FROM tender_documents WHERE folder_id = ?", (folder_id,))
    execute_commit("DELETE FROM folder_requested_items WHERE folder_id = ?", (folder_id,))
    execute_commit("DELETE FROM folder_expenses WHERE folder_id = ?", (folder_id,))
    execute_commit("DELETE FROM folder_checklist_items WHERE folder_id = ?", (folder_id,))
    execute_commit("DELETE FROM folder_milestones WHERE folder_id = ?", (folder_id,))
    execute_commit("DELETE FROM folder_risks WHERE folder_id = ?", (folder_id,))
    execute_commit("DELETE FROM folder_evaluation_criteria WHERE folder_id = ?", (folder_id,))
    execute_commit("DELETE FROM folder_analysis_jobs WHERE folder_id = ?", (folder_id,))
    execute_commit("DELETE FROM supplier_quote_lines WHERE folder_id = ?", (folder_id,))

    # 3. Desvincular cotizaciones, DTEs, transacciones bancarias y documentos comerciales
    execute_commit("UPDATE quotations SET folder_id = NULL WHERE folder_id = ?", (folder_id,))
    execute_commit("UPDATE dte_documents SET folder_id = NULL WHERE folder_id = ?", (folder_id,))
    execute_commit("UPDATE bank_transactions SET folder_id = NULL WHERE folder_id = ?", (folder_id,))
    execute_commit("UPDATE commercial_docs SET folder_id = NULL WHERE folder_id = ?", (folder_id,))

    # 4. Eliminar la carpeta de la base de datos
    execute_commit("DELETE FROM business_folders WHERE id = ?", (folder_id,))

    return {"message": "Carpeta de negocio eliminada correctamente", "id": folder_id, "title": folder.get("title")}


@router.delete("/{folder_id}")
def delete_folder(folder_id: int):
    """Elimina definitivamente una Carpeta de Negocio y limpia todos sus registros y archivos asociados."""
    return delete_folder_by_id(folder_id)

