'use client';

import React from 'react';
import Link from 'next/link';
import { usePersonas } from '@/lib/personas/context';
import { ModuloId } from '@/lib/personas/types';
import {
  Home,
  ShieldCheck,
  Rocket,
  Calculator,
  TrendingUp,
  SlidersHorizontal,
  Archive,
  CircleDot,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  Plus,
  Sparkles,
  Settings,
  Building2,
  ExternalLink,
  Activity,
  Target,
  Briefcase,
  Percent,
} from 'lucide-react';

interface ModuloNav {
  id: ModuloId;
  nombre: string;
  icono: React.ElementType;
  railIcon: React.ElementType;
  count: string;
  group: 'primary' | 'growth';
}

export default function Sidebar() {
  const {
    moduloActivo,
    setModuloActivo,
    metas,
    oportunidades,
    cursos,
    semaforoInfo,
    semaforoOverride,
    setSemaforoOverride,
    saldoLiquidoTotal,
    setModalNuevaMetaAbierto,
    setModalBancoAbierto,
    setSolicitarPackEmpresasModal,
  } = usePersonas();

  const MODULOS: ModuloNav[] = [
    {
      id: 'metas',
      nombre: 'Metas & Proyección',
      icono: SlidersHorizontal,
      railIcon: Home,
      count: String(metas.length),
      group: 'primary',
    },
    {
      id: 'blindaje',
      nombre: 'Blindaje Anti-DICOM',
      icono: Archive,
      railIcon: Activity,
      count: '24/7',
      group: 'primary',
    },
    {
      id: 'creditos',
      nombre: 'Simulador Créditos',
      icono: Target,
      railIcon: Target,
      count: 'IA',
      group: 'growth',
    },
    {
      id: 'empresario',
      nombre: 'Quiero Ser Empresario',
      icono: Sparkles,
      railIcon: Briefcase,
      count: String(cursos.length),
      group: 'growth',
    },
    {
      id: 'inversiones',
      nombre: 'Finazia Inversiones',
      icono: Percent,
      railIcon: TrendingUp,
      count: String(oportunidades.length),
      group: 'growth',
    },
  ];

  const primaryMods = MODULOS.filter((m) => m.group === 'primary');
  const growthMods = MODULOS.filter((m) => m.group === 'growth');

  return (
    <div className="hidden lg:flex items-stretch gap-2 shrink-0 select-none">
      {/* 1. RIEL PRIMARIO OSCURO DE ÍCONOS (DARK CAPSULE DOCK) */}
      <nav
        className="saas-dark-rail w-[54px] shrink-0 flex flex-col items-center justify-between py-4 px-2"
        aria-label="Módulos Principales"
      >
        <div className="flex flex-col items-center space-y-5">
          {/* Emblema Geométrico */}
          <Link
            href="/"
            className="w-9 h-9 rounded-xl flex items-center justify-center text-white hover:scale-105 transition-transform"
            title="FINANZIA · Volver al Inicio"
          >
            <svg viewBox="0 0 24 24" className="w-6 h-6 fill-current" aria-hidden="true">
              <path d="M4 4h7v7H4V4zm9 0l7 7h-7V4zM4 13h7v7l-7-7zm9 0h7v7h-7v-7z" />
            </svg>
          </Link>

          {/* Íconos de Módulos */}
          <div className="flex flex-col items-center space-y-2">
            {MODULOS.map((m) => {
              const RailIcon = m.railIcon;
              const isSelected = moduloActivo === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setModuloActivo(m.id)}
                  title={m.nombre}
                  className={`saas-rail-icon cursor-pointer ${
                    isSelected ? 'saas-rail-icon-active' : ''
                  }`}
                >
                  <RailIcon className="w-[18px] h-[18px]" />
                </button>
              );
            })}
          </div>
        </div>

        {/* Acciones Inferiores del Riel */}
        <div className="flex flex-col items-center space-y-2">
          <button
            type="button"
            onClick={() => setModalBancoAbierto(true)}
            className="saas-rail-icon cursor-pointer"
            title="Configurar Open Banking"
          >
            <Settings className="w-[18px] h-[18px]" />
          </button>
          <a
            href="/erp"
            className="saas-rail-icon"
            title="Ir a ERP Empresas"
          >
            <Building2 className="w-[18px] h-[18px]" />
          </a>
        </div>
      </nav>

      {/* 2. BARRA LATERAL CONTEXTUAL SECUNDARIA (SUB-SIDEBAR LIGHT) */}
      <aside className="w-64 flex flex-col justify-between px-2.5 py-3 text-zinc-900">
        <div className="space-y-5">
          {/* Encabezado Contextual */}
          <div className="px-2.5 pt-1 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-[16px] text-zinc-900 tracking-tight leading-tight">
                Opportunities
              </h2>
              <p className="text-[11px] text-zinc-400 font-medium mt-0.5">
                Salud & Patrimonio
              </p>
            </div>
            <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md bg-zinc-200/70 text-zinc-700 border border-black/[0.05]">
              CL
            </span>
          </div>

          {/* Navegación Principal (Estilo All / Archived) */}
          <nav className="space-y-1">
            {primaryMods.map((m) => {
              const Icon = m.icono;
              const isSelected = moduloActivo === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setModuloActivo(m.id)}
                  className={`w-full flex items-center justify-between text-left cursor-pointer saas-nav-item ${
                    isSelected ? 'saas-nav-item-active' : ''
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        isSelected ? 'text-zinc-900' : 'text-zinc-500'
                      }`}
                    />
                    <span className="truncate">{m.nombre}</span>
                  </div>
                  <span className="text-xs font-mono tabular-nums text-zinc-400 font-medium">
                    {m.count}
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="h-px bg-black/[0.06] mx-2" />

          {/* Sección Status (Indicadores en vivo + Nueva Meta) */}
          <div>
            <p className="px-2.5 mb-2 text-[11px] font-medium text-zinc-400 tracking-tight">
              Status
            </p>
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => setModuloActivo('blindaje')}
                className="w-full flex items-center justify-between saas-nav-item cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <CircleDot className="w-4 h-4 text-zinc-500" />
                  <span>Score DICOM</span>
                </div>
                <span className="text-xs font-mono tabular-nums text-zinc-500 font-medium">
                  {semaforoInfo.scoreDicom}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setModuloActivo('blindaje')}
                className="w-full flex items-center justify-between saas-nav-item cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <ShieldCheck className="w-4 h-4 text-zinc-500" />
                  <span>Carga Mensual</span>
                </div>
                <span
                  className={`text-xs font-mono tabular-nums font-semibold ${
                    semaforoInfo.cargaFinancieraPct > 45
                      ? 'text-rose-600'
                      : semaforoInfo.cargaFinancieraPct > 35
                      ? 'text-amber-600'
                      : 'text-zinc-500'
                  }`}
                >
                  {semaforoInfo.cargaFinancieraPct}%
                </span>
              </button>

              <button
                type="button"
                onClick={() => setModalBancoAbierto(true)}
                className="w-full flex items-center justify-between saas-nav-item cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-zinc-500" />
                  <span>Cuentas Sincr.</span>
                </div>
                <span className="text-xs font-mono tabular-nums text-zinc-500 font-medium">
                  4
                </span>
              </button>

              <button
                type="button"
                onClick={() => setModalNuevaMetaAbierto(true)}
                className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-[12.5px] font-medium text-zinc-400 hover:text-zinc-800 transition-colors rounded-lg cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Meta Patrimonial</span>
              </button>
            </div>
          </div>

          <div className="h-px bg-black/[0.06] mx-2" />

          {/* Sección Group (Crecimiento, Créditos, Inversiones) */}
          <div>
            <p className="px-2.5 mb-2 text-[11px] font-medium text-zinc-400 tracking-tight">
              Group
            </p>
            <nav className="space-y-1">
              {growthMods.map((m) => {
                const Icon = m.icono;
                const isSelected = moduloActivo === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setModuloActivo(m.id)}
                    className={`w-full flex items-center justify-between text-left cursor-pointer saas-nav-item ${
                      isSelected ? 'saas-nav-item-active' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Icon
                        className={`w-4 h-4 shrink-0 ${
                          isSelected ? 'text-zinc-900' : 'text-zinc-500'
                        }`}
                      />
                      <span className="truncate">{m.nombre}</span>
                    </div>
                    <span className="text-xs font-mono tabular-nums text-zinc-400 font-medium">
                      {m.count}
                    </span>
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => setSolicitarPackEmpresasModal(true)}
                className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-[12.5px] font-medium text-zinc-400 hover:text-zinc-800 transition-colors rounded-lg cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Crear Empresa 24h</span>
              </button>
            </nav>
          </div>
        </div>

        {/* Pie de Sub-Sidebar: Liquidez + Simulador de Estrés DICOM */}
        <div className="pt-3 mt-3 border-t border-black/[0.06] space-y-2.5">
          {/* Tarjeta Compacta de Liquidez */}
          <div className="p-3 rounded-xl bg-white border border-black/[0.07] shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
            <div className="flex items-center justify-between text-[11px] text-zinc-500 mb-0.5">
              <span>Saldo Líquido</span>
              <span className="font-mono text-[10px] text-emerald-700 font-semibold">
                Open Banking
              </span>
            </div>
            <div className="font-mono text-base font-bold text-zinc-950 tracking-tight tabular-nums">
              ${saldoLiquidoTotal.toLocaleString('es-CL')}{' '}
              <span className="text-[10px] font-normal text-zinc-400">CLP</span>
            </div>

            {/* Simulador de Escenario de Estrés */}
            <div className="mt-2.5 pt-2 border-t border-black/[0.06]">
              <div className="text-[10px] font-medium text-zinc-400 mb-1.5">
                Simulador Escenario DICOM
              </div>
              <div className="grid grid-cols-3 gap-1">
                <button
                  type="button"
                  onClick={() =>
                    setSemaforoOverride(semaforoOverride === 'verde' ? null : 'verde')
                  }
                  className={`px-1.5 py-1 rounded-lg text-[10px] font-semibold flex items-center justify-center gap-1 transition cursor-pointer ${
                    semaforoInfo.estado === 'verde'
                      ? 'bg-zinc-900 text-white shadow-xs'
                      : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200/70'
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span>OK</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setSemaforoOverride(
                      semaforoOverride === 'amarillo' ? null : 'amarillo'
                    )
                  }
                  className={`px-1.5 py-1 rounded-lg text-[10px] font-semibold flex items-center justify-center gap-1 transition cursor-pointer ${
                    semaforoInfo.estado === 'amarillo'
                      ? 'bg-zinc-900 text-white shadow-xs'
                      : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200/70'
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  <span>Alerta</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setSemaforoOverride(semaforoOverride === 'rojo' ? null : 'rojo')
                  }
                  className={`px-1.5 py-1 rounded-lg text-[10px] font-semibold flex items-center justify-center gap-1 transition cursor-pointer ${
                    semaforoInfo.estado === 'rojo'
                      ? 'bg-rose-600 text-white shadow-xs'
                      : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200/70'
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-300" />
                  <span>Mora</span>
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px] text-zinc-500 px-1">
            <Link href="/" className="hover:text-zinc-900 transition">
              ← Web Principal
            </Link>
            <Link
              href="/dashboard"
              className="text-zinc-700 hover:text-zinc-950 font-medium flex items-center gap-1"
            >
              <span>Panel Central</span>
              <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </aside>
    </div>
  );
}
