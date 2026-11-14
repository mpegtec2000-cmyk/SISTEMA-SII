"use server";

import { redirect } from "next/navigation";
import { DEMO_USERS, createSession, destroySession } from "@/lib/auth";

export async function loginAction(_: string | null, formData: FormData): Promise<string | null> {
  const ident = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "").trim();
  const next = String(formData.get("next") ?? "/dashboard");
  const user = DEMO_USERS.find(
    (u) => (u.email === ident || u.username?.toLowerCase() === ident) && u.password === password
  );
  if (!user) return "Usuario/correo o contraseña incorrectos.";
  await createSession({ email: user.email, name: user.name, role: user.role });
  redirect(next.startsWith("/") ? next : "/dashboard");
}

export async function logoutAction() {
  await destroySession();
  redirect("/");
}
