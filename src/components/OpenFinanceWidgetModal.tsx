"use client";

import { useState } from "react";
import type { ConsolidatedFinancialProfile } from "@/lib/services/financial-data";

interface OpenFinanceWidgetModalProps {
  rut: string;
  tipo?: "persona" | "empresa";
  onSuccess: (profile: ConsolidatedFinancialProfile) => void;
  onClose: () => void;
}

export default function OpenFinanceWidgetModal({
  rut,
  tipo = "empresa",
  onSuccess,
  onClose,
}: OpenFinanceWidgetModalProps) {
  const [paso, setPaso] = useState<"auth" | "sincronizando" | "exito">("auth");
  const [metodo, setMetodo] = useState<"claveunica" | "sii">("sii");
  const [clave, setClave] = useState("••••••••");
  const [progresoTexto, setProgresoTexto] = useState("Conectando con Servicio de Impuestos Internos (SII)...");

  const handleAutorizar = async () => {
    setPaso("sincronizando");
    setProgresoTexto("Consultando declaraciones de impuestos F29 en SII...");

    try {
      // 1. Inicializar sesión
      await fetch("/api/v1/integrations/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rut, tipo, products: ["sii", "cmf", "dicom", "previred"] }),
      });

      // Simulación de pasos de extracción
      setTimeout(() => {
        setProgresoTexto("Consultando deudas consolidadas en CMF...");
      }, 1000);

      setTimeout(() => {
        setProgresoTexto("Obteniendo scoring y antecedentes comerciales...");
      }, 2000);

      setTimeout(async () => {
        // 2. Disparar webhook simulado para persistir en backend
        const resWebhook = await fetch("/api/v1/webhooks/financial-data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rut, type: tipo }),
        });
        await resWebhook.json();

        // 3. Evaluar brecha consolidada
        const resGap = await fetch("/api/v1/evaluation/calculate-gap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rut, tipo }),
        });
        const gapData = await resGap.json();

        setPaso("exito");
        setTimeout(() => {
          onSuccess(gapData.profileConsolidated);
          onClose();
        }, 1200);
      }, 3000);
    } catch (err) {
      alert("Error en la conexión Open Finance. Intenta nuevamente.");
      setPaso("auth");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="card max-w-lg w-full overflow-hidden shadow-2xl border-slate-300 p-0">
        {/* Cabecera del Widget */}
        <div className="bg-navy px-6 py-4 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-white font-extrabold text-xs">
              OF
            </span>
            <div>
              <h3 className="font-bold text-sm tracking-wide">Open Finance Hub · FINANZIA</h3>
              <p className="text-[11px] text-slate-300">Conexión Segura vía Floid / Fintoc B2B</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-300 hover:text-white text-lg font-bold">
            
          </button>
        </div>

        {/* Contenido */}
        <div className="p-6 space-y-5">
          {paso === "auth" && (
            <>
              <div className="text-center space-y-1">
                <span className="inline-block rounded-full bg-blue-100 px-3 py-0.5 text-[11px] font-bold text-blue-800">
                  Cumplimiento Ley de Protección de Datos Personales
                </span>
                <h4 className="text-base font-extrabold text-navy pt-1">
                  Autorización de Consulta Financiera & Tributaria
                </h4>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Para calcular tus brechas automáticamente con tu RUT <b>{rut || "sin especificar"}</b>, autoriza la lectura de antecedentes oficiales.
                </p>
              </div>

              {/* Selector de Credencial */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setMetodo("sii")}
                  className={`p-3 rounded-xl border text-left transition ${
                    metodo === "sii"
                      ? "border-brand bg-brand/5 ring-2 ring-brand/20"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <p className="text-xs font-bold text-navy">Clave Tributaria SII</p>
                  <p className="text-[10px] text-slate-500">F29, ventas y situación tributaria</p>
                </button>

                <button
                  type="button"
                  onClick={() => setMetodo("claveunica")}
                  className={`p-3 rounded-xl border text-left transition ${
                    metodo === "claveunica"
                      ? "border-brand bg-brand/5 ring-2 ring-brand/20"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <p className="text-xs font-bold text-navy">ClaveÚnica del Estado</p>
                  <p className="text-[10px] text-slate-500">Deudas CMF, DICOM y Previred</p>
                </button>
              </div>

              {/* Formulario seguro */}
              <div className="rounded-xl bg-slate-50 p-4 border border-slate-200 space-y-3">
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">RUT Identificador</label>
                  <input className="input font-mono text-xs bg-white" disabled value={rut} />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">
                    {metodo === "sii" ? "Clave Secreta SII" : "Contraseña ClaveÚnica"}
                  </label>
                  <input
                    type="password"
                    className="input text-xs bg-white font-mono"
                    value={clave}
                    onChange={(e) => setClave(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-500 pt-1">
                  <span>Encriptación TLS 256-bit</span>
                  <span>•</span>
                  <span>Modo Sandbox activo</span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleAutorizar}
                className="btn btn-primary w-full py-3 text-sm font-bold shadow-sm"
              >
                Autorizar y Sincronizar en Sandbox →
              </button>
            </>
          )}

          {paso === "sincronizando" && (
            <div className="py-8 text-center space-y-4">
              <div className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-brand" />
              <div>
                <h4 className="font-extrabold text-navy text-base">Extrayendo Datos Financieros...</h4>
                <p className="text-xs text-brand font-medium mt-1 animate-pulse">{progresoTexto}</p>
              </div>
              <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
                Consolidando API SII, API CMF deudas bancarias, scoring DICOM y cotizaciones en un único payload seguro.
              </p>
            </div>
          )}

          {paso === "exito" && (
            <div className="py-6 text-center space-y-3">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 text-xl font-bold">
                
              </div>
              <h4 className="font-extrabold text-navy text-lg">¡Antecedentes Sincronizados!</h4>
              <p className="text-xs text-slate-600">
                Se autocompletaron las ventas declaradas, deudas CMF y cotizaciones en el simulador.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
