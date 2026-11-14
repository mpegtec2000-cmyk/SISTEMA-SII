import random
import string
from typing import Dict, Any, List, Optional
from app.database import query_all, query_one, execute_insert, execute_commit

def generate_sku(category: str = "GEN") -> str:
    """
    Genera un SKU interno inteligente único, p. ej: GEN-2026-0042
    """
    prefix = "".join(c for c in category.upper() if c.isalnum())[:3]
    if len(prefix) < 3:
        prefix = "PRO"
    
    # Obtener el número máximo existente
    count = query_one("SELECT COUNT(*) as c FROM products")["c"] + 1
    sku = f"{prefix}-2026-{count:04d}"

    # Verificar que no exista colisión
    while query_one("SELECT id FROM products WHERE sku = ?", (sku,)):
        random_suffix = random.randint(10, 99)
        sku = f"{prefix}-2026-{count:04d}-{random_suffix}"

    return sku

def generate_barcode(sku: str) -> str:
    """
    Genera un código de barras numérico único de 12 dígitos (EAN-12 / UPC compatible).
    """
    # Usar prefijo 780 (Chile) + correlativo de 8 dígitos
    count = query_one("SELECT COUNT(*) as c FROM products")["c"] + 1
    base = f"780{count:08d}"
    
    # Calcular dígito verificador módulo 10
    impares = sum(int(base[i]) for i in range(0, len(base), 2))
    pares = sum(int(base[i]) * 3 for i in range(1, len(base), 2))
    total = impares + pares
    dv = (10 - (total % 10)) % 10
    return f"{base}{dv}"

def reserve_inventory_for_quotation(quotation_id: int):
    """
    Reserva dinámicamente unidades en inventario cuando una cotización es aceptada.
    """
    items = query_all("SELECT * FROM quotation_items WHERE quotation_id = ?", (quotation_id,))
    quotation = query_one("SELECT * FROM quotations WHERE id = ?", (quotation_id,))
    folio = quotation["folio"] if quotation else str(quotation_id)

    for item in items:
        sku = item.get("sku")
        qty = float(item.get("quantity", 0))
        if not sku or qty <= 0:
            continue

        prod = query_one("SELECT * FROM products WHERE sku = ?", (sku,))
        if prod:
            # Incrementar stock reservado
            execute_commit("""
                UPDATE products 
                SET stock_reserved = stock_reserved + ?
                WHERE id = ?
            """, (qty, prod["id"]))

            # Registrar movimiento
            execute_insert("""
                INSERT INTO inventory_movements (
                    product_id, sku, type, quantity, reference_doc, reference_type, notes
                ) VALUES (?, ?, 'RESERVA', ?, ?, 'COTIZACION', 'Reserva por Cotización aceptada')
            """, (prod["id"], sku, qty, folio))

def deduct_inventory_for_invoice(invoice_folio: int, items_list: List[Dict[str, Any]]):
    """
    Descuenta stock físico definitivo al emitirse la factura de venta (y libera la reserva previa si existía).
    """
    for item in items_list:
        sku = item.get("sku")
        qty = float(item.get("quantity", 0))
        if not sku or qty <= 0:
            continue

        prod = query_one("SELECT * FROM products WHERE sku = ?", (sku,))
        if prod:
            # Descontar stock físico y liberar stock reservado hasta el total
            reserva_a_liberar = min(prod["stock_reserved"], qty)
            execute_commit("""
                UPDATE products 
                SET stock_physical = MAX(0.0, stock_physical - ?),
                    stock_reserved = MAX(0.0, stock_reserved - ?)
                WHERE id = ?
            """, (qty, reserva_a_liberar, prod["id"]))

            # Registrar salida
            execute_insert("""
                INSERT INTO inventory_movements (
                    product_id, sku, type, quantity, reference_doc, reference_type, notes
                ) VALUES (?, ?, 'SALIDA', ?, ?, 'FACTURA_VENTA', 'Despacho por Factura de Venta')
            """, (prod["id"], sku, qty, str(invoice_folio)))


def add_inventory_for_purchase(doc_folio: int, items_list: List[Dict[str, Any]], ref_type: str = "FACTURA_COMPRA"):
    """
    Incrementa stock físico al registrarse una factura de compra o nota de crédito de devolución.
    """
    for item in items_list:
        sku = item.get("sku")
        qty = float(item.get("quantity", 0))
        if not sku or qty <= 0:
            continue
        prod = query_one("SELECT * FROM products WHERE sku = ?", (sku,))
        if prod:
            execute_commit("""
                UPDATE products
                SET stock_physical = stock_physical + ?
                WHERE id = ?
            """, (qty, prod["id"]))
            execute_insert("""
                INSERT INTO inventory_movements (
                    product_id, sku, type, quantity, reference_doc, reference_type, notes
                ) VALUES (?, ?, 'ENTRADA', ?, ?, ?, 'Ingreso automático por DTE / SII')
            """, (prod["id"], sku, qty, str(doc_folio), ref_type))


