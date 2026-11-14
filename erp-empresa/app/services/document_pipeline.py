"""
Pipeline de procesamiento inteligente documental de la Carpeta de Negocio.

Subir archivo -> guardar -> leer texto (PDF/Word/Excel/TXT) -> analizar con IA (o reglas) ->
auto-configurar la carpeta: productos + especificaciones, checklist, hitos, riesgos, anexos a firmar.
"""
import io
import json
import os
import re
import threading
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Tuple, Optional

from app.database import (DB_DIR, query_all, query_one, execute_insert, execute_commit)
from app.services import ai_provider


# ---------------------------------------------------------------- lectura de texto
def read_pages(file_bytes: bytes, filename: str) -> List[Tuple[int, str]]:
    ext = os.path.splitext(filename.lower())[1]
    pages: List[Tuple[int, str]] = []
    if ext == ".pdf":
        import pypdf
        reader = pypdf.PdfReader(io.BytesIO(file_bytes))
        for i, p in enumerate(reader.pages, start=1):
            try:
                txt = p.extract_text() or ""
            except Exception:
                txt = ""
            pages.append((i, txt))
    elif ext == ".docx":
        import docx
        document = docx.Document(io.BytesIO(file_bytes))
        parts = [p.text for p in document.paragraphs if p.text.strip()]
        for tbl in document.tables:
            for row in tbl.rows:
                parts.append(" | ".join(c.text.strip() for c in row.cells))
        pages.append((1, "\n".join(parts)))
    elif ext in (".xlsx", ".xlsm", ".xls"):
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
        for i, ws in enumerate(wb.worksheets, start=1):
            rows = []
            for r in ws.iter_rows(values_only=True):
                vals = [str(c).strip() for c in r if c is not None and str(c).strip()]
                if vals:
                    rows.append(" | ".join(vals))
            pages.append((i, "\n".join(rows)))
    else:
        pages.append((1, file_bytes.decode("utf-8", errors="ignore")))
    return pages


# ---------------------------------------------------------------- fechas
def _add_business_days(start: date, n: int) -> date:
    d = start
    while n > 0:
        d += timedelta(days=1)
        if d.weekday() < 5:
            n -= 1
    return d


def recompute_milestone_dates(folder_id: int) -> None:
    folder = query_one("SELECT publication_date FROM business_folders WHERE id = ?", (folder_id,))
    pub = (folder or {}).get("publication_date")
    if not pub:
        return
    try:
        base = datetime.strptime(pub[:10], "%Y-%m-%d").date()
    except Exception:
        return
    ms = query_all("SELECT * FROM folder_milestones WHERE folder_id = ? ORDER BY id", (folder_id,))
    dates: Dict[str, date] = {"PUBLICACION": base}
    for m in ms:
        if m["kind"] == "PUBLICACION":
            execute_commit("UPDATE folder_milestones SET due_date=? WHERE id=?", (base.isoformat(), m["id"]))
            continue
        anchor = dates.get(m["anchor"] or "PUBLICACION")
        n = m["offset_days"]
        if anchor is None or n is None:
            continue
        if m["offset_type"] == "HABILES":
            due = _add_business_days(anchor, n)
        else:
            due = anchor + timedelta(days=n)
        dates[m["kind"]] = due
        execute_commit("UPDATE folder_milestones SET due_date=? WHERE id=?", (due.isoformat(), m["id"]))
    close = dates.get("CIERRE")
    if close:
        execute_commit("UPDATE business_folders SET tender_closing_date=? WHERE id=?", (close.isoformat(), folder_id))


# ---------------------------------------------------------------- catálogo
def _match_catalog(name: str, specs: str) -> Optional[Dict[str, Any]]:
    """Cruza con el catálogo interno. Sólo devuelve coincidencia si es razonablemente confiable."""
    catalog = query_all("SELECT * FROM products WHERE is_active = 1")
    text = (name + " " + specs).upper()
    best, best_score = None, 0
    for prod in catalog:
        kws = [w for w in re.split(r"\W+", prod["name"].upper()) if len(w) > 3]
        score = sum(2 for kw in kws if kw in text)
        if prod["sku"].upper() in text:
            score += 10
        if score > best_score:
            best, best_score = prod, score
    if best and best_score >= 4:
        return {"sku": best["sku"], "cost": float(best["unit_cost"]), "price": float(best["unit_price"]), "unit": best["unit"]}
    return None


