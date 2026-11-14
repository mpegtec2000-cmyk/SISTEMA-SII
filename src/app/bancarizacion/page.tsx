"use client";

import { useState } from "react";
import Link from "next/link";

type TipoSolicitante = "persona" | "empresa";

interface TrabaFinanciera {
  id: string;
  label: string;
  desc: string;
  impacto: "Alto" | "Medio" | "Crítico";
}

const TRABAS_DISPONIBLES: TrabaFinanciera[] = [
  {
    id: "ingresos_informales",
    label: "Ingresos no demostrables formalmente",
    desc: "Ventas o ingresos en efectivo/transferencias sin boletas, facturas ni liquidaciones de sueldo.",
    impacto: "Crítico",
  },
  {
    id: "dicom_morosidad",
    label: "Deudas en Boletín Comercial / DICOM",
    desc: "Morosidades vigentes, protestos o deudas castigadas que bloquean la evaluación bancaria.",
    impacto: "Crítico",
  },
  {
    id: "sin_cuenta_bancaria",
    label: "Sin cuenta bancaria comercial o corriente",
    desc: "Uso exclusivo de cuentas prepago o efectivo sin trazabilidad financiera.",
    impacto: "Medio",
  },
  {
    id: "lagunas_previsionales",
    label: "Lagunas en cotizaciones previsionales",
    desc: "Meses impagos en AFP, Fonasa o Isapre en los últimos 24 meses.",
    impacto: "Alto",
  },
  {
    id: "sin_antiguedad",
    label: "Falta de antigüedad formal (< 1 año)",
    desc: "Negocio recién iniciado o contrato laboral reciente sin continuidad demostrable.",
    impacto: "Medio",
  },
];

