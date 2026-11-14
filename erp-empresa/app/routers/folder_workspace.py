"""
API del Espacio de Trabajo de la Carpeta de Negocio (todo en uno):
documentos + análisis IA + checklist + hitos + riesgos + productos + cotizador integrado + firma.
"""
import io
import json
import os
import re
import zipfile
from datetime import date, datetime
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Response
from fastapi.responses import FileResponse

from app.database import DB_DIR, query_all, query_one, execute_insert, execute_commit, tenant_file_prefix, active_company_id
from app.models import formatear_rut
from app.services import ai_provider, document_pipeline as pipeline
from app.services import folder_documents_export as exporter
from app.services.costing_service import calculate_folder_financials
from app.services.inventory_service import reserve_inventory_for_quotation

router = APIRouter(prefix="/api/workspace", tags=["Espacio de Trabajo de la Carpeta"])

ALLOWED_EXT = {".pdf", ".docx", ".xlsx", ".xls", ".xlsm", ".txt", ".csv"}


STANDARD_CHILECOMPRA_CHECKLIST = [
    # 1. Administrativos
    {
        "category": "ADMINISTRATIVO",
        "title": "Patente Municipal al día",
        "detail": "Patente comercial vigente emitida por la Municipalidad correspondiente al domicilio legal del oferente.",
        "is_mandatory": 1
    },
    {
        "category": "ADMINISTRATIVO",
        "title": "Certificado de Estatutos y Vigencia de la Sociedad",
        "detail": "Registro Electrónico de Empresas y Sociedades (Tu Empresa en un Día) o Certificado de Vigencia del CBR (antigüedad no superior a 60-90 días).",
        "is_mandatory": 1
    },
    {
        "category": "ADMINISTRATIVO",
        "title": "Cédula de Identidad del Representante Legal",
        "detail": "Copia digital legible por ambos lados de la cédula de identidad del o los representantes legales vigentes.",
        "is_mandatory": 1
    },
    {
        "category": "ADMINISTRATIVO",
        "title": "Certificado F30 / F30-1 (Dirección del Trabajo)",
        "detail": "Certificado de Antecedentes Laborales y Previsionales de la Dirección del Trabajo (no registrar multas ni deudas previsionales).",
        "is_mandatory": 1
    },
    {
        "category": "ADMINISTRATIVO",
        "title": "Certificado de Habilidad ChileCompra",
        "detail": "Certificado descargado desde el Registro de Proveedores de Mercado Público que acredita estar hábil para contratar con el Estado.",
        "is_mandatory": 1
    },
    {
        "category": "ADMINISTRATIVO",
        "title": "Acreditación de Experiencia Comercial / Técnica",
        "detail": "Facturas emitidas, órdenes de compra aceptadas o certificados de clientes anteriores que acrediten experiencia en el rubro.",
        "is_mandatory": 0
    },

    # 2. Técnicos
    {
        "category": "TECNICO",
        "title": "Fichas Técnicas de Productos Solicitados",
        "detail": "Ficha técnica oficial de fábrica o confección detallando composición, gramaje, costuras y especificaciones por cada ítem ofertado.",
        "is_mandatory": 1
    },
    {
        "category": "TECNICO",
        "title": "Acreditación Norma EN ISO 20471 / NCh 3254 (Alta Visibilidad)",
        "detail": "Informe de ensayo o certificación de laboratorio para material reflectante y fondo fluorescente en prendas de alta visibilidad.",
        "is_mandatory": 1
    },
    {
        "category": "TECNICO",
        "title": "Acreditación Norma EN ISO 11612 / EN 1149 (Ignífugo y Antiestático)",
        "detail": "Certificación de protección térmica contra calor/llama y propiedades electrostáticas para prendas de protección técnica.",
        "is_mandatory": 1
    },
    {
        "category": "TECNICO",
        "title": "Certificados de Laboratorio Textil (Cesmec / Caltex / Lictex)",
        "detail": "Ensayos de tracción, solidez del color al lavado y frote, y resistencia al pilling emitidos por laboratorios acreditados.",
        "is_mandatory": 0
    },
    {
        "category": "TECNICO",
        "title": "Muestra Física y Rotulación",
        "detail": "Preparación y entrega física de prototipos o muestras requeridas por las bases técnicas en el plazo y lugar estipulados.",
        "is_mandatory": 0
    },

    # 3. Económicos
    {
        "category": "ECONOMICO",
        "title": "Formulario Anexo N° 3 - Oferta Económica Desglosada",
        "detail": "Formulario oficial de la oferta económica desglosada según requerimientos de las bases administrativas/técnicas.",
        "is_mandatory": 1
    },
    {
        "category": "ECONOMICO",
        "title": "Planilla de Precios Unitarios y Plazos de Entrega",
        "detail": "Detalle de precios unitarios netos en CLP, descuentos por volumen y plazos de entrega comprometidos.",
        "is_mandatory": 1
    },
    {
        "category": "ECONOMICO",
        "title": "Cotización / Propuesta Económica Formal",
        "detail": "Cotización membretada de la empresa oferente con desglose de valores netos, IVA, condiciones comerciales y vigencia.",
        "is_mandatory": 1
    },

    # 4. Requisitos para ofertar (obligatorio)
    {
        "category": "REQUISITO_OBLIGATORIO",
        "title": "Declaración de ausencia de conflicto de interés e inhabilidades por condenas",
        "detail": "Declaración jurada obligatoria según Ley N° 19.886 y directivas de ChileCompra sobre no registrar condenas ni conflictos de interés con la entidad compradora.",
        "is_mandatory": 1
    },
    {
        "category": "REQUISITO_OBLIGATORIO",
        "title": "Anexo N° 1 - Declaración Jurada Simple de Aceptación de Bases",
        "detail": "Declaración jurada firmada por el representante legal aceptando íntegramente las bases administrativas y técnicas de la licitación.",
        "is_mandatory": 1
    }
]


def ensure_standard_chilecompra_checklist(folder_id: int):
    existing = query_all("SELECT title FROM folder_checklist_items WHERE folder_id=?", (folder_id,))
    existing_titles = {c["title"].strip().lower() for c in existing}
    for item in STANDARD_CHILECOMPRA_CHECKLIST:
        if item["title"].strip().lower() not in existing_titles:
            execute_insert("""
                INSERT INTO folder_checklist_items (folder_id, category, title, detail, is_mandatory, status, source_doc)
                VALUES (?, ?, ?, ?, ?, 'PENDIENTE', 'Estándar ChileCompra')
            """, (folder_id, item["category"], item["title"], item["detail"], item.get("is_mandatory", 1)))
            existing_titles.add(item["title"].strip().lower())


def _folder_or_404(folder_id: int) -> Dict[str, Any]:
    f = query_one("SELECT * FROM business_folders WHERE id = ?", (folder_id,))
    if not f:
        raise HTTPException(status_code=404, detail="Carpeta no encontrada")
    return f


# ------------------------------------------------------------------ configuración de IA
@router.get("/ai-settings")
def get_ai_settings():
    return ai_provider.public_settings()


@router.put("/ai-settings")
def put_ai_settings(payload: Dict[str, Any]):
    return ai_provider.save_settings(payload)


@router.post("/ai-settings/test")
def test_ai_settings():
    return ai_provider.ping()


# ------------------------------------------------------------------ firma guardada
@router.get("/signer-profile")
def get_signer():
    p = query_one("SELECT * FROM signer_profiles ORDER BY is_default DESC, id DESC LIMIT 1") or {}
    comp = query_one("SELECT razon_social, rut FROM companies WHERE id=?", (active_company_id(),)) or {}
    p["company_name"] = comp.get("razon_social") or ""
    p["company_rut"] = comp.get("rut") or ""
    return p


@router.put("/signer-profile")
def put_signer(payload: Dict[str, Any]):
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Nombre del firmante requerido")
    cur = query_one("SELECT id FROM signer_profiles ORDER BY id DESC LIMIT 1")
    vals = (name, formatear_rut(payload.get("rut") or ""), payload.get("role") or "Representante Legal",
            payload.get("signature_data_url"), payload.get("stamp_data_url"))
    if cur:
        execute_commit("""UPDATE signer_profiles SET name=?, rut=?, role=?, signature_data_url=COALESCE(?, signature_data_url),
                          stamp_data_url=COALESCE(?, stamp_data_url) WHERE id=?""", vals + (cur["id"],))
    else:
        execute_insert("INSERT INTO signer_profiles (name, rut, role, signature_data_url, stamp_data_url) VALUES (?,?,?,?,?)", vals)
    return {"message": "Firma guardada"}


