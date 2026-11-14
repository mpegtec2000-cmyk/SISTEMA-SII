import sqlite3
import os
import contextvars
from typing import List, Dict, Any, Optional

DB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
DB_PATH = os.path.join(DB_DIR, "erp_database.db")
TENANTS_DIR = os.path.join(DB_DIR, "tenants")

# ---------------------------------------------------------------------------
# Multi-empresa: cada empresa opera en su propia base de datos SQLite aislada.
#  - La base "maestra" (DB_PATH) guarda el registro de empresas y usuarios y, por
#    compatibilidad, los datos de la primera empresa (id más bajo).
#  - Las demás empresas viven en data/tenants/company_<id>.db
# El contexto (empresa activa) lo fija el middleware de cada request.
# ---------------------------------------------------------------------------
MASTER = "master"
_current_company: contextvars.ContextVar = contextvars.ContextVar("current_company", default=MASTER)
_first_company_id: Optional[int] = None


def set_current_company(company_id):
    """Fija la empresa activa del contexto. Devuelve el token para restaurar."""
    return _current_company.set(company_id if company_id else MASTER)


def reset_current_company(token):
    _current_company.reset(token)


def current_company_id():
    return _current_company.get()


def _master_conn() -> sqlite3.Connection:
    os.makedirs(DB_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def first_company_id() -> Optional[int]:
    """Empresa cuyos datos viven en la base maestra (la de id más bajo)."""
    global _first_company_id
    if _first_company_id is None:
        try:
            with _master_conn() as c:
                r = c.execute("SELECT MIN(id) FROM companies").fetchone()
                _first_company_id = r[0] if r and r[0] else None
        except Exception:
            return None
    return _first_company_id


def db_path_for(company_id) -> str:
    if company_id in (None, MASTER) or company_id == first_company_id():
        return DB_PATH
    os.makedirs(TENANTS_DIR, exist_ok=True)
    return os.path.join(TENANTS_DIR, f"company_{int(company_id)}.db")


def active_company_id() -> Optional[int]:
    """Id numérico de la empresa activa (la primera si el contexto es la base maestra)."""
    cid = _current_company.get()
    return first_company_id() if cid in (None, MASTER) else int(cid)


def tenant_file_prefix() -> str:
    """Prefijo para nombres de archivos físicos, evita choques entre empresas."""
    cid = _current_company.get()
    if cid in (None, MASTER) or cid == first_company_id():
        return ""
    return f"c{int(cid)}_"


def get_db_connection() -> sqlite3.Connection:
    os.makedirs(DB_DIR, exist_ok=True)
    conn = sqlite3.connect(db_path_for(_current_company.get()))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def ensure_tenant(company_id: int):
    """Crea/migra el esquema de la base de una empresa y replica su ficha."""
    with _master_conn() as m:
        row = m.execute("SELECT * FROM companies WHERE id = ?", (company_id,)).fetchone()
    tok = set_current_company(company_id)
    try:
        init_db()
        if row is not None and db_path_for(company_id) != DB_PATH:
            d = dict(row)
            cols = ", ".join(d.keys())
            ph = ", ".join("?" for _ in d)
            with get_db_connection() as conn:
                if conn.execute("SELECT 1 FROM companies WHERE id = ?", (company_id,)).fetchone():
                    sets = ", ".join(f"{k} = ?" for k in d.keys() if k != "id")
                    conn.execute(f"UPDATE companies SET {sets} WHERE id = ?",
                                 tuple(v for k, v in d.items() if k != "id") + (company_id,))
                else:
                    conn.execute(f"INSERT INTO companies ({cols}) VALUES ({ph})", tuple(d.values()))
                conn.commit()
    finally:
        reset_current_company(tok)

def init_db():
    os.makedirs(DB_DIR, exist_ok=True)
    uploads_dir = os.path.join(DB_DIR, "uploads")
    generated_dir = os.path.join(DB_DIR, "generated")
    os.makedirs(uploads_dir, exist_ok=True)
    os.makedirs(generated_dir, exist_ok=True)

    with get_db_connection() as conn:
        cursor = conn.cursor()
        
        # 1. Multi-Empresas
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS companies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rut TEXT NOT NULL UNIQUE,
            razon_social TEXT NOT NULL,
            giro TEXT,
            direccion TEXT,
            comuna TEXT,
            ciudad TEXT,
            telefono TEXT,
            email TEXT,
            logo_url TEXT,
            ppm_rate REAL DEFAULT 1.5,
            is_default INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """)

        # 2. Clientes y Proveedores (Contrapartes)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS counterparties (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rut TEXT NOT NULL UNIQUE,
            razon_social TEXT NOT NULL,
            giro TEXT,
            tipo TEXT DEFAULT 'AMBOS', -- 'CLIENTE', 'PROVEEDOR', 'AMBOS'
            email TEXT,
            telefono TEXT,
            direccion TEXT,
            condiciones_pago TEXT DEFAULT '30 días',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """)

        # 3. Carpetas de Negocio (Centros de Costo)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS business_folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            client_id INTEGER,
            client_name TEXT NOT NULL,
            client_rut TEXT NOT NULL,
            status TEXT DEFAULT 'EN_EJECUCION', -- 'EN_PREPARACION', 'ENVIADA', 'ADJUDICADA', 'EN_EJECUCION', 'CERRADA', 'PERDIDA'
            type TEXT DEFAULT 'MERCADO_PUBLICO', -- 'MERCADO_PUBLICO', 'PRIVADO'
            tender_id TEXT, -- ID Licitación Mercado Público (ej: 1234-56-LP24)
            tender_closing_date TEXT,
            budget_amount REAL DEFAULT 0,
            company_id INTEGER,
            target_margin_pct REAL DEFAULT 25.0,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(company_id) REFERENCES companies(id)
        )
        """)

        # 4. Gastos adicionales de Carpeta (fletes, subcontratos, viáticos)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS folder_expenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            folder_id INTEGER NOT NULL,
            description TEXT NOT NULL,
            category TEXT DEFAULT 'OTRO', -- 'FLETE', 'SUBCONTRATO', 'VIATICO', 'HONORARIOS', 'SEGUROS', 'OTRO'
            amount REAL NOT NULL,
            date TEXT NOT NULL,
            doc_number TEXT,
            supplier_rut TEXT,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(folder_id) REFERENCES business_folders(id) ON DELETE CASCADE
        )
        """)

        # 5. Catálogo de Productos / Inventario
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sku TEXT NOT NULL UNIQUE,
            barcode TEXT,
            name TEXT NOT NULL,
            description TEXT,
            category TEXT DEFAULT 'General',
            unit TEXT DEFAULT 'UND',
            unit_cost REAL DEFAULT 0,
            unit_price REAL DEFAULT 0,
            stock_physical REAL DEFAULT 0,
            stock_reserved REAL DEFAULT 0,
            stock_min REAL DEFAULT 5,
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """)

        # 6. Movimientos de Inventario
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS inventory_movements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            sku TEXT NOT NULL,
            type TEXT NOT NULL, -- 'ENTRADA', 'SALIDA', 'RESERVA', 'LIBERACION'
            quantity REAL NOT NULL,
            reference_doc TEXT,
            reference_type TEXT, -- 'COTIZACION', 'FACTURA_VENTA', 'FACTURA_COMPRA', 'AJUSTE'
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
        )
        """)

        # 7. Cotizaciones
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS quotations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            folio TEXT NOT NULL UNIQUE,
            folder_id INTEGER,
            company_id INTEGER NOT NULL,
            client_name TEXT NOT NULL,
            client_rut TEXT NOT NULL,
            client_address TEXT,
            client_contact TEXT,
            client_email TEXT,
            date TEXT NOT NULL,
            validity_days INTEGER DEFAULT 15,
            currency TEXT DEFAULT 'CLP',
            payment_terms TEXT DEFAULT '30 días contra factura',
            delivery_time TEXT DEFAULT '5 días hábiles',
            subtotal REAL DEFAULT 0,
            discount_amount REAL DEFAULT 0,
            net_amount REAL DEFAULT 0,
            tax_amount REAL DEFAULT 0, -- IVA 19%
            total_amount REAL DEFAULT 0,
            notes TEXT,
            type TEXT DEFAULT 'MERCADO_PUBLICO',
            tender_id TEXT,
            warranty_doc TEXT,
            status TEXT DEFAULT 'ACEPTADA', -- 'BORRADOR', 'ENVIADA', 'ACEPTADA', 'RECHAZADA', 'FACTURADA'
            signature_data_url TEXT,
            signer_name TEXT,
            signer_rut TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(folder_id) REFERENCES business_folders(id) ON DELETE SET NULL,
            FOREIGN KEY(company_id) REFERENCES companies(id)
        )
        """)

        # 8. Ítems de Cotizaciones
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS quotation_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            quotation_id INTEGER NOT NULL,
            sku TEXT,
            description TEXT NOT NULL,
            unit TEXT DEFAULT 'UND',
            quantity REAL NOT NULL,
            unit_cost REAL DEFAULT 0,
            unit_price REAL NOT NULL,
            discount_pct REAL DEFAULT 0,
            margin_pct REAL DEFAULT 0,
            subtotal REAL NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(quotation_id) REFERENCES quotations(id) ON DELETE CASCADE
        )
        """)

        # 9. Documentos Tributarios Electrónicos (DTE / RCV)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS dte_documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dte_type INTEGER NOT NULL, -- 33: Factura, 34: Factura Exenta, 61: Nota Crédito, 56: Nota Débito, 52: Guía
            folio INTEGER NOT NULL,
            rut_emisor TEXT NOT NULL,
            razon_social_emisor TEXT NOT NULL,
            rut_receptor TEXT NOT NULL,
            razon_social_receptor TEXT NOT NULL,
            emission_date TEXT NOT NULL,
            expiration_date TEXT,
            net_amount REAL DEFAULT 0,
            exempt_amount REAL DEFAULT 0,
            iva_amount REAL DEFAULT 0,
            total_amount REAL NOT NULL,
            direction TEXT NOT NULL, -- 'EMITIDO' (Venta), 'RECIBIDO' (Compra)
            status_sii TEXT DEFAULT 'ACEPTADO',
            folder_id INTEGER,
            quotation_id INTEGER,
            is_reconciled INTEGER DEFAULT 0,
            source TEXT DEFAULT 'RCV', -- 'RCV_VENTAS', 'RCV_COMPRAS', 'EMISION_DIRECTA', 'MANUAL_EXTERNO'
            file_url TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(folder_id) REFERENCES business_folders(id) ON DELETE SET NULL,
            FOREIGN KEY(quotation_id) REFERENCES quotations(id) ON DELETE SET NULL
        )
        """)

        # 10. Cuentas Bancarias
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS bank_accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bank_name TEXT NOT NULL,
            account_number TEXT NOT NULL,
            account_type TEXT DEFAULT 'Cuenta Corriente',
            company_id INTEGER,
            currency TEXT DEFAULT 'CLP',
            balance REAL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(company_id) REFERENCES companies(id)
        )
        """)

        # 11. Movimientos Bancarios (Cartola)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS bank_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id INTEGER NOT NULL,
            transaction_date TEXT NOT NULL,
            description TEXT NOT NULL,
            amount REAL NOT NULL,
            transaction_type TEXT NOT NULL, -- 'ABONO', 'CARGO'
            balance REAL DEFAULT 0,
            is_reconciled INTEGER DEFAULT 0,
            reconciled_dte_id INTEGER,
            folder_id INTEGER,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(account_id) REFERENCES bank_accounts(id) ON DELETE CASCADE,
            FOREIGN KEY(reconciled_dte_id) REFERENCES dte_documents(id) ON DELETE SET NULL,
            FOREIGN KEY(folder_id) REFERENCES business_folders(id) ON DELETE SET NULL
        )
        """)

        # 12. Gestor Documental de Licitaciones y Anexos
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS tender_documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            folder_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            doc_type TEXT DEFAULT 'ANEXO_DECLARACION', -- 'BASES_TECNICAS', 'BASES_ADMIN', 'ANEXO_DECLARACION', 'ANEXO_OFERTA', 'ANEXO_EXPERIENCIA', 'OTRO'
            original_filename TEXT,
            file_path TEXT,
            form_data_json TEXT,
            signature_data_url TEXT,
            signer_name TEXT,
            signer_rut TEXT,
            status TEXT DEFAULT 'BORRADOR', -- 'BORRADOR', 'COMPLETADO', 'FIRMADO'
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(folder_id) REFERENCES business_folders(id) ON DELETE CASCADE
        )
        """)

        # 13. Productos Solicitados y Especificaciones Técnicas Extraídas de Documentos (Público y Privado)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS folder_requested_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            folder_id INTEGER NOT NULL,
            item_number INTEGER DEFAULT 1,
            product_name TEXT NOT NULL,
            technical_specs TEXT,
            quantity REAL DEFAULT 1,
            unit TEXT DEFAULT 'UND',
            estimated_cost REAL DEFAULT 0,
            offered_price REAL DEFAULT 0,
            matched_sku TEXT,
            source_doc TEXT,
            status TEXT DEFAULT 'VALIDADO',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(folder_id) REFERENCES business_folders(id) ON DELETE CASCADE
        )
        """)

        # 14. Jobs de análisis IA por documento
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS folder_analysis_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            folder_id INTEGER NOT NULL,
            document_id INTEGER,
            filename TEXT,
            status TEXT DEFAULT 'PENDIENTE', -- PENDIENTE, LEYENDO, ANALIZANDO, LISTO, ERROR
            stage_msg TEXT,
            provider TEXT,
            pages INTEGER DEFAULT 0,
            error TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            finished_at TIMESTAMP,
            FOREIGN KEY(folder_id) REFERENCES business_folders(id) ON DELETE CASCADE
        )
        """)

        # 15. Checklist de pendientes (muestras, documentos, firmas, garantías, requisitos excluyentes)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS folder_checklist_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            folder_id INTEGER NOT NULL,
            category TEXT NOT NULL, -- MUESTRA, DOCUMENTO, FIRMA, GARANTIA, EXCLUYENTE, OTRO
            title TEXT NOT NULL,
            detail TEXT,
            due_date TEXT,
            place TEXT,
            is_mandatory INTEGER DEFAULT 1,
            requires_signature INTEGER DEFAULT 0,
            status TEXT DEFAULT 'PENDIENTE', -- PENDIENTE, HECHO
            source_doc TEXT,
            source_page INTEGER,
            document_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(folder_id) REFERENCES business_folders(id) ON DELETE CASCADE
        )
        """)

        # 16. Hitos y fechas clave
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS folder_milestones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            folder_id INTEGER NOT NULL,
            kind TEXT NOT NULL, -- CONSULTAS, RESPUESTAS, CIERRE, APERTURA, ADJUDICACION, ORDEN_COMPRA, ENTREGA, OTRO
            title TEXT NOT NULL,
            rule_text TEXT,
            anchor TEXT,
            offset_days INTEGER,
            offset_type TEXT, -- CORRIDOS, HABILES
            due_date TEXT,
            source_page INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(folder_id) REFERENCES business_folders(id) ON DELETE CASCADE
        )
        """)

        # 17. Riesgos y puntos críticos
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS folder_risks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            folder_id INTEGER NOT NULL,
            kind TEXT NOT NULL, -- GARANTIA, MULTA, CRITERIO, EXCLUYENTE, CONDICION, PLAZO
            title TEXT NOT NULL,
            detail TEXT,
            severity TEXT DEFAULT 'MEDIA', -- ALTA, MEDIA, BAJA
            source_doc TEXT,
            source_page INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(folder_id) REFERENCES business_folders(id) ON DELETE CASCADE
        )
        """)

        # 18. Perfiles de firmante (firma guardada reutilizable)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS signer_profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            rut TEXT,
            role TEXT DEFAULT 'Representante Legal',
            signature_data_url TEXT,
            is_default INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """)

        # 19. Cotizaciones de proveedores (comparador de costos por carpeta)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS supplier_quote_lines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            folder_id INTEGER NOT NULL,
            requested_item_id INTEGER,          -- producto solicitado al que se asocia (nullable)
            supplier_rut TEXT,
            supplier_name TEXT NOT NULL,
            sku TEXT,
            description TEXT,
            unit_price REAL DEFAULT 0,          -- precio unitario neto
            quantity REAL DEFAULT 0,
            lead_time_days INTEGER,
            quote_ref TEXT,
            source_file TEXT,
            is_selected INTEGER DEFAULT 0,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(folder_id) REFERENCES business_folders(id) ON DELETE CASCADE
        )
        """)

        # 20. Documentos comerciales propios: Órdenes de Compra y Cotizaciones directas
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS commercial_docs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            doc_type TEXT NOT NULL,             -- 'OC' | 'COTIZACION'
            folio TEXT NOT NULL UNIQUE,
            folder_id INTEGER,
            counterparty_rut TEXT,
            counterparty_name TEXT NOT NULL,
            counterparty_address TEXT,
            counterparty_email TEXT,
            counterparty_contact TEXT,
            issue_date TEXT,
            delivery_date TEXT,
            validity_days INTEGER DEFAULT 15,
            payment_terms TEXT,
            delivery_place TEXT,
            notes TEXT,
            items_json TEXT,
            net_amount REAL DEFAULT 0,
            tax_amount REAL DEFAULT 0,
            total_amount REAL DEFAULT 0,
            status TEXT DEFAULT 'EMITIDA',      -- EMITIDA, ENVIADA, ACEPTADA, ANULADA
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(folder_id) REFERENCES business_folders(id) ON DELETE SET NULL
        )
        """)

        # 21. Integración SII (certificado digital cifrado, por empresa)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS sii_config (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            rut TEXT,
            ambiente TEXT DEFAULT 'PRODUCCION',   -- PRODUCCION | CERTIFICACION
            pfx_enc BLOB,
            pass_enc BLOB,
            cert_subject TEXT,
            cert_rut TEXT,
            cert_expires TEXT,
            last_sync TEXT,
            last_status TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """)

        # 22. Integración bancaria (Fintoc), por empresa
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS bank_connections (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            provider TEXT DEFAULT 'FINTOC',
            secret_enc BLOB,
            public_key TEXT,
            link_token_enc BLOB,
            institution TEXT,
            status TEXT DEFAULT 'SIN_CONECTAR',
            last_sync TEXT,
            last_message TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS email_config (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            provider TEXT DEFAULT 'SMTP',
            host TEXT, port INTEGER DEFAULT 587, security TEXT DEFAULT 'STARTTLS',
            username TEXT, pass_enc BLOB, api_key_enc BLOB,
            from_email TEXT, from_name TEXT, reply_to TEXT,
            last_status TEXT, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS dte_payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dte_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            paid_date TEXT NOT NULL,
            method TEXT NOT NULL,
            source TEXT DEFAULT 'MANUAL',
            bank_transaction_id INTEGER,
            transfer_ref TEXT,
            receipt_path TEXT,
            receipt_name TEXT,
            notes TEXT,
            created_by TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS rcv_summary (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            period TEXT NOT NULL,
            direction TEXT NOT NULL,
            dte_type INTEGER NOT NULL,
            doc_count INTEGER DEFAULT 0,
            exempt_amount REAL DEFAULT 0,
            net_amount REAL DEFAULT 0,
            iva_amount REAL DEFAULT 0,
            total_amount REAL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(period, direction, dte_type)
        )
        """)

        # Elimina el DTE de prueba que insertaba la antigua "sincronización simulada" del RCV
        try:
            mock = cursor.execute("SELECT id FROM dte_documents WHERE folio = 55102 AND rut_emisor = '76.444.333-2' "
                                  "AND razon_social_emisor = 'Distribuidora Nacional de Insumos SpA'").fetchall()
            for m in mock:
                cursor.execute("DELETE FROM dte_payments WHERE dte_id = ?", (m[0],))
                cursor.execute("DELETE FROM dte_documents WHERE id = ?", (m[0],))
        except Exception:
            pass

        # Migraciones seguras de columnas
        migrations = [
            "ALTER TABLE business_folders ADD COLUMN progress_pct INTEGER DEFAULT 65",
            "ALTER TABLE business_folders ADD COLUMN publication_date TEXT",
            "ALTER TABLE business_folders ADD COLUMN analysis_summary TEXT",
            "ALTER TABLE tender_documents ADD COLUMN requires_signature INTEGER DEFAULT 0",
            "ALTER TABLE tender_documents ADD COLUMN is_mandatory INTEGER DEFAULT 0",
            "ALTER TABLE tender_documents ADD COLUMN detected_by_ai INTEGER DEFAULT 0",
            "ALTER TABLE tender_documents ADD COLUMN extracted_text TEXT",
            "ALTER TABLE tender_documents ADD COLUMN signed_file_path TEXT",
        "ALTER TABLE tender_documents ADD COLUMN annotations_json TEXT",
            "ALTER TABLE folder_requested_items ADD COLUMN source_page INTEGER",
            "ALTER TABLE folder_requested_items ADD COLUMN in_quotation INTEGER DEFAULT 0",
            # Catálogo con fichas enriquecidas desde enlaces web
            "ALTER TABLE products ADD COLUMN brand TEXT",
            "ALTER TABLE products ADD COLUMN source_url TEXT",
            "ALTER TABLE products ADD COLUMN image_url TEXT",
            "ALTER TABLE products ADD COLUMN image_path TEXT",
            "ALTER TABLE products ADD COLUMN specs_json TEXT",
            "ALTER TABLE products ADD COLUMN norms TEXT",
            "ALTER TABLE products ADD COLUMN warranty TEXT",
            "ALTER TABLE products ADD COLUMN datasheet_url TEXT",
            "ALTER TABLE products ADD COLUMN in_catalog INTEGER DEFAULT 0",
            "ALTER TABLE products ADD COLUMN scrape_status TEXT",
            "ALTER TABLE sii_config ADD COLUMN clave_enc TEXT",
            "ALTER TABLE bank_connections ADD COLUMN mode TEXT DEFAULT 'LIVE'",
            "ALTER TABLE bank_connections ADD COLUMN secret_test_enc BLOB",
            "ALTER TABLE bank_connections ADD COLUMN public_key_test TEXT",
            "ALTER TABLE bank_connections ADD COLUMN link_token_test_enc BLOB",
            "ALTER TABLE signer_profiles ADD COLUMN stamp_data_url TEXT",
            "ALTER TABLE bank_accounts ADD COLUMN external_id TEXT",
            "ALTER TABLE bank_accounts ADD COLUMN provider TEXT",
            "ALTER TABLE bank_transactions ADD COLUMN external_id TEXT",
            "ALTER TABLE dte_documents ADD COLUMN paid_amount REAL DEFAULT 0",
            "ALTER TABLE dte_documents ADD COLUMN payment_status TEXT DEFAULT 'PENDIENTE'",
            "ALTER TABLE dte_documents ADD COLUMN paid_date TEXT",
            "ALTER TABLE dte_documents ADD COLUMN payment_method TEXT",
            "ALTER TABLE dte_documents ADD COLUMN payment_ref TEXT",
            "ALTER TABLE business_folders ADD COLUMN awarded_amount REAL DEFAULT 0",
            "ALTER TABLE business_folders ADD COLUMN oc_number TEXT",
            """CREATE TABLE IF NOT EXISTS folder_evaluation_criteria (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                folder_id INTEGER NOT NULL,
                criterion TEXT NOT NULL,
                weight_pct REAL NOT NULL DEFAULT 0,
                detail TEXT,
                source_page INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(folder_id) REFERENCES business_folders(id) ON DELETE CASCADE
            )""",
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_tx_external ON bank_transactions(external_id)",
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_acc_external ON bank_accounts(external_id)",
            "ALTER TABLE folder_requested_items ADD COLUMN tech_sheet_status TEXT DEFAULT 'PENDIENTE'",
            "ALTER TABLE folder_requested_items ADD COLUMN tech_sheet_file TEXT",
            "ALTER TABLE folder_requested_items ADD COLUMN tech_sheet_filename TEXT",
            "ALTER TABLE folder_checklist_items ADD COLUMN file_path TEXT",
            "ALTER TABLE folder_checklist_items ADD COLUMN original_filename TEXT",
            """CREATE TABLE IF NOT EXISTS folder_clarifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                folder_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                request_text TEXT,
                response_text TEXT,
                deadline_at TEXT,
                status TEXT DEFAULT 'PENDIENTE',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(folder_id) REFERENCES business_folders(id) ON DELETE CASCADE
            )""",
            """CREATE TABLE IF NOT EXISTS folder_adjudication_benchmarks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                folder_id INTEGER NOT NULL,
                product_name TEXT NOT NULL,
                entity_name TEXT,
                past_unit_price REAL DEFAULT 0,
                past_award_date TEXT,
                past_winner_name TEXT,
                tender_id TEXT,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(folder_id) REFERENCES business_folders(id) ON DELETE CASCADE
            )""",
            """CREATE TABLE IF NOT EXISTS folder_dispatch_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                folder_id INTEGER NOT NULL,
                item_id INTEGER,
                product_name TEXT NOT NULL,
                size TEXT,
                color TEXT,
                quantity REAL DEFAULT 1,
                destination_place TEXT,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(folder_id) REFERENCES business_folders(id) ON DELETE CASCADE
            )""",
            """CREATE TABLE IF NOT EXISTS company_legal_vault (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                company_id INTEGER NOT NULL,
                doc_code TEXT NOT NULL,
                title TEXT NOT NULL,
                file_path TEXT NOT NULL,
                original_filename TEXT NOT NULL,
                issue_date TEXT,
                expiration_date TEXT,
                status TEXT DEFAULT 'VIGENTE',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE
            )""",
            "ALTER TABLE business_folders ADD COLUMN oc_date TEXT",
            "ALTER TABLE business_folders ADD COLUMN delivery_days INTEGER DEFAULT 15",
            "ALTER TABLE business_folders ADD COLUMN dispatch_guide_number TEXT",
            "ALTER TABLE business_folders ADD COLUMN dispatch_guide_date TEXT",
            "ALTER TABLE business_folders ADD COLUMN daily_penalty_pct REAL DEFAULT 1.0",
            "ALTER TABLE business_folders ADD COLUMN daily_penalty_fixed REAL DEFAULT 0",
            "ALTER TABLE dte_documents ADD COLUMN payment_condition TEXT DEFAULT 'CREDITO'",
            "ALTER TABLE dte_documents ADD COLUMN observations TEXT",
        ]
        for sql in migrations:
            try:
                cursor.execute(sql)
            except Exception:
                pass

        conn.commit()

def query_all(query: str, params: tuple = ()) -> List[Dict[str, Any]]:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(query, params)
        rows = cursor.fetchall()
        return [dict(row) for row in rows]

def query_one(query: str, params: tuple = ()) -> Optional[Dict[str, Any]]:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(query, params)
        row = cursor.fetchone()
        return dict(row) if row else None

def execute_insert(query: str, params: tuple = ()) -> int:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(query, params)
        conn.commit()
        return cursor.lastrowid

def execute_commit(query: str, params: tuple = ()) -> int:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(query, params)
        conn.commit()
        return cursor.rowcount
