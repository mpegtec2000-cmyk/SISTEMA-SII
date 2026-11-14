import os
import glob
import re
import datetime
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from app import database
from app.database import query_all, query_one, execute_insert, execute_commit, ensure_tenant, DB_DIR
from app.models import CompanyModel, formatear_rut, rut_valido_formato

router = APIRouter(prefix="/api/companies", tags=["Empresas"])

from app.services.branding import LOGO_DIR, company_logo_path  # noqa: E402
_IMG_EXT = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}


@router.get("")
@router.get("/")
def get_companies():
    return query_all("SELECT * FROM companies ORDER BY is_default DESC, razon_social ASC")


# ------------------------------------------------------------------ Bóveda Legal y Laboral
VAULT_DIR = os.path.join(DB_DIR, "uploads", "vault")
os.makedirs(VAULT_DIR, exist_ok=True)

@router.get("/legal-vault/all")
@router.get("/legal-vault")
def get_legal_vault():
    cid = database.active_company_id()
    return query_all("SELECT * FROM company_legal_vault WHERE company_id = ? ORDER BY id DESC", (cid,))


@router.post("/legal-vault")
async def upload_legal_vault_document(
    doc_code: str = Form(...),
    title: str = Form(...),
    expiration_date: Optional[str] = Form(None),
    file: UploadFile = File(...)
):
    cid = database.active_company_id()
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="Debe adjuntar un archivo (PDF o imagen)")

    ext = os.path.splitext(file.filename)[1].lower()
    safe_name = re.sub(r"[^\w\-.]+", "_", file.filename)
    stored_name = f"vault_c{cid}_{doc_code.upper()}_{datetime.date.today():%Y%m%d}_{safe_name}"
    filepath = os.path.join(VAULT_DIR, stored_name)

    content = await file.read()
    with open(filepath, "wb") as f:
        f.write(content)

    # Si ya existía un documento para ese doc_code, se actualiza o archiva
    prev = query_one("SELECT id FROM company_legal_vault WHERE company_id = ? AND doc_code = ?", (cid, doc_code.upper()))
    if prev:
        execute_commit("""
            UPDATE company_legal_vault
            SET title = ?, file_path = ?, original_filename = ?, expiration_date = ?, status = 'VIGENTE', updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (title, filepath, file.filename, expiration_date, prev["id"]))
        vault_id = prev["id"]
    else:
        vault_id = execute_insert("""
            INSERT INTO company_legal_vault (company_id, doc_code, title, file_path, original_filename, expiration_date, status)
            VALUES (?, ?, ?, ?, ?, ?, 'VIGENTE')
        """, (cid, doc_code.upper(), title, filepath, file.filename, expiration_date))

    return {"message": "Documento guardado en la Bóveda Central", "id": vault_id, "doc_code": doc_code.upper()}


@router.delete("/legal-vault/{item_id}")
def delete_legal_vault_document(item_id: int):
    cid = database.active_company_id()
    doc = query_one("SELECT * FROM company_legal_vault WHERE id = ? AND company_id = ?", (item_id, cid))
    if not doc:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    if doc.get("file_path") and os.path.exists(doc["file_path"]):
        try:
            os.remove(doc["file_path"])
        except Exception:
            pass
    execute_commit("DELETE FROM company_legal_vault WHERE id = ?", (item_id,))
    return {"message": "Documento eliminado de la Bóveda Central"}


@router.get("/legal-vault/{item_id}/download")
def download_legal_vault_document(item_id: int):
    cid = database.active_company_id()
    doc = query_one("SELECT * FROM company_legal_vault WHERE id = ? AND company_id = ?", (item_id, cid))
    if not doc or not doc.get("file_path") or not os.path.exists(doc["file_path"]):
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    return FileResponse(doc["file_path"], filename=doc.get("original_filename") or os.path.basename(doc["file_path"]))


@router.get("/{company_id}")
def get_company(company_id: int):
    comp = query_one("SELECT * FROM companies WHERE id = ?", (company_id,))
    if not comp:
        raise HTTPException(status_code=404, detail="Empresa no encontrada")
    return comp

def _validate_company(data: CompanyModel):
    if not (data.razon_social or "").strip():
        raise HTTPException(status_code=400, detail="Ingresa la razón social")
    if not rut_valido_formato(data.rut):
        raise HTTPException(status_code=400, detail="Formato de RUT no válido")
    em = (data.email or "").strip()
    if em and not __import__("re").fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", em):
        raise HTTPException(status_code=400, detail="Ingresa un correo válido")


@router.post("")
@router.post("/")
def create_company(data: CompanyModel):
    _validate_company(data)
    rut_fmt = formatear_rut(data.rut)
    dup = query_one("SELECT id FROM companies WHERE rut = ?", (rut_fmt,))
    if dup:  # reintento del asistente: actualiza en lugar de fallar por RUT duplicado
        update_company(dup["id"], data)
        return {"message": "Empresa actualizada", "id": dup["id"]}
    comp_id = execute_insert("""
        INSERT INTO companies (
            rut, razon_social, giro, direccion, comuna, ciudad,
            telefono, email, logo_url, ppm_rate, is_default
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        rut_fmt, data.razon_social, data.giro, data.direccion, data.comuna, data.ciudad,
        data.telefono, data.email, data.logo_url, data.ppm_rate, data.is_default
    ))
    database._first_company_id = None  # la primera empresa vive en la BD maestra
    ensure_tenant(comp_id)
    return {"message": "Empresa creada exitosamente", "id": comp_id}


