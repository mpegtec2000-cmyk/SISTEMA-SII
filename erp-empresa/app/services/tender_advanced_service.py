"""Servicios avanzados para el ciclo integral de licitaciones y operaciones:
- Ficha formal para póliza/boleta de garantía (PDF)
- Planilla formal de despacho y curvas de tallas (PDF)
- Cálculo de plazos fatales y prevención de multas post-adjudicación
- Sincronización universal de bóveda documental legal/laboral
"""
import os
import re
import datetime
from typing import Dict, Any, List, Optional

from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

from app.database import query_all, query_one, execute_commit, execute_insert, DB_DIR, active_company_id

EXPORTS_DIR = os.path.join(DB_DIR, "exports")
os.makedirs(EXPORTS_DIR, exist_ok=True)


def _fmt_clp(n: float) -> str:
    return f"${round(n or 0):,}".replace(",", ".")


def get_dispatch_status(folder_id: int) -> Dict[str, Any]:
    """Calcula la fecha fatal de entrega, días restantes, multa estimada y estado del despacho."""
    folder = query_one("SELECT * FROM business_folders WHERE id = ?", (folder_id,))
    if not folder:
        return {"error": "Carpeta no encontrada"}

    today = datetime.date.today()
    oc_number = folder.get("oc_number") or ""
    oc_date_str = folder.get("oc_date")
    delivery_days = int(folder.get("delivery_days") or 15)
    dispatch_guide = folder.get("dispatch_guide_number") or ""
    dispatch_date_str = folder.get("dispatch_guide_date")
    awarded_amount = float(folder.get("awarded_amount") or folder.get("budget_amount") or 0)
    daily_penalty_pct = float(folder.get("daily_penalty_pct") or 1.0)
    daily_penalty_fixed = float(folder.get("daily_penalty_fixed") or 0)

    # Si hay fecha de OC, calculamos fecha fatal
    fatal_date = None
    if oc_date_str:
        try:
            oc_d = datetime.date.fromisoformat(str(oc_date_str)[:10])
            fatal_date = oc_d + datetime.timedelta(days=delivery_days)
        except Exception:
            pass
    if not fatal_date:
        fatal_date = today + datetime.timedelta(days=delivery_days)

    days_remaining = (fatal_date - today).days
    is_delivered = bool(dispatch_guide and dispatch_guide.strip())

    # Estimación de multa diaria (porcentual sobre monto adjudicado o fija)
    daily_penalty_est = (awarded_amount * (daily_penalty_pct / 100.0)) + daily_penalty_fixed

    # Nivel de semáforo
    if is_delivered:
        alert_level = "ENTREGADO"
        alert_msg = f"Despacho respaldado con Guía N° {dispatch_guide}"
        badge_color = "emerald"
    elif days_remaining < 0:
        alert_level = "VENCIDO"
        overdue_days = abs(days_remaining)
        accum_penalty = daily_penalty_est * overdue_days
        alert_msg = f"¡Plazo vencido hace {overdue_days} día(s)! Multa acumulada estimada: {_fmt_clp(accum_penalty)}"
        badge_color = "rose"
    elif days_remaining <= 1:
        alert_level = "CRITICO"
        alert_msg = f"¡Últimas 24 horas para despachar! Multa aplicable por retraso: {_fmt_clp(daily_penalty_est)} / día"
        badge_color = "rose"
    elif days_remaining <= 3:
        alert_level = "ALTA"
        alert_msg = f"Restan solo {days_remaining} días para la entrega. Multa en bases: {_fmt_clp(daily_penalty_est)} / día"
        badge_color = "orange"
    elif days_remaining <= 5:
        alert_level = "MEDIA"
        alert_msg = f"Restan {days_remaining} días para la fecha fatal ({fatal_date.strftime('%d/%m/%Y')})"
        badge_color = "amber"
    else:
        alert_level = "AL_DIA"
        alert_msg = f"Dentro de plazo ({days_remaining} días restantes hasta {fatal_date.strftime('%d/%m/%Y')})"
        badge_color = "blue"

    return {
        "folder_id": folder_id,
        "oc_number": oc_number,
        "oc_date": oc_date_str,
        "delivery_days": delivery_days,
        "fatal_delivery_date": fatal_date.isoformat(),
        "days_remaining": days_remaining,
        "is_delivered": is_delivered,
        "dispatch_guide_number": dispatch_guide,
        "dispatch_guide_date": dispatch_date_str,
        "awarded_amount": awarded_amount,
        "daily_penalty_pct": daily_penalty_pct,
        "daily_penalty_est": round(daily_penalty_est),
        "alert_level": alert_level,
        "alert_msg": alert_msg,
        "badge_color": badge_color
    }


