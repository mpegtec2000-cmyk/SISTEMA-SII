import os
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from typing import Dict, Any, List
from app.services.costing_service import calculate_folder_financials, get_all_folders_summary
from app.database import query_all, query_one

EXPORT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "generated")

def style_header_cell(cell, text, bg_color="1E3A8A", text_color="FFFFFF"):
    cell.value = text
    cell.font = Font(name="Calibri", size=11, bold=True, color=text_color)
    cell.fill = PatternFill(start_color=bg_color, end_color=bg_color, fill_type="solid")
    cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

def generate_folder_excel(folder_id: int) -> str:
    """
    Genera un archivo Excel (.xlsx) profesional con el informe completo de la Carpeta de Negocio:
    - Pestaña 1: Resumen Ejecutivo y Rentabilidad
    - Pestaña 2: Ingresos y Facturación Emitida
    - Pestaña 3: Costos Directos y Compras RCV
    - Pestaña 4: Gastos Operativos Adicionales
    """
    os.makedirs(EXPORT_DIR, exist_ok=True)
    summary = calculate_folder_financials(folder_id)
    folder = query_one("SELECT * FROM business_folders WHERE id = ?", (folder_id,))
    if not folder:
        raise ValueError(f"Carpeta {folder_id} no encontrada")

    dtes_emitidos = query_all("SELECT * FROM dte_documents WHERE folder_id = ? AND direction = 'EMITIDO'", (folder_id,))
    dtes_recibidos = query_all("SELECT * FROM dte_documents WHERE folder_id = ? AND direction = 'RECIBIDO'", (folder_id,))
    gastos = query_all("SELECT * FROM folder_expenses WHERE folder_id = ?", (folder_id,))

    wb = openpyxl.Workbook()
    thin_border = Border(
        left=Side(style='thin', color='CBD5E1'),
        right=Side(style='thin', color='CBD5E1'),
        top=Side(style='thin', color='CBD5E1'),
        bottom=Side(style='thin', color='CBD5E1')
    )

    # ==================== HOJA 1: RESUMEN EJECUTIVO ====================
    ws1 = wb.active
    ws1.title = "Resumen Ejecutivo"
    ws1.views.sheetView[0].showGridLines = True

    # Título principal
    ws1.merge_cells("A1:F1")
    title_cell = ws1["A1"]
    title_cell.value = f"INFORME DE RENTABILIDAD - CARPETA DE NEGOCIO [{folder['code']}]"
    title_cell.font = Font(name="Calibri", size=16, bold=True, color="1E3A8A")
    title_cell.alignment = Alignment(horizontal="left", vertical="center")
    ws1.row_dimensions[1].height = 30

    # Metadatos del negocio
    meta = [
        ("Proyecto / Objeto:", folder["title"], "Tipo de Negocio:", folder["type"]),
        ("Cliente / Entidad:", folder["client_name"], "RUT Cliente:", folder["client_rut"]),
        ("ID Licitación:", folder.get("tender_id") or "Venta Privada", "Estado Comercial:", folder["status"]),
    ]

    row_num = 3
    for label1, val1, label2, val2 in meta:
        ws1.cell(row=row_num, column=1, value=label1).font = Font(bold=True, color="475569")
        ws1.cell(row=row_num, column=2, value=val1).font = Font(color="0F172A")
        ws1.cell(row=row_num, column=4, value=label2).font = Font(bold=True, color="475569")
        ws1.cell(row=row_num, column=5, value=val2).font = Font(color="0F172A")
        row_num += 1

    row_num += 1
    # Tarjeta de KPIs
    headers_kpi = ["Métrica Financiera", "Monto Neto ($CLP)", "IVA 19% ($CLP)", "Total Bruto ($CLP)", "% sobre Venta", "Estado"]
    for col_idx, h in enumerate(headers_kpi, start=1):
        style_header_cell(ws1.cell(row=row_num, column=col_idx), h, bg_color="1E3A8A")
    ws1.row_dimensions[row_num].height = 24

    kpis = [
        ("Venta Neta / Facturación", summary["venta_neta"], round(summary["venta_neta"] * 0.19), summary["venta_bruta"], "100.0%", "Ingreso"),
        ("Costos Directos (Compras / Insumos)", summary["costo_directo"], round(summary["costo_directo"] * 0.19), round(summary["costo_directo"] * 1.19), f"{round((summary['costo_directo'] / summary['venta_neta'] * 100) if summary['venta_neta'] > 0 else 0, 1)}%", "Egreso Directo"),
        ("Gastos Operativos Asociados", summary["gastos_asociados"], 0, summary["gastos_asociados"], f"{round((summary['gastos_asociados'] / summary['venta_neta'] * 100) if summary['venta_neta'] > 0 else 0, 1)}%", "Gasto"),
        ("Costo Total Imputado", summary["costo_total"], round(summary["costo_directo"] * 0.19), summary["costo_total"] + round(summary["costo_directo"] * 0.19), f"{round((summary['costo_total'] / summary['venta_neta'] * 100) if summary['venta_neta'] > 0 else 0, 1)}%", "Total Egresos"),
        ("Utilidad Neta del Negocio", summary["utilidad_neta"], "-", summary["utilidad_neta"], f"{summary['margen_pct']}%", f"Semáforo: {summary['semaforo']}")
    ]

    for kpi in kpis:
        row_num += 1
        ws1.row_dimensions[row_num].height = 20
        ws1.cell(row=row_num, column=1, value=kpi[0]).font = Font(bold=(row_num in [8, 12]))
        
        # Formatos numéricos
        c2 = ws1.cell(row=row_num, column=2, value=kpi[1])
        c2.number_format = "$#,##0" if isinstance(kpi[1], (int, float)) else "@"
        
        c3 = ws1.cell(row=row_num, column=3, value=kpi[2])
        c3.number_format = "$#,##0" if isinstance(kpi[2], (int, float)) else "@"
        
        c4 = ws1.cell(row=row_num, column=4, value=kpi[3])
        c4.number_format = "$#,##0" if isinstance(kpi[3], (int, float)) else "@"

        ws1.cell(row=row_num, column=5, value=kpi[4]).alignment = Alignment(horizontal="center")
        c6 = ws1.cell(row=row_num, column=6, value=kpi[5])
        c6.alignment = Alignment(horizontal="center")

        if "VERDE" in str(kpi[5]):
            c6.fill = PatternFill(start_color="DCFCE7", end_color="DCFCE7", fill_type="solid")
            c6.font = Font(bold=True, color="166534")
        elif "AMARILLO" in str(kpi[5]):
            c6.fill = PatternFill(start_color="FEF3C7", end_color="FEF3C7", fill_type="solid")
            c6.font = Font(bold=True, color="92400E")
        elif "ROJO" in str(kpi[5]):
            c6.fill = PatternFill(start_color="FEE2E2", end_color="FEE2E2", fill_type="solid")
            c6.font = Font(bold=True, color="991B1B")

    # ==================== HOJA 2: INGRESOS Y VENTAS ====================
    ws2 = wb.create_sheet(title="Ingresos (Ventas)")
    headers_v = ["Tipo DTE", "Folio", "RUT Receptor", "Cliente", "Fecha Emisión", "Monto Neto ($)", "IVA ($)", "Total ($)", "Estado Conciliado"]
    for c_idx, h in enumerate(headers_v, start=1):
        style_header_cell(ws2.cell(row=1, column=c_idx), h, bg_color="047857")
    ws2.row_dimensions[1].height = 24

    for r_idx, dte in enumerate(dtes_emitidos, start=2):
        ws2.cell(row=r_idx, column=1, value=f"DTE {dte['dte_type']}")
        ws2.cell(row=r_idx, column=2, value=dte["folio"])
        ws2.cell(row=r_idx, column=3, value=dte["rut_receptor"])
        ws2.cell(row=r_idx, column=4, value=dte["razon_social_receptor"])
        ws2.cell(row=r_idx, column=5, value=dte["emission_date"])
        ws2.cell(row=r_idx, column=6, value=dte["net_amount"]).number_format = "$#,##0"
        ws2.cell(row=r_idx, column=7, value=dte["iva_amount"]).number_format = "$#,##0"
        ws2.cell(row=r_idx, column=8, value=dte["total_amount"]).number_format = "$#,##0"
        ws2.cell(row=r_idx, column=9, value="Conciliado" if dte["is_reconciled"] == 1 else "Pendiente de Cobro")

    # ==================== HOJA 3: COMPRAS Y COSTOS ====================
    ws3 = wb.create_sheet(title="Costos Directos (Compras)")
    headers_c = ["Tipo DTE", "Folio", "RUT Emisor", "Proveedor", "Fecha Emisión", "Monto Neto ($)", "IVA ($)", "Total ($)", "Estado Conciliado"]
    for c_idx, h in enumerate(headers_c, start=1):
        style_header_cell(ws3.cell(row=1, column=c_idx), h, bg_color="B45309")
    ws3.row_dimensions[1].height = 24

    for r_idx, dte in enumerate(dtes_recibidos, start=2):
        ws3.cell(row=r_idx, column=1, value=f"DTE {dte['dte_type']}")
        ws3.cell(row=r_idx, column=2, value=dte["folio"])
        ws3.cell(row=r_idx, column=3, value=dte["rut_emisor"])
        ws3.cell(row=r_idx, column=4, value=dte["razon_social_emisor"])
        ws3.cell(row=r_idx, column=5, value=dte["emission_date"])
        ws3.cell(row=r_idx, column=6, value=dte["net_amount"]).number_format = "$#,##0"
        ws3.cell(row=r_idx, column=7, value=dte["iva_amount"]).number_format = "$#,##0"
        ws3.cell(row=r_idx, column=8, value=dte["total_amount"]).number_format = "$#,##0"
        ws3.cell(row=r_idx, column=9, value="Pagado / Conciliado" if dte["is_reconciled"] == 1 else "Pendiente de Pago")

    # ==================== HOJA 4: GASTOS OPERATIVOS ====================
    ws4 = wb.create_sheet(title="Gastos Operativos")
    headers_g = ["Fecha", "Categoría", "Descripción", "N° Doc / Boleta", "RUT Proveedor", "Monto ($)", "Observaciones"]
    for c_idx, h in enumerate(headers_g, start=1):
        style_header_cell(ws4.cell(row=1, column=c_idx), h, bg_color="475569")
    ws4.row_dimensions[1].height = 24

    for r_idx, g in enumerate(gastos, start=2):
        ws4.cell(row=r_idx, column=1, value=g["date"])
        ws4.cell(row=r_idx, column=2, value=g["category"])
        ws4.cell(row=r_idx, column=3, value=g["description"])
        ws4.cell(row=r_idx, column=4, value=g.get("doc_number") or "-")
        ws4.cell(row=r_idx, column=5, value=g.get("supplier_rut") or "-")
        ws4.cell(row=r_idx, column=6, value=g["amount"]).number_format = "$#,##0"
        ws4.cell(row=r_idx, column=7, value=g.get("notes") or "")

    # ==================== HOJA 5: PRODUCTOS Y ESPECIFICACIONES TÉCNICAS ====================
    ws5 = wb.create_sheet(title="Productos y Espec. Técnicas")
    headers_p = ["N° Ítem", "SKU Sugerido", "Producto Solicitado", "Especificaciones Técnicas Detalladas", "Cantidad", "Unidad", "Costo Est. Unit ($)", "Precio Oferta Unit ($)", "Documento Origen"]
    for c_idx, h in enumerate(headers_p, start=1):
        style_header_cell(ws5.cell(row=1, column=c_idx), h, bg_color="2563EB")
    ws5.row_dimensions[1].height = 24

    req_items = query_all("SELECT * FROM folder_requested_items WHERE folder_id = ? ORDER BY item_number ASC, id ASC", (folder_id,))
    for r_idx, it in enumerate(req_items, start=2):
        ws5.cell(row=r_idx, column=1, value=it["item_number"])
        ws5.cell(row=r_idx, column=2, value=it.get("matched_sku") or "-")
        ws5.cell(row=r_idx, column=3, value=it["product_name"]).font = Font(bold=True)
        ws5.cell(row=r_idx, column=4, value=it.get("technical_specs") or "")
        ws5.cell(row=r_idx, column=5, value=it["quantity"])
        ws5.cell(row=r_idx, column=6, value=it["unit"])
        ws5.cell(row=r_idx, column=7, value=it.get("estimated_cost", 0)).number_format = "$#,##0"
        ws5.cell(row=r_idx, column=8, value=it.get("offered_price", 0)).number_format = "$#,##0"
        ws5.cell(row=r_idx, column=9, value=it.get("source_doc") or "-")

    # Ajustar ancho de columnas
    for ws in [ws1, ws2, ws3, ws4, ws5]:
        for col in ws.columns:
            max_len = min(max(len(str(cell.value or '')) for cell in col), 55)
            col_letter = openpyxl.utils.get_column_letter(col[0].column)
            ws.column_dimensions[col_letter].width = max(max_len + 3, 12)

    filename = f"Carpeta_Negocio_{folder['code']}.xlsx"
    filepath = os.path.join(EXPORT_DIR, filename)
    wb.save(filepath)
    return filepath

