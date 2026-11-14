'use client';

import React from 'react';
import Link from 'next/link';
import { usePersonas } from '@/lib/personas/context';
import {
  ShieldCheck,
  AlertTriangle,
  AlertCircle,
  RefreshCw,
  Sparkles,
  ExternalLink,
} from 'lucide-react';

export default function Header() {
  const {
    nombreUsuario,
    rutUsuario,
    ufValor,
    semaforoInfo,
    sincronizarCuentas,
    isSyncing,
    setModuloActivo,
    setSolicitarPackEmpresasModal,
  } = usePersonas();

  return (
    <header className="sticky top-0 z-30 border-b border-black/[0.06] bg-white/95 backdrop-blur-md px-4 sm:px-7 py-3 text-zinc-950">
      <div className="flex items-center justify-between gap-4">
        {/* Marca & Breadcrumb */}
        <div className="flex items-center gap-3">
          <Link href="/personas" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-lg bg-[#141416] text-white flex items-center justify-center font-bold text-sm shadow-xs group-hover:scale-105 transition-transform">
              F
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm tracking-tight text-zinc-950">
                FINANZIA
              </span>
              <span className="text-zinc-300">/</span>
              <span className="text-xs font-medium text-zinc-600">
                Portal Personas
              </span>
            </div>
          </Link>
        </div>

        {/* Indicadores en Vivo Mercado Chileno */}
        <div className="hidden lg:flex items-center gap-2.5 text-xs">
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-[#F7F8FA] border border-black/[0.06] text-zinc-700">
            <span className="text-zinc-400 font-medium">UF:</span>
            <span className="font-mono font-semibold text-zinc-900 tabular-nums">
              ${ufValor.toLocaleString('es-CL')}
            </span>
          </div>

          <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-[#F7F8FA] border border-black/[0.06] text-zinc-700">
            <span className="text-zinc-400 font-medium">Score:</span>
            <span className="font-mono font-semibold text-zinc-900 tabular-nums">
              {semaforoInfo.scoreDicom} pts
            </span>
          </div>

          {/* Estado de Blindaje Anti-DICOM */}
          <button
            onClick={() => setModuloActivo('blindaje')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition cursor-pointer ${
              semaforoInfo.estado === 'verde'
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 hover:bg-emerald-500/15'
                : semaforoInfo.estado === 'amarillo'
                ? 'bg-amber-500/10 border-amber-500/20 text-amber-700 hover:bg-amber-500/15'
                : 'bg-rose-500/10 border-rose-500/25 text-rose-700 hover:bg-rose-500/15 animate-pulse'
            }`}
          >
            {semaforoInfo.estado === 'verde' ? (
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            ) : semaforoInfo.estado === 'amarillo' ? (
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
            )}
            <span>
              {semaforoInfo.estado === 'verde'
                ? 'Blindaje Activo'
                : semaforoInfo.estado === 'amarillo'
                ? 'Precaución'
                : 'Riesgo DICOM'}
            </span>
          </button>
        </div>

        {/* Acciones Rápidas & Usuario */}
        <div className="flex items-center gap-2">
          <button
            onClick={sincronizarCuentas}
            disabled={isSyncing}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white hover:bg-zinc-50 border border-black/[0.09] shadow-[0_1px_2px_rgba(0,0,0,0.02)] text-xs font-medium text-zinc-800 transition cursor-pointer"
            title="Sincronizar cuentas Open Banking"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 text-emerald-600 ${
                isSyncing ? 'animate-spin' : ''
              }`}
            />
            <span className="hidden sm:inline">
              {isSyncing ? 'Sincronizando...' : 'Open Banking'}
            </span>
          </button>

          <button
            onClick={() => setSolicitarPackEmpresasModal(true)}
            className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#141416] hover:bg-zinc-800 text-white font-semibold text-xs shadow-xs transition cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Pack Empresas</span>
          </button>

          <a
            href="/erp"
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[#F7F8FA] hover:bg-zinc-200/70 border border-black/[0.07] text-zinc-800 font-medium text-xs transition"
            title="Ir al Sistema ERP Empresas"
          >
            <span>ERP</span>
            <ExternalLink className="w-3 h-3 text-zinc-400" />
          </a>

          {/* Usuario Info Chip */}
          <div className="flex items-center gap-2 pl-2 ml-1 border-l border-black/[0.07]">
            <div className="w-7 h-7 rounded-full bg-zinc-900 flex items-center justify-center text-[11px] font-bold text-white">
              IV
            </div>
            <div className="hidden xl:block text-left">
              <p className="text-xs font-semibold text-zinc-900 leading-tight">
                {nombreUsuario}
              </p>
              <p className="text-[10px] text-zinc-500 font-mono leading-tight">
                {rutUsuario}
              </p>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
