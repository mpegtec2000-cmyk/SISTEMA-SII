import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

export type WebLead = {
  id: string;
  createdAt: string;
  source: "CREDITOS" | "BANCARIZACION" | "DIAGNOSTICO" | "PLANES";
  personType: string;
  name: string;
  rut: string;
  email: string;
  phone: string;
  summary: string;
  problemPreview?: string;
  solutionPreview?: string;
  amountCLP?: number;
  status: "NUEVO" | "CONTACTADO" | "EN_GESTION" | "CERRADO";
  payload?: Record<string, unknown>;
};

const DATA_DIR = path.join(process.cwd(), "erp-empresa", "data");
const LEADS_FILE = path.join(DATA_DIR, "web_leads.json");

function readLeads(): WebLead[] {
  try {
    if (!fs.existsSync(LEADS_FILE)) {
      return [];
    }
    const raw = fs.readFileSync(LEADS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLeads(leads: WebLead[]): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2), "utf-8");
}

export async function GET() {
  const leads = readLeads();
  return NextResponse.json({
    ok: true,
    total: leads.length,
    leads,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<WebLead>;
    const leads = readLeads();

    const newLead: WebLead = {
      id: `LEAD-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
      createdAt: new Date().toISOString(),
      source: body.source || "BANCARIZACION",
      personType: String(body.personType || "Persona / PyME"),
      name: String(body.name || "Solicitante Web").trim(),
      rut: String(body.rut || "").trim(),
      email: String(body.email || "").trim(),
      phone: String(body.phone || "").trim(),
      summary: String(body.summary || "Solicitud desde portal web FINANZIA").trim(),
      problemPreview: body.problemPreview ? String(body.problemPreview) : undefined,
      solutionPreview: body.solutionPreview ? String(body.solutionPreview) : undefined,
      amountCLP: typeof body.amountCLP === "number" ? body.amountCLP : undefined,
      status: "NUEVO",
      payload: body.payload || {},
    };

    leads.unshift(newLead);
    writeLeads(leads);

    return NextResponse.json({
      ok: true,
      lead: newLead,
      message: "Solicitud registrada exitosamente en la bandeja comercial de FINANZIA.",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error procesando solicitud";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as { id?: string; status?: WebLead["status"] };
    if (!body.id || !body.status) {
      return NextResponse.json({ ok: false, error: "ID y estado requeridos" }, { status: 400 });
    }
    const leads = readLeads();
    const idx = leads.findIndex((l) => l.id === body.id);
    if (idx === -1) {
      return NextResponse.json({ ok: false, error: "Solicitud no encontrada" }, { status: 404 });
    }
    leads[idx].status = body.status;
    writeLeads(leads);
    return NextResponse.json({ ok: true, lead: leads[idx] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error actualizando solicitud";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
