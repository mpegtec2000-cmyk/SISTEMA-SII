import { NextResponse, type NextRequest } from "next/server";
import { FinancialDataService } from "@/lib/services/financial-data";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      rut,
      montoSolicitado = 25000000,
      plazoMeses = 36,
      tipoProducto = "general",
      pieDisponible = 0,
      valorBien = 0,
      tipo = "empresa",
    } = body;

    if (!rut) {
      return NextResponse.json({ error: "El RUT es requerido para evaluar" }, { status: 400 });
    }

    // Buscamos si existe un perfil consolidado extraído por Open Finance para este RUT
    let profile = FinancialDataService.getProfileByRut(rut);

    // Si aún no se ha recibido webhook o estamos en Sandbox, generamos perfil instantáneo
    if (!profile) {
      profile = FinancialDataService.generateSandboxProfile(rut, tipo);
      FinancialDataService.saveProfile(profile);
    }

    const evaluation = FinancialDataService.calculateGap({
      profile,
      montoSolicitado: Number(montoSolicitado),
      plazoMeses: Number(plazoMeses),
      tipoProducto,
      pieDisponible: Number(pieDisponible),
      valorBien: Number(valorBien),
    });

    return NextResponse.json({
      success: true,
      evaluation,
      profileConsolidated: {
        rut: profile.rut,
        nombreRazonSocial: profile.nombreRazonSocial,
        tipo: profile.tipo,
        provider: profile.provider,
        fechaConsulta: profile.fechaConsulta,
        sii: profile.sii,
        cmf: profile.cmf,
        dicom: profile.dicom,
        previred: profile.previred,
      },
    });
  } catch (error: unknown) {
    const details = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json(
      { error: "Error al calcular evaluación y brecha crediticia", details },
      { status: 500 }
    );
  }
}
