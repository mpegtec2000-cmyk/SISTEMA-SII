import Link from "next/link";
import { Check } from "lucide-react";
import { PACKS, PLANES_MENSUALES, type Plan } from "@/lib/catalog";

function PlanCard({ p }: { p: Plan }) {
  return (
    <div
      className={`card flex flex-col justify-between ${
        p.highlight
          ? "!border-zinc-900 ring-1 ring-zinc-900/10 shadow-md"
          : ""
      }`}
    >
      <div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-lg font-bold text-zinc-950 tracking-tight">{p.name}</h3>
          {p.highlight && (
            <span className="px-2 py-0.5 rounded-md bg-[#141416] text-white text-[10px] font-mono font-semibold uppercase">
              Recomendado
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-zinc-500">{p.tagline}</p>
        <p className="mt-4 text-xl font-extrabold font-mono tabular-nums text-zinc-950">
          {p.priceCLP ? `$${p.priceCLP.toLocaleString("es-CL")}` : "Precio a cotizar"}
        </p>
        <ul className="mt-4 space-y-2 text-xs text-zinc-700 border-t border-black/[0.06] pt-4">
          {p.features.map((f) => (
            <li key={f} className="flex items-start gap-2">
              <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </div>
      <Link href="/login?next=/dashboard" className="btn btn-primary mt-6 w-full">
        Contratar Plan
      </Link>
    </div>
  );
}

export default function Planes() {
  return (
    <main className="mx-auto max-w-6xl px-4 pt-10 pb-16">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Suscripciones & Servicios
        </p>
        <h1 className="text-3xl font-extrabold text-zinc-950 tracking-tight mt-0.5">
          Planes y Packs Empresariales
        </h1>
      </div>
      <h2 className="mt-8 text-base font-bold text-zinc-900">
        Suscripción mensual para Empresas y PyMEs
      </h2>
      <div className="mt-4 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {PLANES_MENSUALES.map((p) => (
          <PlanCard key={p.id} p={p} />
        ))}
      </div>
      <h2 className="mt-12 text-base font-bold text-zinc-900">
        Packs empresariales (Inicio & Aceleración)
      </h2>
      <div className="mt-4 grid gap-5 lg:grid-cols-3">
        {PACKS.map((p) => (
          <PlanCard key={p.id} p={p} />
        ))}
      </div>
    </main>
  );
}
