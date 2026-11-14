'use client';

import React, { useState } from 'react';
import { usePersonas } from '@/lib/personas/context';
import {
  ShieldCheck,
  AlertTriangle,
  AlertOctagon,
  Building2,
  CreditCard,
  Wallet,
  Clock,
  CheckCircle2,
  Plus,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  DollarSign,
  PieChart as PieIcon,
  BarChart3,
  Calendar,
  Zap,
  Info,
  Sliders,
} from 'lucide-react';

export default function Module2BlindajeAntiDicom() {
  const {
    cuentas,
    vencimientos,
    marcarPagoRealizado,
    saldoLiquidoTotal,
    cupoTarjetasTotal,
    cupoTarjetasUtilizado,
    lineaSobregiroTotal,
    lineaSobregiroUtilizada,
    semaforoInfo,
    semaforoOverride,
    setSemaforoOverride,
    cargaFinancieraActual,
    gastosMensuales,
    historicoFlujo,
    sincronizarCuentas,
    isSyncing,
    setModalBancoAbierto,
    ingresoLiquidoMensual,
  } = usePersonas();

  const [tabGrafico, setTabGrafico] = useState<'gastos' | 'flujo' | 'deuda'>('gastos');

  const cupoDisponibleTotal = Math.max(0, cupoTarjetasTotal - cupoTarjetasUtilizado);
  const pctCupoUtilizado = Math.round((cupoTarjetasUtilizado / cupoTarjetasTotal) * 100);

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Banner Principal del Módulo */}
      <div className="bg-gradient-to-r from-slate-50 via-blue-50/50 to-white p-6 sm:p-7 rounded-2xl border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-xs font-semibold mb-2">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Módulo 2: Open Banking & Blindaje Anti-DICOM</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-950 tracking-tight">
            Control de Liquidez & Prevención de Morosidad
          </h1>
          <p className="text-sm text-slate-700 mt-1 max-w-2xl">
            Sincronización bancaria automatizada para monitorear vencimientos, evitar cobros de intereses abusivos y proteger tu historial comercial en Chile.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setModalBancoAbierto(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm shadow-lg shadow-sm transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Conectar Banco</span>
          </button>
        </div>
      </div>

      {/* 2. Semáforo Financiero Preventivo (Estado en Vivo) */}
      <div
        className={`p-6 sm:p-7 rounded-2xl border transition-all ${
          semaforoInfo.estado === 'verde'
            ? 'bg-gradient-to-br from-emerald-50 via-white to-white border-emerald-200'
            : semaforoInfo.estado === 'amarillo'
            ? 'bg-gradient-to-br from-amber-50 via-white to-white border-amber-200'
            : 'bg-gradient-to-br from-rose-50 via-white to-white border-rose-300 shadow-xl shadow-sm'
        }`}
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div className="flex items-start gap-3.5">
            <div
              className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 text-slate-950 shadow-lg ${
                semaforoInfo.estado === 'verde'
                  ? 'bg-emerald-500 shadow-emerald-500/30'
                  : semaforoInfo.estado === 'amarillo'
                  ? 'bg-amber-500 shadow-amber-500/30'
                  : 'bg-rose-500 shadow-rose-500/30 animate-bounce'
              }`}
            >
              {semaforoInfo.estado === 'verde' ? (
                <ShieldCheck className="w-7 h-7" />
              ) : semaforoInfo.estado === 'amarillo' ? (
                <AlertTriangle className="w-7 h-7" />
              ) : (
                <AlertOctagon className="w-7 h-7" />
              )}
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl sm:text-2xl font-extrabold text-slate-950">{semaforoInfo.titulo}</h2>
                <span
                  className={`text-xs uppercase font-extrabold px-2.5 py-0.5 rounded-full ${
                    semaforoInfo.estado === 'verde'
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : semaforoInfo.estado === 'amarillo'
                      ? 'bg-amber-50 text-amber-700 border border-amber-200'
                      : 'bg-rose-50 text-rose-700 border border-rose-200'
                  }`}
                >
                  {semaforoInfo.riesgoTexto}
                </span>
              </div>
              <p className="text-sm text-slate-700 mt-1 max-w-2xl">{semaforoInfo.descripcion}</p>
            </div>
          </div>

          {/* Test Switcher de Estados */}
          <div className="flex flex-col items-start md:items-end gap-1.5 self-start md:self-auto">
            <span className="text-[11px] text-slate-600 font-semibold flex items-center gap-1">
              <Sliders className="w-3 h-3 text-slate-600" />
              Probar Escenario de Riesgo:
            </span>
            <div className="inline-flex rounded-xl bg-slate-50 p-1 border border-slate-200">
              <button
                onClick={() => setSemaforoOverride('verde')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                  semaforoInfo.estado === 'verde'
                    ? 'bg-emerald-500 text-slate-950'
                    : 'text-slate-600 hover:text-slate-950'
                }`}
              >
                Saludable
              </button>
              <button
                onClick={() => setSemaforoOverride('amarillo')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                  semaforoInfo.estado === 'amarillo'
                    ? 'bg-amber-400 text-slate-950'
                    : 'text-slate-600 hover:text-slate-950'
                }`}
              >
                Precaución
              </button>
              <button
                onClick={() => setSemaforoOverride('rojo')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                  semaforoInfo.estado === 'rojo'
                    ? 'bg-rose-500 text-white'
                    : 'text-slate-600 hover:text-slate-950'
                }`}
              >
                Alerta DICOM
              </button>
            </div>
          </div>
        </div>

        {/* Métricas clave del Semáforo */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-5">
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-[11px] text-slate-600 uppercase tracking-wider block">Carga Financiera</span>
            <span
              className={`font-mono text-xl font-extrabold ${
                semaforoInfo.cargaFinancieraPct > 45
                  ? 'text-rose-700'
                  : semaforoInfo.cargaFinancieraPct > 35
                  ? 'text-amber-700'
                  : 'text-emerald-700'
              }`}
            >
              {semaforoInfo.cargaFinancieraPct}%
            </span>
            <span className="text-[10px] text-slate-500 block mt-0.5">Límite bancario: 35%</span>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-[11px] text-slate-600 uppercase tracking-wider block">Score DICOM Estimado</span>
            <span className="font-mono text-xl font-extrabold text-slate-950">{semaforoInfo.scoreDicom}</span>
            <span className="text-[10px] text-slate-500 block mt-0.5">Escala CMF (0 - 999)</span>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-[11px] text-slate-600 uppercase tracking-wider block">Uso Línea Sobregiro</span>
            <span className="font-mono text-xl font-extrabold text-emerald-700">
              {lineaSobregiroTotal > 0
                ? `${Math.round((lineaSobregiroUtilizada / lineaSobregiroTotal) * 100)}%`
                : '0%'}
            </span>
            <span className="text-[10px] text-slate-500 block mt-0.5">$0 utilizado de $800k</span>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-[11px] text-slate-600 uppercase tracking-wider block">Cobertura Próx. 15 Días</span>
            <span className="font-mono text-xl font-extrabold text-emerald-700">2.6x</span>
            <span className="text-[10px] text-slate-500 block mt-0.5">Saldo supera compromisos</span>
          </div>
        </div>

        {/* Recomendación Accionable en Caso de Alerta */}
        {semaforoInfo.estado === 'rojo' && (
          <div className="mt-5 p-4 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-3">
            <AlertOctagon className="w-5 h-5 text-rose-700 shrink-0 mt-0.5" />
            <div className="text-xs text-rose-700">
              <strong className="block font-bold text-slate-950 text-sm">Protocolo de Contingencia DICOM Activado:</strong>
              Tienes cuotas críticas por vencer en menos de 72 horas. Te recomendamos:
              1) Realizar el <strong>Pago Mínimo</strong> de emergencia en tu tarjeta Santander ($25.000) para evitar reporte comercial.
              2) Postergar compras no esenciales y solicitar reprogramación preventiva antes del día hábil siguiente.
            </div>
          </div>
        )}
      </div>

      {/* 1. Conector Bancario (Open Banking Mockup) */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-7 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-bold text-slate-950 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-emerald-700" />
              Cuentas Bancarias Conectadas (Open Finance Chile)
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Lectura directa y segura mediante agregación financiera cifrada AES-256.
            </p>
          </div>

          <button
            onClick={sincronizarCuentas}
            disabled={isSyncing}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-900 border border-slate-300 self-start sm:self-auto cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-emerald-700 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'Actualizando saldos...' : 'Sincronizar ahora'}</span>
          </button>
        </div>

        {/* Tarjetas de Cuentas */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {cuentas.map((c) => (
            <div
              key={c.id}
              className="p-4 rounded-xl bg-slate-50 border border-slate-200 hover:border-slate-300 transition flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xl">{c.logo}</span>
                  <span className="text-[10px] font-mono text-emerald-700 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    En línea
                  </span>
                </div>

                <h3 className="font-bold text-slate-950 text-sm mt-2">{c.banco}</h3>
                <p className="text-xs text-slate-600 truncate">{c.tipoCuenta}</p>
                <p className="text-[11px] font-mono text-slate-500 mt-0.5">{c.numeroEnmascarado}</p>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-200">
                {c.saldoDisponible > 0 ? (
                  <div>
                    <span className="text-[10px] uppercase text-slate-500 block">Saldo Disponible</span>
                    <span className="font-mono text-base font-extrabold text-emerald-700">
                      ${c.saldoDisponible.toLocaleString('es-CL')}
                    </span>
                  </div>
                ) : c.cupoTotal ? (
                  <div>
                    <div className="flex justify-between text-[10px] text-slate-600 mb-1">
                      <span>Cupo Utilizado</span>
                      <span className="font-mono">${c.cupoUtilizado?.toLocaleString('es-CL')}</span>
                    </div>
                    <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                      <div
                        className="bg-amber-400 h-full rounded-full"
                        style={{
                          width: `${Math.min(
                            100,
                            Math.round(((c.cupoUtilizado || 0) / (c.cupoTotal || 1)) * 100)
                          )}%`,
                        }}
                      />
                    </div>
                    <span className="text-[10px] text-slate-600 mt-1 block">
                      Total: ${c.cupoTotal.toLocaleString('es-CL')}
                    </span>
                  </div>
                ) : (
                  <div>
                    <span className="text-[10px] uppercase text-slate-500 block">Línea de Sobregiro</span>
                    <span className="font-mono text-xs font-bold text-slate-700">
                      $0 utilizado / ${c.lineaSobregiroTotal?.toLocaleString('es-CL')}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Resumen Consolidado */}
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-3">
            <Wallet className="w-5 h-5 text-emerald-700" />
            <div>
              <span className="text-slate-600 block">Saldo Líquido Total Inmediato:</span>
              <strong className="text-slate-950 font-mono text-base">${saldoLiquidoTotal.toLocaleString('es-CL')} CLP</strong>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <CreditCard className="w-5 h-5 text-amber-700" />
            <div>
              <span className="text-slate-600 block">Cupo Tarjetas Disponible:</span>
              <strong className="text-slate-950 font-mono text-base">${cupoDisponibleTotal.toLocaleString('es-CL')} CLP</strong>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-blue-700" />
            <div>
              <span className="text-slate-600 block">Línea de Emergencia (Sobregiro):</span>
              <strong className="text-slate-950 font-mono text-base">${lineaSobregiroTotal.toLocaleString('es-CL')} (100% libre)</strong>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Calendario y Avisos de Vencimiento de Pagos */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-7 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-bold text-slate-950 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-amber-700" />
              Calendario de Vencimientos & Alertas Preventivas
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Notificaciones graduadas: T-5 (Informativo), T-3 (Alerta de saldo), T-1 (Pago mínimo de rescate).
            </p>
          </div>
          <span className="text-xs font-mono text-slate-600">
            {vencimientos.filter((v) => !v.pagado).length} Cuentas pendientes este mes
          </span>
        </div>

        <div className="space-y-3">
          {vencimientos.map((item) => {
            const esUrgente = !item.pagado && item.diasRestantes <= 3;
            const esMedio = !item.pagado && item.diasRestantes <= 5;

            return (
              <div
                key={item.id}
                className={`p-4 rounded-xl border transition flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                  item.pagado
                    ? 'bg-slate-50 border-slate-200 opacity-60'
                    : esUrgente
                    ? 'bg-rose-50 border-rose-200'
                    : esMedio
                    ? 'bg-amber-50 border-amber-200'
                    : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div className="flex items-start gap-3.5">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                      item.pagado
                        ? 'bg-emerald-50 text-emerald-700'
                        : esUrgente
                        ? 'bg-rose-50 text-rose-700'
                        : esMedio
                        ? 'bg-amber-50 text-amber-700'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {item.pagado ? (
                      <CheckCircle2 className="w-5 h-5" />
                    ) : (
                      <Clock className="w-5 h-5" />
                    )}
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-slate-950 text-sm">{item.entidad}</h3>
                      {item.pagado ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                          Pagado al día
                        </span>
                      ) : esUrgente ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 animate-pulse">
                          Alerta T-3: Vence en {item.diasRestantes} días
                        </span>
                      ) : esMedio ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                          Aviso T-5: Vence en {item.diasRestantes} días
                        </span>
                      ) : (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                          Vence en {item.diasRestantes} días
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5">{item.descripcion}</p>
                    <p className="text-[11px] font-mono text-slate-500 mt-1">
                      Fecha de vencimiento: <strong>{item.fechaVencimiento}</strong>
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between md:justify-end gap-5 pt-3 md:pt-0 border-t md:border-t-0 border-slate-200">
                  <div className="text-left md:text-right">
                    <span className="text-[10px] uppercase text-slate-500 block">Total a Pagar</span>
                    <span className="font-mono text-base font-extrabold text-slate-950">
                      ${item.montoTotal.toLocaleString('es-CL')} CLP
                    </span>
                    {item.pagoMinimo && !item.pagado && (
                      <span className="text-[11px] font-mono text-amber-700 block">
                        Pago Mínimo: ${item.pagoMinimo.toLocaleString('es-CL')}
                      </span>
                    )}
                  </div>

                  {!item.pagado ? (
                    <button
                      onClick={() => marcarPagoRealizado(item.id)}
                      className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-md shadow-sm transition cursor-pointer"
                    >
                      Pagar / Marcar Listo
                    </button>
                  ) : (
                    <span className="text-xs text-slate-500 font-semibold italic">Comprobante guardado</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. Gráficos Analíticos Completos (Distribución, Flujo y Deuda Neta) */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-7 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-bold text-slate-950 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-emerald-700" />
              Analítica Financiera Completa
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Distribución de gastos, comparación ingresos vs. egresos y evolución de pasivos.
            </p>
          </div>

          {/* Selector de Pestañas de Gráfico */}
          <div className="flex items-center rounded-xl bg-slate-50 p-1 border border-slate-200 text-xs">
            <button
              onClick={() => setTabGrafico('gastos')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                tabGrafico === 'gastos'
                  ? 'bg-slate-100 text-emerald-700 font-bold'
                  : 'text-slate-600 hover:text-slate-950'
              }`}
            >
              Distribución de Gastos
            </button>
            <button
              onClick={() => setTabGrafico('flujo')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                tabGrafico === 'flujo'
                  ? 'bg-slate-100 text-emerald-700 font-bold'
                  : 'text-slate-600 hover:text-slate-950'
              }`}
            >
              Ingresos vs. Gastos
            </button>
            <button
              onClick={() => setTabGrafico('deuda')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                tabGrafico === 'deuda'
                  ? 'bg-slate-100 text-emerald-700 font-bold'
                  : 'text-slate-600 hover:text-slate-950'
              }`}
            >
              Evolución Deuda Neta
            </button>
          </div>
        </div>

        {/* Tab 1: Distribución de Gastos (Dona + Barras) */}
        {tabGrafico === 'gastos' && (
          <div className="grid md:grid-cols-2 gap-6 items-center">
            {/* Donut SVG estético interactivo */}
            <div className="flex flex-col items-center justify-center p-4 bg-slate-50 rounded-xl border border-slate-200">
              <div className="relative w-48 h-48">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="38" stroke="#E2E8F0" strokeWidth="14" fill="transparent" />
                  {/* Segmentos de la Dona */}
                  <circle
                    cx="50"
                    cy="50"
                    r="38"
                    stroke="#3B82F6"
                    strokeWidth="14"
                    strokeDasharray="238.7"
                    strokeDashoffset="0"
                    fill="transparent"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="38"
                    stroke="#10B981"
                    strokeWidth="14"
                    strokeDasharray="238.7"
                    strokeDashoffset="83.5"
                    fill="transparent"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="38"
                    stroke="#F59E0B"
                    strokeWidth="14"
                    strokeDasharray="238.7"
                    strokeDashoffset="140.8"
                    fill="transparent"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="38"
                    stroke="#8B5CF6"
                    strokeWidth="14"
                    strokeDasharray="238.7"
                    strokeDashoffset="183.8"
                    fill="transparent"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="38"
                    stroke="#EC4899"
                    strokeWidth="14"
                    strokeDasharray="238.7"
                    strokeDashoffset="212.4"
                    fill="transparent"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-[10px] uppercase text-slate-600">Total Gastos</span>
                  <span className="font-mono text-base font-bold text-slate-950">$1.285.000</span>
                  <span className="text-[10px] text-emerald-700 font-semibold">Octubre</span>
                </div>
              </div>
            </div>

            {/* Desglose de Categorías */}
            <div className="space-y-3">
              {gastosMensuales.map((g) => (
                <div key={g.categoria} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-700 font-medium flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: g.color }} />
                      {g.categoria}
                    </span>
                    <span className="font-mono text-slate-950 font-semibold">
                      ${g.monto.toLocaleString('es-CL')} ({g.porcentaje}%)
                    </span>
                  </div>
                  <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${g.porcentaje}%`, backgroundColor: g.color }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 2: Ingresos vs Gastos */}
        {tabGrafico === 'flujo' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-emerald-500" /> Ingresos Reales
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-blue-500" /> Gastos del Mes
                </span>
              </div>
              <span>Últimos 6 meses (CLP)</span>
            </div>

            <div className="grid grid-cols-6 gap-2 sm:gap-4 h-52 items-end pt-4 pb-2 border-b border-slate-200">
              {historicoFlujo.map((f) => {
                const maxVal = 2200000;
                const hIngresos = Math.round((f.ingresos / maxVal) * 100);
                const hGastos = Math.round((f.gastos / maxVal) * 100);

                return (
                  <div key={f.mes} className="flex flex-col items-center h-full justify-end group">
                    <div className="flex items-end gap-1.5 w-full justify-center h-44">
                      {/* Barra Ingresos */}
                      <div
                        className="w-1/2 max-w-[20px] bg-emerald-500/80 hover:bg-emerald-400 rounded-t-md transition-all relative group-hover:scale-105"
                        style={{ height: `${hIngresos}%` }}
                        title={`Ingresos ${f.mes}: $${f.ingresos.toLocaleString('es-CL')}`}
                      />
                      {/* Barra Gastos */}
                      <div
                        className="w-1/2 max-w-[20px] bg-blue-500/80 hover:bg-blue-400 rounded-t-md transition-all relative group-hover:scale-105"
                        style={{ height: `${hGastos}%` }}
                        title={`Gastos ${f.mes}: $${f.gastos.toLocaleString('es-CL')}`}
                      />
                    </div>
                    <span className="text-[10px] sm:text-xs text-slate-600 font-semibold mt-2">{f.mes}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tab 3: Evolución Deuda Neta */}
        {tabGrafico === 'deuda' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>Trayectoria de Deuda Total Consolidada</span>
              <span className="text-emerald-700 font-semibold font-mono">-$500.000 en 6 meses (-30.3%)</span>
            </div>

            <div className="grid grid-cols-6 gap-2 sm:gap-4 h-48 items-end pt-4 pb-2 border-b border-slate-200">
              {historicoFlujo.map((f) => {
                const maxDeuda = 1800000;
                const hDeuda = Math.round((f.deudaNeta / maxDeuda) * 100);

                return (
                  <div key={f.mes} className="flex flex-col items-center h-full justify-end group">
                    <div className="w-full flex justify-center h-40 items-end">
                      <div
                        className="w-8 bg-gradient-to-t from-amber-600 to-amber-400 rounded-t-md transition-all group-hover:brightness-110 flex items-start justify-center pt-1"
                        style={{ height: `${hDeuda}%` }}
                      >
                        <span className="text-[9px] font-mono font-bold text-slate-950 opacity-0 group-hover:opacity-100 transition">
                          ${(f.deudaNeta / 1000).toFixed(0)}k
                        </span>
                      </div>
                    </div>
                    <span className="text-[10px] sm:text-xs text-slate-600 font-semibold mt-2">{f.mes}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-slate-600">
              Tu disciplina de amortización ha reducido tus pasivos en <strong>$500.000 CLP</strong>. Esto aumenta directamente tu score comercial y te acerca a la aprobación del crédito hipotecario.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
