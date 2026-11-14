'use client';

import React, { useState } from 'react';
import { usePersonas } from '@/lib/personas/context';
import { X, TrendingUp, ShieldCheck, CheckCircle2, Lock, ArrowRight, DollarSign } from 'lucide-react';

export default function ModalInvertirOC() {
  const {
    oportunidadParaInvertir,
    setOportunidadParaInvertir,
    invertirEnOportunidad,
    saldoLiquidoTotal,
    mostrarToast,
  } = usePersonas();

  const [monto, setMonto] = useState<number>(300000);
  const [aceptaTerminos, setAceptaTerminos] = useState(true);
  const [procesando, setProcesando] = useState(false);

  if (!oportunidadParaInvertir) return null;

  const op = oportunidadParaInvertir;
  const meses = op.plazoDias / 30;
  const ganancia = Math.round(monto * (op.tasaMensual / 100) * meses);
  const rescate = monto + ganancia;

  const handleInvertir = (e: React.FormEvent) => {
    e.preventDefault();
    if (!aceptaTerminos) {
      mostrarToast('Debes aceptar las condiciones de cesión de crédito Ley 19.983.');
      return;
    }

    setProcesando(true);
    setTimeout(() => {
      const ok = invertirEnOportunidad(op.id, monto);
      setProcesando(false);
      if (ok) {
        setOportunidadParaInvertir(null);
      }
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-lg rounded-2xl bg-white border border-emerald-200 p-6 sm:p-7 text-slate-950 shadow-2xl animate-scaleUp">
        <button
          onClick={() => setOportunidadParaInvertir(null)}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-600 hover:text-slate-950 hover:bg-slate-100 transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] font-mono text-emerald-700 block">{op.codigoOC}</span>
            <h3 className="font-extrabold text-lg text-slate-950">Financiar Orden de Compra</h3>
          </div>
        </div>

        <form onSubmit={handleInvertir} className="space-y-4">
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-600">Mandante:</span>
              <strong className="text-slate-950">{op.mandante}</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">PYME Receptora:</span>
              <span className="text-slate-900">{op.pymeRazonSocial}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Tasa de Rentabilidad:</span>
              <strong className="text-emerald-700 font-mono">{op.tasaMensual}% mensual</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Plazo de Pago:</span>
              <span className="text-slate-900">{op.plazoDias} días ({op.fechaLiquidacionEstimada})</span>
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-xs font-bold uppercase text-slate-700">
                Monto que deseas aportar (CLP)
              </label>
              <span className="text-[11px] text-slate-600">
                Disponible: <strong className="text-emerald-700 font-mono">${saldoLiquidoTotal.toLocaleString('es-CL')}</strong>
              </span>
            </div>
            <input
              type="number"
              min={50000}
              max={saldoLiquidoTotal}
              step={50000}
              value={monto}
              onChange={(e) => setMonto(Number(e.target.value))}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm font-mono text-slate-950"
              required
            />
          </div>

          {/* Resumen de Retorno */}
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between">
            <div>
              <span className="text-[10px] uppercase text-slate-600 block font-bold">Ganancia Estimada</span>
              <span className="font-mono text-xl font-black text-emerald-700">
                +${ganancia.toLocaleString('es-CL')} CLP
              </span>
            </div>
            <div className="text-right">
              <span className="text-[10px] uppercase text-slate-600 block font-bold">Rescate Total</span>
              <span className="font-mono text-base font-bold text-slate-950">
                ${rescate.toLocaleString('es-CL')} CLP
              </span>
            </div>
          </div>

          <div className="flex items-start gap-2.5 text-[11px] text-slate-600">
            <input
              type="checkbox"
              id="terminos"
              checked={aceptaTerminos}
              onChange={(e) => setAceptaTerminos(e.target.checked)}
              className="mt-0.5 accent-emerald-500 rounded"
            />
            <label htmlFor="terminos" className="cursor-pointer">
              Autorizo la suscripción del contrato de mandato para la cesión de la factura con mérito ejecutivo bajo la <strong>Ley 19.983</strong> chilena y custodia en Finazia.
            </label>
          </div>

          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setOportunidadParaInvertir(null)}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-950"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={procesando}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs shadow-lg shadow-emerald-500/25 transition cursor-pointer"
            >
              <span>{procesando ? 'Procesando cesión...' : 'Confirmar Inversión'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
