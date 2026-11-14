export interface SIIData {
  periodoMeses: number;
  ventasNetasUltimos12Meses: number;
  ventasPromedioMensual: number;
  f29AlDia: boolean;
  observacionesTributarias: string[];
  inicioActividadesFecha: string;
}

export interface CMFData {
  deudaDirectaVigente: number;
  deudaIndirecta: number;
  deudaMorosa: number;
  deudaCastigada: number;
  cargaFinancieraMensualEstimada: number;
  bancosAcreedores: string[];
  fechaInforme: string;
}

export interface DicomData {
  scoreRiesgo: number; // 0 a 999
  montoMorosidadesComerciales: number;
  cantidadProtestos: number;
  tieneAntecedentesComerciales: boolean;
  calificacionGeneral: "Bajo Riesgo" | "Riesgo Moderado" | "Alto Riesgo";
}

export interface PreviredData {
  rentaImponiblePromedio: number;
  lagunasUltimos24Meses: number;
  mesesContinuidadLaboral: number;
  empleadorActual: string;
  cotizacionesAlDia: boolean;
}

export interface ConsolidatedFinancialProfile {
  rut: string;
  nombreRazonSocial: string;
  tipo: "persona" | "empresa";
  provider: "floid" | "fintoc" | "sandbox";
  sessionId: string;
  fechaConsulta: string;
  sii: SIIData;
  cmf: CMFData;
  dicom: DicomData;
  previred: PreviredData;
}

// In-memory cache de perfiles para desarrollo/sandbox (en producción reemplazar con Postgres/Prisma)
const profileStore = new Map<string, ConsolidatedFinancialProfile>();