# ------------------------------------------------------------------ carga y análisis
@router.post("/{folder_id}/documents")
async def upload_documents(folder_id: int, files: List[UploadFile] = File(...), doc_type: str = Form("BASES")):
    _folder_or_404(folder_id)
    uploads = os.path.join(DB_DIR, "uploads")
    os.makedirs(uploads, exist_ok=True)
    jobs = []
    for up in files:
        filename = os.path.basename(up.filename or "documento.pdf")
        ext = os.path.splitext(filename.lower())[1]
        if ext not in ALLOWED_EXT:
            jobs.append({"filename": filename, "error": f"Formato {ext or '(sin extensión)'} no soportado. Use PDF, Word, Excel o TXT."})
            continue
        data = await up.read()
        if not data:
            jobs.append({"filename": filename, "error": "El archivo está vacío"})
            continue
        safe = re.sub(r"[^\w\-. ()]+", "_", filename)
        path = os.path.join(uploads, f"{tenant_file_prefix()}folder_{folder_id}_{safe}")
        with open(path, "wb") as f:
            f.write(data)
        is_annex = bool(re.search(r"(?i)\b(anexo|declaraci[oó]n|formulario|formato)\b|anexo[-_]|anexos", filename))
        is_decree = bool(re.search(r"(?i)\b(decreto|resoluci[oó]n|respuestas|aclaraci[oó]n|aclaraciones)\b", filename))
        actual_doc_type = "ANEXO" if is_annex else ("DECRETO" if is_decree else doc_type)
        actual_req_sig = 1 if is_annex else 0
        actual_status = "PENDIENTE" if is_annex else "COMPLETADO"

        doc_id = execute_insert("""
            INSERT INTO tender_documents (folder_id, name, doc_type, original_filename, file_path, form_data_json, status, requires_signature, detected_by_ai)
            VALUES (?, ?, ?, ?, ?, '{}', ?, ?, 0)
        """, (folder_id, filename, actual_doc_type, filename, path, actual_status, actual_req_sig))
        job_id = pipeline.create_job(folder_id, doc_id, filename)
        pipeline.start_job_async(job_id, folder_id, doc_id, path, filename)
        jobs.append({"filename": filename, "job_id": job_id, "document_id": doc_id})
    return {"jobs": jobs}


@router.post("/load-sample-bundle")
def load_sample_bundle(payload: Dict[str, Any] = None):
    """
    Carga automáticamente los documentos reales de ejemplo ubicados en D:\\FINANZIA\\documentos ejemplos
    dentro de una Carpeta Inteligente de Negocio y dispara el análisis documental con IA Gemini.
    """
    payload = payload or {}
    sample_dir = os.path.abspath(os.path.join(DB_DIR, "..", "..", "documentos ejemplos"))
    if not os.path.isdir(sample_dir):
        raise HTTPException(status_code=404, detail=f"No se encontró el directorio de documentos de ejemplo: {sample_dir}")

    files_in_dir = [
        f for f in sorted(os.listdir(sample_dir))
        if os.path.isfile(os.path.join(sample_dir, f)) and os.path.splitext(f.lower())[1] in ALLOWED_EXT
    ]
    if not files_in_dir:
        raise HTTPException(status_code=400, detail="No hay archivos compatibles en 'documentos ejemplos'")

    folder_id = payload.get("folder_id")
    if not folder_id:
        count_row = query_one("SELECT COUNT(*) as c FROM business_folders") or {"c": 0}
        code = f"CN-2026-{int(count_row['c']) + 1:03d}"
        comp = query_one("SELECT id FROM companies WHERE is_default = 1 LIMIT 1") or query_one("SELECT id FROM companies LIMIT 1")
        comp_id = comp["id"] if comp else 1
        folder_id = execute_insert("""
            INSERT INTO business_folders (
                code, title, client_name, client_rut, status, type, tender_id,
                tender_closing_date, budget_amount, company_id, progress_pct, target_margin_pct, notes
            ) VALUES (?, ?, ?, ?, 'EN_PREPARACION', 'MERCADO_PUBLICO', ?, ?, ?, ?, 35, 25.0, ?)
        """, (
            code,
            "Licitación REX N° 311 · Bases Administrativas, Técnicas y Anexos",
            "Organismo Público Licitante (REX N° 311)",
            "60.903.000-1",
            "REX-311-2026",
            date.today().isoformat(),
            12500000.0,
            comp_id,
            "Carpeta Inteligente generada desde el repositorio 'documentos ejemplos' con lectura automática de bases, anexos y certificados."
        ))
        ensure_standard_chilecompra_checklist(folder_id)

    uploads = os.path.join(DB_DIR, "uploads")
    os.makedirs(uploads, exist_ok=True)
    jobs = []
    for filename in files_in_dir:
        src_path = os.path.join(sample_dir, filename)
        with open(src_path, "rb") as rf:
            data = rf.read()
        if not data:
            continue
        safe = re.sub(r"[^\w\-. ()]+", "_", filename)
        dest_path = os.path.join(uploads, f"{tenant_file_prefix()}folder_{folder_id}_{safe}")
        with open(dest_path, "wb") as wf:
            wf.write(data)
        is_annex = bool(re.search(r"(?i)\b(anexo|declaraci[oó]n|formulario|formato)\b|anexo[-_]|anexos", filename))
        is_cert = bool(re.search(r"(?i)\b(certificado)\b", filename))
        actual_doc_type = "ANEXO" if is_annex else ("CERTIFICADO" if is_cert else "BASES")
        actual_req_sig = 1 if is_annex else 0
        actual_status = "PENDIENTE" if is_annex else "COMPLETADO"

        doc_id = execute_insert("""
            INSERT INTO tender_documents (folder_id, name, doc_type, original_filename, file_path, form_data_json, status, requires_signature, detected_by_ai)
            VALUES (?, ?, ?, ?, ?, '{}', ?, ?, 0)
        """, (folder_id, filename, actual_doc_type, filename, dest_path, actual_status, actual_req_sig))
        job_id = pipeline.create_job(folder_id, doc_id, filename)
        pipeline.start_job_async(job_id, folder_id, doc_id, dest_path, filename)
        jobs.append({"filename": filename, "job_id": job_id, "document_id": doc_id})

    return {
        "folder_id": folder_id,
        "files_loaded": len(jobs),
        "jobs": jobs,
        "message": f"Se cargaron {len(jobs)} documentos de ejemplo en la Carpeta Inteligente y se inició el análisis con IA."
    }


@router.post("/{folder_id}/analyze-text")
def analyze_pasted_text(folder_id: int, payload: Dict[str, Any]):
    _folder_or_404(folder_id)
    text = (payload.get("text") or "").strip()
    if len(text) < 20:
        raise HTTPException(status_code=400, detail="Pegue el texto de las bases o del requerimiento (mínimo 20 caracteres)")
    title = payload.get("title") or "Requerimiento (texto pegado)"
    doc_id = execute_insert("""
        INSERT INTO tender_documents (folder_id, name, doc_type, original_filename, form_data_json, status, extracted_text)
        VALUES (?, ?, 'BASES', ?, '{}', 'COMPLETADO', ?)
    """, (folder_id, title, title, text))
    result, label, warnings = ai_provider.analyze(None, "texto.txt", [(1, text)])
    summary = pipeline.persist_result(folder_id, doc_id, title, result, warnings)
    return {"message": summary, "provider": label, "warnings": warnings}


@router.get("/{folder_id}/analysis-status")
def analysis_status(folder_id: int):
    return query_all("SELECT * FROM folder_analysis_jobs WHERE folder_id = ? ORDER BY id DESC LIMIT 20", (folder_id,))


@router.post("/{folder_id}/reanalyze/{document_id}")
def reanalyze(folder_id: int, document_id: int):
    doc = query_one("SELECT * FROM tender_documents WHERE id=? AND folder_id=?", (document_id, folder_id))
    if not doc or not doc.get("file_path") or not os.path.exists(doc["file_path"]):
        raise HTTPException(status_code=404, detail="Archivo original no disponible")
    job_id = pipeline.create_job(folder_id, document_id, doc["original_filename"])
    pipeline.start_job_async(job_id, folder_id, document_id, doc["file_path"], doc["original_filename"])
    return {"job_id": job_id}