def generate_consolidated_folders_excel() -> str:
    """
    Genera el consolidado general de todas las Carpetas de Negocio para auditoría.
    """
    os.makedirs(EXPORT_DIR, exist_ok=True)
    all_summaries = get_all_folders_summary()

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Consolidado Carpetas"
    ws.views.sheetView[0].showGridLines = True

    # Título
    ws.merge_cells("A1:K1")
    title_cell = ws["A1"]
    title_cell.value = "AUDITORÍA GENERAL - CONSOLIDADO DE CARPETAS DE NEGOCIO Y CENTROS DE COSTO"
    title_cell.font = Font(name="Calibri", size=14, bold=True, color="1E3A8A")
    title_cell.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 28

    headers = [
        "Código", "Proyecto / Objeto", "Cliente", "RUT Cliente", "Tipo",
        "Venta Neta ($)", "Costo Directo ($)", "Gastos ($)", "Utilidad Neta ($)",
        "Margen %", "Semáforo"
    ]

    for c_idx, h in enumerate(headers, start=1):
        style_header_cell(ws.cell(row=3, column=c_idx), h, bg_color="1E3A8A")
    ws.row_dimensions[3].height = 24

    for r_idx, s in enumerate(all_summaries, start=4):
        ws.row_dimensions[r_idx].height = 20
        ws.cell(row=r_idx, column=1, value=s["code"]).font = Font(bold=True)
        ws.cell(row=r_idx, column=2, value=s["title"])
        ws.cell(row=r_idx, column=3, value=s["client_name"])
        ws.cell(row=r_idx, column=4, value=s["client_rut"])
        ws.cell(row=r_idx, column=5, value=s["type"])
        ws.cell(row=r_idx, column=6, value=s["venta_neta"]).number_format = "$#,##0"
        ws.cell(row=r_idx, column=7, value=s["costo_directo"]).number_format = "$#,##0"
        ws.cell(row=r_idx, column=8, value=s["gastos_asociados"]).number_format = "$#,##0"
        ws.cell(row=r_idx, column=9, value=s["utilidad_neta"]).number_format = "$#,##0"
        ws.cell(row=r_idx, column=10, value=f"{s['margen_pct']}%").alignment = Alignment(horizontal="center")
        
        sem_cell = ws.cell(row=r_idx, column=11, value=s["semaforo"])
        sem_cell.alignment = Alignment(horizontal="center")
        if s["semaforo"] == "VERDE":
            sem_cell.fill = PatternFill(start_color="DCFCE7", end_color="DCFCE7", fill_type="solid")
            sem_cell.font = Font(bold=True, color="166534")
        elif s["semaforo"] == "AMARILLO":
            sem_cell.fill = PatternFill(start_color="FEF3C7", end_color="FEF3C7", fill_type="solid")
            sem_cell.font = Font(bold=True, color="92400E")
        else:
            sem_cell.fill = PatternFill(start_color="FEE2E2", end_color="FEE2E2", fill_type="solid")
            sem_cell.font = Font(bold=True, color="991B1B")

    for col in ws.columns:
        max_len = max(len(str(cell.value or '')) for cell in col)
        col_letter = openpyxl.utils.get_column_letter(col[0].column)
        ws.column_dimensions[col_letter].width = max(max_len + 3, 12)

    filepath = os.path.join(EXPORT_DIR, "Consolidado_General_Carpetas_Negocio.xlsx")
    wb.save(filepath)
    return filepath

