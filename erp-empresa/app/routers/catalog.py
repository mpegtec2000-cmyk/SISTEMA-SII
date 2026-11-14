"""Catálogo: importación de Excel con enlaces web, fichas técnicas editables y catálogos PDF.

Endpoint principal: POST /api/catalog/import-url-excel
"""
import contextvars
import json
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from app.database import execute_commit, execute_insert, query_all, query_one
from app.services import catalog_service as cs
from app.services.inventory_service import generate_barcode, generate_sku

router = APIRouter(prefix="/api/catalog", tags=["Catálogo"])

_JOBS: Dict[str, Dict[str, Any]] = {}


def _shape(p: Dict[str, Any]) -> Dict[str, Any]:
    try:
        p["specs"] = json.loads(p.get("specs_json") or "{}")
    except Exception:
        p["specs"] = {}
    p["has_image"] = bool(p.get("image_path"))
    return p


# ---------------------------------------------------------------- importación
def _upsert(item: Dict[str, Any], update_existing: bool) -> Dict[str, Any]:
    sku = item.get("sku") or generate_sku(item.get("category") or "General")
    existing = query_one("SELECT * FROM products WHERE sku = ?", (sku,))
    specs_json = json.dumps(item.get("specs") or {}, ensure_ascii=False)
    if existing:
        if not update_existing:
            return {"id": existing["id"], "sku": sku, "action": "omitido"}
        old_specs = {}
        try:
            old_specs = json.loads(existing.get("specs_json") or "{}")
        except Exception:
            pass
        merged = {**old_specs, **(item.get("specs") or {})}
        execute_commit("""UPDATE products SET name=?, description=?, category=?, brand=?, source_url=?, image_url=?,
            specs_json=?, norms=?, warranty=?, unit=?,
            unit_price=CASE WHEN ? > 0 THEN ? ELSE unit_price END,
            unit_cost=CASE WHEN ? > 0 THEN ? ELSE unit_cost END
            WHERE id=?""",
                       (item["name"] or existing["name"], item.get("description") or existing.get("description"),
                        item.get("category") or existing.get("category"), item.get("brand") or existing.get("brand"),
                        item.get("source_url") or existing.get("source_url"),
                        item.get("image_url") or existing.get("image_url"),
                        json.dumps(merged, ensure_ascii=False), item.get("norms") or existing.get("norms"),
                        item.get("warranty") or existing.get("warranty"), item.get("unit") or existing.get("unit"),
                        item.get("unit_price", 0), item.get("unit_price", 0),
                        item.get("unit_cost", 0), item.get("unit_cost", 0), existing["id"]))
        return {"id": existing["id"], "sku": sku, "action": "actualizado"}
    pid = execute_insert("""INSERT INTO products (sku, barcode, name, description, category, unit, unit_cost, unit_price,
        stock_physical, stock_reserved, stock_min, is_active, brand, source_url, image_url, specs_json, norms, warranty, in_catalog)
        VALUES (?,?,?,?,?,?,?,?,?,0,5,1,?,?,?,?,?,?,1)""",
                        (sku, generate_barcode(sku), item["name"], item.get("description"), item.get("category") or "General",
                         item.get("unit") or "UND", item.get("unit_cost", 0), item.get("unit_price", 0), item.get("stock", 0),
                         item.get("brand"), item.get("source_url"), item.get("image_url"), specs_json,
                         item.get("norms"), item.get("warranty")))
    if item.get("stock", 0) > 0:
        execute_insert("""INSERT INTO inventory_movements (product_id, sku, type, quantity, reference_doc, reference_type, notes)
            VALUES (?, ?, 'ENTRADA', ?, 'IMPORT', 'AJUSTE', 'Carga desde Excel de catálogo')""", (pid, sku, item["stock"]))
    return {"id": pid, "sku": sku, "action": "creado"}


