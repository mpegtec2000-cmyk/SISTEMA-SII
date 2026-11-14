'use client';

import React, { useState } from 'react';
import { usePersonas } from '@/lib/personas/context';
import {
  TrendingUp,
  Building,
  ShieldCheck,
  Clock,
  DollarSign,
  Percent,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  ArrowUpRight,
  Filter,
  FileText,
  Wallet,
} from 'lucide-react';
import { OportunidadInversion } from '@/lib/personas/types';

export default function Module5InversionesFinazia() {
  const {
    oportunidades,
    misInversiones,
    saldoLiquidoTotal,
    setOportunidadParaInvertir,
  } = usePersonas();

  const [montoCalculadora, setMontoCalculadora] = useState<number>(500000);
  const [ocSeleccionadaCalc, setOcSeleccionadaCalc] = useState<OportunidadInversion>(oportunidades[0]);

  // Cálculos rápidos de la calculadora
  const tasaMensual = ocSeleccionadaCalc.tasaMensual;
  const mesesPlazo = ocSeleccionadaCalc.plazoDias / 30;
  const gananciaNetaEstimada = Math.round(montoCalculadora * (tasaMensual / 100) * mesesPlazo);
  const totalARescate = montoCalculadora + gananciaNetaEstimada;

  // Métricas del Portafolio del Usuario
  const totalInvertido = misInversiones.reduce((acc, i) => acc + i.montoInvertido, 0);
  const retornosTotales = misInversiones.reduce((acc, i) => acc + (i.retornoEsperado - i.montoInvertido), 0);
  const inversionesActivas = misInversiones.filter((i) => i.estado !== 'liquidado').length;

  const getBadgeEstado = (estado: string) => {
    switch (estado) {
      case 'en_ejecucion':
        return { label: 'En ejecución', color: 'bg-blue-50 text-blue-700 border-blue-200' };
      case 'factura_cedida':
        return { label: 'Factura cedida', color: 'bg-purple-50 text-purple-700 border-purple-200' };
      case 'por_pagar':
        return { label: 'Por liquidar', color: 'bg-amber-50 text-amber-700 border-amber-200' };
      case 'liquidado':
        return { label: 'Liquidado con éxito', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
      default:
        return { label: estado, color: 'bg-slate-100 text-slate-600 border-slate-300' };
    }
  };

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Banner Principal */}
      <div className="bg-gradient-to-r from-slate-50 via-emerald-50/60 to-white p-6 sm:p-8 rounded-2xl border border-emerald-200 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-xl">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold mb-2">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Módulo 5: Crowdfactoring & Finanzas Colaborativas</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-950 tracking-tight">
            Finazia Inversiones
          </h1>
          <p className="text-sm text-slate-700 mt-1 max-w-2xl leading-relaxed">
            Rentabiliza tus ahorros financiando órdenes de compra verificadas de clientes PYME del ecosistema Finazia. Respaldadas con mandantes de primer nivel y cesión legal de factura.
          </p>
        </div>

        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-center gap-4 shrink-0">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
            <Wallet className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] uppercase text-slate-600 font-bold block">Tu Saldo para Invertir</span>
            <span className="font-mono text-xl font-black text-emerald-700">
              ${saldoLiquidoTotal.toLocaleString('es-CL')} CLP
            </span>
          </div>
        </div>
      </div>

      {/* 2. Calculadora Rápida de Inversión */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-7 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-bold text-slate-950 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-emerald-700" />
              Calculadora Rápida de Retorno
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Simula tu retorno en base a la orden de compra seleccionada y el plazo de pago del mandante.
            </p>
          </div>
          <span className="text-xs font-mono text-emerald-700 font-semibold">
            Tasa actual: {ocSeleccionadaCalc.tasaMensual}% mensual ({ocSeleccionadaCalc.tasaAnual}% anual)
          </span>
        </div>

        <div className="grid md:grid-cols-12 gap-6 items-center">
          <div className="md:col-span-7 space-y-4">
            <div>
              <label className="text-xs font-bold uppercase text-slate-600 block mb-1.5">
                Selecciona la Orden de Compra:
              </label>
              <select
                value={ocSeleccionadaCalc.id}
                onChange={(e) => {
                  const match = oportunidades.find((o) => o.id === e.target.value);
                  if (match) setOcSeleccionadaCalc(match);
                }}
                className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-300 text-xs text-slate-950 outline-none focus:border-emerald-500"
              >
                {oportunidades.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.codigoOC} - {o.mandante} ({o.tasaMensual}% mes - {o.plazoDias} días)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs font-bold uppercase text-slate-600">Monto a Invertir</label>
                <span className="font-mono text-base font-bold text-slate-950">
                  ${montoCalculadora.toLocaleString('es-CL')} CLP
                </span>
              </div>
              <div className="flex flex-wrap gap-2 mb-2">
                {[100000, 500000, 1000000, 2000000].map((v) => (
                  <button
                    key={v}
                    onClick={() => setMontoCalculadora(v)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                      montoCalculadora === v
                        ? 'bg-emerald-500 text-slate-950 font-bold'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    ${(v / 1000).toLocaleString('es-CL')}k
                  </button>
                ))}
              </div>
              <input
                type="range"
                min={50000}
                max={Math.max(5000000, saldoLiquidoTotal)}
                step={50000}
                value={montoCalculadora}
                onChange={(e) => setMontoCalculadora(Number(e.target.value))}
                className="w-full accent-emerald-500 cursor-pointer h-2 bg-slate-50 rounded-lg"
              />
            </div>
          </div>

          <div className="md:col-span-5 p-5 rounded-xl bg-gradient-to-br from-emerald-50 via-white to-white border border-emerald-200 space-y-3">
            <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-700 block">
              Proyección al Vencimiento
            </span>

            <div className="flex items-baseline justify-between">
              <span className="text-xs text-slate-600">Ganancia Neta:</span>
              <span className="font-mono text-xl font-black text-emerald-700">
                +${gananciaNetaEstimada.toLocaleString('es-CL')} CLP
              </span>
            </div>

            <div className="flex items-baseline justify-between text-xs">
              <span className="text-slate-600">Total a Rescatar:</span>
              <span className="font-mono font-bold text-slate-950 text-base">
                ${totalARescate.toLocaleString('es-CL')} CLP
              </span>
            </div>

            <div className="pt-2 border-t border-slate-200 text-[11px] text-slate-600 space-y-1">
              <p>
                Fecha estimada de pago: <strong>{ocSeleccionadaCalc.fechaLiquidacionEstimada}</strong>
              </p>
              <p>
                Respaldo: <strong>{ocSeleccionadaCalc.garantia}</strong>
              </p>
            </div>

            <button
              onClick={() => setOportunidadParaInvertir(ocSeleccionadaCalc)}
              className="w-full mt-2 py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs shadow-md shadow-emerald-500/25 transition cursor-pointer"
            >
              Invertir en esta OC ahora
            </button>
          </div>
        </div>
      </div>

      {/* 1. Marketplace de Oportunidades de Inversión */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-950 flex items-center gap-2">
              <Building className="w-5 h-5 text-emerald-700" />
              Órdenes de Compra Abiertas para Financiamiento
            </h2>
            <p className="text-xs text-slate-600">
              PYMEs auditadas por Finazia. Cuentan con contrato firmado y factura con mérito ejecutivo.
            </p>
          </div>
          <span className="text-xs text-slate-600 font-mono">
            {oportunidades.length} Oportunidades activas
          </span>
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          {oportunidades.map((op) => {
            const pctFinanciado = Math.min(
              100,
              Math.round((op.montoFinanciado / op.montoTotalOC) * 100)
            );
            const restante = Math.max(0, op.montoTotalOC - op.montoFinanciado);

            return (
              <div
                key={op.id}
                className="p-5 rounded-2xl bg-white border border-slate-200 hover:border-slate-300 transition flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <span className="text-[10px] font-mono text-emerald-700 font-semibold block">
                        {op.codigoOC}
                      </span>
                      <h3 className="font-extrabold text-slate-950 text-base leading-snug mt-0.5">
                        {op.mandante}
                      </h3>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                        Riesgo {op.riesgo}
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-slate-700 font-medium">
                    Proveedor: <strong className="text-slate-950">{op.pymeRazonSocial}</strong> ({op.rubro})
                  </p>

                  <p className="text-xs text-slate-600 mt-2 line-clamp-2 leading-relaxed">
                    {op.descripcion}
                  </p>

                  {/* Datos Clave */}
                  <div className="grid grid-cols-3 gap-2 my-4 p-3 rounded-xl bg-slate-50 border border-slate-200 text-center">
                    <div>
                      <span className="text-[10px] uppercase text-slate-500 block font-bold">Retorno</span>
                      <span className="font-mono text-sm font-extrabold text-emerald-700">
                        {op.tasaMensual}% mes
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-slate-500 block font-bold">Plazo</span>
                      <span className="font-mono text-sm font-bold text-slate-950">
                        {op.plazoDias} días
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-slate-500 block font-bold">Tasa Anual</span>
                      <span className="font-mono text-sm font-bold text-amber-700">
                        {op.tasaAnual}%
                      </span>
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-200">
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-slate-600">
                      Financiado: <strong>{pctFinanciado}%</strong>
                    </span>
                    <span className="font-mono text-slate-700">
                      Restan: ${restante.toLocaleString('es-CL')}
                    </span>
                  </div>

                  <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden mb-3">
                    <div
                      className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full rounded-full transition-all duration-500"
                      style={{ width: `${pctFinanciado}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[11px] text-slate-600 font-mono truncate">
                      Vence: {op.fechaLiquidacionEstimada}
                    </span>
                    <button
                      onClick={() => setOportunidadParaInvertir(op)}
                      className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-md shadow-sm transition shrink-0 cursor-pointer"
                    >
                      Invertir
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. Mi Portafolio de Inversión */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-7 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-bold text-slate-950 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-700" />
              Mi Portafolio de Inversión Activo
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Monitoreo en tiempo real del estado de tus fondos, cesión de facturas y cobros a la fecha.
            </p>
          </div>
          <span className="text-xs text-slate-600 font-mono">{misInversiones.length} Operaciones registradas</span>
        </div>

        {/* Métricas Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-[10px] uppercase text-slate-600 font-bold block">Total Invertido</span>
            <span className="font-mono text-xl font-black text-slate-950 mt-0.5 block">
              ${totalInvertido.toLocaleString('es-CL')}
            </span>
            <span className="text-[10px] text-slate-500">CLP acumulado</span>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-[10px] uppercase text-slate-600 font-bold block">Retornos Cobrados</span>
            <span className="font-mono text-xl font-black text-emerald-700 mt-0.5 block">
              +${retornosTotales.toLocaleString('es-CL')}
            </span>
            <span className="text-[10px] text-emerald-500">Rentabilidad histórica</span>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-[10px] uppercase text-slate-600 font-bold block">Tasa Promedio Mensual</span>
            <span className="font-mono text-xl font-black text-amber-700 mt-0.5 block">1.52%</span>
            <span className="text-[10px] text-slate-500">~18.2% anualizado</span>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-[10px] uppercase text-slate-600 font-bold block">Inversiones en Curso</span>
            <span className="font-mono text-xl font-black text-slate-950 mt-0.5 block">
              {inversionesActivas}
            </span>
            <span className="text-[10px] text-slate-500">Con mérito ejecutivo</span>
          </div>
        </div>

        {/* Tabla / Listado de Inversiones */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-slate-50 text-slate-600 uppercase text-[10px] font-bold border-b border-slate-200">
              <tr>
                <th className="py-3 px-4">Orden / Mandante</th>
                <th className="py-3 px-4">PYME Beneficiaria</th>
                <th className="py-3 px-4">Monto Invertido</th>
                <th className="py-3 px-4">Retorno Esperado</th>
                <th className="py-3 px-4">Fecha Pago</th>
                <th className="py-3 px-4 text-right">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {misInversiones.map((inv) => {
                const b = getBadgeEstado(inv.estado);
                return (
                  <tr key={inv.id} className="hover:bg-slate-100 transition">
                    <td className="py-3.5 px-4">
                      <span className="font-mono text-emerald-700 font-semibold block text-[11px]">
                        {inv.codigoOC}
                      </span>
                      <strong className="text-slate-950 text-xs">{inv.mandante}</strong>
                    </td>
                    <td className="py-3.5 px-4 text-slate-600">{inv.pyme}</td>
                    <td className="py-3.5 px-4 font-mono font-bold text-slate-950">
                      ${inv.montoInvertido.toLocaleString('es-CL')}
                    </td>
                    <td className="py-3.5 px-4 font-mono font-bold text-emerald-700">
                      ${inv.retornoEsperado.toLocaleString('es-CL')}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-slate-600">{inv.fechaEstimadaPago}</td>
                    <td className="py-3.5 px-4 text-right">
                      <span
                        className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full border ${b.color}`}
                      >
                        {b.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
