import { NextResponse, type NextRequest } from "next/server";
import { FinancialDataService } from "@/lib/services/financial-data";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { rut, tipo = "empresa", callbackUrl, products } = body;

    if (!rut) {
      return NextResponse.json({ error: "El RUT es requerido" }, { status: 400 });
    }

    const session = await FinancialDataService.createSession({
      rut,
      tipo,
      callbackUrl,
      products,
    });

    return NextResponse.json(session);
  } catch (error: unknown) {
    const details = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json(
      { error: "Error al inicializar sesión con Open Finance", details },
      { status: 500 }
    );
  }
}