def _apply_scrape(product_id: int, scraped: Dict[str, Any], overwrite: bool = False) -> None:
    """Completa la ficha con lo descargado; por defecto no pisa lo que ya viene del Excel o fue editado."""
    cur = query_one("SELECT * FROM products WHERE id = ?", (product_id,))
    if not cur:
        return
    try:
        specs = json.loads(cur.get("specs_json") or "{}")
    except Exception:
        specs = {}
    for k, v in (scraped.get("specs") or {}).items():
        if overwrite or k not in specs:
            specs[k] = v
    norms = cur.get("norms") or ""
    if scraped.get("norms") and (overwrite or not norms):
        norms = ", ".join(scraped["norms"])
    img_path = cur.get("image_path")
    img_url = cur.get("image_url") or scraped.get("image_url") or ""
    if scraped.get("image_url") and (overwrite or not img_path):
        img_url = scraped["image_url"] if overwrite or not cur.get("image_url") else cur["image_url"]
    if img_url and (overwrite or not img_path):
        img_path = cs.download_image(img_url, cur["sku"]) or img_path
    name = cur["name"]
    if scraped.get("name") and (overwrite or name.startswith("Producto ")):
        name = scraped["name"]
    status = "OK" if scraped.get("ok") else f"Sin datos: {scraped.get('error') or 'sin información'}"
    execute_commit("""UPDATE products SET name=?, description=?, brand=?, specs_json=?, norms=?, image_url=?, image_path=?,
        datasheet_url=?, scrape_status=? WHERE id=?""",
                   (name, cur.get("description") if (cur.get("description") and not overwrite) else (scraped.get("description") or cur.get("description")),
                    cur.get("brand") if (cur.get("brand") and not overwrite) else (scraped.get("brand") or cur.get("brand")),
                    json.dumps(specs, ensure_ascii=False), norms, img_url, img_path,
                    scraped.get("datasheet_url") or cur.get("datasheet_url"), status, product_id))


def _run_import(job_id: str, items: List[Dict[str, Any]], fetch_web: bool, update_existing: bool) -> None:
    job = _JOBS[job_id]
    try:
        job.update(status="GUARDANDO", message="Guardando productos…")
        saved = []
        for it in items:
            try:
                r = _upsert(it, update_existing)
                saved.append((r, it))
                job["counts"][r["action"]] = job["counts"].get(r["action"], 0) + 1
            except Exception as e:
                job["errors"].append(f"{it.get('name')}: {e}")
        targets = [(r, it) for r, it in saved if fetch_web and it.get("source_url") and r["action"] != "omitido"]
        job["total_web"] = len(targets)
        if targets:
            job.update(status="DESCARGANDO", message=f"Descargando fichas técnicas de {len(targets)} enlace(s)…")
            with ThreadPoolExecutor(max_workers=6) as pool:
                futures = [(r, pool.submit(cs.scrape_product, it["source_url"])) for r, it in targets]
                for r, fut in futures:
                    scraped = fut.result()
                    _apply_scrape(r["id"], scraped)
                    job["done_web"] += 1
                    job["web_ok" if scraped.get("ok") else "web_fail"] += 1
                    if not scraped.get("ok"):
                        job["errors"].append(f"{r['sku']}: {scraped.get('error')}")
        job.update(status="LISTO", message="Importación finalizada")
    except Exception as e:
        job.update(status="ERROR", message=str(e))
    job["finished"] = time.time()


@router.post("/import-url-excel")
async def import_url_excel(file: UploadFile = File(...), fetch_web: bool = Form(True), update_existing: bool = Form(True)):
    """Sube un Excel/CSV con códigos, nombres, precios y links; descarga fichas técnicas e imágenes desde los links."""
    data = await file.read()
    try:
        columns, rows = cs.read_table(data, file.filename or "")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"No se pudo leer el archivo: {e}")
    mapping = cs.autodetect_mapping(columns)
    items = cs.rows_to_products(rows, mapping)
    job_id = uuid.uuid4().hex[:10]
    _JOBS[job_id] = {"job_id": job_id, "status": "PENDIENTE", "message": "En cola", "total": len(items),
                     "total_web": 0, "done_web": 0, "web_ok": 0, "web_fail": 0, "counts": {}, "errors": [],
                     "filename": file.filename, "started": time.time(),
                     "mapping": {k: v for k, v in mapping.items() if v}}
    ctx = contextvars.copy_context()  # conserva la empresa activa
    threading.Thread(target=ctx.run, args=(_run_import, job_id, items, fetch_web, update_existing), daemon=True).start()
    return {"job_id": job_id, "total": len(items), "mapping": _JOBS[job_id]["mapping"],
            "links_detected": sum(1 for i in items if i.get("source_url"))}