# ------------------------------------------------------------------ workspace completo
@router.get("/{folder_id}")
def get_workspace(folder_id: int):
    folder = _folder_or_404(folder_id)
    ensure_standard_chilecompra_checklist(folder_id)
    fin = calculate_folder_financials(folder_id)
    checklist = query_all("SELECT * FROM folder_checklist_items WHERE folder_id=? ORDER BY status='HECHO', category, id", (folder_id,))
    milestones = query_all("SELECT * FROM folder_milestones WHERE folder_id=? ORDER BY id", (folder_id,))
    risks = query_all("SELECT * FROM folder_risks WHERE folder_id=? ORDER BY CASE severity WHEN 'ALTA' THEN 0 WHEN 'MEDIA' THEN 1 ELSE 2 END, id", (folder_id,))
    items = query_all("SELECT * FROM folder_requested_items WHERE folder_id=? ORDER BY item_number, id", (folder_id,))
    docs = query_all("""SELECT id, folder_id, name, doc_type, original_filename, status, requires_signature, is_mandatory,
                               detected_by_ai, signer_name, signer_rut, (file_path IS NOT NULL AND file_path != '') AS has_file,
                               (signature_data_url IS NOT NULL AND signature_data_url != '') AS has_signature, updated_at
                        FROM tender_documents WHERE folder_id=? ORDER BY detected_by_ai, id""", (folder_id,))
    jobs = query_all("SELECT * FROM folder_analysis_jobs WHERE folder_id=? ORDER BY id DESC LIMIT 10", (folder_id,))
    quotation = None
    q = query_one("SELECT id FROM quotations WHERE folder_id=? AND status != 'RECHAZADA' ORDER BY id DESC LIMIT 1", (folder_id,))
    if q:
        quotation = _quotation_payload(q["id"])
    try:
        summary = json.loads(folder.get("analysis_summary") or "{}")
    except Exception:
        summary = {}
    criteria = query_all("SELECT * FROM folder_evaluation_criteria WHERE folder_id=? ORDER BY weight_pct DESC, id ASC", (folder_id,))
    return {
        "folder": folder, "financials": fin, "checklist": checklist, "milestones": milestones, "risks": risks,
        "criteria": criteria,
        "items": items, "documents": docs, "jobs": jobs, "quotation": quotation, "summary": summary,
        "dtes_emitidos": query_all("SELECT * FROM dte_documents WHERE folder_id=? AND direction='EMITIDO' ORDER BY emission_date DESC", (folder_id,)),
        "dtes_recibidos": query_all("SELECT * FROM dte_documents WHERE folder_id=? AND direction='RECIBIDO' ORDER BY emission_date DESC", (folder_id,)),
        "gastos": query_all("SELECT * FROM folder_expenses WHERE folder_id=? ORDER BY date DESC", (folder_id,)),
        "signer": query_one("SELECT id, name, rut, role, (signature_data_url IS NOT NULL AND signature_data_url != '') AS has_signature FROM signer_profiles ORDER BY id DESC LIMIT 1") or {},
        "ai": ai_provider.public_settings(),
    }


@router.put("/{folder_id}/awarded-amount")
def set_awarded_amount(folder_id: int, payload: Dict[str, Any]):
    _folder_or_404(folder_id)
    amount = float(payload.get("awarded_amount") or 0)
    oc_num = (payload.get("oc_number") or "").strip()
    execute_commit(
        "UPDATE business_folders SET awarded_amount=?, oc_number=COALESCE(?, oc_number), updated_at=CURRENT_TIMESTAMP WHERE id=?",
        (amount, oc_num or None, folder_id)
    )
    return {"message": "Monto de la Orden de Compra (OC) actualizado exitosamente", "awarded_amount": amount}


@router.post("/{folder_id}/reanalyze-all")
def reanalyze_all(folder_id: int):
    _folder_or_404(folder_id)
    docs = query_all("SELECT id, original_filename, file_path FROM tender_documents WHERE folder_id=? AND file_path IS NOT NULL AND file_path != ''", (folder_id,))
    if not docs:
        raise HTTPException(status_code=400, detail="No hay documentos adjuntos en esta carpeta para analizar")
    jobs = []
    for d in docs:
        if os.path.exists(d["file_path"]):
            jid = pipeline.create_job(folder_id, d["id"], d["original_filename"])
            pipeline.start_job_async(jid, folder_id, d["id"], d["file_path"], d["original_filename"])
            jobs.append(jid)
    return {"message": f"Se inició el re-análisis con IA para {len(jobs)} documento(s)", "jobs": jobs}


@router.post("/{folder_id}/criteria")
def add_evaluation_criterion(folder_id: int, payload: Dict[str, Any]):
    _folder_or_404(folder_id)
    criterion = (payload.get("criterion") or "").strip()
    if not criterion:
        raise HTTPException(status_code=400, detail="Nombre del criterio requerido")
    weight = float(payload.get("weight_pct") or 0)
    detail = (payload.get("detail") or "").strip()
    cid = execute_insert(
        "INSERT INTO folder_evaluation_criteria (folder_id, criterion, weight_pct, detail) VALUES (?, ?, ?, ?)",
        (folder_id, criterion, weight, detail)
    )
    return {"id": cid, "message": "Criterio de evaluación agregado exitosamente"}


@router.put("/criteria/{criterion_id}")
def update_evaluation_criterion(criterion_id: int, payload: Dict[str, Any]):
    criterion = (payload.get("criterion") or "").strip()
    weight = float(payload.get("weight_pct") or 0)
    detail = (payload.get("detail") or "").strip()
    execute_commit(
        "UPDATE folder_evaluation_criteria SET criterion=?, weight_pct=?, detail=? WHERE id=?",
        (criterion, weight, detail, criterion_id)
    )
    return {"message": "Criterio de evaluación actualizado"}


@router.delete("/criteria/{criterion_id}")
def delete_evaluation_criterion(criterion_id: int):
    execute_commit("DELETE FROM folder_evaluation_criteria WHERE id=?", (criterion_id,))
    return {"message": "Criterio de evaluación eliminado"}


@router.put("/{folder_id}/publication-date")
def set_publication_date(folder_id: int, payload: Dict[str, Any]):
    _folder_or_404(folder_id)
    d = (payload.get("date") or "").strip() or None
    execute_commit("UPDATE business_folders SET publication_date=? WHERE id=?", (d, folder_id))
    pipeline.recompute_milestone_dates(folder_id)
    return {"message": "Fechas recalculadas a partir de la publicación"}


@router.put("/{folder_id}/milestones/{kind}")
def update_folder_milestone(folder_id: int, kind: str, payload: Dict[str, Any]):
    _folder_or_404(folder_id)
    due_date = (payload.get("due_date") or "").strip() or None
    title = (payload.get("title") or kind.replace("_", " ").title()).strip()
    rule_text = (payload.get("rule_text") or "").strip() or None

    existing = query_one("SELECT id FROM folder_milestones WHERE folder_id=? AND kind=?", (folder_id, kind))
    if existing:
        execute_commit("UPDATE folder_milestones SET due_date=?, title=?, rule_text=? WHERE id=?",
                       (due_date, title, rule_text, existing["id"]))
    else:
        execute_insert("""
            INSERT INTO folder_milestones (folder_id, kind, title, rule_text, due_date)
            VALUES (?, ?, ?, ?, ?)
        """, (folder_id, kind, title, rule_text, due_date))

    # Actualizar fechas clave en business_folders si aplica
    if kind in ("PUBLICACION", "PUBLICATION") and due_date:
        execute_commit("UPDATE business_folders SET publication_date=? WHERE id=?", (due_date[:10], folder_id))
        pipeline.recompute_milestone_dates(folder_id)
    elif kind in ("CIERRE_OFERTAS", "CIERRE", "OFFER_CLOSE") and due_date:
        execute_commit("UPDATE business_folders SET tender_closing_date=? WHERE id=?", (due_date[:10], folder_id))

    return {"message": f"Hito '{title}' actualizado exitosamente", "due_date": due_date}


@router.delete("/{folder_id}/milestones/{kind}")
def delete_folder_milestone(folder_id: int, kind: str):
    _folder_or_404(folder_id)
    execute_commit("DELETE FROM folder_milestones WHERE folder_id=? AND kind=?", (folder_id, kind))
    return {"message": "Hito eliminado"}


# ------------------------------------------------------------------ checklist
@router.put("/checklist/{item_id}")
def update_checklist(item_id: int, payload: Dict[str, Any]):
    status = payload.get("status")
    if status not in ("PENDIENTE", "HECHO"):
        raise HTTPException(status_code=400, detail="Estado inválido")
    execute_commit("UPDATE folder_checklist_items SET status=? WHERE id=?", (status, item_id))
    return {"message": "Checklist actualizado"}