# ---------------------------------------------------------------- desglose de productos agrupados
def _strip_accents(s: str) -> str:
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", s or "") if unicodedata.category(c) != "Mn")


def _keyword(name: str) -> str:
    """Palabra distintiva de un nombre ('Polerón Micropolar' -> 'poleron')."""
    ws = [w for w in re.findall(r"[a-z0-9]{3,}", _strip_accents(name).lower()) if w not in ("para", "con", "tipo", "de", "del")]
    return ws[0] if ws else _strip_accents(name).lower()[:5]


def suggest_split_names(name: str, unit: str = "") -> List[str]:
    """Nombres candidatos cuando una fila agrupa varios artículos ('Pantalón/Calzas, Polerón y Pechera')."""
    parts = [x.strip(" .:-") for x in re.split(r"\s*,\s*|\s+y\s+|\s+e\s+", name or "") if x.strip(" .:-")]
    parts = [x for x in parts if 2 < len(x) <= 45]
    return parts if len(parts) >= 2 else []


def distribute_specs(spec_lines: List[str], names: List[str]) -> List[List[str]]:
    """Reparte las líneas de especificación entre los artículos. Líneas genéricas se copian a todos."""
    kws = [_keyword(n) for n in names]
    groups: List[List[str]] = [[] for _ in names]
    shared: List[str] = []
    current: Optional[List[int]] = None
    for ln in spec_lines:
        low = _strip_accents(ln).lower()
        hits = [i for i, k in enumerate(kws) if k and k in low]
        is_header = len(ln) <= 60 and hits and (low.rstrip().endswith(":") or len(low.split()) <= 4)
        if is_header:
            current = hits
            continue
        if hits:
            for i in hits:
                groups[i].append(ln)
        elif current is not None:
            for i in current:
                groups[i].append(ln)
        else:
            shared.append(ln)
    return [shared + g for g in groups]