function formatRut(val: string) {
  const clean = val.replace(/[^0-9kK]/g, "").toUpperCase();
  if (clean.length <= 1) return clean;
  const dv = clean.slice(-1);
  const cuerpo = clean.slice(0, -1);
  const formatted = cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${formatted}-${dv}`;
}

export default function BancarizacionPublicaPage() {
  const [tipo, setTipo] = useState<TipoSolicitante>("persona");
  const [ingresosAprox, setIngresosAprox] = useState<number>(1800000);
  const [trabasSeleccionadas, setTrabasSeleccionadas] = useState<string[]>([
    "ingresos_informales",
    "sin_cuenta_bancaria",
  ]);
  const [meta, setMeta] = useState<string>("hipotecario");

  // Modal de Conversión / Captura de Lead
  const [mostrarModal, setMostrarModal] = useState(false);
  const [rut, setRut] = useState("");
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [registrado, setRegistrado] = useState(false);

  const toggleTraba = (id: string) => {
    setTrabasSeleccionadas((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  };

  const getRutaSalida = () => {
    const pasos = [
      {
        titulo: "1. Acreditación Formal de Ingresos",
        desc:
          tipo === "persona"
            ? "Formalización mediante boletas de honorarios continuas o contrato laboral estructurado."
            : "Inicio de actividades en SII, acreditación de domicilio y facturación electrónica periódica.",
        duracion: "Mes 1",
        aplica: trabasSeleccionadas.includes("ingresos_informales") || trabasSeleccionadas.includes("sin_antiguedad"),
      },
      {
        titulo: "2. Saneamiento de Deuda & Aclaración Comercial",
        desc: "Negociación de deudas castigadas, convenios de pago y tramitación de aclaraciones ante DICOM y la CMF.",
        duracion: "Mes 1 - 2",
        aplica: trabasSeleccionadas.includes("dicom_morosidad"),
      },
      {
        titulo: "3. Regularización Previsional en Previred",
        desc: "Cálculo y pago de imposiciones atrasadas para validar continuidad y capacidad de ahorro ante bancos.",
        duracion: "Mes 2",
        aplica: trabasSeleccionadas.includes("lagunas_previsionales"),
      },
      {
        titulo: "4. Apertura y Trazabilidad Bancaria Escalonada",
        desc: "Apertura de cuenta vista o corriente inicial con depósito estructurado del flujo operativo mensual.",
        duracion: "Mes 2 - 3",
        aplica: true,
      },
      {
        titulo: "5. Calificación Bancable & Postulación a Crédito",
        desc: `Estructuración de carpeta financiera lista para postular a ${
          meta === "hipotecario"
            ? "Crédito Hipotecario / Vivienda"
            : meta === "automotriz"
            ? "Crédito Automotriz"
            : meta === "capital"
            ? "Línea de Capital de Trabajo"
            : "Licitaciones en Mercado Público"
        }.`,
        duracion: "Mes 4 - 6",
        aplica: true,
      },
    ];
    return pasos.filter((p) => p.aplica);
  };

  const ruta = getRutaSalida();

  const handleEnviarLead = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await fetch("/api/v1/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "BANCARIZACION",
          personType: tipo === "persona" ? "Persona Natural" : "Empresa / PyME",
          name: nombre,
          rut,
          email,
          phone: telefono,
          amountCLP: ingresosAprox,
          summary: `Bancarización y Regularización · Meta: ${meta.toUpperCase()} · Ingresos aprox: $${ingresosAprox.toLocaleString("es-CL")}`,
          problemPreview: `${trabasSeleccionadas.length} trabas detectadas (${trabasSeleccionadas.join(", ")})`,
          solutionPreview: ruta.map((r) => r.titulo).join(" → "),
          payload: { tipo, ingresosAprox, meta, trabasSeleccionadas },
        }),
      });
    } catch {
      // fallback local
    }
    setRegistrado(true);
  };

  return (
    <main className="mx-auto max-w-5xl px-4 pt-10 pb-20">
      <div className="mb-8">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-block rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800 uppercase tracking-wider">
            Herramienta Pública 100% Gratuita (Sin Registro)
          </span>
          <span className="inline-block rounded-full bg-brand/10 px-3 py-1 text-xs font-bold text-brand uppercase tracking-wider">
            Inclusión Financiera & Regularización
          </span>
        </div>
        <h1 className="mt-2 text-3xl font-extrabold text-navy sm:text-4xl">
          Diagnóstico y Plan de Bancarización
        </h1>
        <p className="mt-2 text-slate-600 max-w-3xl">
          ¿Trabajas de forma independiente o informal? ¿Tienes deudas castigadas o lagunas previsionales? Evalúa tu situación sin costo y conoce el plan paso a paso para abrir cuentas y acceder a créditos.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Formulario de Evaluación de Trabas */}
        <div className="card lg:col-span-7 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-lg font-bold text-navy">Evaluación Rápida de Trabas</h2>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setTipo("persona")}
                className={`px-3 py-1 rounded-full text-xs font-bold transition ${tipo === "persona" ? "bg-navy text-white" : "bg-slate-100 text-slate-600"}`}
              >
                Persona Natural
              </button>
              <button
                type="button"
                onClick={() => setTipo("empresa")}
                className={`px-3 py-1 rounded-full text-xs font-bold transition ${tipo === "empresa" ? "bg-navy text-white" : "bg-slate-100 text-slate-600"}`}
              >
                Empresa / Emprendimiento
              </button>
            </div>
          </div>

          <div>
            <label className="label">¿Cuánto dinero generas mensualmente en promedio? (CLP)</label>
            <input
              type="number"
              min={0}
              className="input font-mono text-base font-bold text-navy"
              value={ingresosAprox || ""}
              onChange={(e) => setIngresosAprox(Number(e.target.value))}
            />
            <p className="mt-1 text-xs text-slate-500">Suma tus ingresos reales habituales (efectivo, transferencias, honorarios).</p>
          </div>

          <div>
            <label className="label">¿Cuál es tu principal objetivo para bancarizarte?</label>
            <select className="input" value={meta} onChange={(e) => setMeta(e.target.value)}>
              <option value="hipotecario">Comprar una vivienda / Casa propia (Crédito Hipotecario)</option>
              <option value="automotriz">Comprar un vehículo o camioneta de trabajo</option>
              <option value="capital">Obtener cuenta corriente bancaria con capital de trabajo</option>
              <option value="mercado_publico">Formalizar mi empresa y licitar en Mercado Público</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="label font-bold text-navy">Selecciona las trabas que tienes actualmente:</label>
            <div className="space-y-2.5">
              {TRABAS_DISPONIBLES.map((t) => {
                const checked = trabasSeleccionadas.includes(t.id);
                return (
                  <div
                    key={t.id}
                    onClick={() => toggleTraba(t.id)}
                    className={`p-3 rounded-xl border cursor-pointer transition flex items-start gap-3 ${
                      checked ? "border-brand bg-brand/5 ring-1 ring-brand/30" : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {}}
                      className="mt-1 rounded text-brand focus:ring-brand"
                    />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-bold text-navy">{t.label}</p>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            t.impacto === "Crítico"
                              ? "bg-rose-100 text-rose-800"
                              : t.impacto === "Alto"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-blue-100 text-blue-800"
                          }`}
                        >
                          {t.impacto}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">{t.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Panel de Resultados: Ruta de Salida en Vivo & Punto de Conversión */}
        <div className="card lg:col-span-5 space-y-5 bg-slate-50 border-slate-200">
          <div className="border-b border-slate-200 pb-3">
            <span className="text-xs font-bold text-brand uppercase tracking-wider">Resultado Inmediato</span>
            <h3 className="text-lg font-extrabold text-navy">Ruta de Salida hacia la Banca</h3>
          </div>

          <div className="rounded-xl bg-white p-4 border border-slate-200 shadow-sm space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-500">Trabas seleccionadas:</span>
              <span className="font-bold text-rose-700 font-mono">{trabasSeleccionadas.length} impedimentos</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-500">Tiempo estimado a perfil bancable:</span>
              <span className="font-bold text-brand">3 a 5 meses con acompañamiento</span>
            </div>
          </div>

          {/* Etapas de la Ruta */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">Plan de Regularización Sugerido:</h4>
            <div className="space-y-2.5">
              {ruta.map((p) => (
                <div key={p.titulo} className="rounded-xl bg-white p-3 border border-slate-200 shadow-sm">
                  <div className="flex items-center justify-between text-xs font-bold text-navy">
                    <span>{p.titulo}</span>
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-600 font-mono">{p.duracion}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600 leading-relaxed">{p.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* PUNTO DE CONVERSIÓN / ACCIÓN */}
          <div className="rounded-2xl border-2 border-brand/40 bg-white p-5 shadow-sm space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-white text-xs font-bold">
                
              </span>
              <h4 className="text-sm font-extrabold text-navy">¿Quieres que un asesor te guíe en el proceso?</h4>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              En FINANZIA regularizamos tu situación societaria, tributaria y previsional para que los bancos te abran las puertas.
            </p>
            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={() => setMostrarModal(true)}
                className="btn btn-primary w-full !text-xs !py-3 shadow-sm font-bold"
              >
                Solicitar Asesor de Regularización →
              </button>
              <Link href="/diagnostico" className="btn btn-ghost w-full !text-xs !py-2 text-slate-700">
                Comprar Diagnóstico Integral al Instante ($19.990)
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* MODAL DE REGISTRO / CONVERSIÓN */}
      {mostrarModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="card max-w-md w-full space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-extrabold text-navy text-lg">Solicitud de Bancarización</h3>
                <p className="text-xs text-slate-500">Ingresa tus datos para contactar a tu asesor FINANZIA.</p>
              </div>
              <button onClick={() => setMostrarModal(false)} className="text-slate-400 hover:text-slate-600 font-bold text-lg">
                
              </button>
            </div>

            {!registrado ? (
              <form onSubmit={handleEnviarLead} className="space-y-3 text-sm">
                <div>
                  <label className="label">RUT *</label>
                  <input
                    className="input font-mono"
                    required
                    value={rut}
                    onChange={(e) => setRut(formatRut(e.target.value))}
                    placeholder="12.345.678-K"
                  />
                </div>
                <div>
                  <label className="label">Nombre Completo *</label>
                  <input
                    className="input"
                    required
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    placeholder="Juan Pérez González"
                  />
                </div>
                <div>
                  <label className="label">Correo Electrónico *</label>
                  <input
                    type="email"
                    className="input"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tu-correo@gmail.com"
                  />
                </div>
                <div>
                  <label className="label">Teléfono WhatsApp *</label>
                  <input
                    type="tel"
                    className="input"
                    required
                    value={telefono}
                    onChange={(e) => setTelefono(e.target.value)}
                    placeholder="+56 9 1234 5678"
                  />
                </div>

                <div className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600 border border-slate-200">
                  ℹ️ Crearemos tu acceso seguro para revisar el avance de tus trámites legales y contables.
                </div>

                <button type="submit" className="btn btn-primary w-full py-2.5 font-bold">
                  Enviar Solicitud de Acompañamiento →
                </button>
              </form>
            ) : (
              <div className="space-y-4 text-center py-4">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 text-xl font-bold">
                  
                </div>
                <h4 className="font-extrabold text-navy text-lg">¡Solicitud Recibida!</h4>
                <p className="text-xs text-slate-600">
                  Hemos registrado tus trabas y meta financiera. Un asesor de bancarización te contactará a tu WhatsApp o correo (<b>{email}</b>) en las próximas 24 horas hábiles.
                </p>
                <div className="pt-2">
                  <Link href="/login" className="btn btn-primary w-full">
                    Ir al Portal de Clientes →
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