def sync_inventory_from_sii_dtes() -> Dict[str, Any]:
    """
    Apoya el control de stock leyendo las facturas de compra y venta del SII (dte_documents)
    y las líneas de órdenes de compra / cotizaciones / carpetas vinculadas que aún no tengan
    movimiento en inventory_movements.
    """
    created_skus = 0
    movements_added = 0

    # 1. Revisar ítems de carpetas adjudicadas/en ejecución o cotizaciones que no existan aún en catálogo SKU
    folder_items = query_all("SELECT * FROM folder_requested_items")
    for fi in folder_items:
        pname = (fi.get("product_name") or "").strip()
        if not pname:
            continue
        existing = query_one("SELECT * FROM products WHERE LOWER(name) = LOWER(?)", (pname,))
        if not existing:
            sku = generate_sku("LIC")
            barcode = generate_barcode(sku)
            cost = float(fi.get("estimated_cost") or 0)
            price = float(fi.get("offered_price") or (cost * 1.3 if cost > 0 else 0))
            qty = float(fi.get("quantity") or 0)
            pid = execute_insert("""
                INSERT INTO products (sku, barcode, name, description, category, unit, unit_cost, unit_price, stock_physical, stock_reserved, stock_min, is_active)
                VALUES (?, ?, ?, ?, 'Licitaciones / SII', ?, ?, ?, ?, 0, 5, 1)
            """, (sku, barcode, pname, fi.get("technical_specs") or "", fi.get("unit") or "UND", cost, price, qty))
            execute_commit("UPDATE folder_requested_items SET matched_sku = ? WHERE id = ?", (sku, fi["id"]))
            if qty > 0:
                execute_insert("""
                    INSERT INTO inventory_movements (product_id, sku, type, quantity, reference_doc, reference_type, notes)
                    VALUES (?, ?, 'ENTRADA', ?, ?, 'SINCRONIZACION_CARPETA', 'Stock inicial desde Carpeta / SII')
                """, (pid, sku, qty, f"FOLDER-{fi.get('folder_id')}"))
                movements_added += 1
            created_skus += 1

    # 2. Revisar facturas recibidas (COMPRAS en SII) que no tengan aún SKU de abastecimiento asociado
    dtes_compra = query_all("SELECT * FROM dte_documents WHERE direction = 'RECIBIDO' AND dte_type IN (33, 34)")
    for d in dtes_compra:
        ref_doc = f"DTE-{d['dte_type']}-{d['folio']}"
        already = query_one("SELECT id FROM inventory_movements WHERE reference_doc = ?", (ref_doc,))
        if already:
            continue
        emisor = (d.get("razon_social_emisor") or "Proveedor SII").strip()
        sku_name = f"Insumo / Compra SII · {emisor[:36]} (Folio #{d['folio']})"
        prod = query_one("SELECT * FROM products WHERE LOWER(name) = LOWER(?)", (sku_name,))
        if not prod:
            sku = generate_sku("SII")
            barcode = generate_barcode(sku)
            neto = float(d.get("net_amount") or 0)
            pid = execute_insert("""
                INSERT INTO products (sku, barcode, name, description, category, unit, unit_cost, unit_price, stock_physical, stock_reserved, stock_min, is_active)
                VALUES (?, ?, ?, ?, 'Compras SII (RCV)', 'LOT', ?, ?, 1, 0, 1, 1)
            """, (sku, barcode, sku_name, f"Originado desde Factura de Compra SII Folio #{d['folio']} ({d.get('rut_emisor')})", neto, round(neto * 1.25)))
            created_skus += 1
        else:
            pid = prod["id"]
            sku = prod["sku"]
            execute_commit("UPDATE products SET stock_physical = stock_physical + 1 WHERE id = ?", (pid,))

        execute_insert("""
            INSERT INTO inventory_movements (product_id, sku, type, quantity, reference_doc, reference_type, notes)
            VALUES (?, ?, 'ENTRADA', 1, ?, 'COMPRA_SII', ?)
        """, (pid, sku, ref_doc, f"Recepción Factura SII #{d['folio']} · {emisor}"))
        movements_added += 1

    return {
        "created_skus": created_skus,
        "movements_added": movements_added,
        "message": f"Sincronización SII completada: {created_skus} nuevo(s) SKU detectados y {movements_added} movimiento(s) de stock actualizados."
    }

def get_inventory_summary() -> Dict[str, Any]:
    """
    Devuelve la visión completa del stock en línea:
    - Unidades disponibles netas (Físico - Reservado)
    - Alerta de Stock Crítico (si Disponible <= Stock Mínimo)
    """
    products = query_all("SELECT * FROM products WHERE is_active = 1 ORDER BY name ASC")
    
    total_articulos = len(products)
    total_unidades_fisicas = 0.0
    total_unidades_reservadas = 0.0
    total_unidades_libres = 0.0
    articulos_criticos = []

    for p in products:
        fisico = float(p["stock_physical"])
        reservado = float(p["stock_reserved"])
        libre = max(0.0, fisico - reservado)
        minimo = float(p["stock_min"])

        total_unidades_fisicas += fisico
        total_unidades_reservadas += reservado
        total_unidades_libres += libre

        p_copy = dict(p)
        p_copy["stock_disponible"] = libre
        p_copy["is_critico"] = (libre <= minimo)

        if p_copy["is_critico"]:
            articulos_criticos.append(p_copy)

    return {
        "total_articulos": total_articulos,
        "total_unidades_fisicas": round(total_unidades_fisicas, 1),
        "total_unidades_reservadas": round(total_unidades_reservadas, 1),
        "total_unidades_libres": round(total_unidades_libres, 1),
        "articulos_criticos_count": len(articulos_criticos),
        "articulos_criticos": articulos_criticos,
        "productos": [dict(p, stock_disponible=max(0.0, p['stock_physical'] - p['stock_reserved']), is_critico=(max(0.0, p['stock_physical'] - p['stock_reserved']) <= p['stock_min'])) for p in products]
    }
