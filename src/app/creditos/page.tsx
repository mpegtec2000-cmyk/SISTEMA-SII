"use client";

import { useState } from "react";
import Link from "next/link";
import OpenFinanceWidgetModal from "@/components/OpenFinanceWidgetModal";
import type { ConsolidatedFinancialProfile } from "@/lib/services/financial-data";

type TabTipo = "general" | "automotriz" | "hipotecario" | "leasing";

function formatRut(val: string) {
  const clean = val.replace(/[^0-9kK]/g, "").toUpperCase();
  if (clean.length <= 1) return clean;
  const dv = clean.slice(-1);
  const cuerpo = clean.slice(0, -1);
  const formatted = cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${formatted}-${dv}`;
}

export default function SimuladorCreditosPublico() {
  const [tab, setTab] = useState<TabTipo>("general");
  const [perfil, setPerfil] = useState<"persona" | "empresa">("empresa");

  // Inputs Comunes
  const [rut, setRut] = useState("");
  const [nombre, setNombre] = useState("");
  const [ingresos, setIngresos] = useState<number>(3500000);
  const [deudasActuales, setDeudasActuales] = useState<number>(400000);
  const [montoSolicitado, setMontoSolicitado] = useState<number>(25000000);
  const [plazoMeses, setPlazoMeses] = useState<number>(36);

  // Inputs Automotriz
  const [patente, setPatente] = useState("");
  const [anioVehiculo, setAnioVehiculo] = useState<number>(2021);
  const [valorVehiculo, setValorVehiculo] = useState<number>(14000000);

  // Inputs Hipotecario
  const [rolPropiedad, setRolPropiedad] = useState("");
  const [comunaPropiedad, setComunaPropiedad] = useState("Santiago");
  const [valorPropiedad, setValorPropiedad] = useState<number>(90000000);
  const [pieDisponible, setPieDisponible] = useState<number>(15000000);

  // Inputs Leasing
  const [tipoActivo, setTipoActivo] = useState("Maquinaria y Equipos Industriales");
  const [valorActivo, setValorActivo] = useState<number>(30000000);

  // Modal de Conversión / Registro de Lead
  const [mostrarModalContacto, setMostrarModalContacto] = useState(false);
  const [emailContacto, setEmailContacto] = useState("");
  const [telefonoContacto, setTelefonoContacto] = useState("");
  const [registroExitoso, setRegistroExitoso] = useState(false);

  // Widget Open Finance (Floid / Fintoc)
  const [mostrarWidgetOpenFinance, setMostrarWidgetOpenFinance] = useState(false);
  const [perfilOpenFinance, setPerfilOpenFinance] = useState<ConsolidatedFinancialProfile | null>(null);

  const handleOpenFinanceSuccess = (profile: ConsolidatedFinancialProfile) => {
    setPerfilOpenFinance(profile);
    setNombre(profile.nombreRazonSocial);
    if (profile.tipo === "persona") {
      setIngresos(profile.previred.rentaImponiblePromedio || 2100000);
      setPerfil("persona");
    } else {
      setIngresos(profile.sii.ventasPromedioMensual || 8500000);
      setPerfil("empresa");
    }
    setDeudasActuales(profile.cmf.cargaFinancieraMensualEstimada || 550000);
  };

  // Cálculos matemáticos de brechas
  const calcularEvaluacion = () => {
    let tasaMensual = 0.0135;
    let cuotaEstimada = 0;
    let capacidadMaximaCuota = 0;
    let brechaMensual = 0;
    let mensajeBrecha = "";
    let esApto = false;
    let detalleGarantia = "";

    if (tab === "general") {
      tasaMensual = perfil === "empresa" ? 0.0125 : 0.0155;
      cuotaEstimada = Math.round(
        (montoSolicitado * tasaMensual) / (1 - Math.pow(1 + tasaMensual, -plazoMeses))
      );
      capacidadMaximaCuota =
        perfil === "persona"
          ? Math.max(0, ingresos * 0.28 - deudasActuales)
          : Math.max(0, ingresos * 0.18 - deudasActuales);

      if (cuotaEstimada <= capacidadMaximaCuota) {
        esApto = true;
      } else {
        const diferenciaCuota = cuotaEstimada - capacidadMaximaCuota;
        if (perfil === "persona") {
          brechaMensual = Math.ceil(diferenciaCuota / 0.28);
          mensajeBrecha = `Para calificar a este financiamiento te falta demostrar $${brechaMensual.toLocaleString("es-CL")} CLP adicionales de renta líquida mensual.`;
        } else {
          brechaMensual = Math.ceil(diferenciaCuota / 0.18);
          mensajeBrecha = `Tu empresa requiere facturar $${brechaMensual.toLocaleString("es-CL")} CLP adicionales mensuales promedio en los últimos 6 meses para ser sujeto de crédito.`;
        }
      }
    } else if (tab === "automotriz") {
      tasaMensual = 0.014;
      const maximoFinanciamientoGarantia = Math.round(valorVehiculo * 0.75);
      const montoFinal = Math.min(montoSolicitado, maximoFinanciamientoGarantia);
      cuotaEstimada = Math.round((montoFinal * tasaMensual) / (1 - Math.pow(1 + tasaMensual, -plazoMeses)));
      capacidadMaximaCuota = Math.max(0, ingresos * 0.25 - deudasActuales);

      if (montoSolicitado > maximoFinanciamientoGarantia) {
        const faltaGarantia = montoSolicitado - maximoFinanciamientoGarantia;
        detalleGarantia = `Por el año (${anioVehiculo}) y tasación ($${valorVehiculo.toLocaleString("es-CL")}), el monto máximo garantizable es $${maximoFinanciamientoGarantia.toLocaleString("es-CL")}. Brecha de garantía: $${faltaGarantia.toLocaleString("es-CL")} CLP.`;
      }

      if (cuotaEstimada <= capacidadMaximaCuota && montoSolicitado <= maximoFinanciamientoGarantia) {
        esApto = true;
      } else {
        const dif = Math.max(0, cuotaEstimada - capacidadMaximaCuota);
        brechaMensual = Math.ceil(dif / 0.25);
        mensajeBrecha = `Para cubrir la cuota vehicular ($${cuotaEstimada.toLocaleString("es-CL")}/mes), necesitas acreditar $${brechaMensual.toLocaleString("es-CL")} CLP adicionales de ingresos mensuales.`;
      }
    } else if (tab === "hipotecario") {
      tasaMensual = 0.0042;
      const pieMinimo = Math.round(valorPropiedad * 0.2);
      const montoCredito = Math.max(0, valorPropiedad - pieDisponible);
      cuotaEstimada = Math.round((montoCredito * tasaMensual) / (1 - Math.pow(1 + tasaMensual, -plazoMeses)));
      capacidadMaximaCuota = Math.max(0, ingresos * 0.25 - deudasActuales);

      let faltaPie = 0;
      if (pieDisponible < pieMinimo) {
        faltaPie = pieMinimo - pieDisponible;
        detalleGarantia = `El pie ingresado ($${pieDisponible.toLocaleString("es-CL")}) es inferior al 20% mínimo exigido ($${pieMinimo.toLocaleString("es-CL")}). Te faltan $${faltaPie.toLocaleString("es-CL")} CLP de pie para postular.`;
      }

      if (cuotaEstimada <= capacidadMaximaCuota && faltaPie === 0) {
        esApto = true;
      } else {
        const dif = Math.max(0, cuotaEstimada - capacidadMaximaCuota);
        brechaMensual = Math.ceil(dif / 0.25);
        mensajeBrecha = `Para calificar al dividendo ($${cuotaEstimada.toLocaleString("es-CL")}/mes), requieres acreditar $${brechaMensual.toLocaleString("es-CL")} CLP adicionales de renta familiar líquida.`;
      }
    } else if (tab === "leasing") {
      tasaMensual = 0.0115;
      cuotaEstimada = Math.round((valorActivo * tasaMensual) / (1 - Math.pow(1 + tasaMensual, -plazoMeses)));
      capacidadMaximaCuota = Math.max(0, ingresos * 0.22 - deudasActuales);

      if (cuotaEstimada <= capacidadMaximaCuota) {
        esApto = true;
      } else {
        const dif = cuotaEstimada - capacidadMaximaCuota;
        brechaMensual = Math.ceil(dif / 0.22);
        mensajeBrecha = `Para la cuota de leasing de este activo ($${cuotaEstimada.toLocaleString("es-CL")}/mes), tu empresa requiere facturar $${brechaMensual.toLocaleString("es-CL")} CLP adicionales al mes.`;
      }
    }

    return {
      cuotaEstimada,
      capacidadMaximaCuota,
      brechaMensual,
      mensajeBrecha,
      esApto,
      detalleGarantia,
    };
  };

  const resultado = calcularEvaluacion();

  const handleRegistrarLead = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await fetch("/api/v1/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "CREDITOS",
          personType: perfil === "empresa" ? "Empresa / PyME" : "Persona Natural",
          name: nombre || "Solicitante Simulador",
          rut,
          email: emailContacto,
          phone: telefonoContacto,
          amountCLP: montoSolicitado,
          summary: `Simulador Créditos (${tab.toUpperCase()}) · ${resultado.esApto ? "PRE-APROBADO" : "CON BRECHA"} · Cuota est: $${resultado.cuotaEstimada.toLocaleString("es-CL")}/mes`,
          problemPreview: resultado.esApto ? "Sin brecha de ingresos detectada" : resultado.mensajeBrecha,
          solutionPreview: resultado.esApto ? "Gestión de carpeta bancaria e informe financiero" : `Cerrar brecha mensual de $${resultado.brechaMensual.toLocaleString("es-CL")} + Informe Financiero`,
          payload: { tab, perfil, ingresos, deudasActuales, montoSolicitado, plazoMeses, resultado },
        }),
      });
    } catch {
      // fallback local
    }
    setRegistroExitoso(true);
  };

  return (
    <main className="mx-auto max-w-6xl px-4 pt-10 pb-20">
      <div className="mb-8">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-block rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800 uppercase tracking-wider">
            Herramienta Pública 100% Gratuita (Sin Registro)
          </span>
          <span className="inline-block rounded-full bg-navy/10 px-3 py-1 text-xs font-bold text-navy uppercase tracking-wider">
            Lead Magnet Inteligente
          </span>
        </div>
        <h1 className="mt-2 text-3xl font-extrabold text-navy sm:text-4xl">
          Simulador de Créditos & Evaluador de Brechas
        </h1>
        <p className="mt-2 text-slate-600 max-w-3xl">
          Ingresa tu RUT y antecedentes financieros para simular de inmediato tu capacidad crediticia. Conoce al instante si calificas o qué monto exacto te falta para que los bancos aprueben tu financiamiento.
        </p>
      </div>

      {/* Tabs por Activo / Garantía */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        <button
          onClick={() => setTab("general")}
          className={`px-4 py-2 text-sm font-semibold rounded-lg transition ${tab === "general" ? "bg-navy text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
        >
          Líneas Comerciales & FOGAPE
        </button>
        <button
          onClick={() => setTab("automotriz")}
          className={`px-4 py-2 text-sm font-semibold rounded-lg transition ${tab === "automotriz" ? "bg-navy text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
        >
          Garantía Vehicular / Automotriz
        </button>
        <button
          onClick={() => setTab("hipotecario")}
          className={`px-4 py-2 text-sm font-semibold rounded-lg transition ${tab === "hipotecario" ? "bg-navy text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
        >
          Crédito Hipotecario / Inmuebles
        </button>
        <button
          onClick={() => setTab("leasing")}
          className={`px-4 py-2 text-sm font-semibold rounded-lg transition ${tab === "leasing" ? "bg-navy text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
        >
          Leasing Operativo & Maquinaria
        </button>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-12">
        {/* Formulario de Simulación Pública */}
        <div className="card lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-lg font-bold text-navy">Simulación Libre de Financiamiento</h2>
            <div className="flex gap-2 text-xs">
              <button
                type="button"
                onClick={() => setPerfil("empresa")}
                className={`px-3 py-1 rounded-full font-bold transition ${perfil === "empresa" ? "bg-brand text-white" : "bg-slate-100 text-slate-600"}`}
              >
                Empresa
              </button>
              <button
                type="button"
                onClick={() => setPerfil("persona")}
                className={`px-3 py-1 rounded-full font-bold transition ${perfil === "persona" ? "bg-brand text-white" : "bg-slate-100 text-slate-600"}`}
              >
                Persona
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">RUT {perfil === "empresa" ? "Empresa" : "Titular"} *</label>
              <input
                className="input font-mono"
                placeholder="76.123.456-7"
                value={rut}
                onChange={(e) => setRut(formatRut(e.target.value))}
              />
            </div>
            <div>
              <label className="label">{perfil === "empresa" ? "Razón Social" : "Nombre Completo"}</label>
              <input
                className="input"
                placeholder="Ej: Inversiones Los Andes SpA"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
              />
            </div>

            <div className="sm:col-span-2">
              {!perfilOpenFinance ? (
                <button
                  type="button"
                  onClick={() => {
                    if (!rut) {
                      setRut("76.432.109-8");
                    }
                    setMostrarWidgetOpenFinance(true);
                  }}
                  className="flex items-center justify-center gap-2 w-full rounded-xl border border-brand/40 bg-brand/5 py-2.5 px-4 text-xs font-bold text-brand hover:bg-brand/10 transition shadow-sm"
                >
                  Autocompletar con ClaveÚnica o SII (Open Finance Floid / Fintoc)
                </button>
              ) : (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-emerald-700">Open Finance Activo:</span>
                    <span>Ventas SII: ${perfilOpenFinance.sii.ventasPromedioMensual.toLocaleString("es-CL")} · Deudas CMF: ${perfilOpenFinance.cmf.deudaDirectaVigente.toLocaleString("es-CL")} · Dicom: {perfilOpenFinance.dicom.scoreRiesgo} pts</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMostrarWidgetOpenFinance(true)}
                    className="text-[11px] underline font-semibold text-emerald-900 ml-2"
                  >
                    Re-sincronizar
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className="label">{perfil === "empresa" ? "Ventas mensuales promedio (CLP)" : "Renta líquida mensual (CLP)"}</label>
              <input
                type="number"
                min={0}
                className="input font-mono font-bold text-navy"
                value={ingresos || ""}
                onChange={(e) => setIngresos(Number(e.target.value))}
              />
            </div>

            <div>
              <label className="label">Compromisos financieros actuales (CLP/mes)</label>
              <input
                type="number"
                min={0}
                className="input font-mono"
                value={deudasActuales || ""}
                onChange={(e) => setDeudasActuales(Number(e.target.value))}
              />
            </div>
          </div>

          {/* Específico según pestaña */}
          {tab === "general" && (
            <div className="grid gap-3 sm:grid-cols-2 pt-2 border-t border-slate-100">
              <div>
                <label className="label">Monto de crédito a solicitar (CLP)</label>
                <input
                  type="number"
                  min={1000000}
                  className="input font-mono text-base font-bold text-navy"
                  value={montoSolicitado || ""}
                  onChange={(e) => setMontoSolicitado(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="label">Plazo de amortización</label>
                <select className="input" value={plazoMeses} onChange={(e) => setPlazoMeses(Number(e.target.value))}>
                  <option value={12}>12 meses (1 año)</option>
                  <option value={24}>24 meses (2 años)</option>
                  <option value={36}>36 meses (3 años)</option>
                  <option value={48}>48 meses (4 años)</option>
                  <option value={60}>60 meses (5 años)</option>
                </select>
              </div>
            </div>
          )}

          {tab === "automotriz" && (
            <div className="grid gap-3 sm:grid-cols-2 pt-2 border-t border-slate-100">
              <div>
                <label className="label">Patente del vehículo</label>
                <input className="input font-mono uppercase" placeholder="ABCD-12" value={patente} onChange={(e) => setPatente(e.target.value.toUpperCase())} />
              </div>
              <div>
                <label className="label">Año de fabricación</label>
                <input type="number" className="input" value={anioVehiculo} onChange={(e) => setAnioVehiculo(Number(e.target.value))} />
              </div>
              <div>
                <label className="label">Valor comercial tasado (CLP)</label>
                <input type="number" className="input font-mono" value={valorVehiculo || ""} onChange={(e) => setValorVehiculo(Number(e.target.value))} />
              </div>
              <div>
                <label className="label">Monto de liquidez a solicitar (CLP)</label>
                <input type="number" className="input font-mono font-bold text-navy" value={montoSolicitado || ""} onChange={(e) => setMontoSolicitado(Number(e.target.value))} />
              </div>
            </div>
          )}

          {tab === "hipotecario" && (
            <div className="grid gap-3 sm:grid-cols-2 pt-2 border-t border-slate-100">
              <div>
                <label className="label">Rol de la propiedad</label>
                <input className="input font-mono" placeholder="1234-56" value={rolPropiedad} onChange={(e) => setRolPropiedad(e.target.value)} />
              </div>
              <div>
                <label className="label">Comuna</label>
                <input className="input" value={comunaPropiedad} onChange={(e) => setComunaPropiedad(e.target.value)} />
              </div>
              <div>
                <label className="label">Valor de la propiedad (CLP)</label>
                <input type="number" className="input font-mono" value={valorPropiedad || ""} onChange={(e) => setValorPropiedad(Number(e.target.value))} />
              </div>
              <div>
                <label className="label">Pie disponible (CLP)</label>
                <input type="number" className="input font-mono font-bold text-navy" value={pieDisponible || ""} onChange={(e) => setPieDisponible(Number(e.target.value))} />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Plazo hipotecario</label>
                <select className="input" value={plazoMeses} onChange={(e) => setPlazoMeses(Number(e.target.value))}>
                  <option value={180}>15 años (180 meses)</option>
                  <option value={240}>20 años (240 meses)</option>
                  <option value={300}>25 años (300 meses)</option>
                  <option value={360}>30 años (360 meses)</option>
                </select>
              </div>
            </div>
          )}

          {tab === "leasing" && (
            <div className="grid gap-3 sm:grid-cols-2 pt-2 border-t border-slate-100">
              <div className="sm:col-span-2">
                <label className="label">Tipo de activo</label>
                <input className="input" value={tipoActivo} onChange={(e) => setTipoActivo(e.target.value)} />
              </div>
              <div>
                <label className="label">Valor neto del activo (CLP)</label>
                <input type="number" className="input font-mono font-bold text-navy" value={valorActivo || ""} onChange={(e) => setValorActivo(Number(e.target.value))} />
              </div>
              <div>
                <label className="label">Plazo leasing</label>
                <select className="input" value={plazoMeses} onChange={(e) => setPlazoMeses(Number(e.target.value))}>
                  <option value={24}>24 meses</option>
                  <option value={36}>36 meses</option>
                  <option value={48}>48 meses</option>
                </select>
              </div>
            </div>
          )}

          <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500 border border-slate-200">
            Los cálculos y brechas matemáticas se actualizan dinámicamente en tiempo real en el panel lateral.
          </div>
        </div>

        {/* Panel de Resultados del Gap Analysis & Punto de Conversión */}
        <div className="card lg:col-span-5 space-y-4 bg-slate-50 border-slate-200">
          <div className="border-b border-slate-200 pb-3">
            <span className="text-xs font-bold text-brand uppercase tracking-wider">Mini Análisis Automatizado</span>
            <h3 className="text-lg font-extrabold text-navy">Estatus Crediticio en Vivo</h3>
          </div>

          <div className="space-y-3">
            <div className="rounded-xl bg-white p-3.5 border border-slate-200 shadow-sm">
              <div className="flex justify-between text-xs text-slate-500">
                <span>Cuota mensual estimada:</span>
                <span className="font-bold text-navy text-sm font-mono">${resultado.cuotaEstimada.toLocaleString("es-CL")} CLP</span>
              </div>
              <div className="flex justify-between text-xs text-slate-500 mt-1">
                <span>Capacidad máxima según ingresos:</span>
                <span className="font-mono text-slate-700">${resultado.capacidadMaximaCuota.toLocaleString("es-CL")} CLP</span>
              </div>
            </div>

            {/* Resultado Calificación / Brecha Matemática */}
            {resultado.esApto ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="flex items-center gap-2 text-emerald-800 font-bold text-sm">
                  Calificación Favorable Preliminar
                </div>
                <p className="mt-1 text-xs text-emerald-700 leading-relaxed">
                  Tu perfil cumple con los ratios de cobertura y capacidad de pago para este financiamiento.
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-2">
                <div className="flex items-center gap-2 text-amber-900 font-bold text-sm">
                  Detección de Brecha Matemática
                </div>
                <p className="text-xs text-amber-900 font-medium leading-relaxed bg-white/70 p-2.5 rounded-lg border border-amber-200">
                  {resultado.mensajeBrecha}
                </p>
                {resultado.detalleGarantia && (
                  <p className="text-xs text-amber-800 leading-relaxed">{resultado.detalleGarantia}</p>
                )}
              </div>
            )}

            {/* PUNTO DE CONVERSIÓN / ACCIÓN (Lead Magnet) */}
            <div className="rounded-2xl border-2 border-brand/40 bg-white p-5 shadow-sm space-y-3">
              <span className="text-[11px] font-bold text-brand uppercase tracking-wider">Paso Siguiente · Cierra tu Brecha</span>
              <h4 className="text-sm font-extrabold text-navy">¿Deseas que FINANZIA gestione tu crédito o te ayude a calificar?</h4>
              <p className="text-xs text-slate-600 leading-relaxed">
                Nuestros ejecutivos y contadores estructuran tu carpeta tributaria, eliminan inconsistencias y tramitan tu aprobación directamente con los bancos.
              </p>
              
              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  onClick={() => setMostrarModalContacto(true)}
                  className="btn btn-primary w-full !text-xs !py-3 shadow-sm font-bold"
                >
                  Solicitar que FINANZIA estructure mi crédito →
                </button>
                <Link href="/diagnostico" className="btn btn-ghost w-full !text-xs !py-2 text-slate-700">
                  Comprar Diagnóstico Financiero Completo ($19.990)
                </Link>
                <Link href="/planes" className="btn btn-ghost w-full !text-xs !py-2 text-slate-700">
                  Ver Planes de Gestión Mensual (Cierre SII & Flujo)
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* MODAL DE CONVERSIÓN / CAPTURA DE DATOS */}
      {mostrarModalContacto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="card max-w-md w-full space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-extrabold text-navy text-lg">Estructuración de Crédito</h3>
                <p className="text-xs text-slate-500">Crea tu usuario para acceder a tu panel de seguimiento.</p>
              </div>
              <button
                onClick={() => setMostrarModalContacto(false)}
                className="text-slate-400 hover:text-slate-600 font-bold text-lg"
              >
                
              </button>
            </div>

            {!registroExitoso ? (
              <form onSubmit={handleRegistrarLead} className="space-y-3 text-sm">
                <div>
                  <label className="label">RUT Solicitante *</label>
                  <input
                    className="input font-mono"
                    required
                    value={rut}
                    onChange={(e) => setRut(formatRut(e.target.value))}
                    placeholder="12.345.678-K"
                  />
                </div>
                <div>
                  <label className="label">Nombre Completo o Razón Social *</label>
                  <input
                    className="input"
                    required
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    placeholder="Juan Pérez o Mi Empresa SpA"
                  />
                </div>
                <div>
                  <label className="label">Correo Electrónico de Contacto *</label>
                  <input
                    type="email"
                    className="input"
                    required
                    value={emailContacto}
                    onChange={(e) => setEmailContacto(e.target.value)}
                    placeholder="tu-correo@empresa.cl"
                  />
                </div>
                <div>
                  <label className="label">Teléfono móvil *</label>
                  <input
                    type="tel"
                    className="input"
                    required
                    value={telefonoContacto}
                    onChange={(e) => setTelefonoContacto(e.target.value)}
                    placeholder="+56 9 1234 5678"
                  />
                </div>

                <div className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600 border border-slate-200">
                  ℹ️ Se creará automáticamente tu cuenta en FINANZIA con los antecedentes de esta simulación para dar inicio a la tramitación de tu crédito.
                </div>

                <button type="submit" className="btn btn-primary w-full py-2.5 font-bold">
                  Confirmar y Enviar Solicitud de Crédito →
                </button>
              </form>
            ) : (
              <div className="space-y-4 text-center py-4">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 text-xl font-bold">
                  
                </div>
                <h4 className="font-extrabold text-navy text-lg">¡Solicitud de Crédito Ingresada!</h4>
                <p className="text-xs text-slate-600">
                  Hemos registrado tus antecedentes y los datos de tu simulación. Un analista de FINANZIA revisará tu caso y te contactará a <b>{emailContacto}</b>.
                </p>
                <div className="pt-2">
                  <Link href="/login" className="btn btn-primary w-full">
                    Ir al Panel de Clientes →
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* WIDGET OPEN FINANCE EMBEBIDO */}
      {mostrarWidgetOpenFinance && (
        <OpenFinanceWidgetModal
          rut={rut || "76.432.109-8"}
          tipo={perfil}
          onSuccess={handleOpenFinanceSuccess}
          onClose={() => setMostrarWidgetOpenFinance(false)}
        />
      )}
    </main>
  );
}