class DirectUrlsModel(BaseModel):
    urls: List[str]
    category: Optional[str] = "Catálogo Web"
    unit_price: Optional[float] = 0.0
    unit_cost: Optional[float] = 0.0
    stock: Optional[float] = 0.0


@router.post("/import-direct-urls")
def import_direct_urls(body: DirectUrlsModel):
    """
    Permite pegar 1 o varios links directos de productos en la web para extraer toda su información
    (nombre, ficha técnica, especificaciones, normas e imagen) y crear la ficha de catálogo sin Excel.
    """
    clean_urls = [u.strip() for u in (body.urls or []) if u and u.strip().startswith(("http://", "https://"))]
    if not clean_urls:
        raise HTTPException(status_code=400, detail="Ingresa al menos un enlace web válido (http:// o https://)")

    items = []
    for idx, url in enumerate(clean_urls, start=1):
        items.append({
            "name": f"Producto Web #{idx}",
            "category": body.category or "Catálogo Web",
            "source_url": url,
            "unit_price": float(body.unit_price or 0),
            "unit_cost": float(body.unit_cost or 0),
            "stock": float(body.stock or 0),
            "unit": "UND",
            "specs": {},
        })

    job_id = uuid.uuid4().hex[:10]
    _JOBS[job_id] = {
        "job_id": job_id,
        "status": "PENDIENTE",
        "message": "Extrayendo información desde enlaces web…",
        "total": len(items),
        "total_web": len(items),
        "done_web": 0,
        "web_ok": 0,
        "web_fail": 0,
        "counts": {},
        "errors": [],
        "filename": "Enlaces directos",
        "started": time.time(),
        "mapping": {"source_url": "URL Directa"},
    }
    ctx = contextvars.copy_context()
    threading.Thread(target=ctx.run, args=(_run_import, job_id, items, True, True), daemon=True).start()
    return {
        "job_id": job_id,
        "total": len(items),
        "links_detected": len(items),
        "message": f"Procesando {len(items)} enlace(s) web en segundo plano…"
    }


@router.get("/import-status/{job_id}")
def import_status(job_id: str):
    job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Importación no encontrada")
    return {**job, "errors": job["errors"][:30]}