export class FinancialDataService {
  /**
   * Genera datos simulados realistas para modo Sandbox basados en el RUT
   */
  static generateSandboxProfile(rut: string, tipo: "persona" | "empresa" = "empresa"): ConsolidatedFinancialProfile {
    const isEmpresa = tipo === "empresa" || rut.startsWith("76") || rut.startsWith("77") || rut.startsWith("78");
    const ventasMensuales = isEmpresa ? 8500000 : 2400000;
    const deudaDirecta = isEmpresa ? 14000000 : 3800000;
    const cargaMensual = Math.round(deudaDirecta * 0.04);

    return {
      rut,
      nombreRazonSocial: isEmpresa ? "Comercial & Distribuidora Andina SpA" : "Carlos Ignacio Valenzuela Muñoz",
      tipo: isEmpresa ? "empresa" : "persona",
      provider:
        (process.env.OPEN_FINANCE_PROVIDER as ConsolidatedFinancialProfile["provider"] | undefined) ||
        "sandbox",
      sessionId: `sess_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      fechaConsulta: new Date().toISOString(),
      sii: {
        periodoMeses: 12,
        ventasNetasUltimos12Meses: ventasMensuales * 12,
        ventasPromedioMensual: ventasMensuales,
        f29AlDia: true,
        observacionesTributarias: [],
        inicioActividadesFecha: "2021-04-15",
      },
      cmf: {
        deudaDirectaVigente: deudaDirecta,
        deudaIndirecta: 0,
        deudaMorosa: 0,
        deudaCastigada: 0,
        cargaFinancieraMensualEstimada: cargaMensual,
        bancosAcreedores: ["Banco de Chile", "Banco Santander"],
        fechaInforme: new Date().toLocaleDateString("es-CL"),
      },
      dicom: {
        scoreRiesgo: 820,
        montoMorosidadesComerciales: 0,
        cantidadProtestos: 0,
        tieneAntecedentesComerciales: false,
        calificacionGeneral: "Bajo Riesgo",
      },
      previred: {
        rentaImponiblePromedio: isEmpresa ? 1500000 : 2100000,
        lagunasUltimos24Meses: 0,
        mesesContinuidadLaboral: 28,
        empleadorActual: isEmpresa ? "Comercial & Distribuidora Andina SpA" : "Tecnologías y Servicios Globales S.A.",
        cotizacionesAlDia: true,
      },
    };
  }

  /**
   * Inicializa sesión con el agregador Open Finance (Floid / Fintoc)
   */
  static async createSession(params: {
    rut: string;
    tipo?: "persona" | "empresa";
    callbackUrl?: string;
    products?: ("sii" | "cmf" | "dicom" | "previred")[];
  }) {
    const isSandbox = process.env.OPEN_FINANCE_SANDBOX !== "false";
    const provider = process.env.OPEN_FINANCE_PROVIDER || "floid";
    const sessionId = `widget_${provider}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // En producción aquí se consume la API oficial de Floid o Fintoc:
    // const res = await fetch(`https://api.${provider}.com/v1/widget/session`, ...)
    return {
      success: true,
      provider,
      sessionId,
      widgetUrl: isSandbox
        ? `/mock-widget?session=${sessionId}&rut=${encodeURIComponent(params.rut)}`
        : `https://connect.${provider}.com/widget?session=${sessionId}`,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  }

  /**
   * Guarda o actualiza el perfil consolidado tras recibir el webhook
   */
  static saveProfile(profile: ConsolidatedFinancialProfile) {
    profileStore.set(profile.rut.replace(/[^0-9kK]/g, "").toUpperCase(), profile);
    return profile;
  }

  /**
   * Obtiene el perfil financiero consolidado por RUT
   */
  static getProfileByRut(rut: string): ConsolidatedFinancialProfile | null {
    const clean = rut.replace(/[^0-9kK]/g, "").toUpperCase();
    return profileStore.get(clean) || null;
  }

  /**
   * Motor de Reglas: Cálculo de Capacidad de Pago y Brecha Matemática (Gap Analysis)
   */
  static calculateGap(params: {
    profile: ConsolidatedFinancialProfile;
    montoSolicitado: number;
    plazoMeses: number;
    tipoProducto: "general" | "automotriz" | "hipotecario" | "leasing";
    pieDisponible?: number;
    valorBien?: number;
  }) {
    const { profile, montoSolicitado, plazoMeses, tipoProducto, pieDisponible = 0, valorBien = 0 } = params;

    const ingresosMensuales =
      profile.tipo === "persona" ? profile.previred.rentaImponiblePromedio : profile.sii.ventasPromedioMensual;
    const cargaFinancieraActual = profile.cmf.cargaFinancieraMensualEstimada;

    let tasaMensual = 0.013;
    let cuotaEstimada = 0;
    let capacidadMaximaCuota = 0;
    const ratioMaximoCarga = profile.tipo === "persona" ? 0.28 : 0.18;

    if (tipoProducto === "hipotecario") {
      tasaMensual = 0.0042;
      const montoCredito = valorBien > 0 ? Math.max(0, valorBien - pieDisponible) : montoSolicitado;
      cuotaEstimada = Math.round((montoCredito * tasaMensual) / (1 - Math.pow(1 + tasaMensual, -plazoMeses)));
      capacidadMaximaCuota = Math.max(0, ingresosMensuales * 0.25 - cargaFinancieraActual);
    } else {
      cuotaEstimada = Math.round((montoSolicitado * tasaMensual) / (1 - Math.pow(1 + tasaMensual, -plazoMeses)));
      capacidadMaximaCuota = Math.max(0, ingresosMensuales * ratioMaximoCarga - cargaFinancieraActual);
    }

    const cargaFinancieraProyectadaPct =
      ingresosMensuales > 0
        ? Math.round(((cargaFinancieraActual + cuotaEstimada) / ingresosMensuales) * 100)
        : 100;

    const esApto = cuotaEstimada <= capacidadMaximaCuota && profile.cmf.deudaMorosa === 0 && profile.dicom.scoreRiesgo >= 600;

    let mensajeBrecha = "";
    let brechaRentaMensual = 0;
    let brechaVentasMensual = 0;

    if (!esApto) {
      const faltaCuota = Math.max(0, cuotaEstimada - capacidadMaximaCuota);
      if (profile.tipo === "persona") {
        brechaRentaMensual = Math.ceil(faltaCuota / ratioMaximoCarga);
        mensajeBrecha = `Para calificar a este financiamiento te falta demostrar $${brechaRentaMensual.toLocaleString("es-CL")} CLP adicionales de renta líquida mensual.`;
      } else {
        brechaVentasMensual = Math.ceil(faltaCuota / ratioMaximoCarga);
        mensajeBrecha = `Tu empresa requiere facturar $${brechaVentasMensual.toLocaleString("es-CL")} CLP adicionales mensuales promedio en los últimos 6 meses para ser sujeto de crédito.`;
      }
    }

    return {
      rut: profile.rut,
      nombre: profile.nombreRazonSocial,
      esApto,
      cuotaEstimada,
      capacidadMaximaCuota,
      cargaFinancieraActual,
      cargaFinancieraProyectadaPct,
      ingresosBaseUtilizados: ingresosMensuales,
      brechaRentaMensual,
      brechaVentasMensual,
      mensajeBrecha: esApto ? "Perfil calificado con cobertura holgada." : mensajeBrecha,
      antecedentesTributarios: {
        f29AlDia: profile.sii.f29AlDia,
        ventas12Meses: profile.sii.ventasNetasUltimos12Meses,
      },
      antecedentesDeuda: {
        cmfDirecta: profile.cmf.deudaDirectaVigente,
        cmfMorosa: profile.cmf.deudaMorosa,
        dicomScore: profile.dicom.scoreRiesgo,
      },
    };
  }
}