def generate_warranty_sheet_pdf(folder_id: int, overrides: Optional[Dict[str, Any]] = None) -> str:
    """Genera la Ficha Formal de Solicitud de Garantía (Boleta o Póliza) lista para aseguradora o banco."""
    folder = query_one("SELECT * FROM business_folders WHERE id = ?", (folder_id,))
    if not folder:
        raise ValueError("Carpeta no encontrada")

    company = query_one("SELECT * FROM companies WHERE id = ?", (folder.get("company_id") or active_company_id(),)) or {}
    signer = query_one("SELECT * FROM signer_profiles WHERE company_id = ? ORDER BY id DESC LIMIT 1", (company.get("id"),)) or {}
    if not signer:
        signer = query_one("SELECT * FROM signer_profiles ORDER BY id DESC LIMIT 1") or {}

    # Buscar riesgo de garantía detectado por IA si existe
    risk = query_one("SELECT * FROM folder_risks WHERE folder_id = ? AND kind = 'GARANTIA' ORDER BY id ASC LIMIT 1", (folder_id,))

    overrides = overrides or {}
    tender_id = overrides.get("tender_id") or folder.get("tender_id") or folder.get("code") or "S/ID"
    tender_title = overrides.get("tender_title") or folder.get("title") or "Licitación Pública"
    mandante_name = overrides.get("mandante_name") or folder.get("client_name") or "Entidad Licitante"
    mandante_rut = overrides.get("mandante_rut") or folder.get("client_rut") or "60.000.000-0"
    warranty_type = overrides.get("warranty_type") or "Seriedad de la Oferta"
    amount_str = overrides.get("amount_str") or (risk.get("title") if risk else None) or "$500.000 CLP"
    validity_str = overrides.get("validity_str") or "90 días corridos contados desde la apertura de las ofertas"

    default_glosa = (f"Para garantizar la {warranty_type.lower()} en la licitación pública ID {tender_id}, "
                     f"denominada '{tender_title}', ante {mandante_name}.")
    glosa = overrides.get("glosa") or (risk.get("detail") if risk and len(risk.get("detail", "")) > 15 else default_glosa)

    filename = f"Ficha_Garantia_{re.sub(r'[^A-Za-z0-9_.-]', '_', tender_id)}_{datetime.date.today():%Y%m%d}.pdf"
    filepath = os.path.join(EXPORTS_DIR, filename)

    doc = SimpleDocTemplate(filepath, pagesize=letter, leftMargin=36, rightMargin=36, topMargin=36, bottomMargin=36)
    styles = getSampleStyleSheet()

    title_style = ParagraphStyle('TitleStyle', parent=styles['Heading1'], fontName='Helvetica-Bold', fontSize=15, leading=18, textColor=colors.HexColor("#0f172a"), alignment=1)
    sub_style = ParagraphStyle('SubStyle', parent=styles['Normal'], fontName='Helvetica', fontSize=9, leading=12, textColor=colors.HexColor("#475569"), alignment=1)
    h2_style = ParagraphStyle('H2Style', parent=styles['Heading2'], fontName='Helvetica-Bold', fontSize=10, leading=13, textColor=colors.HexColor("#1e293b"))
    body_style = ParagraphStyle('BodyStyle', parent=styles['Normal'], fontName='Helvetica', fontSize=8.5, leading=11, textColor=colors.HexColor("#334155"))
    glosa_style = ParagraphStyle('GlosaStyle', parent=styles['Normal'], fontName='Helvetica-Oblique', fontSize=8.5, leading=12, textColor=colors.HexColor("#0f172a"))

    elements = []
    elements.append(Paragraph("FICHA TÉCNICA DE SOLICITUD DE GARANTÍA", title_style))
    elements.append(Paragraph("PÓLIZA DE SEGURO DE GARANTÍA / BOLETA BANCARIA (MERCADO PÚBLICO)", sub_style))
    elements.append(Spacer(1, 12))
    elements.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor("#2563eb"), spaceAfter=12))

    # Tabla 1: Datos del Mandante (Asegurado / Beneficiario)
    t1_data = [
        [Paragraph("<b>DATOS DEL BENEFICIARIO (MANDANTE)</b>", h2_style), ""],
        [Paragraph("Razón Social:", body_style), Paragraph(mandante_name, body_style)],
        [Paragraph("RUT Beneficiario:", body_style), Paragraph(mandante_rut, body_style)],
        [Paragraph("ID Licitación Mercado Público:", body_style), Paragraph(tender_id, body_style)],
        [Paragraph("Nombre del Proceso:", body_style), Paragraph(tender_title, body_style)],
    ]
    t1 = Table(t1_data, colWidths=[150, 390])
    t1.setStyle(TableStyle([
        ('SPAN', (0, 0), (1, 0)),
        ('BACKGROUND', (0, 0), (1, 0), colors.HexColor("#f1f5f9")),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
    ]))
    elements.append(t1)
    elements.append(Spacer(1, 10))

    # Tabla 2: Condiciones del Instrumento
    t2_data = [
        [Paragraph("<b>CARACTERÍSTICAS DEL INSTRUMENTO REQUERIDO</b>", h2_style), ""],
        [Paragraph("Tipo de Garantía:", body_style), Paragraph(warranty_type, body_style)],
        [Paragraph("Monto Exigido:", body_style), Paragraph(f"<b>{amount_str}</b>", body_style)],
        [Paragraph("Vigencia Mínima Exigida:", body_style), Paragraph(validity_str, body_style)],
        [Paragraph("Naturaleza del Documento:", body_style), Paragraph("Pagadera a la vista e irrevocable, de cobro inmediato.", body_style)],
    ]
    t2 = Table(t2_data, colWidths=[150, 390])
    t2.setStyle(TableStyle([
        ('SPAN', (0, 0), (1, 0)),
        ('BACKGROUND', (0, 0), (1, 0), colors.HexColor("#f1f5f9")),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
    ]))
    elements.append(t2)
    elements.append(Spacer(1, 10))

    # Tabla 3: Glosa Exacta Requerida
    t3_data = [
        [Paragraph("<b>GLOSA EXACTA EXIGIDA EN BASES ADMINISTRATIVAS</b>", h2_style)],
        [Paragraph(f'"{glosa}"', glosa_style)],
    ]
    t3 = Table(t3_data, colWidths=[540])
    t3.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, 0), colors.HexColor("#eff6ff")),
        ('BACKGROUND', (0, 1), (0, 1), colors.HexColor("#faf5ff")),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor("#9333ea")),
        ('LINEBELOW', (0, 0), (-1, 0), 0.5, colors.HexColor("#cbd5e1")),
    ]))
    elements.append(t3)
    elements.append(Spacer(1, 10))

    # Tabla 4: Datos del Tomador (Nuestra Empresa)
    t4_data = [
        [Paragraph("<b>DATOS DEL TOMADOR (OFERENTE / PROPONENTE)</b>", h2_style), ""],
        [Paragraph("Razón Social Tomador:", body_style), Paragraph(company.get("razon_social") or "INVERSIONES FERRARI Y CORDILLERA SPA", body_style)],
        [Paragraph("RUT Tomador:", body_style), Paragraph(company.get("rut") or "77.311.088-3", body_style)],
        [Paragraph("Giro Comercial:", body_style), Paragraph(company.get("giro") or "Comercializadora y Distribuidora", body_style)],
        [Paragraph("Domicilio Legal:", body_style), Paragraph(company.get("direccion") or "Santiago, Chile", body_style)],
        [Paragraph("Representante Legal:", body_style), Paragraph(signer.get("name") or "CRISTIAN YERCO FERRARI ARREDONDO", body_style)],
        [Paragraph("RUT Representante:", body_style), Paragraph(signer.get("rut") or "17.399.102-K", body_style)],
    ]
    t4 = Table(t4_data, colWidths=[150, 390])
    t4.setStyle(TableStyle([
        ('SPAN', (0, 0), (1, 0)),
        ('BACKGROUND', (0, 0), (1, 0), colors.HexColor("#f1f5f9")),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
    ]))
    elements.append(t4)
    elements.append(Spacer(1, 20))

    elements.append(Paragraph("Documento emitido automáticamente por el ERP Operativo y de Licitaciones para gestión expedita ante entidades financieras y compañías de seguros.", sub_style))

    doc.build(elements)
    return filepath


