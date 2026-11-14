"""Comparador de cotizaciones de proveedores por Carpeta de Negocio (costeo inteligente)."""
import os
import re
import unicodedata
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from app.database import DB_DIR, execute_commit, execute_insert, query_all, query_one, tenant_file_prefix
from app.models import formatear_rut
from app.services import ai_provider
from app.services.document_pipeline import read_pages

router = APIRouter(prefix="/api/supplier-quotes", tags=["Comparador de Proveedores"])

RUT_RE = re.compile(r"\b(\d{1,2}\.?\d{3}\.?\d{3}-[\dkK])\b")
NUM_RE = re.compile(r"(?<![\w.,])\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?(?![\w])|(?<![\w.,])\d+(?:,\d{1,2})?(?![\w])")


def _num(tok: str) -> float:
    t = tok.replace(".", "").replace(",", ".")
    try:
        return float(t)
    except ValueError:
        return 0.0


def _words(s: str) -> set:
    s = unicodedata.normalize("NFD", (s or "").lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return {w for w in re.findall(r"[a-z0-9]{3,}", s)}


def _match_item(desc: str, items: List[Dict[str, Any]]) -> Optional[int]:
    dw = _words(desc)
    best, best_score = None, 0.0
    for it in items:
        iw = _words(it["product_name"])
        if not iw or not dw:
            continue
        score = len(dw & iw) / min(len(iw), len(dw))
        if score > best_score:
            best, best_score = it["id"], score
    return best if best_score >= 0.5 else None


def _heuristic_lines(text: str) -> Dict[str, Any]:
    head = text[:3000]
    supplier = ""
    for ln in head.splitlines():
        if re.search(r"\b(S\.?A\.?|SpA|Ltda\.?|Limitada|E\.?I\.?R\.?L\.?|Comercial|Distribuidora|Importadora)\b", ln, re.I) and len(ln.strip()) < 90:
            supplier = ln.strip()
            break
    ruts = RUT_RE.findall(text)
    ref = re.search(r"cotizaci[oó]n\s*(?:n[°ºo.]*)?\s*[:#]?\s*([A-Za-z0-9\-]+)", text, re.I)
    lead = re.search(r"(?:plazo\s+de\s+entrega|entrega)[^\n]{0,40}?(\d{1,3})\s*(d[ií]as|semanas)", text, re.I)
    lead_days = None
    if lead:
        lead_days = int(lead.group(1)) * (7 if lead.group(2).lower().startswith("sem") else 1)
    lines = []
    for raw in text.splitlines():
        ln = raw.strip()
        if len(ln) < 8 or not re.search(r"[A-Za-zÁÉÍÓÚáéíóú]{3,}", ln):
            continue
        if re.search(r"\b(subtotal|total|iva|neto|descuento|flete|rut|tel[eé]fono|fecha|v[aá]lid)\b", ln, re.I):
            continue
        nums = [(m.group(0), m.start()) for m in NUM_RE.finditer(ln)]
        if len(nums) < 2:
            continue
        vals = [_num(t) for t, _ in nums]
        qty = unit = None
        if len(vals) >= 3:
            for i in range(len(vals) - 2):
                q, u, t = vals[i], vals[i + 1], vals[i + 2]
                if q > 0 and u > 0 and abs(q * u - t) <= max(2, 0.02 * t):
                    qty, unit, desc_end = q, u, nums[i][1]
                    break
        if unit is None:
            small, big = sorted(vals[-2:])
            if small <= 100000 and big >= 100 and float(small).is_integer():
                qty, unit, desc_end = small, big, nums[-2][1]
        if unit is None or unit <= 0:
            continue
        desc = ln[:desc_end].strip(" -–:|\t")
        if len(desc) < 3:
            continue
        sku = ""
        m = re.match(r"^([A-Z0-9][A-Z0-9\-_/.]{2,20})\s+(.+)$", desc)
        if m and re.search(r"\d", m.group(1)):
            sku, desc = m.group(1), m.group(2)
        lines.append({"sku": sku, "description": desc[:300], "quantity": qty, "unit_price": unit})
    return {"supplier_name": supplier, "supplier_rut": ruts[0] if ruts else "", "quote_ref": ref.group(1) if ref else "",
            "lead_time_days": lead_days, "lines": lines}


LLM_PROMPT = """Eres un asistente de compras. Lee esta cotización de un PROVEEDOR (texto, tablas, imágenes) y responde SOLO un JSON:
{"supplier_name": str, "supplier_rut": str|null, "quote_ref": str|null, "lead_time_days": int|null,
 "lines": [{"sku": str|null, "description": str, "quantity": number, "unit_price": number}]}
Reglas: unit_price es el precio unitario NETO (sin IVA) en pesos; si el documento sólo muestra precio con IVA, divídelo por 1,19.
lead_time_days es el plazo de entrega en días corridos. No inventes datos; omite lo que no aparezca."""


# ------------------------------------------------------------------ modelos
class LineModel(BaseModel):
    supplier_name: str
    supplier_rut: Optional[str] = ""
    sku: Optional[str] = ""
    description: Optional[str] = ""
    unit_price: float = 0
    quantity: float = 0
    lead_time_days: Optional[int] = None
    requested_item_id: Optional[int] = None
    quote_ref: Optional[str] = ""
    notes: Optional[str] = ""


def _folder_or_404(folder_id: int):
    f = query_one("SELECT * FROM business_folders WHERE id = ?", (folder_id,))
    if not f:
        raise HTTPException(status_code=404, detail="Carpeta no encontrada")
    return f


@router.post("/{folder_id}/lines")
def add_line(folder_id: int, d: LineModel):
    _folder_or_404(folder_id)
    if d.unit_price < 0:
        raise HTTPException(status_code=400, detail="El precio no puede ser negativo")
    rut = formatear_rut(d.supplier_rut) if d.supplier_rut else ""
    lid = execute_insert("""INSERT INTO supplier_quote_lines (folder_id, requested_item_id, supplier_rut, supplier_name, sku,
        description, unit_price, quantity, lead_time_days, quote_ref, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                         (folder_id, d.requested_item_id, rut, d.supplier_name.strip(), d.sku, d.description, d.unit_price,
                          d.quantity, d.lead_time_days, d.quote_ref, d.notes))
    return {"id": lid}


@router.put("/lines/{line_id}")
def update_line(line_id: int, d: LineModel):
    rut = formatear_rut(d.supplier_rut) if d.supplier_rut else ""
    execute_commit("""UPDATE supplier_quote_lines SET requested_item_id=?, supplier_rut=?, supplier_name=?, sku=?, description=?,
        unit_price=?, quantity=?, lead_time_days=?, quote_ref=?, notes=? WHERE id=?""",
                   (d.requested_item_id, rut, d.supplier_name.strip(), d.sku, d.description, d.unit_price, d.quantity,
                    d.lead_time_days, d.quote_ref, d.notes, line_id))
    return {"message": "Línea actualizada"}


@router.delete("/lines/{line_id}")
def delete_line(line_id: int):
    execute_commit("DELETE FROM supplier_quote_lines WHERE id = ?", (line_id,))
    return {"message": "Línea eliminada"}


@router.post("/lines/{line_id}/select")
def select_line(line_id: int):
    """Elige al proveedor ganador para un producto y deja su precio como costo estimado del ítem."""
    ln = query_one("SELECT * FROM supplier_quote_lines WHERE id = ?", (line_id,))
    if not ln:
        raise HTTPException(status_code=404, detail="Línea no encontrada")
    if not ln.get("requested_item_id"):
        raise HTTPException(status_code=400, detail="Asocie primero la línea a un producto solicitado")
    execute_commit("UPDATE supplier_quote_lines SET is_selected = 0 WHERE requested_item_id = ?", (ln["requested_item_id"],))
    execute_commit("UPDATE supplier_quote_lines SET is_selected = 1 WHERE id = ?", (line_id,))
    execute_commit("UPDATE folder_requested_items SET estimated_cost = ? WHERE id = ?", (ln["unit_price"], ln["requested_item_id"]))
    return {"message": f"{ln['supplier_name']} seleccionado: costo unitario ${ln['unit_price']:,.0f}".replace(",", ".")}


@router.post("/{folder_id}/upload-pdf")
async def upload_supplier_pdf(folder_id: int, file: UploadFile = File(...), supplier_name: str = Form(""),
                              supplier_rut: str = Form("")):
    """Lee una cotización de proveedor (PDF/Excel/Word) y crea las líneas de precio detectadas."""
    _folder_or_404(folder_id)
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="El archivo está vacío")
    filename = file.filename or "cotizacion.pdf"
    uploads = os.path.join(DB_DIR, "uploads")
    os.makedirs(uploads, exist_ok=True)
    safe = re.sub(r"[^\w\-. ()]+", "_", filename)
    path = os.path.join(uploads, f"{tenant_file_prefix()}supq_{folder_id}_{safe}")
    with open(path, "wb") as f:
        f.write(data)

    pages = read_pages(data, filename)
    text = "\n".join(t for _, t in pages)
    items = query_all("SELECT id, product_name FROM folder_requested_items WHERE folder_id = ?", (folder_id,))

    method = "reglas"
    result = ai_provider.llm_json(LLM_PROMPT, file_bytes=data, is_pdf=filename.lower().endswith(".pdf"), text=text)
    if result and isinstance(result.get("lines"), list) and result["lines"]:
        method = "IA"
        for ln in result["lines"]:
            ln["quantity"] = float(ln.get("quantity") or 0)
            ln["unit_price"] = float(ln.get("unit_price") or 0)
    else:
        result = _heuristic_lines(text)
    if not result.get("lines"):
        msg = "No se detectaron precios en el documento."
        if not text.strip():
            msg += " El PDF parece escaneado (sólo imagen): configure Gemini en Configuración para leerlo, o ingrese los precios manualmente."
        raise HTTPException(status_code=422, detail=msg)

    sup_name = supplier_name.strip() or result.get("supplier_name") or os.path.splitext(filename)[0]
    sup_rut = supplier_rut.strip() or result.get("supplier_rut") or ""
    if sup_rut:
        sup_rut = formatear_rut(sup_rut)
    created = 0
    for ln in result["lines"]:
        if ln.get("unit_price", 0) <= 0:
            continue
        execute_insert("""INSERT INTO supplier_quote_lines (folder_id, requested_item_id, supplier_rut, supplier_name, sku,
            description, unit_price, quantity, lead_time_days, quote_ref, source_file) VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                       (folder_id, _match_item(ln.get("description", ""), items), sup_rut, sup_name, ln.get("sku") or "",
                        ln.get("description") or "", ln["unit_price"], ln.get("quantity") or 0,
                        result.get("lead_time_days"), result.get("quote_ref") or "", filename))
        created += 1
    return {"message": f"{created} línea(s) leída(s) con {method}. Revíselas y asócielas a los productos si hace falta.",
            "supplier": sup_name, "created": created, "method": method}


class QuickPriceModel(BaseModel):
    requested_item_id: int
    supplier_name: str
    unit_price: float


class SelectSupplierItemModel(BaseModel):
    requested_item_id: int
    supplier_name: str


@router.post("/{folder_id}/quick-price")
def set_quick_price(folder_id: int, d: QuickPriceModel):
    _folder_or_404(folder_id)
    if d.unit_price < 0:
        raise HTTPException(status_code=400, detail="El precio no puede ser negativo")
    sup_name = d.supplier_name.strip()
    if not sup_name:
        raise HTTPException(status_code=400, detail="El nombre del proveedor es obligatorio")

    existing = query_one(
        "SELECT id FROM supplier_quote_lines WHERE folder_id = ? AND requested_item_id = ? AND supplier_name = ?",
        (folder_id, d.requested_item_id, sup_name)
    )
    if existing:
        execute_commit(
            "UPDATE supplier_quote_lines SET unit_price = ? WHERE id = ?",
            (d.unit_price, existing["id"])
        )
        line_id = existing["id"]
    else:
        line_id = execute_insert(
            """INSERT INTO supplier_quote_lines (folder_id, requested_item_id, supplier_name, unit_price, quantity)
               VALUES (?, ?, ?, ?, 1)""",
            (folder_id, d.requested_item_id, sup_name, d.unit_price)
        )
    return {"message": "Precio actualizado", "id": line_id}


@router.post("/{folder_id}/select-item-supplier")
def select_item_supplier(folder_id: int, d: SelectSupplierItemModel):
    _folder_or_404(folder_id)
    line = query_one(
        "SELECT id FROM supplier_quote_lines WHERE folder_id = ? AND requested_item_id = ? AND supplier_name = ?",
        (folder_id, d.requested_item_id, d.supplier_name.strip())
    )
    if not line:
        raise HTTPException(status_code=404, detail="Cotización de proveedor no encontrada para este producto")
    return select_line(line["id"])


@router.post("/{folder_id}/apply-selected-to-quotation")
def apply_selected_to_quotation(folder_id: int):
    """Aplica los costos seleccionados en el comparador directamente a la cotización de venta."""
    _folder_or_404(folder_id)
    items = query_all("SELECT id, product_name, estimated_cost FROM folder_requested_items WHERE folder_id = ?", (folder_id,))
    updated = 0
    for it in items:
        if it["estimated_cost"] and it["estimated_cost"] > 0:
            execute_commit(
                "UPDATE quotation_items SET unit_cost = ? WHERE quotation_id IN (SELECT id FROM quotations WHERE folder_id = ?) AND (description LIKE ? OR sku = ?)",
                (it["estimated_cost"], folder_id, f"%{it['product_name'][:20]}%", str(it["id"]))
            )
            updated += 1
    return {"message": f"Costos de compra aplicados al Cotizador ({updated} producto(s))"}


@router.get("/{folder_id}/comparison")
def comparison(folder_id: int):
    """Matriz Dinámica Producto × Proveedor con % de variación, mejor precio, totales e IVA."""
    _folder_or_404(folder_id)
    items = query_all("SELECT * FROM folder_requested_items WHERE folder_id = ? ORDER BY item_number, id", (folder_id,))
    lines = query_all("SELECT * FROM supplier_quote_lines WHERE folder_id = ? ORDER BY supplier_name, id", (folder_id,))
    suppliers = sorted({(l["supplier_name"].strip()) for l in lines if l.get("supplier_name") and l["supplier_name"].strip()})

    by_item: Dict[Any, List[Dict[str, Any]]] = {}
    for l in lines:
        if l.get("requested_item_id"):
            by_item.setdefault(l["requested_item_id"], []).append(l)

    rows = []
    supplier_nets: Dict[str, float] = {s: 0.0 for s in suppliers}
    supplier_items_count: Dict[str, int] = {s: 0 for s in suppliers}
    selected_net_total = 0.0
    best_mixed_total = 0.0

    for it in items:
        qty = float(it.get("quantity") or 1)
        price = float(it.get("offered_price") or 0)
        offers = by_item.get(it["id"], [])

        # Tomar la mejor oferta de cada proveedor para este producto
        per_supplier: Dict[str, Dict[str, Any]] = {}
        for o in offers:
            sname = (o.get("supplier_name") or "").strip()
            if not sname:
                continue
            cur = per_supplier.get(sname)
            if not cur or o["unit_price"] < cur["unit_price"]:
                per_supplier[sname] = o

        valid_prices = [float(o["unit_price"]) for o in per_supplier.values() if float(o["unit_price"]) > 0]
        min_price = min(valid_prices) if valid_prices else None

        selected_sup = None
        for o in per_supplier.values():
            if o.get("is_selected"):
                selected_sup = (o.get("supplier_name") or "").strip()
                selected_net_total += float(o["unit_price"]) * qty
                break

        if min_price is not None:
            best_mixed_total += min_price * qty

        cells = {}
        for sname in suppliers:
            o = per_supplier.get(sname)
            if not o or float(o.get("unit_price") or 0) <= 0:
                cells[sname] = None
                continue

            uprice = float(o["unit_price"])
            tot_cost = uprice * qty
            supplier_nets[sname] += tot_cost
            supplier_items_count[sname] += 1

            is_best = (min_price is not None and uprice == min_price)
            diff_pct = round(((uprice - min_price) / min_price) * 100, 1) if (min_price and min_price > 0) else 0.0

            cells[sname] = {
                "line_id": o["id"],
                "unit_price": uprice,
                "total_cost": round(tot_cost),
                "is_best": is_best,
                "diff_pct": diff_pct,
                "is_selected": bool(o.get("is_selected")),
                "sku": o.get("sku") or "",
                "lead_time_days": o.get("lead_time_days")
            }

        rows.append({
            "item_id": it["id"],
            "item_number": it.get("item_number") or 1,
            "name": it.get("product_name") or "",
            "technical_specs": it.get("technical_specs") or "",
            "quantity": qty,
            "unit": it.get("unit") or "UND",
            "min_price": min_price,
            "min_total": round(min_price * qty) if min_price else None,
            "selected_supplier": selected_sup,
            "cells": cells
        })

    active_totals = [tot for tot in supplier_nets.values() if tot > 0]
    min_supplier_total = min(active_totals) if active_totals else 0.0

    supplier_summaries: Dict[str, Dict[str, Any]] = {}
    for sname in suppliers:
        net = supplier_nets[sname]
        iva = round(net * 0.19)
        bruto = net + iva
        diff_global = round(((net - min_supplier_total) / min_supplier_total) * 100, 1) if (min_supplier_total > 0 and net > 0) else 0.0
        is_best_global = (net > 0 and net == min_supplier_total)
        supplier_summaries[sname] = {
            "total_net": round(net),
            "iva_19": iva,
            "total_bruto": round(bruto),
            "items_quoted": supplier_items_count[sname],
            "diff_global_pct": diff_global,
            "is_best_global": is_best_global
        }

    unassigned = [l for l in lines if not l.get("requested_item_id")]

    return {
        "suppliers": suppliers,
        "rows": rows,
        "supplier_summaries": supplier_summaries,
        "unassigned": unassigned,
        "totals": {
            "best_mixed_net": round(best_mixed_total),
            "best_mixed_iva": round(best_mixed_total * 0.19),
            "best_mixed_bruto": round(best_mixed_total * 1.19),
            "selected_net": round(selected_net_total),
            "selected_iva": round(selected_net_total * 0.19),
            "selected_bruto": round(selected_net_total * 1.19),
            "min_supplier_total": round(min_supplier_total)
        }
    }


@router.post("/{folder_id}/select-best")
def select_best_all(folder_id: int):
    """Selecciona automáticamente el proveedor más barato de cada producto."""
    _folder_or_404(folder_id)
    n = 0
    for it in query_all("SELECT id FROM folder_requested_items WHERE folder_id = ?", (folder_id,)):
        best = query_one("""SELECT id FROM supplier_quote_lines WHERE requested_item_id = ? AND unit_price > 0
                            ORDER BY unit_price ASC, lead_time_days ASC LIMIT 1""", (it["id"],))
        if best:
            select_line(best["id"])
            n += 1
    return {"message": f"Se eligió el menor costo para {n} producto(s)"}
