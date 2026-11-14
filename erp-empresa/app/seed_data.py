import datetime
from app.database import get_db_connection, query_one, execute_insert, execute_commit

def populate_seed_data():
    """
    Carga datos realistas de demostración en pesos chilenos ($CLP),
    RUTs corporativos y flujo completo de Mercado Público y ventas privadas.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        if not query_one("SELECT id FROM companies LIMIT 1"):
            print("Cargando datos iniciales de demostración chilenos...")

            # 1. Empresas Emisoras (Multi-Empresa)
            cursor.execute("""
                INSERT INTO companies (rut, razon_social, giro, direccion, comuna, ciudad, telefono, email, ppm_rate, is_default)
                VALUES 
                ('76.842.159-4', 'Andes Tech & Servicios SpA', 'Venta al por mayor de maquinaria y equipo; Servicios TI', 'Av. Providencia 1208, Of. 602', 'Providencia', 'Santiago', '+56 2 2849 5000', 'contacto@andestech.cl', 1.5, 1),
                ('77.102.394-K', 'Logística & Proyectos Austral SpA', 'Transporte y logística de suministros industriales', 'Av. El Bosque Norte 0140, Las Condes', 'Las Condes', 'Santiago', '+56 2 2911 3200', 'operaciones@proyectosaustral.cl', 2.0, 0)
            """)

            # 2. Clientes y Proveedores
            cursor.execute("""
                INSERT INTO counterparties (rut, razon_social, giro, tipo, email, telefono, direccion, condiciones_pago)
                VALUES
                ('61.606.000-8', 'Hospital Clínico San Borja Arriarán', 'Salud Pública', 'CLIENTE', 'adquisiciones@hcsba.cl', '+56 2 2574 8000', 'Santa Rosa 1234, Santiago', '30 días'),
                ('69.070.100-3', 'Ilustre Municipalidad de Las Condes', 'Administración Pública', 'CLIENTE', 'compras@lascondes.cl', '+56 2 2950 7000', 'Av. Apoquindo 3400, Las Condes', '30 días'),
                ('96.792.000-K', 'Minera Los Pelambres SpA', 'Extracción minera de cobre y molibdeno', 'CLIENTE', 'pagos@aminerals.cl', '+56 2 2798 7000', 'Av. Vitacura 2670, Las Condes', '60 días'),
                ('76.012.345-6', 'TechData Wholesale Chile SpA', 'Mayorista de Hardware y Telecomunicaciones', 'PROVEEDOR', 'facturas@techdata.cl', '+56 2 2450 1100', 'Av. Américo Vespucio 1500, Pudahuel', '30 días'),
                ('77.890.123-1', 'Ingram Micro Chile SpA', 'Distribución Mayorista de Computación', 'PROVEEDOR', 'cobranzas@ingrammicro.cl', '+56 2 2380 9000', 'Camino Lo Boza 107, Renca', '15 días')
            """)

            # 3. Catálogo de Productos
            cursor.execute("""
                INSERT INTO products (sku, barcode, name, description, category, unit, unit_cost, unit_price, stock_physical, stock_reserved, stock_min)
                VALUES
                ('TEC-2026-0001', '7801000100018', 'Servidor Rack 1U Xeon Gold 64GB', 'Servidor empresarial para virtualización con fuente redundante', 'Servidores', 'UND', 2450000, 3690000, 8, 2, 2),
                ('TEC-2026-0002', '7801000200025', 'Switch Cisco Catalyst 48 Puertos PoE+', 'Switch capa 3 administrable Gigabit 740W PoE+', 'Redes', 'UND', 920000, 1450000, 15, 5, 3),
                ('TEC-2026-0003', '7801000300032', 'Notebook Corporativo Core i7 16GB 512GB SSD', 'Equipo para trabajo pesado con Windows 11 Pro empresarial', 'Computadores', 'UND', 620000, 890000, 25, 10, 5),
                ('TEC-2026-0004', '7801000400049', 'Access Point Wi-Fi 6 Enterprise', 'Punto de acceso de alta densidad MIMO 4x4 techo', 'Redes', 'UND', 145000, 240000, 40, 8, 10),
                ('TEC-2026-0005', '7801000500056', 'UPS Online Doble Conversión 3kVA Rack', 'Respaldo eléctrico ininterrumpido con bypass de mantenimiento', 'Energía', 'UND', 580000, 910000, 12, 1, 3),
                ('INS-2026-0006', '7801000600063', 'Bobina Cable UTP Cat6A 305m LSZH', 'Cable de red 10Gbps cero halógeno normado', 'Cableado', 'BOB', 85000, 135000, 30, 4, 8)
            """)

            # 4. Carpetas de Negocio
            cursor.execute("""
                INSERT INTO business_folders (code, title, client_name, client_rut, status, type, tender_id, tender_closing_date, budget_amount, company_id, target_margin_pct, notes, progress_pct)
                VALUES
                ('CN-2026-001', 'Renovación Infraestructura TI y Servidores Hospital San Borja', 'Hospital Clínico San Borja Arriarán', '61.606.000-8', 'EN_EJECUCION', 'MERCADO_PUBLICO', '1245-22-LR26', '2026-10-15', 18500000, 1, 28.0, 'Licitación adjudicada. En entrega fase 1.', 85),
                ('CN-2026-002', 'Suministro Switcheo y Redes Inalámbricas Las Condes', 'Ilustre Municipalidad de Las Condes', '69.070.100-3', 'EN_EJECUCION', 'MERCADO_PUBLICO', '2390-11-L126', '2026-10-20', 12000000, 1, 25.0, 'Contrato de suministro vigente.', 75),
                ('CN-2026-003', 'Equipamiento de Salas de Control y UPS Faena Los Pelambres', 'Minera Los Pelambres SpA', '96.792.000-K', 'ADJUDICADA', 'PRIVADO', 'OC-MIN-99412', '2026-11-05', 15800000, 1, 30.0, 'Negocio privado con orden de compra confirmada.', 60)
            """)

            # 5. Documentos Tributarios Electrónicos (DTEs - RCV Ventas y Compras)
            cursor.execute("""
                INSERT INTO dte_documents (dte_type, folio, rut_emisor, razon_social_emisor, rut_receptor, razon_social_receptor, emission_date, expiration_date, net_amount, exempt_amount, iva_amount, total_amount, direction, status_sii, folder_id, is_reconciled, source)
                VALUES
                (33, 10520, '76.842.159-4', 'Andes Tech & Servicios SpA', '61.606.000-8', 'Hospital Clínico San Borja Arriarán', '2026-09-18', '2026-10-18', 11070000, 0, 2103300, 13173300, 'EMITIDO', 'ACEPTADO', 1, 1, 'RCV_VENTAS'),
                (33, 10521, '76.842.159-4', 'Andes Tech & Servicios SpA', '69.070.100-3', 'Ilustre Municipalidad de Las Condes', '2026-09-25', '2026-10-25', 7250000, 0, 1377500, 8627500, 'EMITIDO', 'ACEPTADO', 2, 0, 'RCV_VENTAS'),
                (33, 10522, '76.842.159-4', 'Andes Tech & Servicios SpA', '96.792.000-K', 'Minera Los Pelambres SpA', '2026-10-01', '2026-11-01', 9800000, 0, 1862000, 11662000, 'EMITIDO', 'ACEPTADO', 3, 0, 'EMISION_DIRECTA'),
                (33, 44810, '76.012.345-6', 'TechData Wholesale Chile SpA', '76.842.159-4', 'Andes Tech & Servicios SpA', '2026-09-15', '2026-10-15', 7350000, 0, 1396500, 8746500, 'RECIBIDO', 'ACEPTADO', 1, 1, 'RCV_COMPRAS'),
                (33, 89201, '77.890.123-1', 'Ingram Micro Chile SpA', '76.842.159-4', 'Andes Tech & Servicios SpA', '2026-09-22', '2026-10-22', 4600000, 0, 874000, 5474000, 'RECIBIDO', 'ACEPTADO', 2, 0, 'RCV_COMPRAS'),
                (33, 90312, '77.890.123-1', 'Ingram Micro Chile SpA', '76.842.159-4', 'Andes Tech & Servicios SpA', '2026-09-28', '2026-10-28', 1850000, 0, 351500, 2201500, 'RECIBIDO', 'ACEPTADO', NULL, 0, 'RCV_COMPRAS')
            """)

            # 6. Gastos Operativos de Carpeta
            cursor.execute("""
                INSERT INTO folder_expenses (folder_id, description, category, amount, date, doc_number, supplier_rut, notes)
                VALUES
                (1, 'Flete refrigerado y traslado seguro de racks hospitalarios', 'FLETE', 320000, '2026-09-19', 'GUI-1290', '76.555.444-1', 'Despacho directo a bodega central hospital.'),
                (1, 'Certificación técnica y pruebas de carga eléctrica', 'HONORARIOS', 250000, '2026-09-20', 'BH-44', '15.234.567-8', 'Ingeniero eléctrico certificado SEC.'),
                (2, 'Instalación y peinado de cableado en dependencias municipales', 'SUBCONTRATO', 480000, '2026-09-26', 'FAC-881', '76.999.111-2', 'Cuadrilla de 2 técnicos especialistas.')
            """)

            # 7. Cuentas Bancarias
            cursor.execute("""
                INSERT INTO bank_accounts (bank_name, account_number, account_type, company_id, currency, balance)
                VALUES
                ('Banco de Chile', '00-123-45678-01', 'Cuenta Corriente Comercial', 1, 'CLP', 14850200),
                ('Banco Santander', '00-098-76543-02', 'Cuenta Corriente Operativa', 1, 'CLP', 5230000)
            """)

            # 8. Movimientos Bancarios
            cursor.execute("""
                INSERT INTO bank_transactions (account_id, transaction_date, description, amount, transaction_type, balance, is_reconciled, reconciled_dte_id, folder_id)
                VALUES
                (1, '2026-09-20', 'TRF HOSP SAN BORJA PAGO FAC 10520', 13173300, 'ABONO', 22173300, 1, 1, 1),
                (1, '2026-09-22', 'TRF TECHDATA CHILE PAGO FAC 44810', 8746500, 'CARGO', 13426800, 1, 4, 1),
                (1, '2026-10-01', 'TRANSF ILUSTRE MUNICIPALIDAD LAS CONDES FOLIO 10521', 8627500, 'ABONO', 22054300, 0, NULL, NULL),
                (1, '2026-10-02', 'PAGO PROVEEDOR INGRAM MICRO RUT 77890123 FAC 89201', 5474000, 'CARGO', 16580300, 0, NULL, NULL)
            """)

            # 9. Cotización modelo
            cursor.execute("""
                INSERT INTO quotations (folio, folder_id, company_id, client_name, client_rut, client_address, client_contact, client_email, date, validity_days, payment_terms, delivery_time, subtotal, discount_amount, net_amount, tax_amount, total_amount, notes, type, tender_id, status)
                VALUES
                ('COT-2026-0089', 1, 1, 'Hospital Clínico San Borja Arriarán', '61.606.000-8', 'Santa Rosa 1234, Santiago', 'Lic. Rodrigo Fuentes', 'rfuentes@hcsba.cl', '2026-09-10', 30, '30 días contra factura recepción conforme', '5 días hábiles', 11070000, 0, 11070000, 2103300, 13173300, 'Valores netos en CLP. Incluye garantía técnica 3 años on-site.', 'MERCADO_PUBLICO', '1245-22-LR26', 'FACTURADA')
            """)

            cursor.execute("""
                INSERT INTO quotation_items (quotation_id, sku, description, unit, quantity, unit_cost, unit_price, discount_pct, margin_pct, subtotal)
                VALUES
                (1, 'TEC-2026-0001', 'Servidor Rack 1U Xeon Gold 64GB', 'UND', 2, 2450000, 3690000, 0, 33.6, 7380000),
                (1, 'TEC-2026-0002', 'Switch Cisco Catalyst 48 Puertos PoE+', 'UND', 2, 920000, 1450000, 0, 36.5, 2900000),
                (1, 'TEC-2026-0005', 'UPS Online Doble Conversión 3kVA Rack', 'UND', 1, 580000, 790000, 0, 26.5, 790000)
            """)

            # 10. Documentos de Licitación y Negocios
            anexo_json = '{"razon_social":"Andes Tech & Servicios SpA","rut":"76.842.159-4","rep_legal":"Carlos Mendoza Silva","rut_rep":"14.892.341-2","organismo":"Hospital Clínico San Borja Arriarán","licitacion_id":"1245-22-LR26","cumple_inhabilidades":true,"garantia_seriedad_banco":"Banco de Chile","vigencia_oferta_dias":60}'
            cursor.execute("""
                INSERT INTO tender_documents (folder_id, name, doc_type, original_filename, form_data_json, status, signer_name, signer_rut)
                VALUES
                (1, 'Anexo 1 - Declaración Jurada Simple de Inhabilidades', 'ANEXO_DECLARACION', 'Anexo1_DeclaracionJurada.pdf', ?, 'FIRMADO', 'Carlos Mendoza Silva', '14.892.341-2'),
                (1, 'Anexo 2 - Formulario de Oferta Económica y Plazo de Entrega', 'ANEXO_OFERTA', 'Anexo2_OfertaEconomica.pdf', '{"plazo_entrega":"5 dias","validez":"60 dias","monto_neto":11070000}', 'COMPLETADO', NULL, NULL),
                (1, 'Bases Técnicas y Administrativas Especiales', 'BASES_TECNICAS', 'Bases_Tecnicas_1245-22-LR26.pdf', '{}', 'COMPLETADO', NULL, NULL)
            """, (anexo_json,))

        # 11. Sembrar Productos Solicitados y Especificaciones Técnicas (para Mercado Público y Privados) si aún no existen
        if not query_one("SELECT id FROM folder_requested_items LIMIT 1"):
            cursor.execute("UPDATE business_folders SET progress_pct = 85 WHERE id = 1")
            cursor.execute("UPDATE business_folders SET progress_pct = 75 WHERE id = 2")
            cursor.execute("UPDATE business_folders SET progress_pct = 60, tender_id = COALESCE(tender_id, 'OC-MIN-99412') WHERE id = 3")

            cursor.execute("""
                INSERT INTO folder_requested_items (
                    folder_id, item_number, product_name, technical_specs, quantity, unit, estimated_cost, offered_price, matched_sku, source_doc, status
                ) VALUES
                -- Carpeta 1: Hospital San Borja (Mercado Público)
                (1, 1, 'Servidor Rack 1U Xeon Gold 64GB', 'Procesador Dual Intel Xeon Gold 2.4GHz, 64GB RAM DDR5 ECC, 2x1.92TB SSD NVMe RAID 1, Fuente Redundante 800W Hot-Plug, Rieles deslizables y Garantía 3 años On-Site Hospitalario.', 2, 'UND', 2450000, 3690000, 'TEC-2026-0001', 'Bases_Tecnicas_1245-22-LR26.pdf', 'ADJUDICADO'),
                (1, 2, 'Switch Cisco Catalyst 48 Puertos PoE+', 'Switch Capa 3 Administrable, 48 puertos 10/100/1000 PoE+ (740W), 4 uplinks 10G SFP+, soporte VLAN clínica y segmentación de red médica.', 2, 'UND', 920000, 1450000, 'TEC-2026-0002', 'Bases_Tecnicas_1245-22-LR26.pdf', 'ADJUDICADO'),
                (1, 3, 'UPS Online Doble Conversión 3kVA Rack', 'Topología Online Doble Conversión, formato Rack 2U, tarjeta de red SNMP incluida, banco de baterías interno con autonomía >15 min.', 1, 'UND', 580000, 790000, 'TEC-2026-0005', 'Bases_Tecnicas_1245-22-LR26.pdf', 'ADJUDICADO'),

                -- Carpeta 2: Municipalidad de Las Condes (Mercado Público)
                (2, 1, 'Switch Cisco Catalyst 48 Puertos PoE+', 'Switch Core/Acceso Gigabit PoE+ 740W con licenciamiento Network Advantage y cables de apilamiento StackWise.', 3, 'UND', 920000, 1450000, 'TEC-2026-0002', 'Especificaciones_Muni_LasCondes.pdf', 'EN_ENTREGA'),
                (2, 2, 'Access Point Wi-Fi 6 Enterprise Alta Densidad', 'Estándar IEEE 802.11ax (Wi-Fi 6), MU-MIMO 4x4:4, PoE 802.3at, soporte controlador centralizado y montaje en cielo falso municipal.', 10, 'UND', 145000, 236000, 'TEC-2026-0004', 'Especificaciones_Muni_LasCondes.pdf', 'EN_ENTREGA'),
                (2, 3, 'Bobina Cable UTP Cat6A 305m LSZH', 'Cable blindado F/UTP Categoría 6A 10Gbps, chaqueta libre de halógenos (LSZH) certificada para edificios públicos.', 4, 'BOB', 85000, 135000, 'INS-2026-0006', 'Especificaciones_Muni_LasCondes.pdf', 'EN_ENTREGA'),

                -- Carpeta 3: Minera Los Pelambres (Cliente Privado)
                (3, 1, 'Notebook Corporativo Core i7 16GB 512GB SSD', 'Chasis reforzado grado militar MIL-STD-810H para faena minera, Intel Core i7 vPro, 16GB RAM, 512GB SSD NVMe, Windows 11 Pro.', 8, 'UND', 620000, 890000, 'TEC-2026-0003', 'Solicitud_Cotizacion_Minera_Pelambres.pdf', 'COTIZADO'),
                (3, 2, 'UPS Online Doble Conversión 3kVA Rack', 'Protección eléctrica industrial para sala de control en faena a 3.100 msnm, incluye transformador de aislación.', 3, 'UND', 580000, 893333, 'TEC-2026-0005', 'Solicitud_Cotizacion_Minera_Pelambres.pdf', 'COTIZADO')
            """)

            # Asegurar que las carpetas 2 y 3 también tengan documentos en el gestor documental
            cursor.execute("""
                INSERT INTO tender_documents (folder_id, name, doc_type, original_filename, form_data_json, status, signer_name, signer_rut)
                VALUES
                (2, 'Especificaciones Técnicas Red Municipal Las Condes', 'BASES_TECNICAS', 'Especificaciones_Muni_LasCondes.pdf', '{"plazo_entrega":"7 dias habiles","vigencia_oferta_dias":45}', 'FIRMADO', 'Carlos Mendoza Silva', '14.892.341-2'),
                (3, 'Solicitud Técnica de Equipos y Estándar Minero (RFQ Privado)', 'BASES_TECNICAS', 'Solicitud_Cotizacion_Minera_Pelambres.pdf', '{"plazo_entrega":"10 dias habiles en faena","vigencia_oferta_dias":30}', 'COMPLETADO', 'Carlos Mendoza Silva', '14.892.341-2')
            """)

        conn.commit()

    print("Carga de datos de demostración completada con éxito.")
