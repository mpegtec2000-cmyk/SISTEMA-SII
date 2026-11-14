import json
from fastapi import APIRouter, HTTPException
from typing import List, Dict, Any
from app.database import query_all, query_one, execute_insert, execute_commit
from app.models import TenderDocumentModel, formatear_rut

router = APIRouter(prefix="/api/tenders", tags=["Licitaciones"])

@router.get("")
@router.get("/")
def get_tenders():
    """
    Retorna las carpetas correspondientes a Mercado Público con su información de licitación.
    """
    return query_all("""
        SELECT f.*, 
            (SELECT COUNT(*) FROM tender_documents d WHERE d.folder_id = f.id) as docs_count,
            (SELECT COUNT(*) FROM tender_documents d WHERE d.folder_id = f.id AND d.status = 'FIRMADO') as docs_firmados_count
        FROM business_folders f 
        WHERE f.type = 'MERCADO_PUBLICO' 
        ORDER BY f.id DESC
    """)

@router.get("/folders/{folder_id}/documents")
def get_folder_documents(folder_id: int):
    docs = query_all("SELECT * FROM tender_documents WHERE folder_id = ? ORDER BY id ASC", (folder_id,))
    return docs

@router.get("/documents/{doc_id}")
def get_document(doc_id: int):
    doc = query_one("SELECT * FROM tender_documents WHERE id = ?", (doc_id,))
    if not doc:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    return doc

@router.post("/documents")
def create_document(data: TenderDocumentModel):
    doc_id = execute_insert("""
        INSERT INTO tender_documents (
            folder_id, name, doc_type, original_filename, form_data_json, status
        ) VALUES (?, ?, ?, ?, ?, ?)
    """, (
        data.folder_id, data.name, data.doc_type, data.original_filename,
        data.form_data_json or "{}", data.status
    ))
    return {"message": "Documento agregado", "id": doc_id}

@router.put("/documents/{doc_id}/form-data")
def update_document_form(doc_id: int, payload: Dict[str, Any]):
    form_data = payload.get("form_data", {})
    status = payload.get("status", "COMPLETADO")
    form_json = json.dumps(form_data, ensure_ascii=False) if isinstance(form_data, dict) else str(form_data)

    execute_commit("""
        UPDATE tender_documents SET
            form_data_json = ?,
            status = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    """, (form_json, status, doc_id))
    return {"message": "Campos del documento actualizados"}

@router.post("/documents/{doc_id}/sign")
def sign_document(doc_id: int, payload: Dict[str, Any]):
    signature_data_url = payload.get("signature_data_url")
    signer_name = payload.get("signer_name", "Representante Legal")
    signer_rut = formatear_rut(payload.get("signer_rut", ""))

    if not signature_data_url:
        raise HTTPException(status_code=400, detail="Firma requerida")

    execute_commit("""
        UPDATE tender_documents SET
            signature_data_url = ?,
            signer_name = ?,
            signer_rut = ?,
            status = 'FIRMADO',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    """, (signature_data_url, signer_name, signer_rut, doc_id))

    return {"message": "Documento firmado y sellado exitosamente"}
