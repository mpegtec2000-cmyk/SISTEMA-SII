import Link from "next/link";
import { getSession, ROLE_LABEL, type Role } from "@/lib/auth";
import { logoutAction } from "@/app/actions";
import LeadsInboxPanel from "@/components/LeadsInboxPanel";
import {
  Home,
  Activity,
  Target,
  Briefcase,
  Settings,
  SlidersHorizontal,
  Archive,
  CircleDot,
  CheckCircle2,
  Plus,
  Sparkles,
  Percent,
  ArrowUpRight,
  LogOut,
  ShieldCheck,
  Layers,
} from "lucide-react";

const PANELES: Record<Role, { title: string; desc: string; href: string; badge: string; external?: boolean }[]> = {
  PERSONA: [
    { title: "Portal Personas (Salud & Blindaje)", desc: "Metas patrimoniales, semáforo anti-DICOM, academia e inversión en OC.", href: "/personas", badge: "5 Módulos" },
    { title: "Bancarización y Regularización", desc: "Evalúa tu situación, detecta trabas y sigue tu ruta de salida formal.", href: "/bancarizacion", badge: "Ruta 5 Pasos" },
    { title: "Simulador de Créditos & Brechas", desc: "Simula capacidad crediticia con vehículos, hipotecas o libre disponibilidad.", href: "/creditos", badge: "Open Finance" },
    { title: "Diagnóstico al Instante", desc: "Chequeo financiero inmediato con informe PDF.", href: "/diagnostico", badge: "PDF Oficial" },
  ],
  EMPRESA: [
    { title: "ERP Comercial y Operativo (Panel General)", desc: "Acceso completo a licitaciones Mercado Público, ventas privadas, stock y finanzas.", href: "/erp", badge: "ERP 360°", external: true },
    { title: "Gestión Mensual & SII (RCV / F29)", desc: "Sincronización de compras/ventas SII, proyección F29 y emisión DTE.", href: "/erp?tab=sii", badge: "SII en Línea", external: true },
    { title: "Negocios, Licitaciones & Asistente IA", desc: "Carpetas de negocio con análisis IA de bases técnicas y administrativas.", href: "/erp?tab=folders", badge: "IA Activa", external: true },
    { title: "Bancos & Conciliación Fintoc", desc: "Cartolas bancarias en línea, conciliación en 1 clic y control de vencimientos.", href: "/erp?tab=banking", badge: "Conciliación", external: true },
    { title: "Bóveda Legal y Multi-Empresa", desc: "Resguardo encriptado de antecedentes legales, laborales y configuración SII.", href: "/erp?tab=companies", badge: "Multi-RUT", external: true },
    { title: "Simulador de Créditos & Diagnóstico", desc: "Evaluador comercial, FOGAPE, leasing y líneas con análisis de brecha.", href: "/creditos", badge: "Gap Analysis" },
  ],
  STAFF: [
    { title: "ERP Multi-Empresa (Cartera Clientes)", desc: "Operación contable, tributaria (SII) y comercial de empresas asignadas.", href: "/erp?tab=companies", badge: "Cartera", external: true },
    { title: "Cierre Mensual SII & Optimización F29", desc: "Revisión de RCV, proyección de IVA/PPM y documentos tributarios.", href: "/erp?tab=sii", badge: "Tributario", external: true },
    { title: "Pipeline Comercial & Cotizaciones", desc: "Seguimiento de propuestas, alertas de vencimiento y conversión.", href: "/erp?tab=pipeline", badge: "Pipeline", external: true },
    { title: "Evaluaciones y Créditos", desc: "Revisión de simulaciones y estructuración de carpetas de clientes.", href: "/creditos", badge: "Comité" },
    { title: "Casos de Bancarización", desc: "Gestión de planes de regularización previsional y comercial.", href: "/bancarizacion", badge: "Casos" },
  ],
  ADMIN: [
    { title: "Sistema ERP Maestro (Multi-Tenant)", desc: "Control total de empresas, facturación SII, licitaciones, bancos y stock.", href: "/erp", badge: "Master ERP", external: true },
    { title: "Usuarios y Permisos por Empresa", desc: "Administración de accesos, roles y empresas habilitadas en la plataforma.", href: "/erp?tab=users", badge: "RBAC", external: true },
    { title: "Clientes & Empresas Registradas", desc: "Configuración de RUTs, certificados digitales, SII, Fintoc y bóveda legal.", href: "/erp?tab=companies", badge: "3 Empresas", external: true },
    { title: "Portal Personas (Vista Completa)", desc: "Supervisión de módulos de metas, blindaje anti-DICOM e inversiones en OC.", href: "/personas", badge: "B2C Suite" },
    { title: "Catálogo de Planes y Cobros", desc: "Administración de suscripciones mensuales, packs y comisiones.", href: "/planes", badge: "Pricing" },
    { title: "Embudo de Créditos & Gap Analysis", desc: "Monitoreo global de simulaciones y solicitudes de financiamiento.", href: "/creditos", badge: "Simulador" },
  ],
};

