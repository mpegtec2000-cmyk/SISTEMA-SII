import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

export type Role = "PERSONA" | "EMPRESA" | "STAFF" | "ADMIN";

export type SessionUser = { email: string; name: string; role: Role; username?: string };

export const ROLE_LABEL: Record<Role, string> = {
  PERSONA: "Persona Natural",
  EMPRESA: "Empresa / PyME",
  STAFF: "Staff Profesional",
  ADMIN: "Super Administrador",
};

// Usuarios activos (incluye cuenta maestra solicitada Vision / Code + cuentas demo por rol).
export const DEMO_USERS: (SessionUser & { password: string })[] = [
  { email: "vision@finanzia.cl", username: "vision", name: "Vision", role: "ADMIN", password: "Code" },
  { email: "persona@finanzia.cl", username: "persona", name: "Camila Rojas", role: "PERSONA", password: "demo1234" },
  { email: "empresa@finanzia.cl", username: "empresa", name: "Comercial Andes SpA", role: "EMPRESA", password: "demo1234" },
  { email: "staff@finanzia.cl", username: "staff", name: "Matías Soto (Contador)", role: "STAFF", password: "demo1234" },
  { email: "admin@finanzia.cl", username: "admin", name: "Administración Finanzia", role: "ADMIN", password: "demo1234" },
];

export const COOKIE = "finanzia_session";

export function secretKey() {
  return new TextEncoder().encode(
    process.env.AUTH_SECRET ?? "dev-only-secret-change-me-in-production-32chars"
  );
}

export async function createSession(user: SessionUser) {
  const token = await new SignJWT({ ...user })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("8h")
    .sign(secretKey());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
}

export async function getSession(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return { email: payload.email as string, name: payload.name as string, role: payload.role as Role };
  } catch {
    return null;
  }
}

export async function destroySession() {
  const store = await cookies();
  store.delete(COOKIE);
  store.delete("erp_token");
  store.delete("erp_company");
}