def expand_grouped_products(products: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Garantiza una fila por prenda/artículo: divide productos agrupados (unidad 'Por Prenda', nombres con '/' o ',')."""
    out: List[Dict[str, Any]] = []
    for p in products:
        unit = (p.get("unit") or "").strip().lower()
        grouped_unit = unit in ("por prenda", "prenda", "prendas", "por set", "set", "por kit", "kit", "por juego")
        names = suggest_split_names(p.get("name", ""), unit)
        # sólo dividimos si hay evidencia clara: unidad agrupadora ("Por Prenda"). "Pantalón/Calzas" es UN artículo.
        if len(names) >= 2 and grouped_unit:
            groups = distribute_specs(p.get("specs") or [], names)
            for n, g in zip(names, groups):
                out.append({**p, "name": n, "specs": g, "unit": "UND" if grouped_unit else p.get("unit", "UND")})
        else:
            out.append(p)
    return out




# ---------------------------------------------------------------- jobs
def _set_job(job_id: int, **fields) -> None:
    cols = ", ".join(f"{k} = ?" for k in fields)
    execute_commit(f"UPDATE folder_analysis_jobs SET {cols} WHERE id = ?", tuple(fields.values()) + (job_id,))


def create_job(folder_id: int, document_id: int, filename: str) -> int:
    return execute_insert(
        "INSERT INTO folder_analysis_jobs (folder_id, document_id, filename, status, stage_msg) VALUES (?, ?, ?, 'PENDIENTE', 'En cola')",
        (folder_id, document_id, filename))


def start_job_async(job_id: int, folder_id: int, document_id: int, path: str, filename: str) -> None:
    import contextvars
    ctx = contextvars.copy_context()  # conserva la empresa activa (multi-empresa)
    t = threading.Thread(target=ctx.run, args=(run_job, job_id, folder_id, document_id, path, filename), daemon=True)
    t.start()


def run_job(job_id: int, folder_id: int, document_id: int, path: str, filename: str) -> None:
    try:
        _set_job(job_id, status="LEYENDO", stage_msg="Leyendo el documento (texto, tablas y páginas)…")
        with open(path, "rb") as f:
            data = f.read()
        pages = read_pages(data, filename)
        is_pdf = filename.lower().endswith(".pdf")
        ocr_note = ""
        if is_pdf:
            # Etapa OCR: páginas sin texto (escaneadas / imágenes) se leen como imagen
            empty = [n for n, t in pages if len((t or "").strip()) < 30]
            if empty:
                from app.services import ocr_service
                ok, why = ocr_service.available()
                if ok:
                    _set_job(job_id, status="LEYENDO", stage_msg=f"OCR: leyendo {len(empty)} página(s) escaneada(s)…")

                    def _prog(k, total):
                        _set_job(job_id, stage_msg=f"OCR: página {k} de {total} (escaneadas)…")
                    texts = ocr_service.ocr_pdf_pages(data, empty, _prog)
                    pages = [(n, texts.get(n) or t) if n in texts else (n, t) for n, t in pages]
                    ocr_note = f"OCR aplicado a {len(empty)} página(s) escaneada(s)."
                else:
                    ocr_note = f"{len(empty)} página(s) escaneadas sin leer: {why}"
            # Tablas (cantidades / descripciones) para que el análisis las vea ordenadas
            from app.services import ocr_service as _o
            tables = _o.extract_tables(data)
            if tables:
                pages = [(n, (t or "") + ("\n[TABLAS]\n" + tables[n] if n in tables else "")) for n, t in pages]
        total_text = sum(len(t or "") for _, t in pages)
        _set_job(job_id, pages=len(pages), status="ANALIZANDO",
                 stage_msg=f"Analizando {len(pages)} página(s) con IA…")
        # Guardar texto extraído para búsquedas futuras
        execute_commit("UPDATE tender_documents SET extracted_text = ? WHERE id = ?",
                       ("\n\f\n".join(t for _, t in pages)[:2_000_000], document_id))

        result, label, warnings = ai_provider.analyze(data, filename, pages)
        if ocr_note:
            warnings.append(ocr_note)
        if total_text < 50 and label == "Reglas locales":
            raise RuntimeError("El documento no contiene texto legible y no se pudo aplicar OCR. " + ocr_note)

        _set_job(job_id, stage_msg="Configurando la carpeta (productos, checklist, hitos, riesgos)…", provider=label)
        summary = persist_result(folder_id, document_id, filename, result, warnings)
        _set_job(job_id, status="LISTO", stage_msg=summary, finished_at=datetime.now().isoformat(sep=" ", timespec="seconds"),
                 error="\n".join(warnings) if warnings else None)
    except Exception as e:  # noqa
        _set_job(job_id, status="ERROR", stage_msg="Error en el análisis", error=str(e)[:900],
                 finished_at=datetime.now().isoformat(sep=" ", timespec="seconds"))


# ---------------------------------------------------------------- persistencia
SIGN_DOC_CATEGORIES = {"DECLARACION", "ANEXO", "ANEXO_OFERTA"}


def persist_result(folder_id: int, document_id: int, source: str, r: Dict[str, Any], warnings: List[str]) -> str:
    folder = query_one("SELECT * FROM business_folders WHERE id = ?", (folder_id,))

    # Limpiar resultados previos de IA de este mismo archivo (re-análisis idempotente)
    execute_commit("DELETE FROM folder_requested_items WHERE folder_id=? AND source_doc=? AND status LIKE 'IA_%'", (folder_id, source))
    execute_commit("DELETE FROM folder_checklist_items WHERE folder_id=? AND source_doc=?", (folder_id, source))
    execute_commit("DELETE FROM folder_risks WHERE folder_id=? AND source_doc=?", (folder_id, source))
    execute_commit("DELETE FROM tender_documents WHERE folder_id=? AND detected_by_ai=1 AND original_filename=? AND status != 'FIRMADO'",
                   (folder_id, "[" + source + "]"))

    meta = r.get("meta") or {}
    # --- Productos
    n_prod = 0
    base_n = query_one("SELECT COALESCE(MAX(item_number),0) AS m FROM folder_requested_items WHERE folder_id=?", (folder_id,))["m"]
    for p in expand_grouped_products(r.get("products", [])):
        i = n_prod + 1
        specs = p.get("specs") or []
        specs_txt = "\n".join(specs) if specs else (p.get("description") or "")
        cat = _match_catalog(p["name"], specs_txt)
        execute_insert("""
            INSERT INTO folder_requested_items (folder_id, item_number, product_name, technical_specs, quantity, unit,
                estimated_cost, offered_price, matched_sku, source_doc, status, source_page)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'IA_PROPUESTO', ?)
        """, (folder_id, base_n + i, p["name"], specs_txt, p["quantity"], (cat or {}).get("unit") or p["unit"],
              (cat or {}).get("cost", 0), (cat or {}).get("price", 0), (cat or {}).get("sku") or "POR COTIZAR",
              source, p.get("page")))
        n_prod += 1

    # --- Documentos / checklist
    n_docs = n_sign = 0
    for dct in r.get("documents", []):
        category = (dct.get("category") or "DOCUMENTO").upper()
        sign = bool(dct.get("requires_signature"))
        doc_id = None
        if category in SIGN_DOC_CATEGORIES or sign:
            doc_id = execute_insert("""
                INSERT INTO tender_documents (folder_id, name, doc_type, original_filename, form_data_json, status,
                    requires_signature, is_mandatory, detected_by_ai)
                VALUES (?, ?, ?, ?, '{}', 'BORRADOR', ?, ?, 1)
            """, (folder_id, dct["title"][:200], "ANEXO_OFERTA" if category == "ANEXO_OFERTA" else "ANEXO_DECLARACION",
                  "[" + source + "]", 1 if sign else 0, 1 if dct.get("mandatory", True) else 0))
        t_lower = (dct["title"] + " " + (dct.get("detail") or "")).lower()
        if "conflicto" in t_lower or "inhabilidad" in t_lower:
            ccat = "REQUISITO_OBLIGATORIO"
        elif any(w in t_lower for w in ("económ", "precio", "anexo 3", "anexo n° 3", "anexo n°3", "anexo iii", "cotiz", "presupuesto")):
            ccat = "ECONOMICO"
        elif any(w in t_lower for w in ("ficha", "norma", "iso", "nch", "ensayo", "laboratorio", "certific", "muestra", "caltex", "cesmec", "lictex", "idic")):
            ccat = "TECNICO"
        elif any(w in t_lower for w in ("patente", "estatuto", "vigencia", "cédula", "f30", "habilidad", "experiencia")):
            ccat = "ADMINISTRATIVO"
        elif category == "EXCLUYENTE":
            ccat = "EXCLUYENTE"
        elif sign:
            ccat = "FIRMA"
        elif category == "GARANTIA":
            ccat = "GARANTIA"
        else:
            ccat = "DOCUMENTO"
        execute_insert("""
            INSERT INTO folder_checklist_items (folder_id, category, title, detail, is_mandatory, requires_signature,
                source_doc, source_page, document_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (folder_id, ccat, dct["title"][:250], dct.get("detail"), 1 if dct.get("mandatory", True) else 0,
              1 if sign else 0, source, dct.get("page"), doc_id))
        n_docs += 1
        n_sign += 1 if sign else 0

    # --- Documentos y antecedentes administrativos a adjuntar (Patente, Estatutos, Cédula rep, F30/F30-1, Experiencia)
    for ad in r.get("admin_documents", []):
        execute_insert("""
            INSERT INTO folder_checklist_items (folder_id, category, title, detail, is_mandatory, requires_signature,
                source_doc, source_page)
            VALUES (?, 'ADMINISTRATIVO', ?, ?, ?, 0, ?, ?)
        """, (folder_id, ad["title"][:250], ad.get("detail"), 1 if ad.get("mandatory", True) else 0,
              source, ad.get("page")))
        n_docs += 1

    # --- Criterios de evaluación y ponderaciones
    if r.get("evaluation_criteria"):
        execute_commit("DELETE FROM folder_evaluation_criteria WHERE folder_id=?", (folder_id,))
        for ec in r.get("evaluation_criteria", []):
            execute_insert("""
                INSERT INTO folder_evaluation_criteria (folder_id, criterion, weight_pct, detail, source_page)
                VALUES (?, ?, ?, ?, ?)
            """, (folder_id, ec.get("criterion") or "Criterio", float(ec.get("weight_pct") or 0), ec.get("detail"), ec.get("page")))

    # --- Muestras
    sm = r.get("samples") or {}
    if sm.get("required"):
        execute_insert("""
            INSERT INTO folder_checklist_items (folder_id, category, title, detail, due_date, place, source_doc, source_page)
            VALUES (?, 'MUESTRA', 'Entrega de muestras', ?, ?, ?, ?, ?)
        """, (folder_id, sm.get("detail"), sm.get("deadline"), sm.get("place"), source, sm.get("page")))

    # --- Hitos (se reemplazan los de la carpeta: provienen del análisis de las bases)
    if r.get("milestones"):
        execute_commit("DELETE FROM folder_milestones WHERE folder_id=?", (folder_id,))
    for m in r.get("milestones", []):
        dt_val = m.get("date")
        if m.get("time") and dt_val:
            dt_val = f"{dt_val} {m.get('time')}"
        elif m.get("datetime_str"):
            dt_val = m.get("datetime_str")
        kind_val = (m.get("kind") or "OTRO").upper()
        execute_insert("""
            INSERT INTO folder_milestones (folder_id, kind, title, rule_text, anchor, offset_days, offset_type, due_date, source_page)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (folder_id, kind_val, m.get("title") or "Hito", m.get("rule_text"), m.get("anchor"),
              m.get("offset_days"), m.get("offset_type") or "CORRIDOS", dt_val, m.get("page")))
        if kind_val in ("CIERRE", "CIERRE_OFERTAS") and dt_val:
            execute_commit("UPDATE business_folders SET tender_closing_date=? WHERE id=?", (dt_val[:10], folder_id))
        elif kind_val == "PUBLICACION" and dt_val:
            execute_commit("UPDATE business_folders SET publication_date=? WHERE id=?", (dt_val[:10], folder_id))

    # --- Riesgos
    for k in r.get("risks", []):
        execute_insert("""
            INSERT INTO folder_risks (folder_id, kind, title, detail, severity, source_doc, source_page)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (folder_id, k.get("kind") or "CONDICION", (k.get("title") or "")[:250], k.get("detail"),
              (k.get("severity") or "MEDIA").upper(), source, k.get("page")))

    # --- Datos de la carpeta
    summary_prev = {}
    try:
        summary_prev = json.loads((folder or {}).get("analysis_summary") or "{}")
    except Exception:
        pass
    summary_prev.update({
        "meta": meta,
        "samples": sm,
        "evaluation_criteria": r.get("evaluation_criteria", []),
        "admin_documents": r.get("admin_documents", []),
        "warnings": warnings,
        "source": source
    })
    execute_commit("UPDATE business_folders SET analysis_summary=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                   (json.dumps(summary_prev, ensure_ascii=False), folder_id))
    if meta.get("tender_id") and not (folder or {}).get("tender_id"):
        execute_commit("UPDATE business_folders SET tender_id=? WHERE id=?", (meta["tender_id"], folder_id))
    if meta.get("budget") and not (folder or {}).get("budget_amount"):
        execute_commit("UPDATE business_folders SET budget_amount=? WHERE id=?", (meta["budget"], folder_id))
    recompute_milestone_dates(folder_id)

    return (f"{n_prod} producto(s), {n_docs} documento(s)/requisito(s) ({n_sign} con firma), "
            f"{len(r.get('milestones', []))} hito(s), {len(r.get('risks', []))} punto(s) crítico(s)"
            + (" · muestras exigidas" if sm.get("required") else " · sin muestras"))
