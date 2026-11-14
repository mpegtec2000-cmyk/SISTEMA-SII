"use client";

import { useState } from "react";
import Link from "next/link";
import OpenFinanceWidgetModal from "@/components/OpenFinanceWidgetModal";
import type { ConsolidatedFinancialProfile } from "@/lib/services/financial-data";

type Answers = {
  rut: string;
  nombre: string;
  email: string;
  telefono: string;
  tipo: "empresa" | "persona";
  ingresos: number;
  gastos: number;
  deudas: number;
  tieneCuentaBancaria: boolean;
  historialCrediticio: "bueno" | "regular" | "malo" | "sin";
  contabilidadAlDia: boolean;
  cotizacionesAlDia: boolean;
  controlInventario: boolean;
};

type Area = { nombre: string; puntaje: number; nota: string; estado: "Bueno" | "Regular" | "Crítico" };

const init: Answers = {
  rut: "",
  nombre: "",
  email: "",
  telefono: "",
  tipo: "empresa",
  ingresos: 0,
  gastos: 0,
  deudas: 0,
  tieneCuentaBancaria: true,
  historialCrediticio: "regular",
  contabilidadAlDia: false,
  cotizacionesAlDia: false,
  controlInventario: false,
};

function formatRut(val: string) {
  const clean = val.replace(/[^0-9kK]/g, "").toUpperCase();
  if (clean.length <= 1) return clean;
  const dv = clean.slice(-1);
  const cuerpo = clean.slice(0, -1);
  const formatted = cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${formatted}-${dv}`;
}

function analizar(a: Answers): { areas: Area[]; total: number; diagnosticoClave: string; ordenId: string; authCode: string } {
  const margen = a.ingresos > 0 ? (a.ingresos - a.gastos) / a.ingresos : 0;
  const endeud = a.ingresos > 0 ? a.deudas / (a.ingresos * 12) : 1;
  const fin = Math.max(0, Math.min(100, Math.round(50 + margen * 100 - endeud * 40)));
  const hist = { bueno: 40, regular: 25, malo: 5, sin: 10 }[a.historialCrediticio];
  const ban = Math.min(100, (a.tieneCuentaBancaria ? 40 : 0) + hist + (a.cotizacionesAlDia ? 20 : 0));
  const con = a.contabilidadAlDia ? 85 : 35;
  const ope = (a.controlInventario ? 50 : 20) + (a.cotizacionesAlDia ? 30 : 10);

  const getStatus = (p: number): "Bueno" | "Regular" | "Crítico" => (p >= 70 ? "Bueno" : p >= 45 ? "Regular" : "Crítico");

  const areas: Area[] = [
    {
      nombre: "Área Financiera",
      puntaje: fin,
      estado: getStatus(fin),
      nota: fin >= 60 ? "Márgenes operativos y nivel de endeudamiento dentro de rangos bancables." : "Márgenes ajustados o alto endeudamiento relativo. Requiere reestructuración de pasivos.",
    },
    {
      nombre: "Área Bancaria & Crediticia",
      puntaje: ban,
      estado: getStatus(ban),
      nota: ban >= 60 ? "Perfil financiero elegible para evaluación de financiamiento formal." : "Traba bancaria activa por historial o falta de productos. Requiere plan de bancarización.",
    },
    {
      nombre: "Área Contable & Tributaria (SII)",
      puntaje: con,
      estado: getStatus(con),
      nota: con >= 60 ? "Cumplimiento tributario en regla. F29 y compras/ventas consistentes." : "Inconsistencias tributarias o declaraciones pendientes ante SII. Riesgo de bloqueo.",
    },
    {
      nombre: "Área Operativa & Laboral (Previred)",
      puntaje: ope,
      estado: getStatus(ope),
      nota: ope >= 60 ? "Operación comercial estructurada con obligaciones laborales al día." : "Brecha en control de inventario o lagunas en cotizaciones previsionales de trabajadores/socios.",
    },
  ];

  const total = Math.round(areas.reduce((s, x) => s + x.puntaje, 0) / areas.length);
  const ordenId = `FNZ-${Math.floor(100000 + Math.random() * 900000)}`;
  const authCode = `${Math.floor(1000 + Math.random() * 9000)}`;

  let diagnosticoClave = "Perfil con viabilidad financiera favorable.";
  if (total < 45) {
    diagnosticoClave = "Situación crítica: requiere plan de regularización contable y bancarización inmediata.";
  } else if (total < 70) {
    diagnosticoClave = "Perfil regular: apto para financiamiento condicionado tras subsanar brechas documentales.";
  }

  return { areas, total, diagnosticoClave, ordenId, authCode };
}

async function descargarPDF(a: Answers, r: ReturnType<typeof analizar>) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF();

  // Header Formal
  doc.setFillColor(11, 37, 69); // Navy
  doc.rect(0, 0, 210, 32, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.text("FINANZIA", 14, 18);
  doc.setFontSize(10);
  doc.text("INFORME OFICIAL DE DIAGNÓSTICO FINANCIERO & TRIBUTARIO", 14, 26);

  // Metadata Box
  doc.setTextColor(15, 27, 45);
  doc.setFontSize(9);
  doc.text(`N° Orden: ${r.ordenId}`, 140, 15);
  doc.text(`Fecha: ${new Date().toLocaleDateString("es-CL")}`, 140, 20);
  doc.text(`Pago: Autorizado (${r.authCode})`, 140, 25);

  // Customer Data
  doc.setFontSize(12);
  doc.text("1. ANTECEDENTES DEL CLIENTE", 14, 42);
  doc.line(14, 44, 196, 44);

  doc.setFontSize(10);
  doc.text(`Razón Social / Nombre: ${a.nombre || "No especificado"}`, 14, 52);
  doc.text(`RUT: ${a.rut || "No informado"}`, 120, 52);
  doc.text(`Tipo de Solicitante: ${a.tipo === "empresa" ? "Empresa / PyME" : "Persona Natural"}`, 14, 59);
  doc.text(`Correo Electrónico: ${a.email}`, 120, 59);
  doc.text(`Ingresos declarados: $${a.ingresos.toLocaleString("es-CL")} CLP`, 14, 66);
  doc.text(`Deudas vigentes: $${a.deudas.toLocaleString("es-CL")} CLP`, 120, 66);

  // Score Box
  doc.setFillColor(246, 248, 251);
  doc.roundedRect(14, 73, 182, 24, 3, 3, "F");
  doc.setFontSize(11);
  doc.text("RESULTADO GLOBAL DE CALIFICACIÓN", 20, 82);
  doc.setFontSize(18);
  doc.setTextColor(19, 163, 127); // Brand
  doc.text(`${r.total} / 100 PUNTOS`, 20, 92);
  doc.setFontSize(10);
  doc.setTextColor(15, 27, 45);
  doc.text(`Estatus: ${r.diagnosticoClave}`, 95, 87);

  // Detail Areas
  doc.setFontSize(12);
  doc.text("2. DESGLOSE Y EVALUACIÓN POR PILAR ESTRATÉGICO", 14, 107);
  doc.line(14, 109, 196, 109);

  let y = 118;
  r.areas.forEach((area) => {
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(`${area.nombre} (${area.puntaje}/100) - Estado: ${area.estado}`, 14, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    y += 6;
    const splitText = doc.splitTextToSize(area.nota, 180);
    doc.text(splitText, 14, y);
    y += splitText.length * 5 + 6;
  });

  // Action plan and upsell
  doc.setFillColor(240, 247, 245);
  doc.roundedRect(14, y, 182, 38, 3, 3, "F");
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(11, 37, 69);
  doc.text("3. RUTA RECOMENDADA POR FINANZIA", 20, y + 8);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(50, 50, 50);
  doc.text("• Para cerrar las brechas detectadas y acceder a financiamiento bancario formal, se sugiere", 20, y + 16);
  doc.text("  ingresar al Plan de Gestión Mensual o al Plan de Bancarización de FINANZIA.", 20, y + 21);
  doc.text("• BENEFICIO ESPECIAL: El 100% de lo cancelado por este informe es abonable como crédito a tu", 20, y + 27);
  doc.text("  primera mensualidad o gestión de crédito con nuestro equipo.", 20, y + 32);

  // Footer
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text("FINANZIA SpA · Plataforma Integral de Gestión y Aceleración Financiera · www.finanzia.cl", 14, 285);

  doc.save(`Diagnostico_Finanzia_${a.rut || "Cliente"}.pdf`);
}

export default function DiagnosticoPage() {
  const [a, setA] = useState<Answers>(init);
  const [step, setStep] = useState<"formulario" | "pago" | "resultado">("formulario");
  const [metodoPago, setMetodoPago] = useState<"webpay" | "transferencia">("webpay");
  const [isProcessing, setIsProcessing] = useState(false);
  const [res, setRes] = useState<ReturnType<typeof analizar> | null>(null);
  const [correoEnviado, setCorreoEnviado] = useState(false);

  // Widget Open Finance
  const [mostrarWidgetOpenFinance, setMostrarWidgetOpenFinance] = useState(false);
  const [perfilOpenFinance, setPerfilOpenFinance] = useState<ConsolidatedFinancialProfile | null>(null);

  const handleOpenFinanceSuccess = (profile: ConsolidatedFinancialProfile) => {
    setPerfilOpenFinance(profile);
    const isPersona = profile.tipo === "persona";
    const ingresosCalc = isPersona ? profile.previred.rentaImponiblePromedio : profile.sii.ventasPromedioMensual;
    setA((prev) => ({
      ...prev,
      rut: profile.rut,
      nombre: profile.nombreRazonSocial,
      tipo: profile.tipo,
      ingresos: ingresosCalc || 5000000,
      gastos: Math.round((ingresosCalc || 5000000) * 0.6),
      deudas: profile.cmf.deudaDirectaVigente || 2000000,
      tieneCuentaBancaria: true,
      contabilidadAlDia: profile.sii.f29AlDia,
      cotizacionesAlDia: profile.previred.cotizacionesAlDia,
      historialCrediticio: profile.dicom.scoreRiesgo >= 700 ? "bueno" : profile.dicom.scoreRiesgo >= 500 ? "regular" : "malo",
    }));
  };

  const set = <K extends keyof Answers>(k: K, v: Answers[K]) => setA((p) => ({ ...p, [k]: v }));
  const num = (k: "ingresos" | "gastos" | "deudas") => (e: React.ChangeEvent<HTMLInputElement>) =>
    set(k, Math.max(0, Number(e.target.value)));

  const handleSubmitForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!a.rut || !a.email || !a.nombre) {
      alert("Por favor completa los campos obligatorios (RUT, Nombre y Correo).");
      return;
    }
    setStep("pago");
  };

  const handleSimularPago = () => {
    setIsProcessing(true);
    setTimeout(async () => {
      const resultado = analizar(a);
      setRes(resultado);
      setIsProcessing(false);
      setStep("resultado");
      setCorreoEnviado(true);
      try {
        await fetch("/api/v1/leads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: "DIAGNOSTICO",
            personType: a.tipo === "empresa" ? "Empresa / PyME" : "Persona Natural",
            name: a.nombre,
            rut: a.rut,
            email: a.email,
            phone: a.telefono,
            amountCLP: 19990,
            summary: `Compra Informe Diagnóstico (${resultado.ordenId}) · Puntaje: ${resultado.total}/100 · ${resultado.diagnosticoClave}`,
            problemPreview: `Ingresos: $${a.ingresos.toLocaleString("es-CL")} · Deudas: $${a.deudas.toLocaleString("es-CL")}`,
            solutionPreview: `Evaluación + Proyección Financiera PDF emitida (${metodoPago.toUpperCase()})`,
            payload: { ordenId: resultado.ordenId, total: resultado.total, areas: resultado.areas },
          }),
        });
      } catch {
        // fallback local
      }
    }, 1500);
  };

  return (
    <main className="mx-auto max-w-4xl px-4 pt-10 pb-20">
      <div className="mb-8 text-center sm:text-left">
        <span className="inline-block rounded-full bg-brand/10 px-3 py-1 text-xs font-bold text-brand uppercase tracking-wider">
          Módulo Transaccional On-Demand
        </span>
        <h1 className="mt-2 text-3xl font-extrabold text-navy sm:text-4xl">Diagnóstico al Instante</h1>
        <p className="mt-2 text-slate-600">
          Chequeo automatizado de salud financiera, bancaria, contable (SII) y laboral (Previred) con entrega inmediata en PDF y envío a tu correo.
        </p>
      </div>

      {/* Stepper Bar */}
      <div className="mb-8 grid grid-cols-3 gap-2 text-center text-xs font-semibold sm:text-sm">
        <div className={`rounded-lg p-2.5 ${step === "formulario" ? "bg-navy text-white" : "bg-slate-100 text-slate-700"}`}>
          1. Datos y RUT
        </div>
        <div className={`rounded-lg p-2.5 ${step === "pago" ? "bg-navy text-white" : "bg-slate-100 text-slate-700"}`}>
          2. Pasarela Webpay
        </div>
        <div className={`rounded-lg p-2.5 ${step === "resultado" ? "bg-brand text-white" : "bg-slate-100 text-slate-700"}`}>
          3. Informe & PDF
        </div>
      </div>

      {/* STEP 1: FORMULARIO */}
      {step === "formulario" && (
        <form onSubmit={handleSubmitForm} className="card grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2 border-b border-slate-100 pb-3">
            <h2 className="text-lg font-bold text-navy">Antecedentes del Solicitante</h2>
            <p className="text-xs text-slate-500">Información confidencial resguardada bajo estándares bancarios.</p>
          </div>

          <div>
            <label className="label">Tipo de solicitante *</label>
            <select className="input" value={a.tipo} onChange={(e) => set("tipo", e.target.value as Answers["tipo"])}>
              <option value="empresa">Empresa / PyME (Persona Jurídica)</option>
              <option value="persona">Persona Natural</option>
            </select>
          </div>

          <div>
            <label className="label">RUT {a.tipo === "empresa" ? "Empresa" : "Titular"} *</label>
            <input
              className="input font-mono"
              required
              placeholder="12.345.678-K"
              value={a.rut}
              onChange={(e) => set("rut", formatRut(e.target.value))}
            />
          </div>

          <div className="sm:col-span-2">
            {!perfilOpenFinance ? (
              <button
                type="button"
                onClick={() => {
                  if (!a.rut) {
                    set("rut", "76.432.109-8");
                  }
                  setMostrarWidgetOpenFinance(true);
                }}
                className="flex items-center justify-center gap-2 w-full rounded-xl border border-brand/40 bg-brand/5 py-2 px-4 text-xs font-bold text-brand hover:bg-brand/10 transition shadow-sm"
              >
                Autocompletar datos con ClaveÚnica o SII (Open Finance Floid / Fintoc)
              </button>
            ) : (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-emerald-700">Antecedentes SII y CMF Verificados:</span>
                  <span>Ventas declaradas: ${perfilOpenFinance.sii.ventasPromedioMensual.toLocaleString("es-CL")} · Deuda CMF: ${perfilOpenFinance.cmf.deudaDirectaVigente.toLocaleString("es-CL")}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setMostrarWidgetOpenFinance(true)}
                  className="text-[11px] underline font-semibold text-emerald-900 ml-2"
                >
                  Actualizar
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="label">{a.tipo === "empresa" ? "Razón Social" : "Nombre Completo"} *</label>
            <input
              className="input"
              required
              placeholder={a.tipo === "empresa" ? "Inversiones del Norte SpA" : "Juan Pérez González"}
              value={a.nombre}
              onChange={(e) => set("nombre", e.target.value)}
            />
          </div>

          <div>
            <label className="label">Correo Electrónico (para despacho de informe) *</label>
            <input
              className="input"
              type="email"
              required
              placeholder="tu-correo@empresa.cl"
              value={a.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </div>

          <div>
            <label className="label">Teléfono de contacto</label>
            <input
              className="input"
              type="tel"
              placeholder="+56 9 1234 5678"
              value={a.telefono}
              onChange={(e) => set("telefono", e.target.value)}
            />
          </div>

          <div>
            <label className="label">Historial crediticio general</label>
            <select className="input" value={a.historialCrediticio} onChange={(e) => set("historialCrediticio", e.target.value as Answers["historialCrediticio"])}>
              <option value="bueno">Excelente / Sin morosidades</option>
              <option value="regular">Regular / Algún retraso menor</option>
              <option value="malo">Con antecedentes comerciales / DICOM</option>
              <option value="sin">Sin historial financiero previo</option>
            </select>
          </div>

          <div className="sm:col-span-2 border-t border-slate-100 pt-3">
            <h2 className="text-lg font-bold text-navy">Parámetros Financieros & Operativos Mensuales</h2>
          </div>

          <div>
            <label className="label">{a.tipo === "empresa" ? "Ventas mensuales promedio (CLP)" : "Ingresos líquidos mensuales (CLP)"}</label>
            <input
              type="number"
              min={0}
              className="input font-mono"
              placeholder="Ej: 3500000"
              value={a.ingresos || ""}
              onChange={num("ingresos")}
            />
          </div>

          <div>
            <label className="label">Costos / Gastos mensuales (CLP)</label>
            <input
              type="number"
              min={0}
              className="input font-mono"
              placeholder="Ej: 2100000"
              value={a.gastos || ""}
              onChange={num("gastos")}
            />
          </div>

          <div className="sm:col-span-2">
            <label className="label">Deudas y compromisos financieros totales (CLP)</label>
            <input
              type="number"
              min={0}
              className="input font-mono"
              placeholder="Ej: 5000000"
              value={a.deudas || ""}
              onChange={num("deudas")}
            />
          </div>

          <div className="sm:col-span-2 space-y-2 rounded-xl bg-slate-50 p-4 border border-slate-200">
            <p className="text-xs font-bold uppercase text-slate-500">Verificaciones de cumplimiento:</p>
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" checked={a.tieneCuentaBancaria} onChange={(e) => set("tieneCuentaBancaria", e.target.checked)} className="rounded text-brand focus:ring-brand" />
              Cuenta corriente o vista activa en la banca
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" checked={a.contabilidadAlDia} onChange={(e) => set("contabilidadAlDia", e.target.checked)} className="rounded text-brand focus:ring-brand" />
              Declaraciones de impuestos al día ante el SII (Formulario F29 sin observaciones)
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" checked={a.cotizacionesAlDia} onChange={(e) => set("cotizacionesAlDia", e.target.checked)} className="rounded text-brand focus:ring-brand" />
              Cotizaciones previsionales pagadas al día en Previred
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" checked={a.controlInventario} onChange={(e) => set("controlInventario", e.target.checked)} className="rounded text-brand focus:ring-brand" />
              Control estructurado de inventario, contratos u operaciones comerciales
            </label>
          </div>

          <div className="sm:col-span-2 pt-2">
            <button type="submit" className="btn btn-primary w-full text-base py-3">
              Continuar a Pasarela de Pago ($19.990 CLP) →
            </button>
            <p className="mt-2 text-center text-xs text-slate-500">
              El cobro incluye emisión de informe PDF y envío automático a tu correo electrónico.
            </p>
          </div>
        </form>
      )}

      {/* STEP 2: PASARELA DE PAGO / PAYWALL */}
      {step === "pago" && (
        <div className="grid gap-6 md:grid-cols-5">
          <div className="card md:col-span-3 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-lg font-bold text-navy">Pasarela de Pago Segura</h2>
              <span className="rounded bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">Webpay Plus</span>
            </div>

            <div className="space-y-3">
              <label
                onClick={() => setMetodoPago("webpay")}
                className={`flex items-center justify-between p-3.5 rounded-xl border cursor-pointer transition ${metodoPago === "webpay" ? "border-brand bg-brand/5 ring-2 ring-brand/20" : "border-slate-200"}`}
              >
                <div className="flex items-center gap-3">
                  <input type="radio" checked={metodoPago === "webpay"} onChange={() => setMetodoPago("webpay")} />
                  <div>
                    <p className="text-sm font-bold text-navy">Webpay Plus / Redcompra</p>
                    <p className="text-xs text-slate-500">Tarjetas de Débito, Crédito, Prepago y CuentaRUT</p>
                  </div>
                </div>
                <span className="text-xs font-bold text-slate-400">Transbank</span>
              </label>

              <label
                onClick={() => setMetodoPago("transferencia")}
                className={`flex items-center justify-between p-3.5 rounded-xl border cursor-pointer transition ${metodoPago === "transferencia" ? "border-brand bg-brand/5 ring-2 ring-brand/20" : "border-slate-200"}`}
              >
                <div className="flex items-center gap-3">
                  <input type="radio" checked={metodoPago === "transferencia"} onChange={() => setMetodoPago("transferencia")} />
                  <div>
                    <p className="text-sm font-bold text-navy">Transferencia Bancaria Instantánea</p>
                    <p className="text-xs text-slate-500">Aprobación inmediata vía Khipu / Fintoc</p>
                  </div>
                </div>
                <span className="text-xs font-bold text-slate-400">Instantáneo</span>
              </label>
            </div>

            <div className="rounded-xl bg-slate-50 p-4 text-xs text-slate-600 space-y-1.5 border border-slate-200">
              <p className="font-semibold text-slate-800">Garantía FINANZIA:</p>
              <p>El 100% del valor pagado por este diagnóstico queda a tu favor como cupón de descuento para tu primer mes en cualquiera de nuestros Planes de Gestión o tramitación de crédito.</p>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setStep("formulario")} className="btn btn-ghost flex-1" disabled={isProcessing}>
                ← Modificar datos
              </button>
              <button onClick={handleSimularPago} className="btn btn-primary flex-1 py-3" disabled={isProcessing}>
                {isProcessing ? "Procesando pago..." : "Pagar $19.990 CLP"}
              </button>
            </div>
          </div>

          <div className="card md:col-span-2 space-y-4 bg-slate-50 border-slate-200">
            <h3 className="font-bold text-navy text-sm uppercase tracking-wider">Resumen de la Orden</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>Servicio:</span>
                <span className="font-medium text-slate-800 text-right">Diagnóstico al Instante</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Cliente:</span>
                <span className="font-medium text-slate-800 text-right truncate max-w-[150px]">{a.nombre}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>RUT:</span>
                <span className="font-mono text-slate-800">{a.rut}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Despacho:</span>
                <span className="font-medium text-brand text-right truncate max-w-[150px]">{a.email}</span>
              </div>
              <div className="border-t border-slate-200 pt-2 flex justify-between font-bold text-base text-navy">
                <span>Total a pagar:</span>
                <span>$19.990 CLP</span>
              </div>
            </div>
            <div className="text-[11px] text-slate-500 leading-relaxed">
              Al confirmar el pago se procesará la transacción con estándar TLS 256-bit y se liberará la descarga del informe inmediatamente.
            </div>
          </div>
        </div>
      )}

      {/* STEP 3: RESULTADO & ENTREGA MULTICANAL */}
      {step === "resultado" && res && (
        <div className="space-y-6">
          {/* Notification bar */}
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500 text-white font-bold text-lg">
                
              </div>
              <div>
                <p className="font-bold text-emerald-900">¡Pago Aprobado y Diagnóstico Generado!</p>
                <p className="text-xs text-emerald-700">
                  Orden #{res.ordenId} · Código Transbank #{res.authCode} · Despachado a <b>{a.email}</b>
                </p>
              </div>
            </div>
            <button onClick={() => descargarPDF(a, res)} className="btn btn-primary bg-emerald-600 hover:bg-emerald-700 whitespace-nowrap shadow-sm">
              Descargar Informe en PDF
            </button>
          </div>

          {correoEnviado && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 flex items-center justify-between">
              <span>Copia del informe oficial y comprobante tributario enviada automáticamente a <b>{a.email}</b>.</span>
              <span className="font-semibold text-blue-600">Entregado</span>
            </div>
          )}

          {/* Results Card */}
          <div className="card space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Dictamen Automatizado</span>
                <h2 className="text-2xl font-extrabold text-navy">Salud Financiera: {res.total} / 100 Pts</h2>
                <p className="text-sm text-slate-600 mt-1">{res.diagnosticoClave}</p>
              </div>
              <div className="text-right">
                <span className="inline-block rounded-full px-3 py-1 text-xs font-bold text-white bg-navy">
                  RUT: {a.rut}
                </span>
              </div>
            </div>

            {/* Pillar Breakdown */}
            <div className="grid gap-4 sm:grid-cols-2">
              {res.areas.map((x) => (
                <div key={x.nombre} className="rounded-xl border border-slate-200 p-4 bg-slate-50/50">
                  <div className="flex items-center justify-between text-sm font-bold text-navy">
                    <span>{x.nombre}</span>
                    <span className={x.puntaje >= 70 ? "text-brand" : x.puntaje >= 45 ? "text-amber-600" : "text-rose-600"}>
                      {x.puntaje}/100 ({x.estado})
                    </span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-slate-200 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        x.puntaje >= 70 ? "bg-brand" : x.puntaje >= 45 ? "bg-amber-500" : "bg-rose-500"
                      }`}
                      style={{ width: `${x.puntaje}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-slate-600 leading-relaxed">{x.nota}</p>
                </div>
              ))}
            </div>

            {/* Upsell / Conversion Funnel */}
            <div className="rounded-2xl border-2 border-brand/30 bg-gradient-to-r from-brand/5 to-navy/5 p-6">
              <span className="text-xs font-extrabold uppercase tracking-wider text-brand">Oportunidad de Crecimiento & Descuento</span>
              <h3 className="mt-1 text-xl font-extrabold text-navy">¿Quieres cerrar estas brechas y obtener financiamiento?</h3>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                Utiliza los <b>$19.990 CLP</b> que acabas de pagar como abono automático para tu primer mes en nuestros <b>Planes de Gestión Mensual</b> o para tramitar créditos con nuestro equipo de brokerage.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link href="/planes" className="btn btn-primary">
                  Ver Planes de Gestión y Canjear Descuento →
                </Link>
                <Link href="/creditos" className="btn btn-ghost">
                  Simular Créditos con este Perfil
                </Link>
                <button onClick={() => descargarPDF(a, res)} className="btn btn-ghost">
                  Descargar Copia PDF
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* WIDGET OPEN FINANCE EMBEBIDO */}
      {mostrarWidgetOpenFinance && (
        <OpenFinanceWidgetModal
          rut={a.rut || "76.432.109-8"}
          tipo={a.tipo}
          onSuccess={handleOpenFinanceSuccess}
          onClose={() => setMostrarWidgetOpenFinance(false)}
        />
      )}
    </main>
  );
}