def generate_inventory_excel() -> str:
    """
    Exporta el catálogo completo de productos con stock físico, reservado y disponible.
    """
    os.makedirs(EXPORT_DIR, exist_ok=True)
    products = query_all("SELECT * FROM products ORDER BY category, name ASC")

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Catálogo Inventario"
    ws.views.sheetView[0].showGridLines = True

    headers = [
        "SKU", "Código de Barras", "Nombre del Producto", "Categoría", "Unidad",
        "Costo Unitario ($)", "Precio Venta ($)", "Stock Físico", "Stock Reservado",
        "Stock Disponible", "Stock Mínimo", "Estado"
    ]
    for c_idx, h in enumerate(headers, start=1):
        style_header_cell(ws.cell(row=1, column=c_idx), h, bg_color="0F172A")
    ws.row_dimensions[1].height = 24

    for r_idx, p in enumerate(products, start=2):
        libre = max(0.0, p["stock_physical"] - p["stock_reserved"])
        critico = (libre <= p["stock_min"])

        ws.cell(row=r_idx, column=1, value=p["sku"]).font = Font(bold=True)
        ws.cell(row=r_idx, column=2, value=p.get("barcode") or "")
        ws.cell(row=r_idx, column=3, value=p["name"])
        ws.cell(row=r_idx, column=4, value=p["category"])
        ws.cell(row=r_idx, column=5, value=p["unit"])
        ws.cell(row=r_idx, column=6, value=p["unit_cost"]).number_format = "$#,##0"
        ws.cell(row=r_idx, column=7, value=p["unit_price"]).number_format = "$#,##0"
        ws.cell(row=r_idx, column=8, value=p["stock_physical"])
        ws.cell(row=r_idx, column=9, value=p["stock_reserved"])
        ws.cell(row=r_idx, column=10, value=libre)
        ws.cell(row=r_idx, column=11, value=p["stock_min"])
        
        status_cell = ws.cell(row=r_idx, column=12, value="CRÍTICO (Reponer)" if critico else "Normal")
        status_cell.alignment = Alignment(horizontal="center")
        if critico:
            status_cell.fill = PatternFill(start_color="FEE2E2", end_color="FEE2E2", fill_type="solid")
            status_cell.font = Font(bold=True, color="991B1B")
        else:
            status_cell.font = Font(color="166534")

    for col in ws.columns:
        max_len = max(len(str(cell.value or '')) for cell in col)
        col_letter = openpyxl.utils.get_column_letter(col[0].column)
        ws.column_dimensions[col_letter].width = max(max_len + 3, 12)

    filepath = os.path.join(EXPORT_DIR, "Catalogo_Inventario_Stock.xlsx")
    wb.save(filepath)
    return filepath
