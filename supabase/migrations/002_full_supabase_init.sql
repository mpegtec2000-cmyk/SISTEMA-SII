-- ============================================================================
-- FINANZIA ECOSYSTEM — SCHEMA COMPLETO PARA SUPABASE SQL EDITOR
-- Compatible con: Next.js SaaS + ERP FastAPI + Flow + SII + Bancos
-- ============================================================================

-- Habilitar extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. USUARIOS Y PERFILES (SSO & ACCESOS)
CREATE TABLE IF NOT EXISTS public.finanzia_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE,
  password_hash TEXT,
  full_name TEXT NOT NULL,
  rut TEXT,
  role TEXT NOT NULL DEFAULT 'EMPRESA' CHECK (role IN ('PERSONA', 'EMPRESA', 'STAFF', 'ADMIN')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. BANDEJA DE SOLICITUDES Y LEADS WEB (CRM DE CLIENTES)
CREATE TABLE IF NOT EXISTS public.web_leads (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL CHECK (source IN ('CREDITOS', 'BANCARIZACION', 'DIAGNOSTICO', 'PLANES')),
  person_type TEXT NOT NULL DEFAULT 'Persona',
  name TEXT NOT NULL,
  rut TEXT,
  email TEXT,
  phone TEXT,
  summary TEXT NOT NULL,
  problem_preview TEXT,
  solution_preview TEXT,
  amount_clp NUMERIC(15, 2) DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'NUEVO' CHECK (status IN ('NUEVO', 'CONTACTADO', 'EN_GESTION', 'CERRADO')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- 3. EMPRESAS (MULTI-TENANT ERP)
CREATE TABLE IF NOT EXISTS public.companies (
  id BIGSERIAL PRIMARY KEY,
  razon_social TEXT NOT NULL,
  rut TEXT UNIQUE NOT NULL,
  giro TEXT,
  direccion TEXT,
  comuna TEXT,
  ciudad TEXT DEFAULT 'Santiago',
  email TEXT,
  telefono TEXT,
  ppm_rate NUMERIC(5, 2) NOT NULL DEFAULT 1.5,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. BÓVEDA LEGAL DOCUMENTAL POR EMPRESA
CREATE TABLE IF NOT EXISTS public.company_legal_vault (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT REFERENCES public.companies(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size BIGINT DEFAULT 0,
  expiration_date DATE,
  notes TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. CONFIGURACIÓN DEL SII (FACTURACIÓN Y RCV)
CREATE TABLE IF NOT EXISTS public.sii_config (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT REFERENCES public.companies(id) ON DELETE CASCADE,
  rut TEXT NOT NULL,
  ambiente TEXT NOT NULL DEFAULT 'PRODUCCION',
  clave_enc TEXT,
  pfx_enc TEXT,
  pass_enc TEXT,
  cert_subject TEXT,
  cert_rut TEXT,
  cert_expires TEXT,
  last_sync TIMESTAMPTZ,
  last_status TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. CARPETAS INTELIGENTES DE NEGOCIO Y LICITACIONES 360°
CREATE TABLE IF NOT EXISTS public.business_folders (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT REFERENCES public.companies(id) ON DELETE CASCADE,
  code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  client_name TEXT NOT NULL,
  client_rut TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'VENTA_PRIVADA' CHECK (type IN ('MERCADO_PUBLICO', 'VENTA_PRIVADA', 'PRIVADO')),
  tender_id TEXT,
  status TEXT NOT NULL DEFAULT 'EN_PROCESO',
  budget_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  target_margin_pct NUMERIC(5, 2) NOT NULL DEFAULT 25,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. DOCUMENTOS TRIBUTARIOS ELECTRÓNICOS (SII RCV / DTEs)
CREATE TABLE IF NOT EXISTS public.dte_documents (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT REFERENCES public.companies(id) ON DELETE CASCADE,
  folder_id BIGINT REFERENCES public.business_folders(id) ON DELETE SET NULL,
  dte_type INTEGER NOT NULL,
  folio INTEGER NOT NULL,
  rut_emisor TEXT NOT NULL,
  razon_social_emisor TEXT NOT NULL,
  rut_receptor TEXT NOT NULL,
  razon_social_receptor TEXT NOT NULL,
  emission_date DATE NOT NULL,
  expiration_date DATE,
  net_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  exempt_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  iva_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  direction TEXT NOT NULL CHECK (direction IN ('EMITIDO', 'RECIBIDO')),
  status_sii TEXT NOT NULL DEFAULT 'ACEPTADO',
  is_reconciled BOOLEAN NOT NULL DEFAULT FALSE,
  payment_status TEXT NOT NULL DEFAULT 'PENDIENTE',
  paid_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  source TEXT DEFAULT 'RCV_SYNC',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. CUENTAS BANCARIAS Y CONCILIACIÓN
CREATE TABLE IF NOT EXISTS public.bank_accounts (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT REFERENCES public.companies(id) ON DELETE CASCADE,
  bank_name TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'Cuenta Corriente',
  account_number TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CLP',
  balance NUMERIC(15, 2) NOT NULL DEFAULT 0,
  provider TEXT DEFAULT 'MANUAL',
  external_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.bank_transactions (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  transaction_date DATE NOT NULL,
  description TEXT NOT NULL,
  reference_number TEXT,
  amount NUMERIC(15, 2) NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('ABONO', 'CARGO')),
  balance NUMERIC(15, 2) NOT NULL DEFAULT 0,
  is_reconciled BOOLEAN NOT NULL DEFAULT FALSE,
  reconciled_dte_id BIGINT REFERENCES public.dte_documents(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. DEUDAS FINANCIERAS (SEMÁFORO DE VENCIMIENTOS Y BLINDAJE)
CREATE TABLE IF NOT EXISTS public.financial_debts (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT REFERENCES public.companies(id) ON DELETE CASCADE,
  institution TEXT NOT NULL,
  debt_type TEXT NOT NULL DEFAULT 'CREDITO_COMERCIAL',
  title TEXT NOT NULL,
  total_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  remaining_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  monthly_payment NUMERIC(15, 2) NOT NULL DEFAULT 0,
  interest_rate NUMERIC(5, 2) NOT NULL DEFAULT 0,
  total_installments INTEGER NOT NULL DEFAULT 12,
  paid_installments INTEGER NOT NULL DEFAULT 0,
  due_day INTEGER NOT NULL DEFAULT 5,
  next_due_date DATE,
  status TEXT NOT NULL DEFAULT 'AL_DIA',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. CATÁLOGO SKU & PRODUCTOS
CREATE TABLE IF NOT EXISTS public.products (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT REFERENCES public.companies(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  brand TEXT,
  unit TEXT NOT NULL DEFAULT 'UND',
  unit_cost NUMERIC(15, 2) NOT NULL DEFAULT 0,
  unit_price NUMERIC(15, 2) NOT NULL DEFAULT 0,
  stock_physical NUMERIC(15, 2) NOT NULL DEFAULT 0,
  stock_min NUMERIC(15, 2) NOT NULL DEFAULT 3,
  image_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. COTIZACIONES COMERCIALES Y ÓRDENES DE COMPRA
CREATE TABLE IF NOT EXISTS public.quotations (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT REFERENCES public.companies(id) ON DELETE CASCADE,
  folder_id BIGINT REFERENCES public.business_folders(id) ON DELETE SET NULL,
  code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  client_name TEXT NOT NULL,
  client_rut TEXT NOT NULL,
  subtotal_net NUMERIC(15, 2) NOT NULL DEFAULT 0,
  iva_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  margin_pct NUMERIC(5, 2) NOT NULL DEFAULT 20,
  status TEXT NOT NULL DEFAULT 'BORRADOR' CHECK (status IN ('BORRADOR', 'ENVIADA', 'APROBADA', 'RECHAZADA')),
  validity_days INTEGER NOT NULL DEFAULT 15,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.quotation_items (
  id BIGSERIAL PRIMARY KEY,
  quotation_id BIGINT REFERENCES public.quotations(id) ON DELETE CASCADE,
  product_id BIGINT REFERENCES public.products(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity NUMERIC(10, 2) NOT NULL DEFAULT 1,
  unit_cost NUMERIC(15, 2) NOT NULL DEFAULT 0,
  unit_price NUMERIC(15, 2) NOT NULL DEFAULT 0,
  total_net NUMERIC(15, 2) NOT NULL DEFAULT 0
);

-- ============================================================================
-- SEGURIDAD: ROW LEVEL SECURITY (RLS) CON ACCESO PERMISIVO PARA API KEYS
-- ============================================================================
ALTER TABLE public.finanzia_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.web_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_legal_vault ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sii_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dte_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotation_items ENABLE ROW LEVEL SECURITY;

-- Políticas para permitir lectura y escritura desde la app (API Key anon / authenticated / service_role)
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'finanzia_users', 'web_leads', 'companies', 'company_legal_vault',
    'sii_config', 'business_folders', 'dte_documents', 'bank_accounts',
    'bank_transactions', 'financial_debts', 'products', 'quotations', 'quotation_items'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Public access policy" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Public access policy" ON public.%I FOR ALL USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- ============================================================================
-- DATOS SEMILLA INICIALES (EMPRESA PRINCIPAL + USUARIO ADMINISTRADOR)
-- ============================================================================
INSERT INTO public.companies (id, razon_social, rut, giro, direccion, comuna, ciudad, is_default)
VALUES (1, 'EMPRESA PRINCIPAL CLIENTE', '77.311.088-3', 'Servicios Integrales y Comercio', 'Av. Providencia 1234', 'Providencia', 'Santiago', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.finanzia_users (email, username, full_name, rut, role, is_active)
VALUES 
  ('vision@finanzia.cl', 'vision', 'Administrador Vision', '11.111.111-1', 'ADMIN', true),
  ('admin@finanzia.cl', 'admin', 'Administrador General', '22.222.222-2', 'ADMIN', true),
  ('cliente@empresa.cl', 'cliente', 'Gerente Comercial', '77.311.088-3', 'EMPRESA', true)
ON CONFLICT (email) DO NOTHING;

INSERT INTO public.sii_config (id, company_id, rut, ambiente, last_status)
VALUES (1, 1, '77.311.088-3', 'PRODUCCION', 'Esperando conexión con el SII')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.bank_accounts (company_id, bank_name, account_type, account_number, currency, balance, provider)
VALUES (1, 'Banco Santander', 'Cuenta Corriente', '00-000-00000', 'CLP', 0, 'MANUAL')
ON CONFLICT DO NOTHING;