@router.post("/{folder_id}/checklist")
def add_checklist(folder_id: int, payload: Dict[str, Any]):
    _folder_or_404(folder_id)
    title = (payload.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Título requerido")
    iid = execute_insert("""INSERT INTO folder_checklist_items (folder_id, category, title, detail, due_date, place, source_doc)
                            VALUES (?, ?, ?, ?, ?, ?, 'Manual')""",
                         (folder_id, payload.get("category") or "OTRO", title, payload.get("detail"),
                          payload.get("due_date"), payload.get("place")))
    return {"id": iid}


@router.delete("/checklist/{item_id}")
def delete_checklist(item_id: int):
    execute_commit("DELETE FROM folder_checklist_items WHERE id=?", (item_id,))
    return {"message": "Eliminado"}


@router.post("/checklist/{item_id}/attach-file")
async def upload_checklist_attachment(item_id: int, file: UploadFile = File(...)):
    chk = query_one("SELECT * FROM folder_checklist_items WHERE id=?", (item_id,))
    if not chk:
        raise HTTPException(status_code=404, detail="Ítem de checklist no encontrado")
    uploads = os.path.join(DB_DIR, "uploads")
    os.makedirs(uploads, exist_ok=True)
    orig_name = os.path.basename(file.filename or "respaldo.pdf")
    safe = re.sub(r"[^\w\-. ()]+", "_", orig_name)
    path = os.path.join(uploads, f"{tenant_file_prefix()}checklist_{item_id}_{safe}")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="El archivo está vacío")
    with open(path, "wb") as f:
        f.write(content)
    execute_commit("""
        UPDATE folder_checklist_items 
        SET file_path=?, original_filename=?, status='HECHO' 
        WHERE id=?
    """, (path, orig_name, item_id))
    return {"message": "Respaldo adjuntado exitosamente", "filename": orig_name}


@router.get("/checklist/{item_id}/file")
def get_checklist_attachment(item_id: int):
    chk = query_one("SELECT * FROM folder_checklist_items WHERE id=?", (item_id,))
    if not chk or not chk.get("file_path") or not os.path.exists(chk["file_path"]):
        raise HTTPException(status_code=404, detail="Archivo adjunto no encontrado")
    fname = chk.get("original_filename") or os.path.basename(chk["file_path"])
    return FileResponse(chk["file_path"], filename=fname)


@router.delete("/checklist/{item_id}/file")
def delete_checklist_attachment(item_id: int):
    chk = query_one("SELECT * FROM folder_checklist_items WHERE id=?", (item_id,))
    if not chk:
        raise HTTPException(status_code=404, detail="Ítem no encontrado")
    if chk.get("file_path") and os.path.exists(chk["file_path"]):
        try:
            os.remove(chk["file_path"])
        except Exception:
            pass
    execute_commit("""
        UPDATE folder_checklist_items 
        SET file_path=NULL, original_filename=NULL 
        WHERE id=?
    """, (item_id,))
    return {"message": "Respaldo eliminado"}


@router.post("/checklist/{item_id}/sign-declaration")
def sign_checklist_declaration(item_id: int, payload: Dict[str, Any]):
    chk = query_one("SELECT * FROM folder_checklist_items WHERE id=?", (item_id,))
    if not chk:
        raise HTTPException(status_code=404, detail="Requisito no encontrado")
    
    prof = query_one("SELECT * FROM signer_profiles ORDER BY id DESC LIMIT 1") or {}
    signer_name = (payload.get("signer_name") or prof.get("name") or "Representante Legal").strip()
    signer_rut = (payload.get("signer_rut") or prof.get("rut") or "").strip()
    action = payload.get("action") or "sign"
    
    if action == "unsign":
        base_detail = re.sub(r"\s*\[FIRMADO DIGITALMENTE[^\]]*\]", "", chk.get("detail") or "")
        execute_commit("UPDATE folder_checklist_items SET status='PENDIENTE', detail=? WHERE id=?", (base_detail.strip(), item_id))
        return {"message": "Declaración marcada como PENDIENTE", "status": "PENDIENTE"}

    now_str = datetime.now().strftime("%d/%m/%Y %H:%M")
    clean_detail = re.sub(r"\s*\[FIRMADO DIGITALMENTE[^\]]*\]", "", chk.get("detail") or "")
    detail_note = f"\n\n[FIRMADO DIGITALMENTE por {signer_name} (RUT: {signer_rut}) el {now_str}]"
    new_detail = clean_detail.strip() + detail_note
    
    execute_commit("""
        UPDATE folder_checklist_items 
        SET status='HECHO', detail=? 
        WHERE id=?
    """, (new_detail, item_id))
    
    return {"message": "Declaración jurada firmada exitosamente", "status": "HECHO", "signed_by": signer_name, "signed_at": now_str}


# ------------------------------------------------------------------ productos
@router.put("/items/{item_id}")
def update_item(item_id: int, payload: Dict[str, Any]):
    allowed = {"product_name": str, "technical_specs": str, "quantity": float, "unit": str,
               "estimated_cost": float, "offered_price": float, "matched_sku": str, "tech_sheet_status": str}
    sets, vals = [], []
    for k, cast in allowed.items():
        if k in payload:
            sets.append(f"{k} = ?")
            vals.append(cast(payload[k]))
    if "confirmed" in payload:
        sets.append("status = ?")
        vals.append("CONFIRMADO" if payload["confirmed"] else "IA_PROPUESTO")
    if not sets:
        return {"message": "Sin cambios"}
    execute_commit(f"UPDATE folder_requested_items SET {', '.join(sets)} WHERE id = ?", tuple(vals) + (item_id,))
    return {"message": "Producto actualizado"}


@router.put("/items/{item_id}/tech-sheet-status")
def update_item_tech_sheet_status(item_id: int, payload: Dict[str, Any]):
    status = (payload.get("status") or "PENDIENTE").upper()
    if status not in ("LISTA", "PENDIENTE"):
        raise HTTPException(status_code=400, detail="Estado inválido: use LISTA o PENDIENTE")
    execute_commit("UPDATE folder_requested_items SET tech_sheet_status=? WHERE id=?", (status, item_id))
    return {"message": "Estado de ficha técnica actualizado", "status": status}


@router.post("/items/{item_id}/tech-sheet-file")
async def upload_item_tech_sheet_file(item_id: int, file: UploadFile = File(...)):
    item = query_one("SELECT * FROM folder_requested_items WHERE id=?", (item_id,))
    if not item:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    uploads = os.path.join(DB_DIR, "uploads")
    os.makedirs(uploads, exist_ok=True)
    orig_name = os.path.basename(file.filename or "ficha_tecnica.pdf")
    safe = re.sub(r"[^\w\-. ()]+", "_", orig_name)
    path = os.path.join(uploads, f"{tenant_file_prefix()}item_{item_id}_{safe}")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="El archivo está vacío")
    with open(path, "wb") as f:
        f.write(content)
    execute_commit("""
        UPDATE folder_requested_items 
        SET tech_sheet_file=?, tech_sheet_filename=?, tech_sheet_status='LISTA' 
        WHERE id=?
    """, (path, orig_name, item_id))
    return {"message": "Ficha técnica adjuntada exitosamente", "filename": orig_name}


@router.get("/items/{item_id}/tech-sheet-file")
def get_item_tech_sheet_file(item_id: int):
    item = query_one("SELECT * FROM folder_requested_items WHERE id=?", (item_id,))
    if not item or not item.get("tech_sheet_file") or not os.path.exists(item["tech_sheet_file"]):
        raise HTTPException(status_code=404, detail="Ficha técnica no encontrada o no adjuntada")
    fname = item.get("tech_sheet_filename") or os.path.basename(item["tech_sheet_file"])
    return FileResponse(item["tech_sheet_file"], filename=fname)


@router.delete("/items/{item_id}/tech-sheet-file")
def delete_item_tech_sheet_file(item_id: int):
    item = query_one("SELECT * FROM folder_requested_items WHERE id=?", (item_id,))
    if not item:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    if item.get("tech_sheet_file") and os.path.exists(item["tech_sheet_file"]):
        try:
            os.remove(item["tech_sheet_file"])
        except Exception:
            pass
    execute_commit("""
        UPDATE folder_requested_items 
        SET tech_sheet_file=NULL, tech_sheet_filename=NULL, tech_sheet_status='PENDIENTE' 
        WHERE id=?
    """, (item_id,))
    return {"message": "Ficha técnica eliminada"}