@router.post("/{company_id}/logo")
async def upload_logo(company_id: int, file: UploadFile = File(...)):
    if not query_one("SELECT id FROM companies WHERE id = ?", (company_id,)):
        raise HTTPException(status_code=404, detail="Empresa no encontrada")
    ext = _IMG_EXT.get((file.content_type or "").lower())
    if not ext:
        raise HTTPException(status_code=400, detail="El logo debe ser PNG, JPG o WEBP")
    content = await file.read()
    if not content or len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Logo vacío o mayor a 5 MB")
    os.makedirs(LOGO_DIR, exist_ok=True)
    for old in glob.glob(os.path.join(LOGO_DIR, f"{company_id}.*")):
        os.remove(old)
    with open(os.path.join(LOGO_DIR, f"{company_id}{ext}"), "wb") as f:
        f.write(content)
    url = f"/api/companies/{company_id}/logo"
    execute_commit("UPDATE companies SET logo_url = ? WHERE id = ?", (url, company_id))
    return {"message": "Logo guardado", "logo_url": url}


@router.get("/{company_id}/logo")
def get_logo(company_id: int):
    p = company_logo_path(company_id)
    if not p:
        raise HTTPException(status_code=404, detail="Sin logo")
    return FileResponse(p)

@router.put("/{company_id}")
def update_company(company_id: int, data: CompanyModel):
    _validate_company(data)
    rut_fmt = formatear_rut(data.rut)
    execute_commit("""
        UPDATE companies SET
            rut = ?, razon_social = ?, giro = ?, direccion = ?, comuna = ?, ciudad = ?,
            telefono = ?, email = ?, logo_url = ?, ppm_rate = ?, is_default = ?
        WHERE id = ?
    """, (
        rut_fmt, data.razon_social, data.giro, data.direccion, data.comuna, data.ciudad,
        data.telefono, data.email, data.logo_url, data.ppm_rate, data.is_default, company_id
    ))
    ensure_tenant(company_id)
    return {"message": "Empresa actualizada"}

@router.post("/{company_id}/set-default")
def set_default_company(company_id: int):
    execute_commit("UPDATE companies SET is_default = 0")
    execute_commit("UPDATE companies SET is_default = 1 WHERE id = ?", (company_id,))
    return {"message": "Empresa establecida como predeterminada"}




