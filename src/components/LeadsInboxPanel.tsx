"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { WebLead } from "@/app/api/v1/leads/route";

export default function LeadsInboxPanel() {
  const [leads, setLeads] = useState<WebLead[]>([]);
  const [loading, setLoading] = useState(true);

  const loadLeads = async () => {
    try {
      const res = await fetch("/api/v1/leads", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { leads?: WebLead[] };
        setLeads(data.leads || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    fetch("/api/v1/leads", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { leads: [] }))
      .then((data: { leads?: WebLead[] }) => {
        if (active) {
          setLeads(data.leads || []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleStatusChange = async (id: string, status: WebLead["status"]) => {
    try {
      const res = await fetch("/api/v1/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      if (res.ok) {
        setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status } : l)));
      }
    } catch {
      // ignore
    }
  };

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/[0.06] pb-3.5">
        <div>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Bandeja Comercial en Vivo · Web Principal
          </span>
          <h2 className="text-base font-bold text-zinc-950 tracking-tight mt-0.5">
            Solicitudes Recibidas (Créditos, Bancarización y Diagnóstico)
          </h2>
          <p className="text-xs text-zinc-500">
            Cada evaluación o compra realizada en la Web Principal llega aquí con la previsualización del problema y la solución sugerida.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadLeads()}
          className="btn btn-ghost !text-xs !py-1.5 !px-3"
        >
          Actualizar ({leads.length})
        </button>
      </div>

      {loading ? (
        <p className="text-xs text-zinc-500 py-4">Cargando solicitudes recibidas...</p>
      ) : leads.length === 0 ? (
        <div className="rounded-xl bg-[#F7F8FA] border border-black/[0.06] p-5 text-center text-xs text-zinc-600">
          Aún no hay solicitudes nuevas registradas en esta sesión. Prueba el{" "}
          <Link href="/creditos" className="font-semibold text-zinc-900 underline">
            Simulador de Créditos
          </Link>
          ,{" "}
          <Link href="/bancarizacion" className="font-semibold text-zinc-900 underline">
            Bancarización y Regularización
          </Link>{" "}
          o{" "}
          <Link href="/diagnostico" className="font-semibold text-zinc-900 underline">
            Diagnóstico al Instante
          </Link>{" "}
          para ver cómo ingresan automáticamente.
        </div>
      ) : (
        <div className="space-y-2.5">
          {leads.map((l) => (
            <div
              key={l.id}
              className="rounded-xl border border-black/[0.07] bg-[#F8F9FB] p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 text-xs transition hover:border-black/[0.13]"
            >
              <div className="space-y-1.5 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-[#141416] px-2 py-0.5 text-[10px] font-mono font-semibold text-white uppercase">
                    {l.source}
                  </span>
                  <span className="font-bold text-sm text-zinc-950">{l.name}</span>
                  {l.rut && <span className="font-mono text-zinc-500">({l.rut})</span>}
                  <span className="text-zinc-400">· {l.personType}</span>
                  <span className="text-zinc-400 font-mono">
                    · {new Date(l.createdAt).toLocaleString("es-CL")}
                  </span>
                </div>
                <p className="font-semibold text-zinc-800">{l.summary}</p>
                {l.problemPreview && (
                  <p className="text-rose-700">
                    <strong>Problema detectado:</strong> {l.problemPreview}
                  </p>
                )}
                {l.solutionPreview && (
                  <p className="text-emerald-700">
                    <strong>Alternativa / Solución sugerida:</strong> {l.solutionPreview}
                  </p>
                )}
                <div className="text-zinc-500 pt-0.5">
                  Contacto: <strong className="text-zinc-800">{l.email || "Sin correo"}</strong> · Tel:{" "}
                  <strong className="text-zinc-800">{l.phone || "Sin teléfono"}</strong>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <select
                  value={l.status}
                  onChange={(e) =>
                    void handleStatusChange(l.id, e.target.value as WebLead["status"])
                  }
                  className="input !py-1.5 !text-xs font-semibold !w-44"
                >
                  <option value="NUEVO">NUEVO (Por contactar)</option>
                  <option value="CONTACTADO">CONTACTADO</option>
                  <option value="EN_GESTION">EN GESTIÓN / PRESUPUESTO</option>
                  <option value="CERRADO">CERRADO / CONTRATADO</option>
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