export default async function Dashboard() {
  const user = (await getSession())!;
  const items = PANELES[user.role];

  return (
    <div className="min-h-screen bg-[#EAECEF] text-zinc-950 p-1.5 sm:p-2.5 flex flex-col font-sans">
      <div className="saas-framed-shell flex-1 flex p-1.5 sm:p-2 gap-1.5 sm:gap-2 max-w-[1800px] w-full mx-auto min-h-[calc(100vh-20px)]">
        {/* 1. RIEL PRIMARIO OSCURO DE ÍCONOS (DARK CAPSULE DOCK) */}
        <nav
          className="saas-dark-rail hidden sm:flex w-[54px] shrink-0 flex-col items-center justify-between py-4 px-2 select-none"
          aria-label="Ecosistema FINANZIA"
        >
          <div className="flex flex-col items-center space-y-5">
            <Link
              href="/"
              className="w-9 h-9 rounded-xl flex items-center justify-center text-white hover:scale-105 transition-transform"
              title="FINANZIA · Web Principal"
            >
              <svg viewBox="0 0 24 24" className="w-6 h-6 fill-current" aria-hidden="true">
                <path d="M4 4h7v7H4V4zm9 0l7 7h-7V4zM4 13h7v7l-7-7zm9 0h7v7h-7v-7z" />
              </svg>
            </Link>

            <div className="flex flex-col items-center space-y-2">
              <Link href="/" className="saas-rail-icon" title="Sitio Principal">
                <Home className="w-[18px] h-[18px]" />
              </Link>
              <Link href="/creditos" className="saas-rail-icon" title="Simulador de Créditos">
                <Activity className="w-[18px] h-[18px]" />
              </Link>
              <Link
                href="/dashboard"
                className="saas-rail-icon saas-rail-icon-active"
                title="Opportunities & Panel Central"
              >
                <Target className="w-[18px] h-[18px]" />
              </Link>
              <a href="/erp" className="saas-rail-icon" title="Sistema ERP Empresas">
                <Briefcase className="w-[18px] h-[18px]" />
              </a>
              <Link href="/personas" className="saas-rail-icon" title="Portal Personas">
                <ShieldCheck className="w-[18px] h-[18px]" />
              </Link>
            </div>
          </div>

          <div className="flex flex-col items-center space-y-2">
            <Link href="/planes" className="saas-rail-icon" title="Planes y Configuración">
              <Settings className="w-[18px] h-[18px]" />
            </Link>
            <form action={logoutAction}>
              <button type="submit" className="saas-rail-icon cursor-pointer" title="Cerrar Sesión">
                <LogOut className="w-[18px] h-[18px]" />
              </button>
            </form>
          </div>
        </nav>

        {/* 2. BARRA LATERAL CONTEXTUAL SECUNDARIA (SUB-SIDEBAR LIGHT) */}
        <aside className="hidden lg:flex w-64 flex-col justify-between px-2.5 py-3 shrink-0 select-none">
          <div className="space-y-5">
            {/* Encabezado Opportunities */}
            <div className="px-2.5 pt-1 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-[16px] text-zinc-900 tracking-tight leading-tight">
                  Opportunities
                </h2>
                <p className="text-[11px] text-zinc-400 font-medium mt-0.5">
                  {ROLE_LABEL[user.role]}
                </p>
              </div>
              <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md bg-zinc-200/70 text-zinc-700 border border-black/[0.05]">
                PRO
              </span>
            </div>

            {/* Filtro Principal: All / Archived */}
            <nav className="space-y-1">
              <a
                href="#modulos-activos"
                className="w-full flex items-center justify-between saas-nav-item saas-nav-item-active"
              >
                <div className="flex items-center gap-2.5">
                  <SlidersHorizontal className="w-4 h-4 text-zinc-900" />
                  <span>All</span>
                </div>
                <span className="text-xs font-mono tabular-nums text-zinc-500 font-semibold">
                  {items.length}
                </span>
              </a>

              <a
                href="#bandeja-leads"
                className="w-full flex items-center justify-between saas-nav-item"
              >
                <div className="flex items-center gap-2.5">
                  <Archive className="w-4 h-4 text-zinc-500" />
                  <span>Archived</span>
                </div>
                <span className="text-xs font-mono tabular-nums text-zinc-400 font-medium">
                  0
                </span>
              </a>
            </nav>

            <div className="h-px bg-black/[0.06] mx-2" />

            {/* Sección Status */}
            <div>
              <p className="px-2.5 mb-2 text-[11px] font-medium text-zinc-400 tracking-tight">
                Status
              </p>
              <nav className="space-y-1">
                <a
                  href="#bandeja-leads"
                  className="w-full flex items-center justify-between saas-nav-item"
                >
                  <div className="flex items-center gap-2.5">
                    <CircleDot className="w-4 h-4 text-zinc-500" />
                    <span>New</span>
                  </div>
                  <span className="text-xs font-mono tabular-nums text-zinc-400 font-medium">
                    5
                  </span>
                </a>

                <a
                  href="/erp?tab=pipeline"
                  className="w-full flex items-center justify-between saas-nav-item"
                >
                  <div className="flex items-center gap-2.5">
                    <Layers className="w-4 h-4 text-zinc-500" />
                    <span>Open</span>
                  </div>
                  <span className="text-xs font-mono tabular-nums text-zinc-400 font-medium">
                    2
                  </span>
                </a>

                <a
                  href="/erp?tab=sii"
                  className="w-full flex items-center justify-between saas-nav-item"
                >
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-zinc-500" />
                    <span>Solved</span>
                  </div>
                  <span className="text-xs font-mono tabular-nums text-zinc-400 font-medium">
                    1
                  </span>
                </a>

                <Link
                  href="/diagnostico"
                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-[12.5px] font-medium text-zinc-400 hover:text-zinc-800 transition-colors rounded-lg"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Status</span>
                </Link>
              </nav>
            </div>

            <div className="h-px bg-black/[0.06] mx-2" />

            {/* Sección Group */}
            <div>
              <p className="px-2.5 mb-2 text-[11px] font-medium text-zinc-400 tracking-tight">
                Group
              </p>
              <nav className="space-y-1">
                <a
                  href="/erp"
                  className="w-full flex items-center justify-between saas-nav-item"
                >
                  <div className="flex items-center gap-2.5">
                    <Target className="w-4 h-4 text-zinc-500" />
                    <span>ERP Comercial</span>
                  </div>
                  <span className="text-xs font-mono tabular-nums text-zinc-400 font-medium">
                    3
                  </span>
                </a>

                <Link
                  href="/creditos"
                  className="w-full flex items-center justify-between saas-nav-item"
                >
                  <div className="flex items-center gap-2.5">
                    <Percent className="w-4 h-4 text-zinc-500" />
                    <span>Sales & Créditos</span>
                  </div>
                  <span className="text-xs font-mono tabular-nums text-zinc-400 font-medium">
                    1
                  </span>
                </Link>

                <Link
                  href="/personas"
                  className="w-full flex items-center justify-between saas-nav-item"
                >
                  <div className="flex items-center gap-2.5">
                    <Sparkles className="w-4 h-4 text-zinc-500" />
                    <span>Portal Personas</span>
                  </div>
                  <span className="text-xs font-mono tabular-nums text-zinc-400 font-medium">
                    4
                  </span>
                </Link>

                <Link
                  href="/planes"
                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-[12.5px] font-medium text-zinc-400 hover:text-zinc-800 transition-colors rounded-lg"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Group</span>
                </Link>
              </nav>
            </div>
          </div>

          {/* Usuario Activo */}
          <div className="pt-3 mt-3 border-t border-black/[0.06] space-y-2">
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-white border border-black/[0.07] shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-[#141416] text-white flex items-center justify-center font-bold text-xs shrink-0">
                  {user.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="truncate">
                  <p className="text-xs font-semibold text-zinc-900 truncate">{user.name}</p>
                  <p className="text-[10px] text-zinc-500 font-mono truncate">{user.email}</p>
                </div>
              </div>
              <form action={logoutAction}>
                <button
                  type="submit"
                  className="text-[11px] font-medium text-zinc-400 hover:text-rose-600 px-1.5 py-1 rounded transition cursor-pointer"
                >
                  Salir
                </button>
              </form>
            </div>
          </div>
        </aside>

        {/* 3. LIENZO PRINCIPAL BLANCO ELEVADO (MAIN ELEVATED CANVAS) */}
        <main className="saas-elevated-canvas flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* Topbar Ejecutiva */}
          <header className="h-14 border-b border-black/[0.06] bg-white/95 backdrop-blur px-6 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-700 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {ROLE_LABEL[user.role]}
              </span>
              <span className="text-zinc-300 hidden sm:inline">·</span>
              <span className="text-xs text-zinc-500 font-medium hidden sm:inline">
                Centro de Comando SaaS & ERP
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Link href="/" className="btn btn-ghost !py-1.5 !px-3 !text-xs">
                Web Principal
              </Link>
              <Link href="/personas" className="btn btn-ghost !py-1.5 !px-3 !text-xs">
                Portal Personas →
              </Link>
              <a href="/erp" className="btn btn-primary !py-1.5 !px-3.5 !text-xs">
                Abrir ERP Empresa →
              </a>
            </div>
          </header>

          {/* Contenido Principal Scrollable */}
          <div className="flex-1 overflow-y-auto p-6 sm:p-8 space-y-8">
            <div id="modulos-activos" className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Workspace Ejecutivo
                </p>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-zinc-950 tracking-tight mt-0.5">
                  Hola, {user.name}
                </h1>
              </div>
              <div className="flex items-center gap-2 text-xs text-zinc-500 font-mono">
                <span>{items.length} sistemas habilitados</span>
              </div>
            </div>

            {/* Tarjetas de Sistemas (Bento Grid con Bordes Refinados) */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((p) => {
                const body = (
                  <div className="flex flex-col justify-between h-full">
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-mono font-medium bg-[#F4F5F7] text-zinc-700 border border-black/[0.06]">
                          {p.badge}
                        </span>
                        <ArrowUpRight className="w-4 h-4 text-zinc-400 group-hover:text-zinc-900 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                      </div>
                      <h3 className="font-bold text-base text-zinc-950 tracking-tight">
                        {p.title}
                      </h3>
                      <p className="mt-1.5 text-xs text-zinc-500 leading-relaxed">
                        {p.desc}
                      </p>
                    </div>
                    <div className="mt-5 pt-3 border-t border-black/[0.05] flex items-center justify-between text-xs font-semibold text-zinc-900">
                      <span>Acceder al módulo</span>
                      <span className="text-zinc-400 group-hover:text-zinc-900 transition-colors">
                        →
                      </span>
                    </div>
                  </div>
                );
                return p.external ? (
                  <a
                    key={p.title}
                    href={p.href}
                    className="group card !p-5 hover:-translate-y-0.5 hover:shadow-md"
                  >
                    {body}
                  </a>
                ) : (
                  <Link
                    key={p.title}
                    href={p.href}
                    className="group card !p-5 hover:-translate-y-0.5 hover:shadow-md"
                  >
                    {body}
                  </Link>
                );
              })}
            </div>

            {/* Bandeja Comercial de Solicitudes */}
            <div id="bandeja-leads">
              <LeadsInboxPanel />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