@router.post("/{folder_id}/items")
def add_item(folder_id: int, payload: Dict[str, Any]):
    """Agrega manualmente una fila de producto a la carpeta."""
    if not query_one("SELECT id FROM business_folders WHERE id = ?", (folder_id,)):
        raise HTTPException(status_code=404, detail="Carpeta no encontrada")
    n = query_one("SELECT COALESCE(MAX(item_number),0) AS m FROM folder_requested_items WHERE folder_id=?", (folder_id,))["m"]
    iid = execute_insert("""INSERT INTO folder_requested_items (folder_id, item_number, product_name, technical_specs, quantity, unit,
        estimated_cost, offered_price, matched_sku, source_doc, status) VALUES (?,?,?,?,?,?,?,?,?,?,'CONFIRMADO')""",
                         (folder_id, n + 1, str(payload.get("product_name") or "Nuevo producto"),
                          str(payload.get("technical_specs") or ""), float(payload.get("quantity") or 1),
                          str(payload.get("unit") or "UND"), float(payload.get("estimated_cost") or 0),
                          float(payload.get("offered_price") or 0), "POR COTIZAR", "Manual"))
    return {"id": iid}


@router.delete("/items/{item_id}")
def delete_item(item_id: int):
    execute_commit("DELETE FROM folder_requested_items WHERE id = ?", (item_id,))
    return {"message": "Producto eliminado"}


@router.post("/items/{item_id}/split")
def split_item(item_id: int, payload: Dict[str, Any]):
    """Desglosa una fila que agrupa varios artículos en filas individuales.
    payload.names = lista de nombres; si viene vacía se sugieren desde el nombre / con IA."""
    it = query_one("SELECT * FROM folder_requested_items WHERE id = ?", (item_id,))
    if not it:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    names = [str(n).strip() for n in (payload.get("names") or []) if str(n).strip()]
    specs_lines = [l.strip() for l in (it.get("technical_specs") or "").splitlines() if l.strip()]
    if not names:
        names = pipeline.suggest_split_names(it["product_name"], it.get("unit") or "")
    if len(names) < 2:
        res = ai_provider.llm_json(
            'Esta fila de un pedido agrupa varios artículos distintos. Responde SOLO {"names": [str]} con el nombre de cada '
            f'artículo individual (sin inventar). Fila: "{it["product_name"]}" (unidad {it.get("unit")}).\nEspecificaciones:\n'
            + "\n".join(specs_lines)[:6000], text="")
        names = [str(n).strip() for n in ((res or {}).get("names") or []) if str(n).strip()]
    if len(names) < 2:
        raise HTTPException(status_code=422, detail="No pude identificar los artículos. Indique los nombres (uno por línea) para desglosarlos.")
    groups = pipeline.distribute_specs(specs_lines, names)
    unit = it.get("unit") or "UND"
    if unit.strip().lower() in ("por prenda", "prenda", "prendas", "por set", "set", "por kit", "kit"):
        unit = "UND"
    # la fila original pasa a ser el primer artículo; los demás se insertan a continuación
    execute_commit("UPDATE folder_requested_items SET product_name=?, technical_specs=?, unit=? WHERE id=?",
                   (names[0], "\n".join(groups[0]), unit, item_id))
    for n, g in zip(names[1:], groups[1:]):
        execute_insert("""INSERT INTO folder_requested_items (folder_id, item_number, product_name, technical_specs, quantity, unit,
            estimated_cost, offered_price, matched_sku, source_doc, status, source_page)
            VALUES (?,?,?,?,?,?,0,0,'POR COTIZAR',?,?,?)""",
                       (it["folder_id"], it["item_number"], n, "\n".join(g), it["quantity"], unit, it.get("source_doc"),
                        it.get("status") or "IA_PROPUESTO", it.get("source_page")))
    return {"message": f"Se desglosó en {len(names)} filas", "names": names}


# ------------------------------------------------------------------ cotizador integrado
def _quotation_payload(q_id: int) -> Dict[str, Any]:
    q = query_one("SELECT * FROM quotations WHERE id=?", (q_id,))
    q["items"] = query_all("SELECT * FROM quotation_items WHERE quotation_id=? ORDER BY id", (q_id,))
    return q


def _next_folio() -> str:
    m = query_one("SELECT COALESCE(MAX(id),0) AS m FROM quotations")["m"] + 1
    folio = f"COT-2026-{m:04d}"
    while query_one("SELECT 1 FROM quotations WHERE folio=?", (folio,)):
        m += 1
        folio = f"COT-2026-{m:04d}"
    return folio


def _recalc(q_id: int) -> None:
    items = query_all("SELECT * FROM quotation_items WHERE quotation_id=?", (q_id,))
    net = sum(i["subtotal"] for i in items)
    tax = round(net * 0.19)
    execute_commit("UPDATE quotations SET subtotal=?, net_amount=?, tax_amount=?, total_amount=? WHERE id=?",
                   (net, net, tax, net + tax, q_id))


def _insert_q_item(q_id: int, sku, desc, unit, qty, cost, price, disc=0.0) -> int:
    qty, cost, price, disc = float(qty or 0), float(cost or 0), float(price or 0), float(disc or 0)
    sub = round(qty * price * (1 - disc / 100.0))
    margin = round((price - cost) / price * 100, 1) if price > 0 and cost > 0 else 0
    return execute_insert("""INSERT INTO quotation_items (quotation_id, sku, description, unit, quantity, unit_cost, unit_price,
                                discount_pct, margin_pct, subtotal) VALUES (?,?,?,?,?,?,?,?,?,?)""",
                          (q_id, sku, desc, unit, qty, cost, price, disc, margin, sub))


@router.post("/{folder_id}/quotation/from-items")
def quotation_from_items(folder_id: int):
    folder = _folder_or_404(folder_id)
    items = query_all("SELECT * FROM folder_requested_items WHERE folder_id=? AND COALESCE(in_quotation,0)=0 ORDER BY item_number", (folder_id,))
    if not items:
        raise HTTPException(status_code=400, detail="No hay productos pendientes de pasar a cotización")
    q = query_one("SELECT id FROM quotations WHERE folder_id=? AND status != 'RECHAZADA' ORDER BY id DESC LIMIT 1", (folder_id,))
    summary = {}
    try:
        summary = json.loads(folder.get("analysis_summary") or "{}")
    except Exception:
        pass
    if q:
        q_id = q["id"]
    else:
        q_id = execute_insert("""
            INSERT INTO quotations (folio, folder_id, company_id, client_name, client_rut, date, validity_days, payment_terms,
                delivery_time, type, tender_id, status, notes)
            VALUES (?, ?, ?, ?, ?, ?, 60, '30 días contra factura', 'Según bases (máx. 30 días corridos)', ?, ?, 'BORRADOR', ?)
        """, (_next_folio(), folder_id, folder.get("company_id") or active_company_id(), folder["client_name"], folder["client_rut"],
              date.today().isoformat(), folder["type"], folder.get("tender_id"),
              "Valores netos en CLP. Precio incluye despacho si así lo exigen las bases."))
    for it in items:
        desc = it["product_name"] + ("\n" + it["technical_specs"] if it.get("technical_specs") else "")
        sku = it["matched_sku"] if it.get("matched_sku") and it["matched_sku"] not in ("POR COTIZAR", "MANUAL", "COTIZAR-PROV") else ""
        _insert_q_item(q_id, sku, desc, it["unit"], it["quantity"], it["estimated_cost"], it["offered_price"])
        execute_commit("UPDATE folder_requested_items SET in_quotation=1 WHERE id=?", (it["id"],))
    _recalc(q_id)
    return {"message": f"{len(items)} producto(s) pasados a la cotización", "quotation_id": q_id}


@router.put("/{folder_id}/quotation")
def save_quotation(folder_id: int, payload: Dict[str, Any]):
    folder = _folder_or_404(folder_id)
    q_id = payload.get("id")
    if not q_id:
        q_id = execute_insert("""
            INSERT INTO quotations (folio, folder_id, company_id, client_name, client_rut, date, type, tender_id, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'BORRADOR')
        """, (_next_folio(), folder_id, folder.get("company_id") or active_company_id(), folder["client_name"], folder["client_rut"],
              date.today().isoformat(), folder["type"], folder.get("tender_id")))
    execute_commit("""UPDATE quotations SET validity_days=?, payment_terms=?, delivery_time=?, notes=?, client_contact=?, client_email=?,
                         signature_data_url=COALESCE(?, signature_data_url), signer_name=COALESCE(?, signer_name),
                         signer_rut=COALESCE(?, signer_rut) WHERE id=? AND folder_id=?""",
                   (int(payload.get("validity_days") or 15), payload.get("payment_terms") or "30 días contra factura",
                    payload.get("delivery_time") or "5 días hábiles", payload.get("notes") or "",
                    payload.get("client_contact") or "", payload.get("client_email") or "",
                    payload.get("signature_data_url"), payload.get("signer_name"), payload.get("signer_rut"), q_id, folder_id))
    if isinstance(payload.get("items"), list):
        execute_commit("DELETE FROM quotation_items WHERE quotation_id=?", (q_id,))
        for it in payload["items"]:
            if (it.get("description") or "").strip():
                _insert_q_item(q_id, it.get("sku"), it["description"], it.get("unit") or "UND", it.get("quantity"),
                               it.get("unit_cost"), it.get("unit_price"), it.get("discount_pct"))
    _recalc(q_id)
    return {"message": "Cotización guardada", "quotation": _quotation_payload(q_id)}


