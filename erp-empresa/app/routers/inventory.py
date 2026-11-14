from fastapi import APIRouter, HTTPException, Query
from typing import List, Dict, Any, Optional
from app.database import query_all, query_one, execute_insert, execute_commit
from app.models import ProductModel, InventoryMovementModel
from app.services.inventory_service import generate_sku, generate_barcode, get_inventory_summary, sync_inventory_from_sii_dtes

router = APIRouter(prefix="/api/inventory", tags=["Inventario"])

@router.get("/summary")
def get_summary():
    """
    Retorna el estado del inventario en línea con stock físico, reservado, disponible y alertas críticas.
    """
    return get_inventory_summary()

@router.get("/products")
def get_products():
    return query_all("SELECT * FROM products WHERE is_active = 1 ORDER BY name ASC")

@router.get("/products/{product_id}")
def get_product(product_id: int):
    prod = query_one("SELECT * FROM products WHERE id = ?", (product_id,))
    if not prod:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    movements = query_all("SELECT * FROM inventory_movements WHERE product_id = ? ORDER BY id DESC LIMIT 20", (product_id,))
    prod["movements"] = movements
    return prod

@router.post("/products")
def create_product(data: ProductModel):
    # Generar SKU automático si no fue provisto
    sku = data.sku or generate_sku(data.category)
    barcode = data.barcode or generate_barcode(sku)

    prod_id = execute_insert("""
        INSERT INTO products (
            sku, barcode, name, description, category, unit,
            unit_cost, unit_price, stock_physical, stock_reserved,
            stock_min, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        sku, barcode, data.name, data.description, data.category, data.unit,
        data.unit_cost, data.unit_price, data.stock_physical,
        data.stock_reserved, data.stock_min, data.is_active
    ))

    # Registrar movimiento inicial si se declaró stock inicial
    if data.stock_physical > 0:
        execute_insert("""
            INSERT INTO inventory_movements (
                product_id, sku, type, quantity, reference_doc, reference_type, notes
            ) VALUES (?, ?, 'ENTRADA', ?, 'INICIAL', 'AJUSTE', 'Carga de stock inicial')
        """, (prod_id, sku, data.stock_physical))

    return {"message": "Producto creado", "id": prod_id, "sku": sku, "barcode": barcode}

@router.put("/products/{product_id}")
def update_product(product_id: int, data: ProductModel):
    execute_commit("""
        UPDATE products SET
            barcode = ?, name = ?, description = ?, category = ?, unit = ?,
            unit_cost = ?, unit_price = ?, stock_physical = ?, stock_min = ?, is_active = ?
        WHERE id = ?
    """, (
        data.barcode, data.name, data.description, data.category, data.unit,
        data.unit_cost, data.unit_price, data.stock_physical, data.stock_min,
        data.is_active, product_id
    ))
    return {"message": "Producto actualizado"}

@router.post("/movements")
def add_movement(data: InventoryMovementModel):
    prod = query_one("SELECT * FROM products WHERE id = ?", (data.product_id,))
    if not prod:
        raise HTTPException(status_code=404, detail="Producto no encontrado")

    execute_insert("""
        INSERT INTO inventory_movements (
            product_id, sku, type, quantity, reference_doc, reference_type, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (
        data.product_id, data.sku, data.type, data.quantity,
        data.reference_doc, data.reference_type, data.notes
    ))

    # Actualizar stock
    if data.type == "ENTRADA":
        execute_commit("UPDATE products SET stock_physical = stock_physical + ? WHERE id = ?", (data.quantity, data.product_id))
    elif data.type == "SALIDA":
        execute_commit("UPDATE products SET stock_physical = MAX(0.0, stock_physical - ?) WHERE id = ?", (data.quantity, data.product_id))
    elif data.type == "RESERVA":
        execute_commit("UPDATE products SET stock_reserved = stock_reserved + ? WHERE id = ?", (data.quantity, data.product_id))
    elif data.type == "LIBERACION":
        execute_commit("UPDATE products SET stock_reserved = MAX(0.0, stock_reserved - ?) WHERE id = ?", (data.quantity, data.product_id))

    return {"message": f"Movimiento {data.type} registrado correctamente"}


@router.post("/sync-from-sii")
def sync_from_sii():
    """
    Sincroniza los productos y movimientos de stock con las facturas del SII (RCV)
    y los productos requeridos en carpetas de negocio.
    """
    return sync_inventory_from_sii_dtes()
