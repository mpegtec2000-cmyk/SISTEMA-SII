import Link from "next/link";
import { SERVICIOS } from "@/lib/catalog";
import { ArrowUpRight, ShieldCheck, Layers, Sparkles } from "lucide-react";

export default function Home() {
  return (
    <main className="px-3 sm:px-6 pt-4 pb-12">
      {/* Hero Enmarcado Estilo SaaS Ejecutivo */}
      <section className="mx-auto max-w-6xl rounded-[24px] bg-[#141416] text-white border border-black/[0.12] shadow-[0_12px_40px_-8px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.12)] overflow-hidden relative">
        <div className="px-6 py-16 sm:px-12 sm:py-22 relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.08] border border-white/[0.12] text-xs font-medium text-zinc-200 mb-5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>Plataforma SaaS & ERP Unificada · PyMEs y Personas</span>
          </div>
          <h1 className="max-w-3xl text-3xl sm:text-5xl font-extrabold leading-[1.1] tracking-tight text-white">
            Finanzas, contabilidad SII, licitaciones, bancarización y créditos en un solo sistema.
          </h1>
          <p className="mt-5 max-w-2xl text-base sm:text-lg text-zinc-400 leading-relaxed">
            Simulador inteligente de créditos con análisis de brechas, diagnóstico financiero e integración ERP Comercial con Mercado Público y RCV.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/personas"
              className="inline-flex items-center gap-2 rounded-xl bg-white hover:bg-zinc-100 text-zinc-950 px-5 py-3 text-sm font-bold shadow-md transition-all hover:-translate-y-0.5"
            >
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Portal Personas →</span>
            </Link>
            <a
              href="/erp"
              className="inline-flex items-center gap-2 rounded-xl bg-white/[0.12] hover:bg-white/[0.18] text-white border border-white/[0.16] px-5 py-3 text-sm font-semibold transition-all hover:-translate-y-0.5"
            >
              <Layers className="w-4 h-4 text-blue-400" />
              <span>ERP Empresas →</span>
            </a>
            <Link
              href="/creditos"
              className="inline-flex items-center gap-1.5 rounded-xl bg-transparent hover:bg-white/[0.07] text-zinc-300 hover:text-white border border-white/[0.12] px-4 py-3 text-sm font-medium transition"
            >
              Simulador de Créditos
            </Link>
            <Link
              href="/bancarizacion"
              className="inline-flex items-center gap-1.5 rounded-xl bg-transparent hover:bg-white/[0.07] text-zinc-300 hover:text-white border border-white/[0.12] px-4 py-3 text-sm font-medium transition"
            >
              Plan de Bancarización
            </Link>
            <Link
              href="/diagnostico"
              className="inline-flex items-center gap-1.5 rounded-xl bg-transparent hover:bg-white/[0.07] text-zinc-300 hover:text-white border border-white/[0.12] px-4 py-3 text-sm font-medium transition"
            >
              Diagnóstico al Instante
            </Link>
          </div>
        </div>
      </section>

      {/* Grid de Soluciones con Bordes Refinados */}
      <section className="mx-auto max-w-6xl pt-14">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Ecosistema Abierto
            </p>
            <h2 className="text-2xl font-extrabold text-zinc-950 tracking-tight mt-0.5">
              Herramientas Abiertas y Soluciones Integrales
            </h2>
          </div>
          <Link href="/dashboard" className="text-xs font-semibold text-zinc-600 hover:text-zinc-950">
            Ir al Panel Central →
          </Link>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {SERVICIOS.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="group card flex flex-col justify-between transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1 text-[11px] font-mono font-medium px-2.5 py-0.5 rounded-md bg-[#F4F5F7] text-zinc-700 border border-black/[0.06]">
                    <Sparkles className="w-3 h-3 text-emerald-600" />
                    Módulo Activo
                  </span>
                  <ArrowUpRight className="w-4 h-4 text-zinc-400 group-hover:text-zinc-900 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </div>
                <h3 className="mt-3 text-lg font-bold text-zinc-950 tracking-tight">
                  {s.title}
                </h3>
                <p className="mt-1.5 text-sm text-zinc-500 leading-relaxed">
                  {s.desc}
                </p>
              </div>
              <span className="mt-5 pt-3 border-t border-black/[0.05] inline-flex items-center justify-between text-xs font-semibold text-zinc-900">
                <span>Probar ahora</span>
                <span className="text-zinc-400 group-hover:text-zinc-950">→</span>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
