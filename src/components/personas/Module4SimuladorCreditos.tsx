'use client';

import React, { useState, useMemo } from 'react';
import { usePersonas } from '@/lib/personas/context';
import {
  Calculator,
  Home,
  Car,
  DollarSign,
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  Sparkles,
  TrendingDown,
  ArrowRight,
  ShieldCheck,
  FileCheck,
  Award,
} from 'lucide-react';

type TipoCredito = 'consumo' | 'automotriz' | 'hipotecario';

export default function Module4SimuladorCreditos() {
  const {
    ingresoLiquidoMensual,
    saldoLiquidoTotal,
    cargaFinancieraActual,
    semaforoInfo,
    ufValor,
    metas,
    setModuloActivo,
  } = usePersonas();

  const [tipo, setTipo] = useState<TipoCredito>('hipotecario');

  // Parámetros dinámicos según tipo de crédito
  const [montoSolicitado, setMontoSolicitado] = useState<number>(65000000); // 65 millones
  const [plazoMeses, setPlazoMeses] = useState<number>(240); // 20 años para hipotecario
  const [tasaMensualPct, setTasaMensualPct] = useState<number>(0.42); // 0.42% mensual (~5% anual)
  const [pieAhorrado, setPieAhorrado] = useState<number>(14000000); // 14 millones

  // Al cambiar de tipo, cargamos presets realistas chilenos
  const handleCambioTipo = (nuevoTipo: TipoCredito) => {
    setTipo(nuevoTipo);
    if (nuevoTipo === 'hipotecario') {
      setMontoSolicitado(65000000);
      setPlazoMeses(240); // 20 años
      setTasaMensualPct(0.42);
      setPieAhorrado(14000000);
    } else if (nuevoTipo === 'automotriz') {
      setMontoSolicitado(9500000);
      setPlazoMeses(48); // 4 años
      setTasaMensualPct(1.25);
      setPieAhorrado(3000000);
    } else {
      // Consumo
      setMontoSolicitado(5000000);
      setPlazoMeses(36); // 3 años
      setTasaMensualPct(1.45);
      setPieAhorrado(0);
    }
  };

  // Cálculo matemático financiero de cuota
  const { cuotaCLP, cuotaUF, caeEstimado, costoTotalCredito, cargaFinancieraProyectadaPct } =
    useMemo(() => {
      const r = tasaMensualPct / 100;
      const n = plazoMeses;
      const P = montoSolicitado;

      let cuota = 0;
      if (r > 0 && n > 0) {
        cuota = Math.round((P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1));
      } else {
        cuota = Math.round(P / n);
      }

      // Seguro de desgravamen e incendio/sismo aproximado según mercado chileno
      const seguroMensual = tipo === 'hipotecario' ? Math.round(cuota * 0.08) : Math.round(cuota * 0.04);
      const cuotaTotalConSeguros = cuota + seguroMensual;

      const cuotaEnUF = (cuotaTotalConSeguros / ufValor).toFixed(2);
      const ctc = cuotaTotalConSeguros * n;
      const cae = (Math.pow(1 + r, 12) - 1) * 100 + (tipo === 'hipotecario' ? 0.8 : 1.5);

      // Carga financiera sumando deudas actuales leídas
      const cargaActualPesos = Math.round((cargaFinancieraActual / 100) * ingresoLiquidoMensual);
      const cargaProyectada = Math.round(
        ((cargaActualPesos + cuotaTotalConSeguros) / ingresoLiquidoMensual) * 100
      );

      return {
        cuotaCLP: cuotaTotalConSeguros,
        cuotaUF: cuotaEnUF,
        caeEstimado: cae.toFixed(2),
        costoTotalCredito: ctc,
        cargaFinancieraProyectadaPct: cargaProyectada,
      };
    }, [montoSolicitado, plazoMeses, tasaMensualPct, tipo, ufValor, cargaFinancieraActual, ingresoLiquidoMensual]);

  // Motor de Diagnóstico ("¿Qué te falta para este crédito?")
  const diagnostico = useMemo(() => {
    const brechas: { id: string; titulo: string; desc: string; solucion: string }[] = [];
    const maxCargaAceptable = tipo === 'hipotecario' ? 30 : 35; // Bancos chilenos exigen máx 25-30% para hipotecario

    // Brecha 1: Carga financiera
    if (cargaFinancieraProyectadaPct > maxCargaAceptable) {
      const excesoPorcentual = cargaFinancieraProyectadaPct - maxCargaAceptable;
      const rentaNecesaria = Math.round(cuotaCLP / (maxCargaAceptable / 100));
      brechas.push({
        id: 'carga',
        titulo: `Carga financiera proyectada elevada (${cargaFinancieraProyectadaPct}%)`,
        desc: `La cuota mensual de $${cuotaCLP.toLocaleString('es-CL')} representaría más del ${maxCargaAceptable}% de tu sueldo líquido actual ($${ingresoLiquidoMensual.toLocaleString('es-CL')}).`,
        solucion: `Extiende el plazo a ${Math.min(360, plazoMeses + 60)} meses o complementa renta hasta alcanzar al menos $${rentaNecesaria.toLocaleString('es-CL')} líquidos mensuales.`,
      });
    }

    // Brecha 2: Pie mínimo para hipotecario / automotriz
    if (tipo === 'hipotecario') {
      const valorPropiedadEstimado = montoSolicitado + pieAhorrado;
      const pieMinimoRequerido = valorPropiedadEstimado * 0.2; // 20%
      if (pieAhorrado < pieMinimoRequerido) {
        const faltaPie = Math.round(pieMinimoRequerido - pieAhorrado);
        brechas.push({
          id: 'pie',
          titulo: 'Ahorro insuficiente para el 20% de Pie Hipotecario',
          desc: `La banca chilena actual exige al menos un 20% de pie para tasas preferenciales. Tu pie actual ($${pieAhorrado.toLocaleString('es-CL')}) está bajo el requerimiento.`,
          solucion: `Te faltan $${faltaPie.toLocaleString('es-CL')} CLP de pie. Con tu ritmo de ahorro en Finazia lo alcanzas en aprox. ${Math.ceil(faltaPie / 350000)} meses.`,
        });
      }
    }

    // Brecha 3: Semáforo / Dicom
    if (semaforoInfo.estado === 'rojo') {
      brechas.push({
        id: 'dicom',
        titulo: 'Alertas comerciales activas o cuotas por vencer en <72h',
        desc: 'El algoritmo bancario detectará atrasos o línea de crédito al límite antes de ingresar tu carpeta a comités de riesgo.',
        solucion: 'Resuelve tus alertas en el Módulo 2 y mantén 3 meses consecutivos con blindaje en verde.',
      });
    }

    const esAprobado = brechas.length === 0;

    return {
      esAprobado,
      brechas,
    };
  }, [
    cargaFinancieraProyectadaPct,
    tipo,
    montoSolicitado,
    pieAhorrado,
    plazoMeses,
    cuotaCLP,
    ingresoLiquidoMensual,
    semaforoInfo.estado,
  ]);

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Header del Simulador */}
      <div className="bg-gradient-to-r from-slate-50 via-purple-50/50 to-white p-6 sm:p-8 rounded-2xl border border-purple-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-50 border border-purple-200 text-purple-700 text-xs font-semibold mb-2">
            <Calculator className="w-3.5 h-3.5" />
            <span>Módulo 4: Simulación & Diagnóstico de Aprobación</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-950 tracking-tight">
            Simulador de Créditos con Diagnóstico Real
          </h1>
          <p className="text-sm text-slate-700 mt-1 max-w-2xl">
            Evalúa tu crédito hipotecario, automotriz o de consumo con los criterios reales de los bancos en Chile. Descubre de inmediato qué te falta para ser aprobado sin sorpresas.
          </p>
        </div>

        {/* Tipo de Crédito Switcher */}
        <div className="inline-flex rounded-xl bg-slate-50 p-1.5 border border-slate-200 self-start md:self-auto">
          <button
            onClick={() => handleCambioTipo('hipotecario')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
              tipo === 'hipotecario'
                ? 'bg-emerald-500 text-slate-950 shadow-md'
                : 'text-slate-600 hover:text-slate-950'
            }`}
          >
            <Home className="w-3.5 h-3.5" />
            <span>Hipotecario</span>
          </button>
          <button
            onClick={() => handleCambioTipo('automotriz')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
              tipo === 'automotriz'
                ? 'bg-emerald-500 text-slate-950 shadow-md'
                : 'text-slate-600 hover:text-slate-950'
            }`}
          >
            <Car className="w-3.5 h-3.5" />
            <span>Automotriz</span>
          </button>
          <button
            onClick={() => handleCambioTipo('consumo')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
              tipo === 'consumo'
                ? 'bg-emerald-500 text-slate-950 shadow-md'
                : 'text-slate-600 hover:text-slate-950'
            }`}
          >
            <DollarSign className="w-3.5 h-3.5" />
            <span>Consumo</span>
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-12 gap-8 items-start">
        {/* Columna Izquierda: Parámetros y Sliders (7 cols) */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-6 sm:p-7 space-y-6">
          <div className="pb-4 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-950 flex items-center gap-2">
              <Calculator className="w-5 h-5 text-emerald-700" />
              Parámetros de Simulación
            </h2>
            <span className="text-xs text-slate-600 font-mono">Valores en Pesos Chilenos</span>
          </div>

          {/* Slider 1: Monto Solicitado */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Monto Solicitado
              </label>
              <div className="flex items-center gap-2">
                <span className="font-mono text-lg font-black text-slate-950">
                  ${montoSolicitado.toLocaleString('es-CL')} CLP
                </span>
                <span className="text-xs font-mono text-slate-600">
                  (~{(montoSolicitado / ufValor).toFixed(0)} UF)
                </span>
              </div>
            </div>
            <input
              type="range"
              min={tipo === 'hipotecario' ? 20000000 : tipo === 'automotriz' ? 3000000 : 500000}
              max={tipo === 'hipotecario' ? 180000000 : tipo === 'automotriz' ? 25000000 : 15000000}
              step={tipo === 'hipotecario' ? 1000000 : 500000}
              value={montoSolicitado}
              onChange={(e) => setMontoSolicitado(Number(e.target.value))}
              className="w-full accent-emerald-500 cursor-pointer h-2 bg-slate-50 rounded-lg"
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
              <span>{tipo === 'hipotecario' ? '$20M' : '$3M'}</span>
              <span>{tipo === 'hipotecario' ? '$180M' : '$25M'}</span>
            </div>
          </div>

          {/* Slider 2: Plazo */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Plazo de Pago
              </label>
              <span className="font-mono text-base font-bold text-emerald-700">
                {tipo === 'hipotecario'
                  ? `${plazoMeses} cuotas (${(plazoMeses / 12).toFixed(0)} años)`
                  : `${plazoMeses} cuotas mensuales`}
              </span>
            </div>
            <input
              type="range"
              min={tipo === 'hipotecario' ? 60 : 12}
              max={tipo === 'hipotecario' ? 360 : 60}
              step={tipo === 'hipotecario' ? 12 : 6}
              value={plazoMeses}
              onChange={(e) => setPlazoMeses(Number(e.target.value))}
              className="w-full accent-emerald-500 cursor-pointer h-2 bg-slate-50 rounded-lg"
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
              <span>{tipo === 'hipotecario' ? '5 años (60m)' : '12 meses'}</span>
              <span>{tipo === 'hipotecario' ? '30 años (360m)' : '60 meses'}</span>
            </div>
          </div>

          {/* Slider 3: Tasa de Interés Referencial */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Tasa Mensual Referencial
              </label>
              <span className="font-mono text-base font-bold text-amber-700">
                {tasaMensualPct.toFixed(2)}% mensual (~{(tasaMensualPct * 12).toFixed(1)}% anual)
              </span>
            </div>
            <input
              type="range"
              min={0.3}
              max={2.5}
              step={0.05}
              value={tasaMensualPct}
              onChange={(e) => setTasaMensualPct(Number(e.target.value))}
              className="w-full accent-amber-500 cursor-pointer h-2 bg-slate-50 rounded-lg"
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
              <span>0.30% (Hipotecario Prime)</span>
              <span>2.50% (Consumo Estándar)</span>
            </div>
          </div>

          {/* Input Pie si es hipotecario o automotriz */}
          {tipo !== 'consumo' && (
            <div className="space-y-2 pt-2 border-t border-slate-200">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  Pie Disponible en Ahorro
                </label>
                <span className="font-mono text-base font-bold text-slate-950">
                  ${pieAhorrado.toLocaleString('es-CL')} CLP
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={40000000}
                step={500000}
                value={pieAhorrado}
                onChange={(e) => setPieAhorrado(Number(e.target.value))}
                className="w-full accent-blue-500 cursor-pointer h-2 bg-slate-50 rounded-lg"
              />
              <p className="text-[11px] text-slate-600">
                Representa el{' '}
                <strong className="text-slate-950">
                  {Math.round((pieAhorrado / (montoSolicitado + pieAhorrado)) * 100)}%
                </strong>{' '}
                del valor estimado del bien.
              </p>
            </div>
          )}

          {/* Tarjeta Resumen de Cálculos Financieros */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
            <div className="flex items-baseline justify-between">
              <div>
                <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold block">
                  Cuota Mensual Estimada
                </span>
                <span className="font-mono text-2xl font-black text-emerald-700">
                  ${cuotaCLP.toLocaleString('es-CL')}
                </span>
                <span className="text-xs font-mono text-slate-600 ml-1.5">CLP / mes</span>
              </div>
              <div className="text-right">
                <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold block">
                  En Unidades de Fomento
                </span>
                <span className="font-mono text-lg font-bold text-slate-950">{cuotaUF} UF</span>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200 grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-slate-600 block">CAE Referencial:</span>
                <strong className="text-slate-950 font-mono">{caeEstimado}%</strong>
              </div>
              <div>
                <span className="text-slate-600 block">Costo Total Crédito:</span>
                <strong className="text-slate-950 font-mono">
                  ${costoTotalCredito.toLocaleString('es-CL')}
                </strong>
              </div>
            </div>
          </div>
        </div>

        {/* Columna Derecha: Motor de Diagnóstico Inteligente (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          <div
            className={`p-6 sm:p-7 rounded-2xl border transition-all ${
              diagnostico.esAprobado
                ? 'bg-gradient-to-br from-emerald-50 via-white to-white border-emerald-300 shadow-xl shadow-sm'
                : 'bg-gradient-to-br from-slate-50 via-rose-50/50 to-white border-rose-200'
            }`}
          >
            <div className="flex items-start gap-3.5 mb-4">
              <div
                className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                  diagnostico.esAprobado
                    ? 'bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/30'
                    : 'bg-rose-50 text-rose-700 border border-rose-200'
                }`}
              >
                {diagnostico.esAprobado ? (
                  <Award className="w-7 h-7" />
                ) : (
                  <AlertCircle className="w-7 h-7" />
                )}
              </div>

              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-600 block">
                  Diagnóstico Finazia en Vivo
                </span>
                <h3 className="text-lg font-black text-slate-950 leading-tight mt-0.5">
                  {diagnostico.esAprobado
                    ? '¡Pre-Aprobación Estimada Favorable!'
                    : '¿Qué te falta para este crédito?'}
                </h3>
              </div>
            </div>

            {/* Cruce de Datos con Módulo 2 */}
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1.5 mb-5">
              <div className="flex justify-between">
                <span className="text-slate-600">Renta Líquida demostrable:</span>
                <span className="font-mono text-slate-950 font-bold">
                  ${ingresoLiquidoMensual.toLocaleString('es-CL')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Carga mensual proyectada:</span>
                <span
                  className={`font-mono font-bold ${
                    cargaFinancieraProyectadaPct > 30 ? 'text-rose-700' : 'text-emerald-700'
                  }`}
                >
                  {cargaFinancieraProyectadaPct}% del sueldo
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Historial DICOM:</span>
                <span className="font-mono text-emerald-700 font-bold">
                  {semaforoInfo.scoreDicom} pts (Limpio)
                </span>
              </div>
            </div>

            {/* Listado de Brechas o Checklists */}
            {!diagnostico.esAprobado ? (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-rose-700">
                  Detectamos {diagnostico.brechas.length} brechas que frenarían tu aprobación:
                </p>

                {diagnostico.brechas.map((b) => (
                  <div
                    key={b.id}
                    className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs space-y-1.5"
                  >
                    <div className="flex items-start gap-2">
                      
                      <strong className="text-rose-700">{b.titulo}</strong>
                    </div>
                    <p className="text-slate-700 pl-4">{b.desc}</p>
                    <div className="mt-2 pl-4 pt-1.5 border-t border-rose-200 text-emerald-700 font-medium">
                      <strong>Plan de acción:</strong> {b.solucion}
                    </div>
                  </div>
                ))}

                <button
                  onClick={() => setModuloActivo('metas')}
                  className="w-full mt-3 py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span>Ajustar plan de ahorro en Metas</span>
                  <ArrowRight className="w-4 h-4 text-emerald-700" />
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-emerald-700 leading-relaxed">
                  Tu perfil califica holgadamente bajo la normativa de la CMF. Tu carga total no supera el límite y mantienes historial intachable.
                </p>

                <div className="space-y-2 text-xs">
                  <span className="font-bold text-slate-950 block">Documentos sugeridos para postular:</span>
                  <div className="space-y-1.5 text-slate-700">
                    <p className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                      3 últimas liquidaciones de sueldo
                    </p>
                    <p className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                      Certificado de 12 cotizaciones AFP con RUT pagador
                    </p>
                    <p className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                      Certificado de saldo de cuenta para acreditar pie
                    </p>
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-center">
                  <span className="text-xs font-bold text-emerald-700 block">
                    Finazia Broker Partner
                  </span>
                  <p className="text-[11px] text-slate-700 mt-0.5">
                    Podemos presentar tu carpeta a Banco Estado, Bci y Santander simultáneamente para licitar la mejor tasa.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
