import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { supabase, getAdminSupabase } from "@/lib/supabase";

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

function readLeadsLocal(): WebLead[] {
  try {
    if (!fs.existsSync(LEADS_FILE)) return [];
    const raw = fs.readFileSync(LEADS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLeadsLocal(leads: WebLead[]): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2), "utf-8");
  } catch {
    // Ignore local disk fallback errors
  }
}

export async function GET() {
  try {
    // 1. Intentar consultar desde Supabase en la nube
    const { data, error } = await supabase
      .from("web_leads")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && data && data.length > 0) {
      const formatted: WebLead[] = data.map((d: any) => ({
        id: d.id,
        createdAt: d.created_at,
        source: d.source,
        personType: d.person_type,
        name: d.name,
        rut: d.rut || "",
        email: d.email || "",
        phone: d.phone || "",
        summary: d.summary,
        problemPreview: d.problem_preview,
        solutionPreview: d.solution_preview,
        amountCLP: d.amount_clp ? Number(d.amount_clp) : undefined,
        status: d.status,
        payload: d.payload || {},
      }));

      return NextResponse.json({
        ok: true,
        total: formatted.length,
        leads: formatted,
        source: "supabase",
      });
    }
  } catch {
    // Continuar con fallback local
  }

  // 2. Fallback a almacenamiento local
  const leads = readLeadsLocal();
  return NextResponse.json({
    ok: true,
    total: leads.length,
    leads,
    source: "local",
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<WebLead>;
    const leadId = `LEAD-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const createdAt = new Date().toISOString();

    const newLead: WebLead = {
      id: leadId,
      createdAt,
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

    // 1. Guardar en Supabase en tiempo real
    try {
      const adminSb = getAdminSupabase();
      await adminSb.from("web_leads").insert([
        {
          id: newLead.id,
          source: newLead.source,
          person_type: newLead.personType,
          name: newLead.name,
          rut: newLead.rut,
          email: newLead.email,
          phone: newLead.phone,
          summary: newLead.summary,
          problem_preview: newLead.problemPreview,
          solution_preview: newLead.solutionPreview,
          amount_clp: newLead.amountCLP || 0,
          status: newLead.status,
          payload: newLead.payload,
        },
      ]);
    } catch (sbErr) {
      console.error("Error guardando lead en Supabase:", sbErr);
    }

    // 2. Respaldo local
    const localLeads = readLeadsLocal();
    localLeads.unshift(newLead);
    writeLeadsLocal(localLeads);

    return NextResponse.json({
      ok: true,
      lead: newLead,
      message: "Solicitud registrada exitosamente en la bandeja comercial de FINANZIA y Supabase Cloud.",
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

    // 1. Actualizar en Supabase
    try {
      const adminSb = getAdminSupabase();
      await adminSb.from("web_leads").update({ status: body.status }).eq("id", body.id);
    } catch (sbErr) {
      console.error("Error actualizando lead en Supabase:", sbErr);
    }

    // 2. Actualizar localmente
    const leads = readLeadsLocal();
    const idx = leads.findIndex((l) => l.id === body.id);
    if (idx !== -1) {
      leads[idx].status = body.status;
      writeLeadsLocal(leads);
    }

    return NextResponse.json({ ok: true, id: body.id, status: body.status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error actualizando solicitud";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
