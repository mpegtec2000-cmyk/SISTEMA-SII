export type Plan = {
  id: string;
  name: string;
  tagline: string;
  priceCLP: number | null; // null = por definir
  features: string[];
  highlight?: boolean;
};

export const BASE_MENSUAL = [
  "Cierre mensual ante SII (F29, registro de compras y ventas)",
  "Previred, liquidaciones de sueldo, contratos, finiquitos y anexos",
  "Consultas jurídicas mensuales incluidas",
  "2 reuniones mensuales (1 sesión con abogado y 1 sesión con contador)",
  "Dashboard de crecimiento, proyección de flujo y Bots 24/7 (Acceso limitado a nuestro portal)",
  "Capacitación inicial en Mercado Público",
];

export const PLANES_MENSUALES: Plan[] = [
  {
    id: "mensual-app",
    name: "Plan Mensual Solo App (SaaS)",
    tagline: "Autoservicio, software y monitoreo continuo para tu empresa",
    priceCLP: 49900,
    features: [
      "Acceso continuo a la plataforma web y herramientas digitales operativas",
      "1 Informe Mensual Automatizado Gratuito (diagnóstico de salud financiera y tributaria)",
      "Monitoreo continuo de indicadores clave y flujo",
      "Asistentes virtuales con roles preconfigurados 24/7",
    ],
  },
  {
    id: "mensual-basico",
    name: "Plan Mensual Básico",
    tagline: "Gestión contable, laboral y legal al día",
    priceCLP: 149900,
    features: BASE_MENSUAL,
  },
  {
    id: "mensual-avanzado",
    name: "Plan Mensual Avanzado",
    tagline: "Todo el Básico, más presencia y ventas online",
    priceCLP: 289900,
    highlight: true,
    features: [
      "Todo lo del Plan Mensual Básico",
      "Uso ilimitado de nuestro portal",
      "Capacitación avanzada en Mercado Público",
      "Asesoría mensual en Mercado Público",
      "Capacitación en páginas web y campañas digitales (Google Ads, Meta Ads)",
      "Sitio web con carrito de compras (e-commerce)",
      "Captación continua de clientes (Google Ads, Meta Ads)",
    ],
  },
];

export const PACK1_BASE = [
  "Constitución de sociedad y redacción de estatutos",
  "Inicio de actividades en SII y acreditación de domicilio",
  "Activación de facturación electrónica",
  "Gestión de documentación legal inicial",
  "Capacitación \"Tu Primer Año\"",
  "2 reuniones 1 a 1 (abogado y contador)",
  "Uso exclusivo de nuestra app por un mes",
  "Capacitación básica en Mercado Público",
];

export const PACKS: Plan[] = [
  {
    id: "pack1-basico",
    name: "Pack 1 Básico · Inicio y Constitución",
    tagline: "Parte formal con tu empresa y página informativa",
    priceCLP: 249900,
    features: [...PACK1_BASE, "Página web informativa / corporativa"],
  },
  {
    id: "pack1-avanzado",
    name: "Pack 1 Avanzado · Inicio y Constitución",
    tagline: "Constitución más tienda online",
    priceCLP: 399900,
    features: [...PACK1_BASE, "Página web con carrito de compras (e-commerce)"],
  },
  {
    id: "pack2",
    name: "Pack 2 · Aceleración y Diagnóstico Integral",
    tagline: "Auditoría profunda y crecimiento acelerado",
    priceCLP: 499900,
    highlight: true,
    features: [
      "Auditoría financiera, tributaria, contable y operativa con entrega de información y proyección",
      "Suite de herramientas y apps avanzadas",
      "Capacitación avanzada en Mercado Público",
      "Asesoría mensual en Mercado Público",
      "Sitio web con carrito de compras",
      "Campaña de captación vía Ads durante el primer mes",
      "Mes de prueba gratuito en la plataforma (1 reunión con abogado y 1 con contador)",
    ],
  },
];

export const SERVICIOS = [
  { href: "/creditos", title: "Simulador de Créditos & Brechas", desc: "Herramienta pública gratuita: evaluador inteligente con análisis de brecha para líneas comerciales, hipotecarios y automotriz." },
  { href: "/bancarizacion", title: "Bancarización y Regularización", desc: "Herramienta pública gratuita: diagnóstico y ruta paso a paso para personas y empresas fuera del sistema formal." },
  { href: "/diagnostico", title: "Diagnóstico al Instante", desc: "Auditoría financiera, bancaria, contable y operativa con pasarela de pago y entrega en PDF." },
  { href: "/planes", title: "Planes y Packs", desc: "Suscripción mensual y packs para constituir y acelerar tu PyME." },
];
