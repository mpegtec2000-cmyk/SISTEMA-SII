"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { loginAction } from "@/app/actions";

function Form() {
  const next = useSearchParams().get("next") ?? "/dashboard";
  const [error, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="card space-y-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <label className="label" htmlFor="email">Usuario o Correo</label>
        <input id="email" name="email" type="text" required placeholder="Vision" autoComplete="username" className="input" />
      </div>
      <div>
        <label className="label" htmlFor="password">Contraseña</label>
        <input id="password" name="password" type="password" required placeholder="••••••••" autoComplete="current-password" className="input" />
      </div>
      {error && <p className="text-xs font-medium text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>}
      <button disabled={pending} className="btn btn-primary w-full">{pending ? "Ingresando…" : "Ingresar al Ecosistema"}</button>
      <div className="rounded-xl bg-[#F7F8FA] border border-black/[0.06] p-3 text-xs text-zinc-600 space-y-1">
        <p className="font-semibold text-zinc-900">Acceso principal configurado:</p>
        <p>Usuario: <code className="font-mono font-bold text-zinc-950">Vision</code> · Clave: <code className="font-mono font-bold text-zinc-950">Code</code></p>
      </div>
    </form>
  );
}

export default function Login() {
  return (
    <main className="mx-auto max-w-md px-4 pt-16 pb-16">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 w-11 h-11 rounded-2xl bg-[#141416] text-white flex items-center justify-center shadow-md">
          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current" aria-hidden="true">
            <path d="M4 4h7v7H4V4zm9 0l7 7h-7V4zM4 13h7v7l-7-7zm9 0h7v7h-7v-7z" />
          </svg>
        </div>
        <h1 className="text-2xl font-extrabold text-zinc-950 tracking-tight">Ingresar a FINANZIA</h1>
        <p className="text-xs text-zinc-500 mt-1">Accede al Centro de Comando SaaS & ERP</p>
      </div>
      <Suspense><Form /></Suspense>
    </main>
  );
}