@router.put("/{folder_id}/quotation/status")
def quotation_status(folder_id: int, payload: Dict[str, Any]):
    q = query_one("SELECT id, status FROM quotations WHERE folder_id=? AND status != 'RECHAZADA' ORDER BY id DESC LIMIT 1", (folder_id,))
    if not q:
        raise HTTPException(status_code=404, detail="La carpeta no tiene cotización")
    new = payload.get("status")
    execute_commit("UPDATE quotations SET status=? WHERE id=?", (new, q["id"]))
    if new == "ACEPTADA" and q["status"] != "ACEPTADA":
        reserve_inventory_for_quotation(q["id"])
    return {"message": f"Cotización {new}"}


@router.get("/quotation/{q_id}/export")
def export_quotation(q_id: int, fmt: str = "pdf"):
    if not query_one("SELECT id FROM quotations WHERE id=?", (q_id,)):
        raise HTTPException(status_code=404, detail="Cotización no encontrada")
    path = exporter.quotation_docx(q_id) if fmt == "docx" else exporter.quotation_pdf(q_id)
    return FileResponse(path, filename=os.path.basename(path))


# ------------------------------------------------------------------ documentos / firma
@router.get("/documents/{doc_id}/file")
def download_original(doc_id: int):
    doc = query_one("SELECT * FROM tender_documents WHERE id=?", (doc_id,))
    if not doc or not doc.get("file_path") or not os.path.exists(doc["file_path"]):
        raise HTTPException(status_code=404, detail="Archivo no disponible")
    return FileResponse(doc["file_path"], filename=doc["original_filename"])


@router.get("/documents/{doc_id}")
def get_document(doc_id: int):
    doc = query_one("SELECT * FROM tender_documents WHERE id=?", (doc_id,))
    if not doc:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    doc.pop("extracted_text", None)
    return doc


@router.post("/documents/{doc_id}/complete-and-sign")
def complete_and_sign(doc_id: int, payload: Dict[str, Any]):
    doc = query_one("SELECT * FROM tender_documents WHERE id=?", (doc_id,))
    if not doc:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    form = payload.get("form_data") or {}
    sig = payload.get("signature_data_url")
    signer_name = payload.get("signer_name")
    signer_rut = formatear_rut(payload.get("signer_rut") or "")
    if payload.get("use_saved_signature"):
        prof = query_one("SELECT * FROM signer_profiles ORDER BY id DESC LIMIT 1")
        if not prof or not prof.get("signature_data_url"):
            raise HTTPException(status_code=400, detail="No hay firma guardada. Guarde su firma primero.")
        sig = prof["signature_data_url"]
        signer_name = signer_name or prof["name"]
        signer_rut = signer_rut or prof.get("rut") or ""
    if not sig:
        raise HTTPException(status_code=400, detail="Se requiere firma")
    execute_commit("""UPDATE tender_documents SET form_data_json=?, signature_data_url=?, signer_name=?, signer_rut=?,
                      status='FIRMADO', updated_at=CURRENT_TIMESTAMP WHERE id=?""",
                   (json.dumps(form, ensure_ascii=False), sig, signer_name, signer_rut, doc_id))
    # Marca automáticamente el pendiente del checklist vinculado
    execute_commit("UPDATE folder_checklist_items SET status='HECHO' WHERE document_id=?", (doc_id,))
    doc = query_one("SELECT * FROM tender_documents WHERE id=?", (doc_id,))
    pdf = exporter.annex_pdf(doc)
    execute_commit("UPDATE tender_documents SET signed_file_path=? WHERE id=?", (pdf, doc_id))
    return {"message": "Documento completado y firmado", "pdf": f"/api/workspace/documents/{doc_id}/export?fmt=pdf"}


@router.get("/documents/{doc_id}/export")
def export_document(doc_id: int, fmt: str = "pdf"):
    doc = query_one("SELECT * FROM tender_documents WHERE id=?", (doc_id,))
    if not doc:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    path = exporter.annex_docx(doc) if fmt == "docx" else exporter.annex_pdf(doc)
    return FileResponse(path, filename=os.path.basename(path))


# ------------------------------------------------------------------ visor / edición / firma sobre el PDF
def _doc_or_404(doc_id: int) -> Dict[str, Any]:
    doc = query_one("SELECT * FROM tender_documents WHERE id=?", (doc_id,))
    if not doc:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    return doc


def _doc_pdf_bytes(doc: Dict[str, Any]) -> bytes:
    """PDF base para visualizar: el original si es PDF, una versión PDF si es Word/Excel/TXT,
    o el formato generado por la plataforma para anexos detectados por la IA."""
    from app.services import pdf_annotate
    fp = doc.get("file_path")
    if fp and os.path.exists(fp):
        if fp.lower().endswith(".pdf"):
            with open(fp, "rb") as f:
                return f.read()
        return pdf_annotate.text_document_to_pdf(fp, doc.get("name") or os.path.basename(fp))
    path = exporter.annex_pdf(doc)
    with open(path, "rb") as f:
        return f.read()


@router.get("/documents/{doc_id}/view-pdf")
def view_pdf(doc_id: int):
    from fastapi.responses import Response
    doc = _doc_or_404(doc_id)
    try:
        data = _doc_pdf_bytes(doc)
    except Exception as e:  # noqa
        raise HTTPException(status_code=500, detail=f"No se pudo preparar el documento para visualizarlo: {e}")
    return Response(content=data, media_type="application/pdf", headers={"Cache-Control": "no-store"})


@router.get("/documents/{doc_id}/annotations")
def get_annotations(doc_id: int):
    doc = _doc_or_404(doc_id)
    try:
        ann = json.loads(doc.get("annotations_json") or "[]")
    except Exception:
        ann = []
    return {"annotations": ann, "status": doc.get("status"), "name": doc.get("name")}