@router.get("/template")
def download_template():
    return Response(cs.template_xlsx(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": 'attachment; filename="Plantilla_Catalogo_con_Links.xlsx"'})


# ---------------------------------------------------------------- fichas editables
@router.get("/products")
def list_products(q: str = "", category: str = ""):
    sql, params = "SELECT * FROM products WHERE is_active = 1", []
    if q:
        sql += " AND (name LIKE ? OR sku LIKE ? OR brand LIKE ?)"
        params += [f"%{q}%"] * 3
    if category:
        sql += " AND category = ?"
        params.append(category)
    return [_shape(p) for p in query_all(sql + " ORDER BY category, name", tuple(params))]


@router.get("/products/{product_id}")
def get_product(product_id: int):
    p = query_one("SELECT * FROM products WHERE id = ?", (product_id,))
    if not p:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    return _shape(p)


class ProductSheetModel(BaseModel):
    name: str
    sku: Optional[str] = None
    category: Optional[str] = "General"
    description: Optional[str] = ""
    brand: Optional[str] = ""
    norms: Optional[str] = ""
    warranty: Optional[str] = ""
    source_url: Optional[str] = ""
    image_url: Optional[str] = ""
    datasheet_url: Optional[str] = ""
    unit: Optional[str] = "UND"
    unit_cost: float = 0
    unit_price: float = 0
    specs: Dict[str, str] = {}
    in_catalog: bool = True


@router.put("/products/{product_id}")
def update_sheet(product_id: int, d: ProductSheetModel):
    cur = query_one("SELECT * FROM products WHERE id = ?", (product_id,))
    if not cur:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    img_path = cur.get("image_path")
    if d.image_url and d.image_url != cur.get("image_url"):
        img_path = cs.download_image(d.image_url, cur["sku"]) or img_path
    specs = {k.strip(): v for k, v in d.specs.items() if k.strip()}
    execute_commit("""UPDATE products SET name=?, category=?, description=?, brand=?, norms=?, warranty=?, source_url=?,
        image_url=?, image_path=?, datasheet_url=?, unit=?, unit_cost=?, unit_price=?, specs_json=?, in_catalog=? WHERE id=?""",
                   (d.name, d.category, d.description, d.brand, d.norms, d.warranty, d.source_url, d.image_url, img_path,
                    d.datasheet_url, d.unit, d.unit_cost, d.unit_price, json.dumps(specs, ensure_ascii=False),
                    1 if d.in_catalog else 0, product_id))
    return {"message": "Ficha actualizada"}


@router.post("/products/{product_id}/refetch")
def refetch(product_id: int, overwrite: bool = False):
    cur = query_one("SELECT * FROM products WHERE id = ?", (product_id,))
    if not cur:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    if not cur.get("source_url"):
        raise HTTPException(status_code=400, detail="El producto no tiene enlace web")
    scraped = cs.scrape_product(cur["source_url"])
    _apply_scrape(product_id, scraped, overwrite=overwrite)
    return {"ok": scraped.get("ok"), "error": scraped.get("error"), "product": _shape(query_one("SELECT * FROM products WHERE id = ?", (product_id,)))}


@router.post("/products/{product_id}/image")
async def upload_image(product_id: int, file: UploadFile = File(...)):
    cur = query_one("SELECT * FROM products WHERE id = ?", (product_id,))
    if not cur:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    path = cs.save_image_bytes(await file.read(), cur["sku"])
    if not path:
        raise HTTPException(status_code=400, detail="La imagen no es válida")
    execute_commit("UPDATE products SET image_path = ? WHERE id = ?", (path, product_id))
    return {"message": "Imagen actualizada"}


@router.get("/products/{product_id}/image")
def get_image(product_id: int):
    import os
    p = query_one("SELECT image_path FROM products WHERE id = ?", (product_id,))
    if not p or not p.get("image_path") or not os.path.exists(p["image_path"]):
        raise HTTPException(status_code=404, detail="Sin imagen")
    return FileResponse(p["image_path"], media_type="image/jpeg", headers={"Cache-Control": "no-cache"})


# ---------------------------------------------------------------- catálogo PDF
class CatalogRequest(BaseModel):
    product_ids: List[int] = []
    title: str = "Catálogo de Productos"
    subtitle: str = ""
    per_page: int = 2
    show_prices: bool = False
    norms_matrix: bool = True
    use_cover: bool = True


@router.post("/generate-pdf")
def generate_pdf(req: CatalogRequest):
    if req.product_ids:
        marks = ",".join("?" for _ in req.product_ids)
        prods = query_all(f"SELECT * FROM products WHERE id IN ({marks}) AND is_active = 1 ORDER BY category, name",
                          tuple(req.product_ids))
    else:
        prods = query_all("SELECT * FROM products WHERE is_active = 1 AND in_catalog = 1 ORDER BY category, name")
    if not prods:
        raise HTTPException(status_code=400, detail="No hay productos seleccionados para el catálogo")
    _ensure_extra_tables()
    prods = [_shape(p) for p in prods]
    for p in prods:
        p["show_price"] = req.show_prices
        p["gallery_paths"] = [g["path"] for g in _gallery(p["id"])]
    cv = query_one("SELECT * FROM catalog_cover WHERE id = 1") or {}
    from app.database import current_company_id
    company = query_one("SELECT * FROM companies WHERE id = ?", (current_company_id(),)) or query_one("SELECT * FROM companies ORDER BY id LIMIT 1") or {}
    pdf = cs.build_catalog_pdf(prods, req.title, req.subtitle, company, per_page=max(1, min(req.per_page, 4)),
                               norms_matrix=req.norms_matrix,
                               cover_path=cv.get("cover_path") if req.use_cover else None,
                               logo_path=(cv.get("logo_path") or __import__("app.services.branding", fromlist=["x"]).company_logo_path()) if req.use_cover else None)
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": 'attachment; filename="Catalogo_Productos.pdf"'})



# ---------------------------------------------------------------- galería de imágenes por producto
def _ensure_extra_tables():
    execute_commit("""CREATE TABLE IF NOT EXISTS product_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, path TEXT NOT NULL, sort_order INTEGER DEFAULT 0)""")
    execute_commit("""CREATE TABLE IF NOT EXISTS catalog_cover (
        id INTEGER PRIMARY KEY CHECK (id = 1), title TEXT, subtitle TEXT, cover_path TEXT, logo_path TEXT)""")


def _gallery(product_id: int) -> List[Dict[str, Any]]:
    import os
    _ensure_extra_tables()
    rows = [r for r in query_all("SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order, id", (product_id,))
            if r.get("path") and os.path.exists(r["path"])]
    if not rows:
        p = query_one("SELECT image_path FROM products WHERE id = ?", (product_id,)) or {}
        if p.get("image_path") and os.path.exists(p["image_path"]):
            execute_insert("INSERT INTO product_images (product_id, path, sort_order) VALUES (?,?,0)", (product_id, p["image_path"]))
            rows = query_all("SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order, id", (product_id,))
    return rows


def _sync_primary(product_id: int):
    rows = _gallery(product_id)
    execute_commit("UPDATE products SET image_path = ? WHERE id = ?", (rows[0]["path"] if rows else None, product_id))


def _gallery_out(product_id: int) -> List[Dict[str, Any]]:
    return [{"id": r["id"], "url": f"/api/catalog/images/{r['id']}/file?t={r['id']}", "position": i + 1}
            for i, r in enumerate(_gallery(product_id))]


@router.get("/products/{product_id}/images")
def list_images(product_id: int):
    if not query_one("SELECT id FROM products WHERE id = ?", (product_id,)):
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    return _gallery_out(product_id)


@router.post("/products/{product_id}/images")
async def add_images(product_id: int, files: List[UploadFile] = File(default=[]), url: str = Form("")):
    import uuid as _uuid
    cur = query_one("SELECT * FROM products WHERE id = ?", (product_id,))
    if not cur:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    _gallery(product_id)  # migra la imagen principal existente a la galería
    added = 0
    nxt = (query_one("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM product_images WHERE product_id = ?", (product_id,)) or {"n": 0})["n"]
    for f in files or []:
        path = cs.save_image_bytes(await f.read(), f"{cur['sku']}_g{_uuid.uuid4().hex[:8]}")
        if path:
            execute_insert("INSERT INTO product_images (product_id, path, sort_order) VALUES (?,?,?)", (product_id, path, nxt))
            nxt += 1
            added += 1
    if url.strip():
        path = cs.download_image(url.strip(), f"{cur['sku']}_g{_uuid.uuid4().hex[:8]}")
        if path:
            execute_insert("INSERT INTO product_images (product_id, path, sort_order) VALUES (?,?,?)", (product_id, path, nxt))
            added += 1
        else:
            raise HTTPException(status_code=400, detail="No se pudo descargar una imagen válida desde esa URL")
    if not added:
        raise HTTPException(status_code=400, detail="No se recibió ninguna imagen válida")
    _sync_primary(product_id)
    return {"message": f"{added} imagen(es) agregada(s)", "images": _gallery_out(product_id)}


@router.get("/images/{image_id}/file")
def image_file(image_id: int):
    import os
    _ensure_extra_tables()
    r = query_one("SELECT path FROM product_images WHERE id = ?", (image_id,))
    if not r or not os.path.exists(r["path"]):
        raise HTTPException(status_code=404, detail="Imagen no encontrada")
    return FileResponse(r["path"], media_type="image/jpeg", headers={"Cache-Control": "no-cache"})


@router.delete("/images/{image_id}")
def delete_image(image_id: int):
    _ensure_extra_tables()
    r = query_one("SELECT * FROM product_images WHERE id = ?", (image_id,))
    if not r:
        raise HTTPException(status_code=404, detail="Imagen no encontrada")
    execute_commit("DELETE FROM product_images WHERE id = ?", (image_id,))
    _sync_primary(r["product_id"])
    return {"message": "Imagen eliminada", "images": _gallery_out(r["product_id"])}


class ImageOrder(BaseModel):
    ids: List[int]


@router.put("/products/{product_id}/images/order")
def reorder_images(product_id: int, d: ImageOrder):
    valid = {r["id"] for r in _gallery(product_id)}
    pos = 0
    for i in d.ids:
        if i in valid:
            execute_commit("UPDATE product_images SET sort_order = ? WHERE id = ? AND product_id = ?", (pos, i, product_id))
            pos += 1
    for i in valid - set(d.ids):  # los no listados van al final
        execute_commit("UPDATE product_images SET sort_order = ? WHERE id = ?", (pos, i))
        pos += 1
    _sync_primary(product_id)
    return {"message": "Orden actualizado", "images": _gallery_out(product_id)}


# ---------------------------------------------------------------- portada del catálogo
def _cover_public() -> Dict[str, Any]:
    import os
    _ensure_extra_tables()
    r = query_one("SELECT * FROM catalog_cover WHERE id = 1") or {}
    return {"title": r.get("title") or "Catálogo de Productos", "subtitle": r.get("subtitle") or "",
            "has_cover": bool(r.get("cover_path") and os.path.exists(r["cover_path"])),
            "has_logo": bool(r.get("logo_path") and os.path.exists(r["logo_path"]))}


@router.get("/cover")
def get_cover():
    return _cover_public()


class CoverModel(BaseModel):
    title: str = "Catálogo de Productos"
    subtitle: str = ""


@router.put("/cover")
def put_cover(d: CoverModel):
    _ensure_extra_tables()
    execute_commit("""INSERT INTO catalog_cover (id, title, subtitle) VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET title=excluded.title, subtitle=excluded.subtitle""", (d.title, d.subtitle))
    return _cover_public()


@router.post("/cover/{kind}")
async def upload_cover_asset(kind: str, file: UploadFile = File(...)):
    """kind = cover (imagen de portada) | logo."""
    import io
    import os
    import re as _re
    from PIL import Image
    from app.database import tenant_file_prefix
    if kind not in ("cover", "logo"):
        raise HTTPException(status_code=404, detail="Tipo inválido")
    raw = await file.read()
    try:
        im = Image.open(io.BytesIO(raw))
        im.load()
    except Exception:
        raise HTTPException(status_code=400, detail="La imagen no es válida")
    os.makedirs(cs.IMAGES_DIR, exist_ok=True)
    if kind == "logo":
        im = im.convert("RGBA")
        im.thumbnail((900, 450))
        path = os.path.join(cs.IMAGES_DIR, f"{tenant_file_prefix()}catalog_logo.png")
        im.save(path, "PNG")
        col = "logo_path"
    else:
        im = im.convert("RGB")
        im.thumbnail((2000, 2800))
        path = os.path.join(cs.IMAGES_DIR, f"{tenant_file_prefix()}catalog_cover.jpg")
        im.save(path, "JPEG", quality=88)
        col = "cover_path"
    _ensure_extra_tables()
    execute_commit(f"""INSERT INTO catalog_cover (id, {col}) VALUES (1, ?)
        ON CONFLICT(id) DO UPDATE SET {col}=excluded.{col}""", (path,))
    return _cover_public()


@router.delete("/cover/{kind}")
def delete_cover_asset(kind: str):
    if kind not in ("cover", "logo"):
        raise HTTPException(status_code=404, detail="Tipo inválido")
    _ensure_extra_tables()
    execute_commit(f"UPDATE catalog_cover SET {'cover_path' if kind == 'cover' else 'logo_path'} = NULL WHERE id = 1")
    return _cover_public()


@router.get("/cover/{kind}/file")
def cover_asset_file(kind: str):
    import os
    _ensure_extra_tables()
    r = query_one("SELECT * FROM catalog_cover WHERE id = 1") or {}
    path = r.get("cover_path" if kind == "cover" else "logo_path")
    if not path or not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Sin imagen")
    return FileResponse(path, headers={"Cache-Control": "no-cache"})
