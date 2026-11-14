import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { FinancialDataService, type ConsolidatedFinancialProfile } from "@/lib/services/financial-data";

function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.OPEN_FINANCE_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return false;
  const cleanSig = signatureHeader.replace(/^sha256=/i, "").trim();
  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const sigBuf = Buffer.from(cleanSig, "utf8");
  const expBuf = Buffer.from(expected, "utf8");
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const payload = JSON.parse(rawBody);

    // Verificación criptográfica HMAC-SHA256 del webhook en producción
    const signature = req.headers.get("x-provider-signature") || req.headers.get("x-floid-signature");
    if (process.env.OPEN_FINANCE_SANDBOX === "false" && !verifyWebhookSignature(rawBody, signature)) {
      return NextResponse.json({ error: "Firma del webhook ausente o inválida" }, { status: 401 });
    }

    // Normalización de payload (soporte agnóstico para Floid, Fintoc o Payload Directo Sandbox)
    let profile: ConsolidatedFinancialProfile;

    if (payload.rut && payload.sii && payload.cmf) {
      // Payload ya estructurado
      profile = payload as ConsolidatedFinancialProfile;
    } else {
      // Adaptación de payload recibido del proveedor por RUT
      const rut = payload.rut || payload.taxpayer_id || payload.customer_id;
      if (!rut) {
        return NextResponse.json({ error: "Payload no contiene identificador RUT válido" }, { status: 422 });
      }

      profile = FinancialDataService.generateSandboxProfile(rut, payload.type || "empresa");

      // Si el webhook trae datos específicos de SII o CMF, sobreescribimos
      if (payload.sii) profile.sii = { ...profile.sii, ...payload.sii };
      if (payload.cmf) profile.cmf = { ...profile.cmf, ...payload.cmf };
      if (payload.dicom) profile.dicom = { ...profile.dicom, ...payload.dicom };
      if (payload.previred) profile.previred = { ...profile.previred, ...payload.previred };
    }

    FinancialDataService.saveProfile(profile);

    return NextResponse.json({
      received: true,
      rut: profile.rut,
      sessionId: profile.sessionId,
      status: "processed",
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const details = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json(
      { error: "Error procesando webhook de datos financieros", details },
      { status: 500 }
    );
  }
}