def generate_dispatch_sheet_pdf(folder_id: int) -> str:
    """Genera la Planilla Formal de Despacho y Curvas de Talla para respaldo de Recepción Conforme."""
    folder = query_one("SELECT * FROM business_folders WHERE id = ?", (folder_id,))
    if not folder:
        raise ValueError("Carpeta no encontrada")

    company = query_one("SELECT * FROM companies WHERE id = ?", (folder.get("company_id") or active_company_id(),)) or {}
    items = query_all("SELECT * FROM folder_dispatch_items WHERE folder_id = ? ORDER BY id ASC", (folder_id,))
    if not items:
        # Fallback a folder_requested_items si aún no hay ítems desglosados en curvas
        req_items = query_all("SELECT * FROM folder_requested_items WHERE folder_id = ? ORDER BY item_number ASC", (folder_id,))
        items = [{"product_name": r["product_name"], "size": "Estándar / Curva bases", "color": "-", "quantity": r["quantity"], "destination_place": "Bodega Central Mandante", "notes": r.get("technical_specs", "")[:60]} for r in req_items]

    filename = f"Planilla_Despacho_{re.sub(r'[^A-Za-z0-9_.-]', '_', folder.get('code') or 'CN')}_{datetime.date.today():%Y%m%d}.pdf"
    filepath = os.path.join(EXPORTS_DIR, filename)

    doc = SimpleDocTemplate(filepath, pagesize=letter, leftMargin=30, rightMargin=30, topMargin=30, bottomMargin=30)
    styles = getSampleStyleSheet()

    title_style = ParagraphStyle('TitleStyle', parent=styles['Heading1'], fontName='Helvetica-Bold', fontSize=14, leading=17, textColor=colors.HexColor("#0f172a"), alignment=1)
    sub_style = ParagraphStyle('SubStyle', parent=styles['Normal'], fontName='Helvetica', fontSize=8.5, leading=11, textColor=colors.HexColor("#475569"), alignment=1)
    th_style = ParagraphStyle('ThStyle', parent=styles['Normal'], fontName='Helvetica-Bold', fontSize=8, leading=10, textColor=colors.HexColor("#ffffff"), alignment=1)
    td_style = ParagraphStyle('TdStyle', parent=styles['Normal'], fontName='Helvetica', fontSize=7.5, leading=10, textColor=colors.HexColor("#1e293b"))
    td_num_style = ParagraphStyle('TdNum', parent=styles['Normal'], fontName='Helvetica-Bold', fontSize=8, leading=10, textColor=colors.HexColor("#0f172a"), alignment=2)

    elements = []
    elements.append(Paragraph("PLANILLA FORMAL DE DESPACHO Y RECEPCIÓN CONFORME", title_style))
    elements.append(Paragraph(f"ORDEN DE COMPRA N° {folder.get('oc_number') or 'PENDIENTE'} · LICITACIÓN {folder.get('tender_id') or folder.get('code')}", sub_style))
    elements.append(Spacer(1, 8))
    elements.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor("#0284c7"), spaceAfter=10))

    # Encabezado Entidad y Despacho
    header_data = [
        [Paragraph(f"<b>Destinatario / Mandante:</b> {folder.get('client_name')}", td_style),
         Paragraph(f"<b>RUT Cliente:</b> {folder.get('client_rut')}", td_style)],
        [Paragraph(f"<b>Proveedor:</b> {company.get('razon_social') or 'INVERSIONES FERRARI Y CORDILLERA SPA'}", td_style),
         Paragraph(f"<b>RUT Proveedor:</b> {company.get('rut') or '77.311.088-3'}", td_style)],
        [Paragraph(f"<b>N° Guía de Despacho:</b> {folder.get('dispatch_guide_number') or 'Adjunta'}", td_style),
         Paragraph(f"<b>Fecha de Entrega:</b> {datetime.date.today().strftime('%d/%m/%Y')}", td_style)],
    ]
    t_head = Table(header_data, colWidths=[275, 275])
    t_head.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))
    elements.append(t_head)
    elements.append(Spacer(1, 10))

    # Tabla de Ítems discriminada por curvas y tallas
    table_rows = [
        [Paragraph("Ítem / Producto", th_style), Paragraph("Talla", th_style), Paragraph("Color", th_style),
         Paragraph("Cant.", th_style), Paragraph("Recinto / Destino", th_style), Paragraph("Obs.", th_style)]
    ]
    total_units = 0
    for it in items:
        qty = float(it.get("quantity") or 0)
        total_units += qty
        table_rows.append([
            Paragraph(it.get("product_name") or "", td_style),
            Paragraph(str(it.get("size") or "-"), td_style),
            Paragraph(str(it.get("color") or "-"), td_style),
            Paragraph(str(int(qty) if qty.is_integer() else qty), td_num_style),
            Paragraph(it.get("destination_place") or "Bodega Central", td_style),
            Paragraph(str(it.get("notes") or ""), td_style),
        ])

    table_rows.append([
        Paragraph("<b>TOTAL UNIDADES DESPACHADAS</b>", td_style), "", "",
        Paragraph(f"<b>{int(total_units)}</b>", td_num_style), "", ""
    ])

    t_items = Table(table_rows, colWidths=[180, 55, 60, 45, 110, 100])
    t_items.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#1e293b")),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ('SPAN', (0, -1), (2, -1)),
        ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor("#f1f5f9")),
        ('TOPPADDING', (0, 0), (-1, -1), 3.5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3.5),
    ]))
    elements.append(t_items)
    elements.append(Spacer(1, 20))

    # Bloque de Firmas para Recepción Conforme
    sig_data = [
        [Paragraph("<b>ENTREGADO POR (PROVEEDOR / TRANSPORTE):</b>", td_style),
         Paragraph("<b>RECEPCIÓN CONFORME (MANDANTE / BODEGA):</b>", td_style)],
        [Paragraph("<br/><br/><br/>_____________________________________<br/>Nombre: ____________________________<br/>RUT: _______________________________<br/>Firma y Fecha", td_style),
         Paragraph("<br/><br/><br/>_____________________________________<br/>Nombre Receptor: ___________________<br/>RUT Receptor: ______________________<br/>Timbre, Firma y Fecha Recepción", td_style)],
    ]
    t_sig = Table(sig_data, colWidths=[275, 275])
    t_sig.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor("#94a3b8")),
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#f8fafc")),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    elements.append(t_sig)

    doc.build(elements)
    return filepath