@router.put("/documents/{doc_id}/annotations")
def put_annotations(doc_id: int, payload: Dict[str, Any]):
    _doc_or_404(doc_id)
    ann = payload.get("annotations") or []
    if not isinstance(ann, list):
        raise HTTPException(status_code=400, detail="Formato de anotaciones inválido")
    execute_commit("UPDATE tender_documents SET annotations_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                   (json.dumps(ann, ensure_ascii=False), doc_id))
    return {"message": "Cambios guardados", "count": len(ann)}


@router.get("/documents/{doc_id}/annotated-pdf")
def annotated_pdf(doc_id: int):
    """Compila el PDF final con los textos y firmas aplicados y lo entrega para descarga."""
    from app.services import pdf_annotate
    doc = _doc_or_404(doc_id)
    try:
        ann = json.loads(doc.get("annotations_json") or "[]")
    except Exception:
        ann = []
    try:
        base = _doc_pdf_bytes(doc)
        final = pdf_annotate.apply_annotations(base, ann) if ann else base
    except Exception as e:  # noqa
        raise HTTPException(status_code=500, detail=f"No se pudo generar el PDF: {e}")
    gen = os.path.join(DB_DIR, "generated")
    os.makedirs(gen, exist_ok=True)
    safe = re.sub(r"[^\w\-. ()]+", "_", os.path.splitext(doc.get("original_filename") or doc.get("name") or f"documento_{doc_id}")[0])
    path = os.path.join(gen, f"{tenant_file_prefix()}doc_{doc_id}_{safe[:60]}_final.pdf")
    with open(path, "wb") as f:
        f.write(final)
    if any(a.get("type") == "image" for a in ann):
        execute_commit("UPDATE tender_documents SET signed_file_path=?, status='FIRMADO', updated_at=CURRENT_TIMESTAMP WHERE id=?", (path, doc_id))
        execute_commit("UPDATE folder_checklist_items SET status='HECHO' WHERE document_id=?", (doc_id,))
    else:
        execute_commit("UPDATE tender_documents SET signed_file_path=? WHERE id=?", (path, doc_id))
    return FileResponse(path, media_type="application/pdf", filename=os.path.basename(path))


# ------------------------------------------------------------------ paquete de postulación (.ZIP)
@router.get("/{folder_id}/postulacion-zip")
def download_postulacion_zip(folder_id: int):
    """Compila y genera el archivo ZIP completo con todos los documentos para postular:
    - 00_RESUMEN_POSTULACION.txt (checklist y estatus)
    - 01_ANEXOS_FIRMADOS/ (todos los anexos en PDF)
    - 02_FICHAS_TECNICAS/ (todas las fichas técnicas adjuntadas por producto)
    - 03_ANTECEDENTES_ADMINISTRATIVOS/ (patentes, estatutos, vigencia, F30-1, cédula)
    - 04_PROPUESTA_ECONOMICA/ (cotización oficial en PDF)
    """
    folder = _folder_or_404(folder_id)
    items = query_all("SELECT * FROM folder_requested_items WHERE folder_id=? ORDER BY item_number, id", (folder_id,))
    checklist = query_all("SELECT * FROM folder_checklist_items WHERE folder_id=? ORDER BY category, id", (folder_id,))
    docs = query_all("SELECT * FROM tender_documents WHERE folder_id=? ORDER BY id", (folder_id,))
    quotation = query_one("SELECT * FROM quotations WHERE folder_id=? AND status != 'RECHAZADA' ORDER BY id DESC LIMIT 1", (folder_id,))

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        # 1. Resumen de control
        summary_lines = [
            "=" * 75,
            f"PAQUETE DE POSTULACIÓN - {folder.get('code')}",
            f"Licitación / Negocio: {folder.get('title')}",
            f"Cliente / Entidad: {folder.get('client_name')} (RUT: {folder.get('client_rut')})",
            f"ID Mercado Público: {folder.get('tender_id') or 'N/A'}",
            f"Fecha de compilación: {date.today().isoformat()}",
            "=" * 75,
            "",
            "1. ANEXOS Y FORMULARIOS DE LA OFERTA:",
        ]
        for d in docs:
            is_signed = bool(d.get("status") == "FIRMADO" or d.get("signed_file_path"))
            st = "FIRMADO / LISTO" if is_signed else "PENDIENTE DE FIRMA"
            summary_lines.append(f"  - [{st}] {d.get('name')}")

        summary_lines.append("")
        summary_lines.append("2. FICHAS TÉCNICAS POR PRODUCTO:")
        for it in items:
            has_file = bool(it.get("tech_sheet_file") and os.path.exists(it.get("tech_sheet_file") or ""))
            st = "ADJUNTADA" if has_file else (it.get("tech_sheet_status") or "PENDIENTE")
            summary_lines.append(f"  - Item #{it.get('item_number', 1)}: {it.get('product_name')} ({it.get('quantity')} {it.get('unit')}) -> [{st}]")

        summary_lines.append("")
        summary_lines.append("3. ANTECEDENTES ADMINISTRATIVOS:")
        admin_items = [c for c in checklist if c.get("category") == "ADMINISTRATIVO"]
        for a in admin_items:
            has_file = bool(a.get("file_path") and os.path.exists(a.get("file_path") or ""))
            st = "ADJUNTADO" if has_file else ("HECHO" if a.get("status") == "HECHO" else "PENDIENTE")
            summary_lines.append(f"  - [{st}] {a.get('title')}")

        summary_lines.append("")
        summary_lines.append("4. PROPUESTA ECONÓMICA:")
        if quotation:
            summary_lines.append(f"  - Cotización Folio: {quotation.get('folio')} | Neto: ${round(quotation.get('net_amount', 0)):,} | Total: ${round(quotation.get('total_amount', 0)):,}")
        else:
            summary_lines.append("  - No se ha generado cotización en la carpeta.")

        summary_lines.append("")
        summary_lines.append("=" * 75)
        summary_lines.append("Generado automáticamente por el ERP Comercial y Operativo.")

        zf.writestr("00_RESUMEN_POSTULACION.txt", "\n".join(summary_lines))

        # 2. Agregar Anexos
        for idx, d in enumerate(docs, 1):
            fp = d.get("signed_file_path") or d.get("file_path")
            if fp and os.path.exists(fp):
                clean_name = re.sub(r"[^\w\-. ]+", "_", d.get("name") or f"Anexo_{idx}")
                if not clean_name.lower().endswith((".pdf", ".docx", ".xlsx", ".txt")):
                    clean_name += ".pdf"
                zf.write(fp, f"01_ANEXOS_FIRMADOS/{idx:02d}_{clean_name}")

        # 3. Agregar Fichas Técnicas
        for it in items:
            fp = it.get("tech_sheet_file")
            if fp and os.path.exists(fp):
                ext = os.path.splitext(fp)[1] or ".pdf"
                safe_prod = re.sub(r"[^\w\-. ]+", "_", it.get("product_name") or "Producto")[:40]
                arc_name = f"Item_{it.get('item_number', 1):02d}_Ficha_{safe_prod}{ext}"
                zf.write(fp, f"02_FICHAS_TECNICAS/{arc_name}")

        # 4. Agregar Antecedentes Administrativos
        for idx, a in enumerate(admin_items, 1):
            fp = a.get("file_path")
            if fp and os.path.exists(fp):
                ext = os.path.splitext(fp)[1] or ".pdf"
                safe_title = re.sub(r"[^\w\-. ]+", "_", a.get("title") or "Antecedente")[:40]
                arc_name = f"{idx:02d}_Admin_{safe_title}{ext}"
                zf.write(fp, f"03_ANTECEDENTES_ADMINISTRATIVOS/{arc_name}")

        # 5. Agregar Certificaciones y Documentos Técnicos
        tech_items = [c for c in checklist if c.get("category") in ("TECNICO", "MUESTRA")]
        for idx, t in enumerate(tech_items, 1):
            fp = t.get("file_path")
            if fp and os.path.exists(fp):
                ext = os.path.splitext(fp)[1] or ".pdf"
                safe_title = re.sub(r"[^\w\-. ]+", "_", t.get("title") or "Tecnico")[:40]
                arc_name = f"{idx:02d}_Tecnico_{safe_title}{ext}"
                zf.write(fp, f"04_CERTIFICACIONES_Y_TECNICOS/{arc_name}")

        # 6. Agregar Propuesta y Documentos Económicos
        if quotation:
            try:
                q_pdf = exporter.quotation_pdf(quotation["id"])
                if q_pdf and os.path.exists(q_pdf):
                    zf.write(q_pdf, f"05_PROPUESTA_ECONOMICA/Propuesta_Economica_{quotation.get('folio')}.pdf")
            except Exception:
                pass
        econ_items = [c for c in checklist if c.get("category") == "ECONOMICO"]
        for idx, e_it in enumerate(econ_items, 1):
            fp = e_it.get("file_path")
            if fp and os.path.exists(fp):
                ext = os.path.splitext(fp)[1] or ".pdf"
                safe_title = re.sub(r"[^\w\-. ]+", "_", e_it.get("title") or "Economico")[:40]
                arc_name = f"{idx:02d}_Econ_{safe_title}{ext}"
                zf.write(fp, f"05_PROPUESTA_ECONOMICA/{arc_name}")

    zip_buffer.seek(0)
    raw_code = folder.get("tender_id") or folder.get("code") or "Postulacion"
    safe_code = re.sub(r"[^\w\-]+", "_", raw_code)
    zip_filename = f"Paquete_Postulacion_{safe_code}.zip"
    return Response(
        content=zip_buffer.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{zip_filename}"'}
    )


@router.delete("/{folder_id}")
def delete_workspace_folder(folder_id: int):
    """Elimina definitivamente la Carpeta de Negocio y sus dependencias."""
    from app.routers.business_folders import delete_folder_by_id
    return delete_folder_by_id(folder_id)


# ------------------------------------------------------------------ Subsanaciones y Foro Inverso
@router.get("/{folder_id}/clarifications")
def get_clarifications(folder_id: int):
    _folder_or_404(folder_id)
    rows = query_all("SELECT * FROM folder_clarifications WHERE folder_id = ? ORDER BY deadline_at ASC, id DESC", (folder_id,))
    now = datetime.datetime.now()
    for r in rows:
        dl = r.get("deadline_at")
        if dl:
            try:
                dt = datetime.datetime.fromisoformat(str(dl).replace("Z", ""))
                diff = dt - now
                r["seconds_remaining"] = int(diff.total_seconds())
                r["hours_remaining"] = round(diff.total_seconds() / 3600.0, 1)
                r["is_overdue"] = diff.total_seconds() < 0
            except Exception:
                r["seconds_remaining"] = None
        else:
            r["seconds_remaining"] = None
    return rows


@router.post("/{folder_id}/clarifications")
def add_clarification(folder_id: int, payload: Dict[str, Any]):
    _folder_or_404(folder_id)
    cid = execute_insert("""
        INSERT INTO folder_clarifications (folder_id, title, request_text, response_text, deadline_at, status)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (
        folder_id,
        str(payload.get("title") or "Solicitud de Aclaración / Foro Inverso"),
        str(payload.get("request_text") or ""),
        str(payload.get("response_text") or ""),
        payload.get("deadline_at"),
        str(payload.get("status") or "PENDIENTE")
    ))
    return {"message": "Registro de subsanación agregado", "id": cid}


@router.put("/{folder_id}/clarifications/{item_id}")
def update_clarification(folder_id: int, item_id: int, payload: Dict[str, Any]):
    _folder_or_404(folder_id)
    execute_commit("""
        UPDATE folder_clarifications
        SET title = COALESCE(?, title),
            request_text = COALESCE(?, request_text),
            response_text = COALESCE(?, response_text),
            deadline_at = COALESCE(?, deadline_at),
            status = COALESCE(?, status)
        WHERE id = ? AND folder_id = ?
    """, (
        payload.get("title"), payload.get("request_text"), payload.get("response_text"),
        payload.get("deadline_at"), payload.get("status"), item_id, folder_id
    ))
    return {"message": "Subsanación actualizada"}


@router.delete("/{folder_id}/clarifications/{item_id}")
def delete_clarification(folder_id: int, item_id: int):
    _folder_or_404(folder_id)
    execute_commit("DELETE FROM folder_clarifications WHERE id = ? AND folder_id = ?", (item_id, folder_id))
    return {"message": "Subsanación eliminada"}


# ------------------------------------------------------------------ Ficha de Garantías
@router.get("/{folder_id}/warranty-sheet")
def get_warranty_sheet_data(folder_id: int):
    folder = _folder_or_404(folder_id)
    company = query_one("SELECT * FROM companies WHERE id = ?", (folder.get("company_id") or active_company_id(),)) or {}
    signer = query_one("SELECT * FROM signer_profiles WHERE company_id = ? ORDER BY id DESC LIMIT 1", (company.get("id"),)) or {}
    if not signer:
        signer = query_one("SELECT * FROM signer_profiles ORDER BY id DESC LIMIT 1") or {}
    risk = query_one("SELECT * FROM folder_risks WHERE folder_id = ? AND kind = 'GARANTIA' ORDER BY id ASC LIMIT 1", (folder_id,))

    return {
        "folder_id": folder_id,
        "tender_id": folder.get("tender_id") or folder.get("code"),
        "tender_title": folder.get("title"),
        "mandante_name": folder.get("client_name"),
        "mandante_rut": folder.get("client_rut"),
        "warranty_type": "Seriedad de la Oferta",
        "amount_str": (risk.get("title") if risk else None) or "$500.000 CLP",
        "validity_str": "90 días corridos contados desde la apertura de las ofertas",
        "glosa": (risk.get("detail") if risk and len(risk.get("detail", "")) > 15 else None) or
                 f"Para garantizar la seriedad de la oferta en la licitación ID {folder.get('tender_id') or folder.get('code')}, denominada '{folder.get('title')}', ante {folder.get('client_name')}.",
        "applicant_company": company.get("razon_social"),
        "applicant_rut": company.get("rut"),
        "signer_name": signer.get("name"),
        "signer_rut": signer.get("rut")
    }


@router.get("/{folder_id}/warranty-sheet/pdf")
def download_warranty_sheet_pdf(folder_id: int):
    _folder_or_404(folder_id)
    from app.services.tender_advanced_service import generate_warranty_sheet_pdf
    pdf_path = generate_warranty_sheet_pdf(folder_id)
    return FileResponse(pdf_path, filename=os.path.basename(pdf_path), media_type="application/pdf")


# ------------------------------------------------------------------ Historial Referencial de Adjudicaciones
@router.get("/{folder_id}/benchmarks")
def get_benchmarks(folder_id: int):
    _folder_or_404(folder_id)
    return query_all("SELECT * FROM folder_adjudication_benchmarks WHERE folder_id = ? ORDER BY id DESC", (folder_id,))


@router.post("/{folder_id}/benchmarks")
def add_benchmark(folder_id: int, payload: Dict[str, Any]):
    _folder_or_404(folder_id)
    bid = execute_insert("""
        INSERT INTO folder_adjudication_benchmarks (folder_id, product_name, entity_name, past_unit_price, past_award_date, past_winner_name, tender_id, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        folder_id,
        str(payload.get("product_name") or "Producto"),
        str(payload.get("entity_name") or ""),
        float(payload.get("past_unit_price") or 0),
        payload.get("past_award_date"),
        payload.get("past_winner_name"),
        payload.get("tender_id"),
        payload.get("notes")
    ))
    return {"message": "Precio histórico referencial guardado", "id": bid}


@router.delete("/{folder_id}/benchmarks/{item_id}")
def delete_benchmark(folder_id: int, item_id: int):
    _folder_or_404(folder_id)
    execute_commit("DELETE FROM folder_adjudication_benchmarks WHERE id = ? AND folder_id = ?", (item_id, folder_id))
    return {"message": "Precio histórico eliminado"}


# ------------------------------------------------------------------ Post-Adjudicación: Despacho y Multas
@router.get("/{folder_id}/dispatch-status")
def dispatch_status(folder_id: int):
    _folder_or_404(folder_id)
    from app.services.tender_advanced_service import get_dispatch_status
    return get_dispatch_status(folder_id)


@router.post("/{folder_id}/dispatch-guide")
def save_dispatch_guide(folder_id: int, payload: Dict[str, Any]):
    _folder_or_404(folder_id)
    execute_commit("""
        UPDATE business_folders
        SET dispatch_guide_number = ?, dispatch_guide_date = ?, oc_number = COALESCE(?, oc_number),
            oc_date = COALESCE(?, oc_date), delivery_days = COALESCE(?, delivery_days)
        WHERE id = ?
    """, (
        payload.get("dispatch_guide_number"), payload.get("dispatch_guide_date"),
        payload.get("oc_number"), payload.get("oc_date"), payload.get("delivery_days"),
        folder_id
    ))
    from app.services.tender_advanced_service import get_dispatch_status
    return {"message": "Datos de despacho y OC actualizados", "status": get_dispatch_status(folder_id)}


@router.get("/{folder_id}/dispatch-items")
def get_dispatch_items(folder_id: int):
    _folder_or_404(folder_id)
    rows = query_all("SELECT * FROM folder_dispatch_items WHERE folder_id = ? ORDER BY id ASC", (folder_id,))
    if not rows:
        # Pre-poblar desde folder_requested_items
        req = query_all("SELECT * FROM folder_requested_items WHERE folder_id = ? ORDER BY item_number ASC", (folder_id,))
        for r in req:
            execute_insert("""
                INSERT INTO folder_dispatch_items (folder_id, item_id, product_name, size, color, quantity, destination_place, notes)
                VALUES (?, ?, ?, 'Curva completa', '-', ?, 'Bodega Central', ?)
            """, (folder_id, r["id"], r["product_name"], r["quantity"], r.get("technical_specs", "")[:80]))
        rows = query_all("SELECT * FROM folder_dispatch_items WHERE folder_id = ? ORDER BY id ASC", (folder_id,))
    return rows


@router.post("/{folder_id}/dispatch-items")
def add_dispatch_item(folder_id: int, payload: Dict[str, Any]):
    _folder_or_404(folder_id)
    iid = execute_insert("""
        INSERT INTO folder_dispatch_items (folder_id, item_id, product_name, size, color, quantity, destination_place, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        folder_id, payload.get("item_id"), str(payload.get("product_name") or "Producto"),
        payload.get("size", "M"), payload.get("color", "-"), float(payload.get("quantity") or 1),
        payload.get("destination_place", "Bodega Central"), payload.get("notes", "")
    ))
    return {"message": "Ítem de planilla de despacho agregado", "id": iid}


@router.delete("/{folder_id}/dispatch-items/{item_id}")
def delete_dispatch_item(folder_id: int, item_id: int):
    _folder_or_404(folder_id)
    execute_commit("DELETE FROM folder_dispatch_items WHERE id = ? AND folder_id = ?", (item_id, folder_id))
    return {"message": "Ítem de despacho eliminado"}


@router.get("/{folder_id}/dispatch-sheet/pdf")
def download_dispatch_sheet_pdf(folder_id: int):
    _folder_or_404(folder_id)
    from app.services.tender_advanced_service import generate_dispatch_sheet_pdf
    pdf_path = generate_dispatch_sheet_pdf(folder_id)
    return FileResponse(pdf_path, filename=os.path.basename(pdf_path), media_type="application/pdf")


# ------------------------------------------------------------------ Bóveda Legal a Checklist Sync
@router.post("/{folder_id}/sync-vault-to-checklist")
def sync_vault(folder_id: int):
    _folder_or_404(folder_id)
    from app.services.tender_advanced_service import sync_vault_to_folder
    return sync_vault_to_folder(folder_id)



