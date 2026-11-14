import Link from "next/link";
import { getSession } from "@/lib/auth";
import { logoutAction } from "@/app/actions";

export default async function SiteHeader() {
  const user = await getSession();
  return (
    <header className="sticky top-0 z-20 border-b border-black/[0.06] bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-lg bg-[#141416] text-white flex items-center justify-center shadow-xs group-hover:scale-105 transition-transform">
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" aria-hidden="true">
              <path d="M4 4h7v7H4V4zm9 0l7 7h-7V4zM4 13h7v7l-7-7zm9 0h7v7h-7v-7z" />
            </svg>
          </div>
          <span className="text-base font-extrabold tracking-tight text-zinc-950">
            FINANZ<span className="text-emerald-600">IA</span>
          </span>
        </Link>

        <nav className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs sm:text-[13px] font-medium text-zinc-600">
          <Link
            href="/personas"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F4F5F7] hover:bg-zinc-200/70 text-zinc-900 font-semibold border border-black/[0.07] transition"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Portal Personas
          </Link>
          <a
            href="/erp"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#141416] hover:bg-zinc-800 text-white font-semibold shadow-xs transition"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
            ERP Empresas
          </a>
          <Link href="/creditos" className="px-2 py-1 rounded-lg hover:bg-black/[0.04] hover:text-zinc-950 transition">
            Simulador Créditos
          </Link>
          <Link href="/bancarizacion" className="px-2 py-1 rounded-lg hover:bg-black/[0.04] hover:text-zinc-950 transition">
            Bancarización
          </Link>
          <Link href="/diagnostico" className="px-2 py-1 rounded-lg hover:bg-black/[0.04] hover:text-zinc-950 transition">
            Diagnóstico
          </Link>
          <Link href="/planes" className="px-2 py-1 rounded-lg hover:bg-black/[0.04] hover:text-zinc-950 transition">
            Planes y Packs
          </Link>
          {user ? (
            <>
              <Link href="/dashboard" className="btn btn-primary !py-1.5 !px-3.5 !text-xs">
                Mi Panel
              </Link>
              <form action={logoutAction}>
                <button className="text-zinc-500 hover:text-rose-600 text-xs font-semibold px-1.5 cursor-pointer">
                  Salir
                </button>
              </form>
            </>
          ) : (
            <Link href="/login" className="btn btn-ghost !py-1.5 !px-3.5 !text-xs">
              Ingresar
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
