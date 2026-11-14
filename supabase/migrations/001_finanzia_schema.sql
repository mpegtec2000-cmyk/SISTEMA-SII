-- ============================================================================
-- FINANZIA ECOSYSTEM — SUPABASE / POSTGRESQL UNIFIED SCHEMA (MIGRATION 001)
-- Covers: Web Principal (Leads, Orders, Profiles), Portal Personas, & ERP Empresa
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. USUARIOS Y PERFILES UNIFICADOS (SSO)
CREATE TABLE IF NOT EXISTS public.finanzia_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE,
  full_name TEXT NOT NULL,
  rut TEXT,
  role TEXT NOT NULL DEFAULT 'EMPRESA' CHECK (role IN ('PERSONA', 'EMPRESA', 'STAFF', 'ADMIN')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. BANDEJA DE SOLICITUDES WEB PRINCIPAL (CRÉDITOS, BANCARIZACIÓN, DIAGNÓSTICO, PLANES)
CREATE TABLE IF NOT EXISTS public.web_leads (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL CHECK (source IN ('CREDITOS', 'BANCARIZACION', 'DIAGNOSTICO', 'PLANES')),
  person_type TEXT NOT NULL,
  name TEXT NOT NULL,
  rut TEXT,
  email TEXT,
  phone TEXT,
  summary TEXT NOT NULL,
  problem_preview TEXT,
  solution_preview TEXT,
  amount_clp NUMERIC(15, 2),
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

-- 4. CARPETAS INTELIGENTES DE NEGOCIO Y LICITACIONES 360°
CREATE TABLE IF NOT EXISTS public.business_folders (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT REFERENCES public.companies(id) ON DELETE CASCADE,
  code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  client_name TEXT NOT NULL,
  client_rut TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('MERCADO_PUBLICO', 'PRIVADO')),
  tender_id TEXT,
  status TEXT NOT NULL DEFAULT 'EN_PROCESO',
  budget_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  target_margin_pct NUMERIC(5, 2) NOT NULL DEFAULT 25,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. DOCUMENTOS TRIBUTARIOS ELECTRÓNICOS (SII RCV & EMISIÓN DIRECTA)
CREATE TABLE IF NOT EXISTS public.sii_dtes (
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

-- 6. BANCOS, MOVIMIENTOS Y CONTROL DE DEUDAS FINANCIERAS (ANTI-MORA / ANTI-DICOM)
CREATE TABLE IF NOT EXISTS public.bank_accounts (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT REFERENCES public.companies(id) ON DELETE CASCADE,
  bank_name TEXT NOT NULL,
  account_type TEXT NOT NULL,
  account_number TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CLP',
  balance NUMERIC(15, 2) NOT NULL DEFAULT 0
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
  reconciled_dte_id BIGINT REFERENCES public.sii_dtes(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.financial_debts (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT REFERENCES public.companies(id) ON DELETE CASCADE,
  institution TEXT NOT NULL,
  debt_type TEXT NOT NULL,
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

-- 7. INVENTARIO SKU & FICHAS DE CATÁLOGO WEB
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
  stock_reserved NUMERIC(15, 2) NOT NULL DEFAULT 0,
  stock_min NUMERIC(15, 2) NOT NULL DEFAULT 3,
  source_url TEXT,
  image_url TEXT,
  norms TEXT,
  specs_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  in_catalog BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