def sync_vault_to_folder(folder_id: int) -> Dict[str, Any]:
    """Vincula automáticamente documentos vigentes de la Bóveda Central al checklist de la licitación."""
    folder = query_one("SELECT * FROM business_folders WHERE id = ?", (folder_id,))
    if not folder:
        raise ValueError("Carpeta no encontrada")

    company_id = folder.get("company_id") or active_company_id()
    vault_docs = query_all("SELECT * FROM company_legal_vault WHERE company_id = ? AND status = 'VIGENTE'", (company_id,))
    if not vault_docs:
        return {"matched": 0, "message": "No hay documentos vigentes en la Bóveda Central"}

    checklist = query_all("SELECT * FROM folder_checklist_items WHERE folder_id = ?", (folder_id,))
    matched_count = 0

    code_keywords = {
        "F30": ["f30", "f30-1", "laboral", "previsional", "deudas laborales", "direccion del trabajo"],
        "HABILIDAD": ["habilidad", "chilecompra", "registro de proveedores", "certificado de habilidad"],
        "VIGENCIA": ["vigencia", "estatutos", "conservador", "registro de empresas", "personeria", "poderes"],
        "PATENTE": ["patente", "municipal", "patente al dia"],
        "ESTATUTOS": ["escritura", "estatutos", "constitucion"],
    }

    for ch in checklist:
        ch_title = (ch.get("title") or "").lower()
        for v in vault_docs:
            code = v.get("doc_code", "").upper()
            kws = code_keywords.get(code, [code.lower()])
            if any(kw in ch_title for kw in kws):
                execute_commit("""UPDATE folder_checklist_items SET file_path=?, original_filename=?, status='HECHO' WHERE id=?""",
                               (v["file_path"], f"[Bóveda] {v['original_filename']}", ch["id"]))
                matched_count += 1
                break

    return {
        "matched": matched_count,
        "message": f"Se vincularon automáticamente {matched_count} antecedentes desde la Bóveda Central"
    }
