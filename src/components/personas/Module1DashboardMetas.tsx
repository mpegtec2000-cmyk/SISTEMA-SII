'use client';

import React, { useState } from 'react';
import { usePersonas } from '@/lib/personas/context';
import {
  Home,
  Car,
  Briefcase,
  Target,
  Plus,
  Sparkles,
  ArrowRight,
  Calendar,
  Clock,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  DollarSign,
  ChevronRight,
  ShieldCheck,
  Zap,
} from 'lucide-react';

export default function Module1DashboardMetas() {
  const {
    metas,
    metaSeleccionada,
    setMetaSeleccionadaId,
    agregarAporteMeta,
    setModalNuevaMetaAbierto,
    setModuloActivo,
    saldoLiquidoTotal,
    mostrarToast,
  } = usePersonas();

  const [montoAporteCustom, setMontoAporteCustom] = useState<number>(200000);
  const [mostrarSimuladorAporte, setMostrarSimuladorAporte] = useState(false);

  // Cálculos de la meta activa
  const porcentaje = Math.min(100, Math.round((metaSeleccionada.montoAhorrado / metaSeleccionada.montoObjetivo) * 100));
  const montoFaltante = Math.max(0, metaSeleccionada.montoObjetivo - metaSeleccionada.montoAhorrado);
  const mesesRestantesEstimados = Math.max(
    1,
    Math.ceil(montoFaltante / (metaSeleccionada.aporteMensualSugerido || 300000))
  );

  const getIcon = (cat: string) => {
    switch (cat) {
      case 'casa':
        return Home;
      case 'auto':
        return Car;
      case 'emprender':
        return Briefcase;
      default:
        return Target;
    }
  };

  const handleAporteRapido = (monto: number) => {
    agregarAporteMeta(metaSeleccionada.id, monto);
  };

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Header del Módulo con Bienvenida Motivacional */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-slate-50 via-emerald-50/50 to-white p-6 rounded-2xl border border-slate-200">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold mb-2">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Módulo 1: Proyección de Vida Patrimonial</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-950 tracking-tight">
            Tus Metas y Ruta de Logro
          </h1>
          <p className="text-sm text-slate-700 mt-1 max-w-2xl">
            Monitorea el avance real hacia tus sueños patrimoniales con tus ahorros bancarios sincronizados. Sin burocracia, con metas tangibles en Chile.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setModalNuevaMetaAbierto(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm shadow-lg shadow-sm transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Nueva Meta</span>
          </button>
        </div>
      </div>

      {/* 1. Selector Visual de Meta Patrimonial */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-950">Selecciona tu Meta Activa</h2>
            <p className="text-xs text-slate-600">Haz clic en una tarjeta para enfocar el análisis y simular aportes</p>
          </div>
          <span className="text-xs font-mono text-emerald-700 font-semibold">
            {metas.length} Metas configuradas
          </span>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {metas.map((meta) => {
            const Icon = getIcon(meta.categoria);
            const isSelected = meta.id === metaSeleccionada.id;
            const pct = Math.min(100, Math.round((meta.montoAhorrado / meta.montoObjetivo) * 100));

            return (
              <div
                key={meta.id}
                onClick={() => setMetaSeleccionadaId(meta.id)}
                className={`group relative rounded-2xl overflow-hidden border transition-all cursor-pointer flex flex-col justify-between ${
                  isSelected
                    ? 'bg-white border-emerald-500 ring-2 ring-emerald-500/40 shadow-xl shadow-sm'
                    : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-200'
                }`}
              >
                {/* Imagen de fondo / portada estilizada */}
                <div className="relative h-36 w-full overflow-hidden">
                  <img
                    src={meta.imagenUrl}
                    alt={meta.titulo}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/75 via-slate-950/35 to-transparent" />

                  {/* Badge de Categoría & Selección */}
                  <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-50 backdrop-blur-md text-[11px] font-semibold text-slate-900 border border-slate-200">
                    <Icon className="w-3.5 h-3.5 text-emerald-700" />
                    <span className="capitalize">{meta.categoria}</span>
                  </div>

                  {isSelected && (
                    <div className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-emerald-500 text-slate-950 font-extrabold text-[10px] tracking-wide uppercase shadow">
                      En Enfoque
                    </div>
                  )}

                  {/* Progreso Flotante sobre imagen */}
                  <div className="absolute bottom-2 left-3 right-3 flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-950">{pct}% completado</span>
                    <span className="text-slate-700 font-mono text-[11px]">
                      Plazo: {meta.plazoMeses} meses
                    </span>
                  </div>
                </div>

                {/* Contenido Card */}
                <div className="p-4 flex-1 flex flex-col justify-between">
                  <div>
                    <h3 className="font-bold text-slate-950 text-base leading-snug group-hover:text-emerald-700 transition-colors">
                      {meta.titulo}
                    </h3>
                    <p className="text-xs text-slate-600 mt-1 line-clamp-2">{meta.descripcion}</p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-200">
                    <div className="flex items-baseline justify-between">
                      <div>
                        <span className="text-[10px] uppercase tracking-wider text-slate-500 block">Ahorrado</span>
                        <span className="font-mono text-sm font-bold text-emerald-700">
                          ${meta.montoAhorrado.toLocaleString('es-CL')}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] uppercase tracking-wider text-slate-500 block">Objetivo</span>
                        <span className="font-mono text-sm font-bold text-slate-700">
                          ${meta.montoObjetivo.toLocaleString('es-CL')}
                        </span>
                      </div>
                    </div>

                    {/* Barra mini */}
                    <div className="w-full bg-slate-200 h-2 rounded-full mt-2.5 overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. Línea de Tiempo y Barra de Progreso Dinámica de la Meta Seleccionada */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-200">
          <div>
            <span className="text-xs uppercase tracking-wider text-emerald-700 font-bold">Línea de Tiempo Dinámica</span>
            <h2 className="text-xl sm:text-2xl font-black text-slate-950 mt-0.5">{metaSeleccionada.titulo}</h2>
            <p className="text-sm text-slate-700 mt-1">
              Calculada en base a tu ritmo de ahorro real y aportes extraordinarios.
            </p>
          </div>

          <div className="flex items-center gap-3 self-start md:self-auto">
            <div className="text-right">
              <span className="text-xs text-slate-600 block">Faltante para la meta:</span>
              <span className="font-mono text-lg font-extrabold text-amber-700">
                ${montoFaltante.toLocaleString('es-CL')} CLP
              </span>
            </div>
          </div>
        </div>

        {/* Gran Barra de Progreso con porcentaje grande */}
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-slate-950">{porcentaje}%</span>
              <span className="text-sm text-slate-600 font-medium">alcanzado</span>
            </div>
            <div className="text-sm font-mono text-slate-700">
              <span className="font-bold text-emerald-700">${metaSeleccionada.montoAhorrado.toLocaleString('es-CL')}</span>
              {' / '}
              <span>${metaSeleccionada.montoObjetivo.toLocaleString('es-CL')} CLP</span>
            </div>
          </div>

          <div className="w-full bg-slate-200 h-5 rounded-full p-1 border border-slate-200 relative overflow-hidden">
            <div
              className="bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-300 h-full rounded-full transition-all duration-700 shadow-lg shadow-emerald-500/30 flex items-center justify-end pr-2"
              style={{ width: `${Math.max(5, porcentaje)}%` }}
            >
              <span className="w-2 h-2 rounded-full bg-white animate-ping" />
            </div>
          </div>
        </div>

        {/* Visual Milestone Timeline (Inicio -> Hoy -> Meta) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0 text-slate-600">
              <Calendar className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[11px] uppercase tracking-wider text-slate-500 font-bold block">1. Inicio de la Meta</span>
              <p className="text-sm font-semibold text-slate-950 mt-0.5">{metaSeleccionada.fechaInicio}</p>
              <p className="text-xs text-slate-600 mt-0.5">Planificación inicial fijada</p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-start gap-3 relative overflow-hidden">
            <div className="w-8 h-8 rounded-lg bg-emerald-500 text-slate-950 flex items-center justify-center shrink-0 font-bold">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[11px] uppercase tracking-wider text-emerald-700 font-bold block">2. Situación Actual (Hoy)</span>
              <p className="text-sm font-semibold text-slate-950 mt-0.5">
                ${metaSeleccionada.montoAhorrado.toLocaleString('es-CL')} acumulados
              </p>
              <p className="text-xs text-emerald-700 mt-0.5">Avance a buen ritmo sin morosidades</p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center shrink-0">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[11px] uppercase tracking-wider text-indigo-700 font-bold block">3. Fecha Estimada de Logro</span>
              <p className="text-sm font-semibold text-slate-950 mt-0.5">{metaSeleccionada.fechaEstimada}</p>
              <p className="text-xs text-slate-600 mt-0.5">Aprox. {mesesRestantesEstimados} meses restantes</p>
            </div>
          </div>
        </div>

        {/* Simulador Interactivo de Aporte Extraordinario */}
        <div className="pt-4 border-t border-slate-200">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-700" />
              <h3 className="text-sm font-bold text-slate-950">Simulador de Aporte Extra / Acelerador de Meta</h3>
            </div>
            <span className="text-xs text-slate-600">
              Disponible en tus cuentas: <strong className="text-emerald-700 font-mono">${saldoLiquidoTotal.toLocaleString('es-CL')}</strong>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {[100000, 250000, 500000, 1000000].map((monto) => (
              <button
                key={monto}
                onClick={() => handleAporteRapido(monto)}
                className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-300 text-xs font-semibold text-slate-900 transition flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-emerald-700" />
                <span>+${(monto / 1000).toLocaleString('es-CL')}k</span>
              </button>
            ))}

            <div className="flex items-center gap-2 ml-auto">
              <input
                type="number"
                value={montoAporteCustom}
                onChange={(e) => setMontoAporteCustom(Number(e.target.value))}
                step={50000}
                className="w-32 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-950 font-mono"
                placeholder="Otro monto"
              />
              <button
                onClick={() => handleAporteRapido(montoAporteCustom)}
                className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition cursor-pointer"
              >
                Abonar a Meta
              </button>
            </div>
          </div>
          <p className="text-[11px] text-slate-600 mt-2">
            Cada $350.000 de aporte extraordinario reduce en promedio <strong>1 mes</strong> tu plazo de llegada a la meta.
          </p>
        </div>
      </div>

      {/* 3. Smart Coach Mensual (Recomendaciones Amigables Basadas en Lectura Bancaria) */}
      <div className="bg-gradient-to-br from-indigo-50 via-white to-white border border-indigo-200 rounded-2xl p-6 sm:p-7 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-700">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-slate-950 text-base">Smart Coach Mensual Finazia</h3>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                  Lectura Bancaria Octubre
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-0.5">
                Análisis automático de tus hábitos de gasto cruzados con tus cuentas de Banco Estado, Chile y Santander.
              </p>
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4 pt-2">
          {/* Consejo Positivo / Felicitación */}
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex flex-col justify-between">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 mt-0.5">
                <TrendingUp className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-emerald-700">Vas excelente este mes (+8% eficiencia)</p>
                <p className="text-xs text-slate-700 mt-1 leading-relaxed">
                  Tus gastos discrecionales en delivery y salidas bajaron un <strong>8%</strong> frente a Septiembre. Si mantienes este ritmo, alcanzarás tu meta <strong>1 mes antes de lo proyectado</strong>.
                </p>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-emerald-200 flex items-center justify-between">
              <span className="text-[11px] text-emerald-700 font-medium">Ahorro potencial: $140.000/mes</span>
              <button
                onClick={() => handleAporteRapido(140000)}
                className="text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-1 rounded-lg transition"
              >
                Inyectar ahorro a meta
              </button>
            </div>
          </div>

          {/* Alerta Preventiva de Contención */}
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex flex-col justify-between">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center shrink-0 mt-0.5">
                <AlertCircle className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-amber-700">Cuidado: compras imprevistas con Tarjeta</p>
                <p className="text-xs text-slate-700 mt-1 leading-relaxed">
                  Detectamos cargos en Tarjeta de Crédito por <strong>$120.000</strong> en tiendas de retail. Te recomendamos contener compras este fin de semana para no desviar la cuota de tu meta de la casa.
                </p>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-amber-200 flex items-center justify-between">
              <span className="text-[11px] text-amber-700 font-medium">Vence en 3 días (Santander)</span>
              <button
                onClick={() => setModuloActivo('blindaje')}
                className="text-xs font-bold text-amber-700 hover:text-slate-950 flex items-center gap-1 transition"
              >
                <span>Ver cuentas por pagar</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Atajo a Simulación de Créditos */}
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-600">¿Quieres saber si ya calificas al crédito hipotecario o automotriz?</span>
          </div>
          <button
            onClick={() => setModuloActivo('creditos')}
            className="flex items-center gap-1.5 text-emerald-700 hover:text-emerald-700 font-bold transition cursor-pointer"
          >
            <span>Ir al Simulador con Diagnóstico</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
